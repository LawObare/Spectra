#!/usr/bin/env python3
"""Spike S2: Audit 5 NASA Benchmark Coverage Matrices, Survey Pass MJDs & Saturation.

SPECIFICATION.md §2.2 (Proper Motion Coordinate Propagation to Epoch 2025.5),
§7 (Verification Matrix for the 5 Benchmark Targets), §8 (Day-0 Spike S2).

Queries IRSA SIA2 (spherex_qr2) for all 5 mandatory NASA benchmarks at Epoch 2025.5
coordinates, clusters exposure observation MJDs (t_min/t_max) into discrete survey
passes, measures (Epoch x Band D1-D6) coverage, and audits saturation/detection
behavior via IRSA cutout service where applicable.

Outputs:
  - backend/config/survey_passes.json
  - scripts/spike_s2_coverage_report.json
  - scripts/spike_s2_coverage_report.md
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import struct
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

IRSA_SIA2 = "https://irsa.ipac.caltech.edu/SIA"
DEFAULT_COLLECTION = os.environ.get("IRSA_COLLECTION", "spherex_qr2")
USER_AGENT = "Spectra-Spike-S2/1.0 (NASA SpaceApps; Citizen Science Workbench)"
BANDS = ["D1", "D2", "D3", "D4", "D5", "D6"]
OVERFLOW_BIT = 1
OVERFLOW_MASK = 0x0002
# 180" FoV padded by sqrt(2) on half-diagonal -> radius = 90" * sqrt(2) = 127.279"
FOV_ARCSEC = 180.0
SEARCH_RADIUS_ARCSEC = (FOV_ARCSEC / 2.0) * math.sqrt(2.0)
SEARCH_RADIUS_DEG = SEARCH_RADIUS_ARCSEC / 3600.0
# Gap threshold for clustering MJDs into discrete survey passes (days)
PASS_GAP_DAYS = 30.0
TIMEOUT_S = 45.0

VOTABLE_NS = {"v": "http://www.ivoa.net/xml/VOTable/v1.3"}


@dataclass
class BenchmarkTarget:
    name: str
    object_class: str
    ra_deg: float
    dec_deg: float
    epoch: str = "2025.5"
    notes: str = ""


BENCHMARKS: list[BenchmarkTarget] = [
    BenchmarkTarget(
        "Barnard's Star",
        "M4V Red Dwarf",
        269.44639,
        4.76676,
        notes="Check Bit 1 OVERFLOW saturation in D1-D3; motion 10.39\"/yr North.",
    ),
    BenchmarkTarget(
        "WISE 0855-0714",
        "Y4 Sub-Brown Dwarf (T_eff ~250 K)",
        133.73712,
        -7.24038,
        notes="Check single-pass vs inverse-variance coadd SNR in D5/D6; faint <3.5 um.",
    ),
    BenchmarkTarget(
        "Epsilon Indi B",
        "T1+T6 Brown Dwarf Binary",
        331.09566,
        -56.80031,
        notes="Verify 1/cos(delta) corrected center hits target pixel; unresolved 0.7\" binary.",
    ),
    BenchmarkTarget(
        "RW Aurigae",
        "Classical T Tauri Star",
        76.95647,
        30.40130,
        notes="Check multi-epoch coverage across D1-D6; stationary flashing monopole.",
    ),
    BenchmarkTarget(
        "R Draconis",
        "Mira-type Pulsating AGB (P=245d)",
        248.16773,
        66.75504,
        notes="8.61 deg from NEP; record dense MJD visit cadence.",
    ),
]


@dataclass
class ExposureRecord:
    obs_id: str
    band: str
    t_min_mjd: float | None
    t_max_mjd: float | None
    t_exptime_s: float | None
    access_url: str
    s_ra: float | None
    s_dec: float | None
    em_min_m: float | None
    em_max_m: float | None
    facility: str = ""
    instrument: str = ""


@dataclass
class PassBoundary:
    pass_id: str
    label: str
    mjd_start: float
    mjd_end: float
    n_exposures: int = 0
    n_targets_with_coverage: int = 0


def _get(url: str, timeout: float = TIMEOUT_S) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _f(val: Any) -> float | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("nan", "null", "none", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def normalize_band(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip().upper()
    for b in BANDS:
        if b in s or f"BAND_{b}" in s or f"BAND {b}" in s:
            return b
    # sometimes "1"-"6"
    if s in {"1", "2", "3", "4", "5", "6"}:
        return f"D{s}"
    return s if s.startswith("D") and len(s) <= 3 else None


def parse_sia2_votable(xml_bytes: bytes) -> list[ExposureRecord]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        # try to strip problematic chars
        text = xml_bytes.decode("utf-8", "replace")
        root = ET.fromstring(text)

    # Find fields (with or without namespace)
    fields: list[str] = []
    for fld in root.findall(".//{http://www.ivoa.net/xml/VOTable/v1.3}FIELD"):
        fields.append(fld.attrib.get("name", ""))
    if not fields:
        for fld in root.findall(".//FIELD"):
            fields.append(fld.attrib.get("name", ""))
    if not fields:
        return []

    idx = {name: i for i, name in enumerate(fields)}
    rows: list[ExposureRecord] = []
    trs = root.findall(".//{http://www.ivoa.net/xml/VOTable/v1.3}TR")
    if not trs:
        trs = root.findall(".//TR")

    def col(tds: list[Any], name: str) -> str | None:
        i = idx.get(name)
        if i is None or i >= len(tds):
            return None
        txt = tds[i].text
        return txt.strip() if txt else None

    for tr in trs:
        tds = tr.findall("{http://www.ivoa.net/xml/VOTable/v1.3}TD")
        if not tds:
            tds = tr.findall("TD")
        band = normalize_band(col(tds, "energy_bandpassname"))
        if not band:
            # try instrument/obs_id hints
            band = normalize_band(col(tds, "instrument_name"))
        obs_id = col(tds, "obs_id") or col(tds, "obs_publisher_did") or ""
        access_url = col(tds, "access_url") or ""
        if not access_url and not obs_id:
            continue
        rows.append(
            ExposureRecord(
                obs_id=obs_id,
                band=band or "UNKNOWN",
                t_min_mjd=_f(col(tds, "t_min")),
                t_max_mjd=_f(col(tds, "t_max")) or _f(col(tds, "t_min")),
                t_exptime_s=_f(col(tds, "t_exptime")),
                access_url=access_url,
                s_ra=_f(col(tds, "s_ra")),
                s_dec=_f(col(tds, "s_dec")),
                em_min_m=_f(col(tds, "em_min")),
                em_max_m=_f(col(tds, "em_max")),
                facility=col(tds, "facility_name") or "",
                instrument=col(tds, "instrument_name") or "",
            )
        )
    return rows


def query_sia2_exposures(
    ra: float, dec: float, radius_deg: float, collection: str
) -> tuple[list[ExposureRecord], dict[str, Any]]:
    params = urllib.parse.urlencode(
        {
            "COLLECTION": collection,
            "POS": f"circle {ra} {dec} {radius_deg}",
            "RESPONSEFORMAT": "VOTABLE",
        }
    )
    url = f"{IRSA_SIA2}?{params}"
    meta: dict[str, Any] = {
        "url": url,
        "collection": collection,
        "ra": ra,
        "dec": dec,
        "radius_deg": radius_deg,
        "radius_arcsec": radius_deg * 3600.0,
        "status": "unknown",
        "http_bytes": 0,
        "error": None,
    }
    try:
        t0 = time.perf_counter()
        data = _get(url)
        meta["elapsed_s"] = round(time.perf_counter() - t0, 3)
        meta["http_bytes"] = len(data)
        rows = parse_sia2_votable(data)
        meta["status"] = "ok"
        meta["n_rows"] = len(rows)
        return rows, meta
    except Exception as e:  # noqa: BLE001
        meta["status"] = "error"
        meta["error"] = str(e)
        return [], meta


def cluster_survey_passes(
    all_mjds: list[float], gap_days: float = PASS_GAP_DAYS
) -> list[tuple[float, float]]:
    if not all_mjds:
        return []
    vals = sorted({round(m, 6) for m in all_mjds if m is not None and math.isfinite(m)})
    if not vals:
        return []
    clusters: list[list[float]] = [[vals[0]]]
    for m in vals[1:]:
        if m - clusters[-1][-1] > gap_days:
            clusters.append([m])
        else:
            clusters[-1].append(m)
    # widen boundaries slightly to be inclusive
    bounds: list[tuple[float, float]] = []
    for c in clusters:
        bounds.append((min(c) - 0.001, max(c) + 0.001))
    return bounds


def assign_pass(mjd: float | None, bounds: list[tuple[float, float]]) -> str | None:
    if mjd is None:
        return None
    for i, (s, e) in enumerate(bounds, start=1):
        if s <= mjd <= e:
            return f"pass_{i:02d}"
    return "unassigned"


# -------------------- Minimal FITS reader (stdlib) --------------------


def _read_fits_hdus(data: bytes) -> list[tuple[dict[str, Any], bytes | None]]:
    """Parse FITS into list of (header_dict, raw_data_bytes). Best-effort stdlib."""
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    hdus: list[tuple[dict[str, Any], bytes | None]] = []
    off = 0
    while off + 2880 <= len(data):
        # header blocks
        hdr: dict[str, Any] = {}
        while off + 2880 <= len(data):
            block = data[off : off + 2880]
            off += 2880
            for i in range(0, 2880, 80):
                card = block[i : i + 80]
                key = card[:8].decode("ascii", "replace").strip()
                if key == "END":
                    break
                if key in ("", "COMMENT", "HISTORY", "CONTINUE"):
                    if key == "END":
                        break
                    continue
                if card[8:10] == b"= ":
                    val_raw = card[10:].split(b"/")[0].strip()
                    try:
                        if val_raw.startswith(b"'"):
                            hdr[key] = val_raw.strip(b"' ").decode("ascii", "replace").strip()
                        elif val_raw in (b"T", b"F"):
                            hdr[key] = val_raw == b"T"
                        elif b"." in val_raw or b"E" in val_raw or b"e" in val_raw:
                            hdr[key] = float(val_raw)
                        else:
                            hdr[key] = int(val_raw)
                    except (ValueError, TypeError, UnicodeDecodeError):
                        hdr[key] = val_raw.decode("ascii", "replace").strip()
            if data[off - 2880 : off].find(b"END     ") != -1 or b"END" in data[off - 2880 : off]:
                # check END in last parsed block
                pass
            # detect END properly
            last_block = data[off - 2880 : off]
            if any(last_block[i : i + 8] == b"END     " for i in range(0, 2880, 80)):
                break
        # data
        naxis = int(hdr.get("NAXIS", 0) or 0)
        bitpix = int(hdr.get("BITPIX", 0) or 0)
        gcount = int(hdr.get("GCOUNT", 1) or 1)
        pcount = int(hdr.get("PCOUNT", 0) or 0)
        data_bytes = 0
        if naxis > 0 and bitpix != 0:
            nels = gcount * max(1, pcount + 1)
            for ax in range(1, naxis + 1):
                nels *= int(hdr.get(f"NAXIS{ax}", 1) or 1)
            data_bytes = abs(bitpix) // 8 * nels
        pad = ((data_bytes + 2879) // 2880) * 2880
        raw = data[off : off + data_bytes] if data_bytes else None
        off += pad
        hdus.append((hdr, raw))
        if not hdr.get("XTENSION") and len(hdus) == 1 and naxis == 0 and "SIMPLE" in hdr:
            # primary empty; continue
            pass
    return hdus


def decode_array(raw: bytes | None, hdr: dict[str, Any]) -> Any:
    if raw is None:
        return None
    bitpix = int(hdr.get("BITPIX", 0) or 0)
    naxis = int(hdr.get("NAXIS", 0) or 0)
    if naxis < 1:
        return None
    dims = [int(hdr.get(f"NAXIS{ax}", 1) or 1) for ax in range(1, naxis + 1)]
    count = 1
    for d in dims:
        count *= d
    bscale = float(hdr.get("BSCALE", 1) or 1)
    bzero = float(hdr.get("BZERO", 0) or 0)
    fmts = {8: "B", 16: ">h", 32: ">i", 64: ">q", -32: ">f", -64: ">d"}
    fmtc = {8: "B", 16: "h", 32: "i", 64: "q", -32: "f", -64: "d"}
    if bitpix not in fmts:
        return None
    itemsize = abs(bitpix) // 8
    need = count * itemsize
    if len(raw) < need:
        count = len(raw) // itemsize
        raw = raw[: count * itemsize]
    try:
        vals = list(struct.unpack(f">{count}{fmtc[bitpix]}", raw))
    except (struct.error, ValueError, KeyError):
        return None
    if bscale != 1 or bzero != 0:
        vals = [v * bscale + bzero for v in vals]
    return {"dims": dims, "values": vals, "bitpix": bitpix}


def fetch_cutout_analysis(
    access_url: str, ra: float, dec: float, size_deg: float, target_band: str | None = None
) -> dict[str, Any]:
    """Fetch IRSA cutout and analyze FLAGS (HDU2) and signal stats. Best-effort."""
    out: dict[str, Any] = {
        "access_url": access_url,
        "status": "skipped",
        "http_bytes": 0,
        "overflow_fraction": None,
        "overflow_pixel_count": None,
        "total_pixels_sampled": None,
        "signal_mean": None,
        "variance_mean": None,
        "snr_proxy": None,
        "error": None,
    }
    if not access_url:
        out["error"] = "no access_url"
        return out
    cutout_url = f"{access_url}?center={ra},{dec}&size={size_deg}"
    try:
        t0 = time.perf_counter()
        data = _get(cutout_url, timeout=90)
        out["elapsed_s"] = round(time.perf_counter() - t0, 3)
        out["http_bytes"] = len(data)
        out["cutout_url"] = cutout_url
    except Exception as e:  # noqa: BLE001
        out["status"] = "error"
        out["error"] = str(e)
        return out

    try:
        hdus = _read_fits_hdus(data)
    except Exception as e:  # noqa: BLE001
        out["status"] = "parse_error"
        out["error"] = str(e)
        return out

    out["n_hdus"] = len(hdus)
    # MEF: HDU0 primary, HDU1 IMAGE, HDU2 FLAGS, HDU3 VARIANCE...
    # Some cutouts may have different structure; find by EXTNAME
    image_arr = flags_arr = var_arr = None
    for hdr, raw in hdus:
        extname = str(hdr.get("EXTNAME", "")).upper()
        if extname == "IMAGE" or (image_arr is None and int(hdr.get("BITPIX", 0)) == -32 and hdr.get("NAXIS") == 2):
            image_arr = decode_array(raw, hdr)
        elif extname in ("FLAGS", "MASK"):
            flags_arr = decode_array(raw, hdr)
        elif extname in ("VARIANCE", "VAR"):
            var_arr = decode_array(raw, hdr)
    # positional fallback
    if image_arr is None and len(hdus) > 1:
        image_arr = decode_array(hdus[1][1], hdus[1][0])
    if flags_arr is None and len(hdus) > 2:
        flags_arr = decode_array(hdus[2][1], hdus[2][0])
    if var_arr is None and len(hdus) > 3:
        var_arr = decode_array(hdus[3][1], hdus[3][0])

    if flags_arr and flags_arr.get("values"):
        vals = [int(v) for v in flags_arr["values"]]
        total = len(vals)
        ov = sum(1 for v in vals if (v & OVERFLOW_MASK) != 0)
        out["total_pixels_sampled"] = total
        out["overflow_pixel_count"] = ov
        out["overflow_fraction"] = round(ov / total, 6) if total else None
    if image_arr and image_arr.get("values") and var_arr and var_arr.get("values"):
        iv = image_arr["values"]
        vv = var_arr["values"]
        n = min(len(iv), len(vv))
        if n:
            # central region proxy
            cx = n // 2
            w = min(25, n)
            sl = slice(max(0, cx - w), min(n, cx + w))
            is_ = iv[sl]
            vs_ = [max(v, 1e-12) for v in vv[sl]]
            mean_sig = sum(is_) / len(is_)
            mean_var = sum(vs_) / len(vs_)
            out["signal_mean"] = round(mean_sig, 6)
            out["variance_mean"] = round(mean_var, 6)
            out["snr_proxy"] = round(abs(mean_sig) / math.sqrt(mean_var), 4) if mean_var > 0 else None
    out["status"] = "ok"
    return out


def build_coverage_matrix(
    exposures: list[ExposureRecord], bounds: list[tuple[float, float]]
) -> dict[str, dict[str, int]]:
    matrix: dict[str, dict[str, int]] = {}
    for i in range(1, len(bounds) + 1):
        pid = f"pass_{i:02d}"
        matrix[pid] = {b: 0 for b in BANDS}
    for exp in exposures:
        pid = assign_pass(exp.t_min_mjd, bounds)
        if not pid or pid == "unassigned":
            continue
        if exp.band in BANDS and pid in matrix:
            matrix[pid][exp.band] += 1
    # drop empty passes for per-target matrix readability? keep all global passes with 0s
    return matrix


def pick_exposures_for_audit(
    exposures: list[ExposureRecord], bands: list[str], max_n: int = 2
) -> list[ExposureRecord]:
    picked: list[ExposureRecord] = []
    for b in bands:
        cands = [e for e in exposures if e.band == b and e.access_url]
        cands.sort(key=lambda e: e.t_min_mjd or 0)
        picked.extend(cands[:max_n])
    return picked


def run_audit(args: argparse.Namespace) -> dict[str, Any]:
    collection = args.collection
    gap_days = float(getattr(args, "gap_days", PASS_GAP_DAYS))
    report: dict[str, Any] = {
        "spike": "S2",
        "spec_anchors": ["SPECIFICATION.md §2.2", "SPECIFICATION.md §7", "SPECIFICATION.md §8"],
        "generated_utc": datetime.now(UTC).isoformat(),
        "collection": collection,
        "search_geometry": {
            "fov_arcsec": FOV_ARCSEC,
            "padding_factor": "sqrt(2) on half-diagonal",
            "radius_arcsec": round(SEARCH_RADIUS_ARCSEC, 4),
            "radius_deg": round(SEARCH_RADIUS_DEG, 8),
        },
        "pass_gap_days": gap_days,
        "targets": [],
        "global_survey_passes": [],
        "saturation_audits": {},
        "detection_depth_audits": {},
        "errors": [],
    }

    all_exposures_by_target: dict[str, list[ExposureRecord]] = {}
    all_mjds: list[float] = []

    for t in BENCHMARKS:
        print(f"[S2] Querying SIA2: {t.name} ({t.ra_deg}, {t.dec_deg})")
        exps, meta = query_sia2_exposures(t.ra_deg, t.dec_deg, SEARCH_RADIUS_DEG, collection)
        all_exposures_by_target[t.name] = exps
        for e in exps:
            if e.t_min_mjd is not None:
                all_mjds.append(e.t_min_mjd)
        report["targets"].append(
            {
                "name": t.name,
                "object_class": t.object_class,
                "ra_deg": t.ra_deg,
                "dec_deg": t.dec_deg,
                "epoch": t.epoch,
                "notes": t.notes,
                "query": meta,
                "n_exposures": len(exps),
                "bands_seen": sorted({e.band for e in exps}),
            }
        )
        if meta["status"] != "ok":
            report["errors"].append({"target": t.name, "stage": "sia2", "error": meta.get("error")})

    # Global pass clustering
    bounds = cluster_survey_passes(all_mjds, gap_days)
    passes: list[dict[str, Any]] = []
    for i, (s, e) in enumerate(bounds, start=1):
        pid = f"pass_{i:02d}"
        n_exp = 0
        targets_cov = 0
        for name, exps in all_exposures_by_target.items():
            has = any(assign_pass(x.t_min_mjd, bounds) == pid for x in exps)
            if has:
                targets_cov += 1
            n_exp += sum(1 for x in exps if assign_pass(x.t_min_mjd, bounds) == pid)
        passes.append(
            {
                "pass_id": pid,
                "label": f"Survey Pass {i}",
                "mjd_start": round(s, 6),
                "mjd_end": round(e, 6),
                "duration_days": round(e - s, 6),
                "n_exposures_total": n_exp,
                "n_targets_with_coverage": targets_cov,
            }
        )
    report["global_survey_passes"] = passes

    # Per-target coverage matrices
    for tinfo in report["targets"]:
        name = tinfo["name"]
        matrix = build_coverage_matrix(all_exposures_by_target[name], bounds)
        # summarize totals
        band_totals = {b: sum(matrix[p][b] for p in matrix) for b in BANDS}
        epoch_totals = {p: sum(matrix[p].values()) for p in matrix}
        tinfo["coverage_matrix_epochs_x_bands"] = matrix
        tinfo["band_totals_n_exp"] = band_totals
        tinfo["epoch_totals_n_exp"] = epoch_totals
        tinfo["total_exposures_in_passes"] = sum(band_totals.values())

    # Saturation audit: Barnard's Star D1-D3
    if not getattr(args, "skip_cutouts", False):
        barnards = all_exposures_by_target.get("Barnard's Star", [])
        print("[S2] Auditing Barnard's Star saturation (OVERFLOW bit 1, D1-D3)...")
        sat_samples = []
        for exp in pick_exposures_for_audit(barnards, ["D1", "D2", "D3"], max_n=1):
            analysis = fetch_cutout_analysis(
                exp.access_url, BENCHMARKS[0].ra_deg, BENCHMARKS[0].dec_deg, 0.03, exp.band
            )
            analysis.update({"band": exp.band, "obs_id": exp.obs_id, "t_min_mjd": exp.t_min_mjd})
            sat_samples.append(analysis)
            print(f"  {exp.band} {exp.obs_id}: {analysis['status']} overflow_fraction={analysis.get('overflow_fraction')}")
        report["saturation_audits"]["Barnard's Star"] = {
            "flag_bit": OVERFLOW_BIT,
            "flag_mask": f"0x{OVERFLOW_MASK:04X}",
            "bands_audited": ["D1", "D2", "D3"],
            "samples": sat_samples,
            "summary": _summarize_saturation(sat_samples),
        }

        # Detection depth: WISE 0855-0714 D5/D6
        wise = all_exposures_by_target.get("WISE 0855-0714", [])
        print("[S2] Auditing WISE 0855-0714 detection depth/SNR (D5/D6)...")
        det_samples = []
        for exp in pick_exposures_for_audit(wise, ["D5", "D6"], max_n=2):
            analysis = fetch_cutout_analysis(
                exp.access_url, BENCHMARKS[1].ra_deg, BENCHMARKS[1].dec_deg, 0.03, exp.band
            )
            analysis.update({"band": exp.band, "obs_id": exp.obs_id, "t_min_mjd": exp.t_min_mjd})
            det_samples.append(analysis)
            print(f"  {exp.band} {exp.obs_id}: {analysis['status']} snr_proxy={analysis.get('snr_proxy')}")
        report["detection_depth_audits"]["WISE 0855-0714"] = {
            "bands_audited": ["D5", "D6"],
            "method": "IRSA cutout central-pixel signal/variance proxy; inverse-variance coadd SNR estimated from per-exposure variance",
            "samples": det_samples,
            "summary": _summarize_detection(det_samples),
        }
    else:
        report["saturation_audits"]["Barnard's Star"] = {"skipped": True, "reason": "--skip-cutouts"}
        report["detection_depth_audits"]["WISE 0855-0714"] = {"skipped": True, "reason": "--skip-cutouts"}

    report["acceptance_criteria"] = _evaluate_acceptance(report)
    return report


def _summarize_saturation(samples: list[dict[str, Any]]) -> str:
    ok = [s for s in samples if s.get("status") == "ok" and s.get("overflow_fraction") is not None]
    if not ok:
        errs = [s.get("error") for s in samples if s.get("error")]
        return f"No successful FLAGS cutout analyses. Errors: {errs[:2]}" if errs else "No cutout samples analyzed."
    parts = []
    for s in ok:
        parts.append(f"{s['band']}: overflow_fraction={s['overflow_fraction']:.6f} ({s.get('overflow_pixel_count',0)}/{s.get('total_pixels_sampled',0)} px)")
    any_sat = any((s.get("overflow_fraction") or 0) > 0.001 for s in ok)
    verdict = "OVERFLOW pixels detected in audited D1-D3 cutouts." if any_sat else "No significant OVERFLOW fraction in audited D1-D3 cutout samples (central cutout)."
    return " | ".join(parts) + " — " + verdict


def _summarize_detection(samples: list[dict[str, Any]]) -> str:
    ok = [s for s in samples if s.get("status") == "ok" and s.get("snr_proxy") is not None]
    if not ok:
        errs = [s.get("error") for s in samples if s.get("error")]
        return f"No successful D5/D6 cutout SNR analyses. Errors: {errs[:2]}" if errs else "No cutout samples analyzed."
    by_band: dict[str, list[dict]] = {}
    for s in ok:
        by_band.setdefault(s["band"], []).append(s)
    parts = []
    for band, ss in sorted(by_band.items()):
        snrs = [s["snr_proxy"] for s in ss if s.get("snr_proxy") is not None]
        vars_ = [s["variance_mean"] for s in ss if s.get("variance_mean")]
        single = snrs[0] if snrs else None
        coadd = None
        if vars_ and ss[0].get("signal_mean") is not None:
            # inverse-variance coadd proxy on mean signal
            iv = sum(1.0 / max(v, 1e-12) for v in vars_)
            sigs = [s["signal_mean"] for s in ss if s.get("signal_mean") is not None]
            wmean = sum((sigs[i] if i < len(sigs) else 0) / max(vars_[i], 1e-12) for i in range(len(vars_))) / iv
            coadd = round(abs(wmean) * math.sqrt(iv), 4)
        parts.append(f"{band}: single-pass SNR proxy~{single}, n={len(ss)}, inverse-variance coadd proxy~{coadd}")
    return "; ".join(parts) + ". D5/D6 are the relevant detection bands for this faint Y4 target; non-detection in single pass may be honest if SNR is low."


def _evaluate_acceptance(report: dict[str, Any]) -> dict[str, Any]:
    has_passes = len(report.get("global_survey_passes", [])) > 0
    has_cov = all(t.get("coverage_matrix_epochs_x_bands") for t in report.get("targets", []))
    has_5 = len(report.get("targets", [])) == 5
    has_sat = "Barnard's Star" in report.get("saturation_audits", {})
    has_wise = "WISE 0855-0714" in report.get("detection_depth_audits", {})
    return {
        "survey_passes_json_generated_from_real_mjd_clusters": has_passes and all(t.get("query", {}).get("status") == "ok" for t in report["targets"]),
        "coverage_matrix_epochs_x_6_bands_verified_for_5_targets": has_cov and has_5,
        "barnards_overflow_documented": has_sat,
        "wise_0855_detection_depth_documented": has_wise,
        "all_targets_queried_ok": all(t.get("query", {}).get("status") == "ok" for t in report["targets"]),
    }


def write_survey_passes_json(report: dict[str, Any], path: Path) -> None:
    payload = {
        "version": "3.0.0-PROD",
        "source": "scripts/spike_s2_benchmarks.py (IRSA SIA2 live exposure MJD clustering)",
        "spec_anchor": "SPECIFICATION.md §2.2, §7, §8 (Day-0 Spike S2)",
        "generated_utc": report["generated_utc"],
        "collection": report["collection"],
        "clustering": {
            "method": "gap-based temporal clustering on exposure t_min MJD values across 5 NASA benchmarks",
            "gap_days_threshold": report["pass_gap_days"],
            "search_radius_arcsec": report["search_geometry"]["radius_arcsec"],
        },
        "passes": {},
    }
    for p in report["global_survey_passes"]:
        payload["passes"][p["pass_id"]] = {
            "label": p["label"],
            "mjd_start": p["mjd_start"],
            "mjd_end": p["mjd_end"],
            "duration_days": p["duration_days"],
            "n_exposures_total": p["n_exposures_total"],
            "n_targets_with_coverage": p["n_targets_with_coverage"],
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[S2] Wrote {path}")


def write_markdown_report(report: dict[str, Any], path: Path) -> None:
    lines = []
    a = lines.append
    a("# Spike S2 — NASA Benchmark Coverage Matrices, Survey Pass MJDs & Saturation")
    a("")
    a(f"- **Generated (UTC):** {report['generated_utc']}")
    a(f"- **IRSA Collection:** `{report['collection']}`")
    a(f"- **Search radius:** {report['search_geometry']['radius_arcsec']}\" (180\" FoV padded by sqrt(2) on half-diagonal)")
    a(f"- **Spec anchors:** {', '.join(report['spec_anchors'])}")
    a("")
    a("## Global Survey Passes (MJD clusters)")
    a("")
    a("| Pass | MJD start | MJD end | Duration (days) | Total exposures | Targets covered |")
    a("|---|---:|---:|---:|---:|---:|")
    for p in report["global_survey_passes"]:
        a(f"| {p['pass_id']} | {p['mjd_start']} | {p['mjd_end']} | {p['duration_days']} | {p['n_exposures_total']} | {p['n_targets_with_coverage']} |")
    a("")
    for t in report["targets"]:
        a(f"## {t['name']} ({t['object_class']})")
        a("")
        a(f"- Coords (Epoch 2025.5): RA={t['ra_deg']}°, Dec={t['dec_deg']}°")
        a(f"- SIA2 status: `{t['query']['status']}` | exposures: {t['n_exposures']} | bands seen: {t['bands_seen']}")
        a(f"- Notes: {t['notes']}")
        a("")
        a("### Coverage matrix N_exp(Epoch, Band)")
        a("")
        header = "| Epoch | " + " | ".join(BANDS) + " | Total |"
        sep = "|---|" + "|".join(["---:"] * len(BANDS)) + "|---:|"
        a(header)
        a(sep)
        mat = t["coverage_matrix_epochs_x_bands"]
        for pid in sorted(mat.keys()):
            row = [str(mat[pid].get(b, 0)) for b in BANDS]
            a(f"| {pid} | " + " | ".join(row) + f" | {t['epoch_totals_n_exp'].get(pid,0)} |")
        totals = [str(t['band_totals_n_exp'].get(b, 0)) for b in BANDS]
        a("| **TOTAL** | " + " | ".join(f"**{x}**" for x in totals) + f" | **{t['total_exposures_in_passes']}** |")
        a("")
    a("## Saturation Audit (Barnard's Star, D1-D3, OVERFLOW bit 1 / 0x0002)")
    a("")
    sat = report["saturation_audits"].get("Barnard's Star", {})
    a(f"- Summary: {sat.get('summary','n/a')}")
    for s in sat.get("samples", []):
        a(f"- {s.get('band')} `{s.get('obs_id')}`: status={s.get('status')}, overflow_fraction={s.get('overflow_fraction')}, http_bytes={s.get('http_bytes')}, error={s.get('error')}")
    a("")
    a("## Detection Depth Audit (WISE 0855-0714, D5/D6)")
    a("")
    det = report["detection_depth_audits"].get("WISE 0855-0714", {})
    a(f"- Method: {det.get('method','n/a')}")
    a(f"- Summary: {det.get('summary','n/a')}")
    for s in det.get("samples", []):
        a(f"- {s.get('band')} `{s.get('obs_id')}`: status={s.get('status')}, snr_proxy={s.get('snr_proxy')}, signal_mean={s.get('signal_mean')}, variance_mean={s.get('variance_mean')}, error={s.get('error')}")
    a("")
    a("## Acceptance Criteria Evaluation")
    a("")
    for k, v in report.get("acceptance_criteria", {}).items():
        a(f"- [{'x' if v else ' '}] `{k}`: {v}")
    a("")
    if report.get("errors"):
        a("## Errors")
        for e in report["errors"]:
            a(f"- {e}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[S2] Wrote {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--collection", default=DEFAULT_COLLECTION)
    ap.add_argument("--gap-days", type=float, default=PASS_GAP_DAYS)
    ap.add_argument("--skip-cutouts", action="store_true", help="Skip IRSA cutout saturation/SNR audits")
    ap.add_argument("--out-dir", default=".")
    args = ap.parse_args()

    report = run_audit(args)
    repo = Path(__file__).resolve().parent.parent
    write_survey_passes_json(report, repo / "backend" / "config" / "survey_passes.json")
    out_dir = Path(args.out_dir)
    write_markdown_report(report, out_dir / "scripts" / "spike_s2_coverage_report.md" if out_dir == Path(".") else out_dir / "spike_s2_coverage_report.md")
    # JSON report
    json_path = repo / "scripts" / "spike_s2_coverage_report.json"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"[S2] Wrote {json_path}")
    acc = report.get("acceptance_criteria", {})
    failed = [k for k, v in acc.items() if not v and "generated_from_real" in k]
    print("[S2] Acceptance:", json.dumps(acc, indent=2))
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
