"""Comprehensive Unit and Benchmark Tests for Spectral Similarity Engine.

Specification Anchors:
- SPECIFICATION.md §4.2.4 Item 1 (NumPy Cosine Similarity & BLAS GEMV Engine)
- tasks.md Dev 5 (role:E5-datasci) Issue #20 Acceptance Criteria
"""

from __future__ import annotations

import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

try:
    from backend.main import app
    from backend.science.similarity import (
        NUM_REFERENCE_TEMPLATES,
        SpectralSimilarityEngine,
        find_similar,
        get_similarity_engine,
    )
    from backend.science.wave import (
        BENCHMARK_TARGETS,
        generate_benchmark_sed_102,
        get_standard_channel_grid,
    )
except ImportError:
    from main import app
    from science.similarity import (
        NUM_REFERENCE_TEMPLATES,
        SpectralSimilarityEngine,
        find_similar,
        get_similarity_engine,
    )
    from science.wave import (
        BENCHMARK_TARGETS,
        generate_benchmark_sed_102,
        get_standard_channel_grid,
    )


@pytest.fixture(scope="module")
def similarity_engine() -> SpectralSimilarityEngine:
    """Fixture providing initialized SpectralSimilarityEngine."""
    return get_similarity_engine()


@pytest.fixture(scope="module")
def test_client() -> TestClient:
    """Fixture providing FastAPI test client."""
    return TestClient(app)


def test_engine_initialization(similarity_engine: SpectralSimilarityEngine) -> None:
    """Assert engine initializes 10,000 templates with shape (10000, 102) in float32."""
    assert similarity_engine.num_templates == NUM_REFERENCE_TEMPLATES
    assert similarity_engine.template_matrix.shape == (10000, 102)
    assert similarity_engine.template_matrix.dtype == np.float32
    assert similarity_engine.normalized_matrix.shape == (10000, 102)
    assert similarity_engine.normalized_matrix.dtype == np.float32

    # Assert matrix is C-contiguous for optimal SIMD evaluation
    assert similarity_engine.normalized_matrix.flags["C_CONTIGUOUS"]

    # Verify L2 norms are 1.0 (within float32 precision)
    norms = np.linalg.norm(similarity_engine.normalized_matrix, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-5)


def test_latency_benchmark_under_15ms(similarity_engine: SpectralSimilarityEngine) -> None:
    """Assert benchmark test evaluating 10,000 102-channel spectra completes in <15 ms on CPU."""
    # Create random synthetic query spectrum
    rng = np.random.default_rng(123)
    query = rng.uniform(0.01, 1.0, size=102).astype(np.float32).tolist()

    # Warmup
    _ = similarity_engine.find_similar(query, k=5)

    # Benchmark over 50 iterations
    latencies_ms = []
    for _ in range(50):
        t0 = time.perf_counter()
        matches = similarity_engine.find_similar(query, k=5)
        t1 = time.perf_counter()
        latencies_ms.append((t1 - t0) * 1000.0)

    median_latency_ms = float(np.median(latencies_ms))
    p95_latency_ms = float(np.percentile(latencies_ms, 95))

    # SPECIFICATION.md §4.2.4: Evaluation in <8 ms, acceptance criteria <15 ms
    assert median_latency_ms < 8.0, f"Median latency {median_latency_ms:.2f} ms exceeds 8 ms target"
    assert p95_latency_ms < 15.0, f"P95 latency {p95_latency_ms:.2f} ms exceeds 15 ms target"
    assert len(matches) == 5


def test_wise_0855_spectral_similarity(similarity_engine: SpectralSimilarityEngine) -> None:
    """Assert querying WISE 0855 returns Y-dwarf template as top match with similarity > 0.90."""
    waves = get_standard_channel_grid()
    target_wise = BENCHMARK_TARGETS["wise_0855"]
    flux, _, _, _, _, _ = generate_benchmark_sed_102(target_wise, waves)

    matches = similarity_engine.find_similar(flux.tolist(), k=5)
    assert len(matches) >= 1
    top_match = matches[0]

    # Verify top match is WISE 0855 or Y-dwarf with similarity > 0.90
    assert top_match["similarity"] >= 0.90, f"WISE 0855 similarity {top_match['similarity']} < 0.90"
    assert "Y" in top_match["spectral_class"] or "WISE 0855" in top_match["name"]


def test_epsilon_indi_b_spectral_similarity(similarity_engine: SpectralSimilarityEngine) -> None:
    """Assert querying Epsilon Indi B returns T-dwarf template as top match with similarity > 0.90."""
    waves = get_standard_channel_grid()
    target_eps = BENCHMARK_TARGETS["eps_indi_b"]
    flux, _, _, _, _, _ = generate_benchmark_sed_102(target_eps, waves)

    matches = similarity_engine.find_similar(flux.tolist(), k=5)
    assert len(matches) >= 1
    top_match = matches[0]

    assert top_match["similarity"] >= 0.90, f"Eps Indi B similarity {top_match['similarity']} < 0.90"
    assert "T" in top_match["spectral_class"] or "Epsilon Indi" in top_match["name"]


def test_barnards_star_spectral_similarity(similarity_engine: SpectralSimilarityEngine) -> None:
    """Assert querying Barnard's Star returns M-dwarf template as top match with similarity > 0.90."""
    waves = get_standard_channel_grid()
    target_barnard = BENCHMARK_TARGETS["barnards_star"]
    flux, _, _, _, _, _ = generate_benchmark_sed_102(target_barnard, waves)

    matches = similarity_engine.find_similar(flux.tolist(), k=5)
    assert len(matches) >= 1
    top_match = matches[0]

    assert top_match["similarity"] >= 0.90, f"Barnard's Star similarity {top_match['similarity']} < 0.90"
    assert "M" in top_match["spectral_class"] or "Barnard" in top_match["name"]


def test_edge_cases_all_zeros_and_nans(similarity_engine: SpectralSimilarityEngine) -> None:
    """Assert robust handling of all zeros, NaNs, and infinities without crashing."""
    zeros = [0.0] * 102
    matches_zeros = similarity_engine.find_similar(zeros, k=5)
    assert len(matches_zeros) == 5

    nans = [float("nan")] * 102
    matches_nans = similarity_engine.find_similar(nans, k=5)
    assert len(matches_nans) == 5

    infs = [float("inf") if i % 2 == 0 else -float("inf") for i in range(102)]
    matches_infs = similarity_engine.find_similar(infs, k=5)
    assert len(matches_infs) == 5


def test_api_subjects_similar_endpoint(test_client: TestClient) -> None:
    """Test POST /api/subjects/similar endpoint."""
    waves = get_standard_channel_grid()
    target_wise = BENCHMARK_TARGETS["wise_0855"]
    flux, _, _, _, _, _ = generate_benchmark_sed_102(target_wise, waves)

    response = test_client.post(
        "/api/subjects/similar",
        json={"spectrum": flux.tolist()},
    )
    assert response.status_code == 200
    data = response.json()
    assert "matches" in data
    matches = data["matches"]
    assert len(matches) == 5
    assert matches[0]["similarity"] >= 0.90

    # Test with empty payload (fallback)
    res_empty = test_client.post("/api/subjects/similar", json={})
    assert res_empty.status_code == 200
    assert len(res_empty.json()["matches"]) == 5

    # Test with invalid type
    res_invalid = test_client.post(
        "/api/subjects/similar",
        json={"spectrum": ["not_a_number", "another"]},
    )
    assert res_invalid.status_code == 400


def test_global_find_similar_function() -> None:
    """Test convenience global find_similar function."""
    query = [1.0] * 102
    res = find_similar(query, k=3)
    assert len(res) == 3
    for r in res:
        assert "name" in r
        assert "similarity" in r
        assert "flux_curve" in r
        assert len(r["flux_curve"]) == 102
