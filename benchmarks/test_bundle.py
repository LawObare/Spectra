"""Unit tests for SPHEREx Offline Benchmark Bundles (.f32 & .json).

Specification Anchors:
- SPECIFICATION.md §2.2, §3.2, §6.1.6, §10.5
- Wire format: little-endian JSON header + 14 B/px binary planes (FLUX, VARIANCE, FLAGS, N_EXPOSURES)
- tasks.md Dev 6 (role:E6-devops) Issue #13
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

from scripts.build_benchmark_bundle import (
    DEFAULT_CUTOUT_DIM,
    NUM_BANDS,
    NUM_EPOCHS,
    generate_benchmark_metadata,
    generate_benchmark_tensor,
)

from benchmarks.build import BENCHMARK_TARGETS


def parse_binary_tensor_buffer(buf: bytes) -> dict:
    """Parse canonical 14 B/px binary tensor according to wire contract."""
    assert len(buf) >= 4, "Buffer too small for header length"
    header_len = struct.unpack("<I", buf[:4])[0]
    assert len(buf) >= 4 + header_len, "Buffer truncated before header end"

    header_bytes = buf[4 : 4 + header_len]
    header = json.loads(header_bytes.decode("utf-8"))

    epochs, bands, height, width = header["shape"]
    total_pixels = epochs * bands * height * width

    expected_payload_bytes = (
        total_pixels * 4  # FLUX (float32)
        + total_pixels * 4  # VARIANCE (float32)
        + total_pixels * 4  # FLAGS (uint32)
        + total_pixels * 2  # N_EXPOSURES (uint16)
    )
    assert len(buf) == 4 + header_len + expected_payload_bytes, (
        f"Buffer size {len(buf)} != 4 + {header_len} + {expected_payload_bytes}"
    )

    offset = 4 + header_len
    flux = struct.unpack(f"<{total_pixels}f", buf[offset : offset + total_pixels * 4])
    offset += total_pixels * 4

    variance = struct.unpack(f"<{total_pixels}f", buf[offset : offset + total_pixels * 4])
    offset += total_pixels * 4

    flags = struct.unpack(f"<{total_pixels}I", buf[offset : offset + total_pixels * 4])
    offset += total_pixels * 4

    n_exp = struct.unpack(f"<{total_pixels}H", buf[offset : offset + total_pixels * 2])

    return {
        "header": header,
        "total_pixels": total_pixels,
        "flux": flux,
        "variance": variance,
        "flags": flags,
        "n_exp": n_exp,
    }


def test_tensor_wire_format_conformance():
    """Verify that all 5 benchmark targets generate strictly conforming binary tensors."""
    dim = DEFAULT_CUTOUT_DIM
    total_px = NUM_EPOCHS * NUM_BANDS * dim * dim

    for target in BENCHMARK_TARGETS:
        buf = generate_benchmark_tensor(target, dim=dim)
        parsed = parse_binary_tensor_buffer(buf)

        assert parsed["header"]["shape"] == [NUM_EPOCHS, NUM_BANDS, dim, dim]
        assert parsed["header"]["release"] == "spherex_qr2"
        assert parsed["header"]["source_badge"] == "NASA Benchmark (Pre-cached)"
        assert parsed["header"]["compression"] == "none"
        assert len(parsed["flux"]) == total_px
        assert len(parsed["variance"]) == total_px
        assert len(parsed["flags"]) == total_px
        assert len(parsed["n_exp"]) == total_px


def test_barnard_star_proper_motion_and_saturation():
    """Verify Barnard's Star motion (+1.68 px/yr North) and OVERFLOW core flag."""
    target = next(t for t in BENCHMARK_TARGETS if t.subject_id == "benchmark_barnard")
    dim = DEFAULT_CUTOUT_DIM
    buf = generate_benchmark_tensor(target, dim=dim)
    parsed = parse_binary_tensor_buffer(buf)

    # In epoch 0 (P1), target is near center (14, 14)
    # Band D1 is index 0
    def find_peak_2d(epoch: int, band: int) -> tuple[int, int, float]:
        plane_start = (epoch * NUM_BANDS + band) * (dim * dim)
        max_val = -1.0
        peak_x, peak_y = -1, -1
        for y in range(dim):
            for x in range(dim):
                val = parsed["flux"][plane_start + y * dim + x]
                if val > max_val:
                    max_val = val
                    peak_x, peak_y = x, y
        return peak_x, peak_y, max_val

    x0, y0, _f0 = find_peak_2d(0, 0)
    x2, y2, _f2 = find_peak_2d(2, 0)

    # North motion corresponds to increasing y
    dy = y2 - y0
    assert 1 <= dy <= 2, f"Expected Barnard's Star to move ~1.7 px North, got {dy} px"
    assert abs(x2 - x0) <= 1, "Expected negligible East-West motion"

    # Core saturation check in D1
    saturated_pixels = [flag for flag in parsed["flags"] if (flag & 2) != 0]
    assert len(saturated_pixels) > 0, "Expected OVERFLOW flag (bit 1) on Barnard's Star core"


def test_wise_0855_thermal_detection_profile():
    """Verify WISE 0855 is undetectable in D1-D3 and detected in D5/D6 coadds."""
    target = next(t for t in BENCHMARK_TARGETS if t.subject_id == "benchmark_wise_0855")
    dim = DEFAULT_CUTOUT_DIM
    buf = generate_benchmark_tensor(target, dim=dim)
    parsed = parse_binary_tensor_buffer(buf)

    # Check Band D1 (0) vs Band D5 (4) in Epoch 0
    d1_start = (0 * NUM_BANDS + 0) * (dim * dim)
    d5_start = (0 * NUM_BANDS + 4) * (dim * dim)

    max_d1 = max(parsed["flux"][d1_start : d1_start + dim * dim])
    max_d5 = max(parsed["flux"][d5_start : d5_start + dim * dim])

    assert max_d1 < 0.15, f"WISE 0855 should be non-detected in D1 (<0.15), got {max_d1}"
    assert max_d5 > 1.5, f"WISE 0855 should have strong thermal peak in D5 (>1.5), got {max_d5}"


def test_rw_aurigae_disk_occultation_dimming():
    """Verify RW Aurigae exhibits >1.5 mag occultation dimming between Pass 1 and Pass 2."""
    target = next(t for t in BENCHMARK_TARGETS if t.subject_id == "benchmark_rw_aur")
    dim = DEFAULT_CUTOUT_DIM
    buf = generate_benchmark_tensor(target, dim=dim)
    parsed = parse_binary_tensor_buffer(buf)

    # Peak flux in Epoch 0 vs Epoch 1 for Band 0
    e0_start = (0 * NUM_BANDS + 0) * (dim * dim)
    e1_start = (1 * NUM_BANDS + 0) * (dim * dim)

    max_e0 = max(parsed["flux"][e0_start : e0_start + dim * dim])
    max_e1 = max(parsed["flux"][e1_start : e1_start + dim * dim])

    dimming_ratio = max_e0 / max_e1
    # 1.5 magnitudes is a flux ratio of 10^(1.5/2.5) ~ 3.98
    assert dimming_ratio > 3.5, f"Expected >1.5 mag dimming (ratio >3.5), got {dimming_ratio:.2f}"


def test_companion_metadata_json():
    """Verify companion JSON metadata matches target definitions and contains 102 channels."""
    for target in BENCHMARK_TARGETS:
        meta = generate_benchmark_metadata(target)
        assert meta["target_id"] == target.subject_id
        assert meta["name"] == target.title
        assert meta["class"] == target.object_class
        assert meta["category"] == "benchmark"
        assert meta["is_calibration"] is True
        assert meta["spectrum"]["channels"] == 102
        assert len(meta["spectrum"]["wavelengths_um"]) == 102
        assert len(meta["spectrum"]["flux_mjy_sr"]) == 102
        assert len(meta["spectrum"]["variance"]) == 102
        assert meta["wcs"]["ctype"] == ["RA---TAN", "DEC--TAN"]


def test_static_files_exist_in_web_client():
    """Verify generated files exist in web-client/public/benchmarks/."""
    public_dir = Path(__file__).resolve().parent.parent / "web-client" / "public" / "benchmarks"
    assert public_dir.exists(), "web-client/public/benchmarks directory missing"

    for filename in ["barnards_star", "wise_0855", "eps_indi_b", "rw_aur", "r_dra"]:
        f32 = public_dir / f"{filename}.f32"
        json_file = public_dir / f"{filename}.json"
        assert f32.exists(), f"Missing {f32}"
        assert json_file.exists(), f"Missing {json_file}"
        assert f32.stat().st_size > 200_000, f"File {f32} unexpectedly small"


def test_review_audit_regressions():
    """Verify exposure_ids have no '_arnard' truncation, post-May 2025 MJDs, and spatially varying variance."""
    import statistics

    target = next(t for t in BENCHMARK_TARGETS if t.subject_id == "benchmark_barnard")
    buf = generate_benchmark_tensor(target)
    parsed = parse_binary_tensor_buffer(buf)
    hdr = parsed["header"]

    # 1. Exposure IDs must end with _barnard, never _arnard
    flat_ids = [eid for pass_ids in hdr["exposure_ids"] for eid in pass_ids]
    assert all(eid.endswith("_barnard") for eid in flat_ids), f"Unexpected exposure IDs: {flat_ids}"

    # 2. Survey pass MJDs must start after May 2025 (MJD >= 60789)
    for mjd_start, mjd_end in hdr["mjd_ranges"]:
        assert mjd_start >= 60789.0, f"Pre-launch MJD detected: {mjd_start}"
        assert mjd_end > mjd_start

    # 3. Variance plane is spatially varying (not constant 0.1225) and median flux > 0 (zodiacal background)
    unique_vars = {round(v, 5) for v in parsed["variance"][: 29 * 29]}
    assert len(unique_vars) > 50, "Variance plane should vary spatially with photon/flat statistics"
    assert statistics.median(parsed["flux"]) > 0.01, "Median flux should reflect non-zero zodiacal background"
    assert hdr.get("is_simulated") is True

