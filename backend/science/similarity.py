"""In-Memory OpenBLAS NumPy Cosine Similarity Spectral Matching Engine.

Specification Anchors:
- SPECIFICATION.md §1.3 Audit #11 (Dropped pgvector from P0; in-memory NumPy cosine similarity, line 49)
- SPECIFICATION.md §4.2.4 Item 1 (NumPy Cosine Similarity & BLAS GEMV Engine, lines 501–506)
- tasks.md Dev 5 (role:E5-datasci) Issue #20

Exhaustive OpenBLAS GEMV Evaluation:
Pre-loads and L2-normalizes a reference library of 10,000 102-channel spectra
stored contiguously in C-order in RAM (~4.08 MB). Evaluates incoming queries
via np.dot (GEMV) and np.argpartition for top-k retrieval in <8 ms.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import numpy as np

try:
    from backend.science.wave import (
        BENCHMARK_TARGETS,
        generate_benchmark_sed_102,
        get_standard_channel_grid,
    )
except ImportError:
    from science.wave import (
        BENCHMARK_TARGETS,
        generate_benchmark_sed_102,
        get_standard_channel_grid,
    )

logger = logging.getLogger(__name__)

NUM_REFERENCE_TEMPLATES = 10000


class SpectralSimilarityEngine:
    """Vectorized in-memory cosine similarity engine over 10,000 102-channel spectra."""

    def __init__(self, num_templates: int = NUM_REFERENCE_TEMPLATES) -> None:
        self.num_templates = num_templates
        self.channel_grid = get_standard_channel_grid()
        self.n_channels = len(self.channel_grid)

        # Allocate C-contiguous float32 matrix: shape (N, 102), ~4.08 MB
        self.template_matrix = np.empty((self.num_templates, self.n_channels), dtype=np.float32, order="C")
        self.template_metadata: list[dict[str, str]] = []

        self._populate_library()
        self._precompute_normalized_matrix()

    def _populate_library(self) -> None:
        """Populate the 10,000-spectrum reference library with physically realistic SEDs."""
        waves = self.channel_grid
        idx = 0

        # 1. Mandatory NASA Benchmark Templates (Exact Ground Truth)
        for target_id, target in BENCHMARK_TARGETS.items():
            flux, _, _, _, _, _ = generate_benchmark_sed_102(target, waves)
            self.template_matrix[idx] = flux.astype(np.float32)
            self.template_metadata.append({
                "id": target_id,
                "name": target["name"],
                "spectral_class": target["type"],
                "category": "NASA Benchmark",
            })
            idx += 1

        # 2. Canonical Spectral Archetypes
        archetypes = [
            # Ultracool Y / T Brown Dwarfs (strong 3.32 um CH4, 1.4/1.9 um H2O, D5/D6 thermal rise)
            ("Y4_DWARF_SONORA", "Sonora Bobcat Y4 Ultracool Brown Dwarf", "Y4 Brown Dwarf", "Brown Dwarf", -1.2, 0.05, 3.32, 0.85),
            ("Y2_DWARF_MODEL", "ATMO 2020 Y2 Sub-Stellar Model", "Y2 Brown Dwarf", "Brown Dwarf", -1.1, 0.06, 3.30, 0.75),
            ("T8_DWARF_SPEX", "IRTF SpeX T8 Methane Dwarf", "T8 Brown Dwarf", "Brown Dwarf", -0.9, 0.08, 3.32, 0.70),
            ("T6_DWARF_BOBCAT", "Sonora Bobcat T6 Dwarf", "T6 Brown Dwarf", "Brown Dwarf", -0.8, 0.10, 2.20, 0.60),
            ("T1_DWARF_EPSINDI", "Epsilon Indi Ba T1 Component", "T1 Brown Dwarf", "Brown Dwarf", -0.7, 0.12, 1.42, 0.55),
            # L Dwarfs (FeH / CrH / CO absorption, red optical slope)
            ("L2_DWARF_SPEX", "SpeX Prism L2 Field Dwarf", "L2 Dwarf", "Brown Dwarf", -0.4, 0.18, 2.30, 0.35),
            ("L5_DWARF_SPEX", "SpeX Prism L5 Dusty Dwarf", "L5 Dwarf", "Brown Dwarf", -0.5, 0.15, 2.30, 0.40),
            # M Dwarfs (TiO / VO / H2O absorption)
            ("M4V_BARNARD_REF", "Barnard's Star M4V Reference Standard", "M4V Red Dwarf", "M Dwarf", -0.3, 0.25, 1.40, 0.30),
            ("M6V_DWARF_SPEX", "IRTF SpeX M6V Red Dwarf", "M6V Red Dwarf", "M Dwarf", -0.4, 0.20, 1.90, 0.35),
            ("M8V_DWARF_SPEX", "IRTF SpeX M8V Very Low Mass Star", "M8V Red Dwarf", "M Dwarf", -0.5, 0.16, 1.90, 0.40),
            # Young Stellar Objects & Variables
            ("T_TAURI_RWAUR", "RW Aurigae T Tauri Variable Disk Standard", "T Tauri Variable", "Young Star", -0.1, 0.20, 3.05, 0.25),
            ("HERBIG_AE_BE", "Herbig Ae/Be Circumstellar Envelope", "Herbig Ae/Be", "Young Star", 0.1, 0.30, 3.30, 0.20),
            ("MIRA_AGB_RDRA", "R Draconis Mira Pulsating Variable Standard", "Mira AGB Variable", "Pulsating Star", -0.6, 0.22, 2.30, 0.50),
            ("CARBON_STAR", "Circumstellar C2/HCN Carbon Star", "Carbon Star", "AGB Star", -0.5, 0.19, 3.10, 0.45),
            # Interstellar Ices (SPLICES Point Sources)
            ("SPLICES_H2O_ICE", "SPLICES Embedded Protostar (3.05 µm H2O Ice)", "Ice-Absorbed Protostar", "Interstellar Ice", -0.2, 0.15, 3.05, 0.85),
            ("SPLICES_CO2_ICE", "SPLICES Dense Core (4.27 µm CO2 Ice)", "Ice-Absorbed Protostar", "Interstellar Ice", -0.2, 0.15, 4.27, 0.80),
            ("SPLICES_CO_ICE", "SPLICES Cold Cloud (4.67 µm CO Ice)", "Ice-Absorbed Protostar", "Interstellar Ice", -0.2, 0.15, 4.67, 0.70),
            # Extragalactic Rest-Frame & Redshifted SEDs
            ("GALAXY_REST_HA", "Rest-Frame Starburst Galaxy (Hα + [OIII])", "Starburst Galaxy", "Galaxy", -0.3, 0.12, 0.6563, 0.60),
            ("GALAXY_Z_05", "Redshifted Starburst (z = 0.50)", "Galaxy z=0.5", "Galaxy", -0.3, 0.10, 0.9845, 0.55),
            ("GALAXY_Z_10", "Redshifted Starburst (z = 1.00)", "Galaxy z=1.0", "Galaxy", -0.3, 0.09, 1.3126, 0.50),
            ("GALAXY_Z_15", "Redshifted Starburst (z = 1.50)", "Galaxy z=1.5", "Galaxy", -0.3, 0.08, 1.6408, 0.45),
            ("GALAXY_Z_20", "Redshifted Starburst (z = 2.00)", "Galaxy z=2.0", "Galaxy", -0.3, 0.07, 1.9689, 0.40),
            ("AGN_QSO", "Type-1 Quasar (Broad NIR Emission Lines)", "Quasar", "AGN", -0.1, 0.25, 2.0, 0.30),
            # Solar System Asteroids
            ("ASTEROID_C_TYPE", "Carbonaceous C-Type Asteroid (Flat/Red Albedo)", "C-Type Asteroid", "Solar System", 0.05, 0.10, 3.0, 0.10),
            ("ASTEROID_S_TYPE", "Silicate S-Type Asteroid (1 µm & 2 µm Olivine)", "S-Type Asteroid", "Solar System", 0.20, 0.12, 1.05, 0.20),
        ]

        for aid, name, sclass, cat, slope, base_f, feat_wave, feat_depth in archetypes:
            flux = base_f * (waves / 1.0) ** slope
            flux *= 1.0 - feat_depth * np.exp(-((waves - feat_wave) / 0.10) ** 2)
            flux = np.maximum(flux, 1e-6)
            self.template_matrix[idx] = flux.astype(np.float32)
            self.template_metadata.append({
                "id": aid,
                "name": name,
                "spectral_class": sclass,
                "category": cat,
            })
            idx += 1

        # 3. Parametrically Synthesize the Remainder of the 10,000 Templates
        # Covering continuous parameter space (slopes in [-2.0, +1.0], temperatures, absorption features)
        rng = np.random.default_rng(seed=42)
        classes_pool = [
            ("Y-Dwarf Variant", "Brown Dwarf", -1.3, -0.9, 3.32, 0.12),
            ("T-Dwarf Variant", "Brown Dwarf", -0.9, -0.6, 2.20, 0.08),
            ("L-Dwarf Variant", "Brown Dwarf", -0.6, -0.3, 2.30, 0.06),
            ("M-Dwarf Variant", "M Dwarf", -0.5, -0.1, 1.40, 0.07),
            ("Variable Star Variant", "Variable Star", -0.8, 0.2, 1.90, 0.09),
            ("Ice Cloud Sightline", "Interstellar Ice", -0.4, 0.0, 3.05, 0.15),
            ("Galaxy SED Variant", "Galaxy", -0.5, 0.3, 1.28, 0.05),
            ("Solar System Object", "Solar System", 0.0, 0.4, 1.00, 0.05),
        ]

        while idx < self.num_templates:
            c_name, cat, min_slope, max_slope, center_w, feat_width = classes_pool[idx % len(classes_pool)]
            slope = rng.uniform(min_slope, max_slope)
            base_f = rng.uniform(0.01, 0.50)
            flux = base_f * (waves / 1.0) ** slope

            # Random feature depth and slight shift
            shift = rng.uniform(-0.15, 0.15)
            depth = rng.uniform(0.15, 0.75)
            cw = max(0.8, min(4.8, center_w + shift))
            flux *= 1.0 - depth * np.exp(-((waves - cw) / feat_width) ** 2)

            # Mild noise perturbation
            flux += rng.normal(0, 0.01 * base_f, size=len(waves))
            flux = np.maximum(flux, 1e-6)

            self.template_matrix[idx] = flux.astype(np.float32)
            self.template_metadata.append({
                "id": f"tmpl_{idx:05d}",
                "name": f"{c_name} #{idx}",
                "spectral_class": c_name,
                "category": cat,
            })
            idx += 1

    def _precompute_normalized_matrix(self) -> None:
        """Pre-compute L2-normalized matrix along axis 1 for GEMV dot-product evaluation."""
        norms = np.linalg.norm(self.template_matrix, axis=1, keepdims=True)
        # Avoid division by zero
        norms = np.where(norms == 0, 1.0, norms)
        self.normalized_matrix = np.ascontiguousarray(self.template_matrix / norms, dtype=np.float32)

    def find_similar(
        self,
        query_spectrum: list[float] | np.ndarray,
        k: int = 5,
    ) -> list[dict[str, Any]]:
        """Find the top-k most similar spectra via OpenBLAS SIMD np.dot.

        Specification Anchor: SPECIFICATION.md §4.2.4 Item 1
        Latency: <8 ms for 10,000 templates on CPU.
        """
        k = max(1, min(k, self.num_templates))

        # Sanitize query array
        q = np.asarray(query_spectrum, dtype=np.float32).ravel()
        if len(q) != self.n_channels:
            # Pad or truncate to standard 102 channels
            if len(q) < self.n_channels:
                padded = np.zeros(self.n_channels, dtype=np.float32)
                padded[: len(q)] = q
                q = padded
            else:
                q = q[: self.n_channels]

        # Replace NaNs or infinities with 0
        q = np.nan_to_num(q, nan=0.0, posinf=0.0, neginf=0.0)

        # L2-normalize query
        norm_q_val = float(np.linalg.norm(q))
        if norm_q_val <= 1e-12:
            norm_q = np.zeros(self.n_channels, dtype=np.float32)
        else:
            norm_q = (q / norm_q_val).astype(np.float32)

        # Exhaustive OpenBLAS GEMV: (N, 102) dot (102,) -> (N,)
        scores = np.dot(self.normalized_matrix, norm_q)

        # Fast top-k retrieval using argpartition
        top_k_indices = np.argpartition(scores, -k)[-k:]
        # Sort top-k descending
        sorted_top_k = top_k_indices[np.argsort(-scores[top_k_indices])]

        results: list[dict[str, Any]] = []
        for match_idx in sorted_top_k:
            meta = self.template_metadata[int(match_idx)]
            score = float(scores[int(match_idx)])
            flux_curve = [float(v) for v in self.template_matrix[int(match_idx)]]
            results.append({
                "id": meta["id"],
                "name": meta["name"],
                "spectral_class": meta["spectral_class"],
                "category": meta.get("category", "General"),
                "similarity": round(max(0.0, min(1.0, score)), 4),
                "flux_curve": flux_curve,
            })

        return results


# Module-level singleton engine initialized on first import
_ENGINE_INSTANCE: SpectralSimilarityEngine | None = None


def get_similarity_engine() -> SpectralSimilarityEngine:
    """Retrieve or initialize the global SpectralSimilarityEngine singleton."""
    global _ENGINE_INSTANCE
    if _ENGINE_INSTANCE is None:
        t0 = time.perf_counter()
        _ENGINE_INSTANCE = SpectralSimilarityEngine()
        dt = (time.perf_counter() - t0) * 1000.0
        logger.info(
            "Initialized SpectralSimilarityEngine with %d templates in %.2f ms",
            _ENGINE_INSTANCE.num_templates,
            dt,
        )
    return _ENGINE_INSTANCE


def find_similar(
    query_spectrum: list[float] | np.ndarray,
    k: int = 5,
) -> list[dict[str, Any]]:
    """Global convenience function for in-memory cosine similarity matching."""
    return get_similarity_engine().find_similar(query_spectrum, k=k)
