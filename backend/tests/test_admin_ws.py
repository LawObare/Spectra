import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
for p in (REPO_ROOT, BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from backend import admin_ws


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(admin_ws, "hub", admin_ws.AdminTelemetryHub())
    app = FastAPI()
    app.include_router(admin_ws.router)
    return TestClient(app)


def test_retrain_403_when_mutations_disabled(client, monkeypatch):
    monkeypatch.setenv("ADMIN_MUTATIONS_ENABLED", "false")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    assert client.post("/api/admin/retrain", headers={"X-Admin-Token": "s3cret"}, json={}).status_code == 403


def test_retrain_403_on_bad_token(client, monkeypatch):
    monkeypatch.setenv("ADMIN_MUTATIONS_ENABLED", "true")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    assert client.post("/api/admin/retrain", headers={"X-Admin-Token": "nope"}, json={}).status_code == 403
    assert client.post("/api/admin/retrain", json={}).status_code == 403


def test_retrain_202_with_valid_token(client, monkeypatch):
    from backend.ml import trainer
    monkeypatch.setattr(trainer, "run_training", lambda *a, **k: [])
    monkeypatch.setenv("ADMIN_MUTATIONS_ENABLED", "true")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    r = client.post("/api/admin/retrain", headers={"Authorization": "Bearer s3cret"}, json={"epochs": 2})
    assert r.status_code == 202


def test_ws_replays_cached_frames(client, monkeypatch):
    from backend.ml import trainer
    frames = [{"type": "epoch", "epoch": i} for i in range(1, 4)]
    monkeypatch.setattr("backend.ml.replay_exists", lambda m: True)
    monkeypatch.setattr(trainer, "load_replay", lambda m: frames)
    with client.websocket_connect("/api/admin/ws/training?model=AstroFeatureSVM") as ws:
        assert ws.receive_json()["type"] == "status"
        assert [ws.receive_json()["epoch"] for _ in range(3)] == [1, 2, 3]


def test_no_torch_or_sklearn_on_import():
    env = dict(os.environ, PYTHONPATH=str(REPO_ROOT))
    code = "import sys, backend.admin_ws; assert 'torch' not in sys.modules and 'sklearn' not in sys.modules"
    subprocess.run([sys.executable, "-c", code], env=env, check=True)


def test_studio_train_returns_202_and_runs_lora_dft(client):
    r = client.post(
        "/api/admin/studio/train",
        json={
            "model": "SpectralResNet102",
            "custom_name": "my-y4-detector",
            "epochs": 3,
            "lora_r": 8,
            "lora_alpha": 32,
            "loss_type": "dft",
            "completion_only_loss": True,
            "packing": True,
        },
    )
    assert r.status_code == 202
    payload = r.json()
    assert payload["status"] == "started"
    assert payload["config"]["lora_r"] == 8
    assert payload["config"]["loss_type"] == "dft"
    # Wait briefly for fast 3-epoch background CPU task to release _training_lock
    import time
    for _ in range(50):
        st = client.get("/api/admin/studio/frames?model=SpectralResNet102").json()
        if not st["training_active"] and len(st["frames"]) >= 3:
            break
        time.sleep(0.05)
    assert len(st["frames"]) >= 3
    assert "trl" in st["frames"][-1]
    assert st["frames"][-1]["trl"]["loss_type"] == "dft"
    assert st["frames"][-1]["trl"]["param_summary"]["lora_params"] > 0

    models_resp = client.get("/api/admin/models").json()
    assert len(models_resp["base_models"]) == 3
    assert all("layer_specs" in m and len(m["layer_specs"]) >= 2 for m in models_resp["base_models"])
    assert all("supported_classes" in m and len(m["supported_classes"]) == 6 for m in models_resp["base_models"])
    matched = [m for m in models_resp["trained_models"] if m["custom_name"] == "my-y4-detector"]
    assert len(matched) >= 1

    # Promote checkpoint as active identification model
    promo = client.post("/api/admin/models/promote", json={"model_id": matched[0]["model_id"]})
    assert promo.status_code == 200
    assert promo.json()["promoted_model_id"] == matched[0]["model_id"]
    spec_card = next(m for m in promo.json()["base_models"] if m["model_name"] == "SpectralResNet102")
    assert spec_card["active_checkpoint"]["model_id"] == matched[0]["model_id"]


def test_knowledge_graph_base_and_trained(client):
    r_tr = client.get("/api/admin/graph?model=SpectralResNet102&space=trained&min_similarity=0.2")
    r_bs = client.get("/api/admin/graph?model=SpectralResNet102&space=base&min_similarity=0.2")
    assert r_tr.status_code == 200 and r_bs.status_code == 200
    g_tr = r_tr.json()
    assert g_tr["embedding_space"] == "trained"
    assert any(n["kind"] == "target" for n in g_tr["nodes"])
    assert all("z" in n for n in g_tr["nodes"])
    assert any(n["kind"] == "feature" for n in g_tr["nodes"])
    assert any(n["kind"] == "class" for n in g_tr["nodes"])
    assert any(n["kind"] == "template" for n in g_tr["nodes"])
    assert len(g_tr["edges"]) >= 10


def test_identify_targets_returns_gradcam_and_102_saliency(client):
    r = client.get("/api/admin/identify?model=SpectralResNet102")
    assert r.status_code == 200
    data = r.json()
    assert len(data["targets"]) >= 5
    sel = data["selected"]
    assert sel is not None
    assert len(sel["channel_saliency_102"]) == 102
    assert len(sel["gradcam_32x32"]) == 32 and len(sel["gradcam_32x32"][0]) == 32
    assert len(sel["stamp_32x32"]) == 32
    assert "<think>" in sel["reasoning_trace"]
    assert 0.0 <= sel["base_anomaly_prob"] <= 1.0
    assert 0.0 <= sel["trained_anomaly_prob"] <= 1.0
    assert isinstance(sel["class_probabilities"], list) and len(sel["class_probabilities"]) == 6
    assert abs(sum(c["trained_prob"] for c in sel["class_probabilities"]) - 1.0) < 0.05
    assert "source_centroid" in sel
    assert 0.0 <= sel["source_centroid"]["x"] <= 32.0
    assert 0.0 <= sel["source_centroid"]["y"] <= 32.0
    assert sel["source_centroid"]["radius_px"] >= 2.0
    assert "base_predicted_domain" in sel
    wise_target = next((t for t in data["targets"] if "wise" in t["label"].lower()), None)
    if wise_target is not None:
        assert wise_target["predicted_domain"] == "Brown Dwarf (Y/T/L)"


def test_sft_dataset_all_four_schemas_and_feedback_loop(client):
    fb = client.post(
        "/api/admin/sft-dataset/feedback",
        json={
            "target_id": "wise_0855",
            "label": "WISE 0855-0714",
            "predicted_class": "Brown Dwarf (Y/T/L)",
            "human_class": "Brown Dwarf (Y/T/L)",
            "action": "confirmed",
            "reasoning": "Strong 3.32um CH4 absorption & red D5 excess confirmed.",
        },
    )
    assert fb.status_code == 200 and fb.json()["total_feedback"] >= 1

    for schema, key in (
        ("prompt_completion", "prompt"),
        ("conversational", "messages"),
        ("vlm", "images"),
        ("tool_calling", "tools"),
    ):
        r = client.get(f"/api/admin/sft-dataset?schema={schema}")
        assert r.status_code == 200
        d = r.json()
        assert d["schema"] == schema
        assert d["total_records"] >= 5
        assert key in d["records"][0]
        assert "<think>" in d["jsonl"]
        assert "class_buckets" in d and len(d["class_buckets"]) == 6
        assert "split_summary" in d and (d["split_summary"]["train"] + d["split_summary"]["val"]) == d["total_records"]


def test_main_mounts_admin_router():
    from backend.main import app

    openapi_paths = set(app.openapi()["paths"].keys())
    assert "/api/admin/retrain" in openapi_paths
    assert "/api/admin/studio/train" in openapi_paths
    assert "/api/admin/graph" in openapi_paths
    assert "/api/admin/identify" in openapi_paths
    assert "/api/admin/sft-dataset" in openapi_paths
