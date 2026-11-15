"""Synthetic datasets + the pinned WISE 0855 probe.

Real survey data can be dropped in later. To pin a real WISE 0855 probe, set
WISE0855_PROBE_DIR to a folder containing <ModelName>.npy (shape without the batch dim).
"""
import math
import os
from pathlib import Path

import numpy as np
import torch

DATASET_SIZE = {"DipoleConvNet3D": 240, "SpectralResNet102": 480, "AstroFeatureSVM": 600}


def _dipole(y, g, T=4, S=32):
    """Multi-epoch difference stamps with zodiacal background noise and stationary blends."""
    n = len(y)
    noise_sigma = (0.36 + 0.14 * torch.rand(n, 1, 1, 1, 1, generator=g))
    x = torch.randn(n, 6, T, S, S, generator=g) * noise_sigma
    ax = torch.arange(S).float()
    yy, xx = torch.meshgrid(ax, ax, indexing="ij")

    def blob(cy, cx, s=2.2):
        return torch.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * s * s))

    for i in range(n):
        jy, jx = ((torch.rand(2, generator=g) - 0.5) * 8).tolist()
        if int(y[i].item()) == 1:
            amp = 0.65 + 0.70 * float(torch.rand(1, generator=g).item())
            step_drift = 0.38 + 0.25 * float(torch.rand(1, generator=g).item())
            for t in range(T):
                drift = step_drift * t
                x[i, :, t] += amp * (blob(13 + jy + drift, 16 + jx) - blob(19 + jy + drift, 16 + jx))
        else:
            # 35% of negatives have stationary residual PSF dipoles (hard negatives)
            if float(torch.rand(1, generator=g).item()) < 0.35:
                amp = 0.45 + 0.50 * float(torch.rand(1, generator=g).item())
                st_b = amp * blob(16 + jy, 16 + jx, s=2.6)
                for t in range(T):
                    x[i, :, t] += st_b * (0.15 if t % 2 == 0 else -0.15)
    return x


def _spectral(y, g, L=102):
    """102-band SPHEREx SEDs with variable continuum slopes, ice/CH4 troughs, and zodi noise."""
    n = len(y)
    lam = torch.linspace(0, 1, L)
    sigma = 0.10 + 0.18 * torch.rand(n, 1, generator=g)
    slope = (torch.rand(n, 1, generator=g) - 0.5) * 0.65
    base = 1.0 + slope * lam[None] + 0.22 * torch.sin(2 * math.pi * lam)[None]
    # Variable-depth absorption troughs at 3.05um (H2O), 3.32um (CH4), 4.27um (CO2)
    trough_depth = (0.28 + 0.42 * torch.rand(n, 1, generator=g)) * y[:, None].float()
    neg_weak = (0.12 * torch.rand(n, 1, generator=g)) * (1.0 - y[:, None].float())
    dip = 0.65 * torch.exp(-((lam - 0.55) ** 2) / (2 * 0.035 ** 2)) + 0.55 * torch.exp(-((lam - 0.80) ** 2) / (2 * 0.032 ** 2))
    flux = base - (trough_depth + neg_weak) * dip[None] + sigma * torch.randn(n, L, generator=g)
    ivar = (1.0 / sigma ** 2).expand(n, L) / 180.0
    return torch.stack([flux, ivar], dim=1)


def _astro(n, g):
    """3D physical space with ~8% hard-negative boundary label overlap."""
    x = torch.rand(n, 3, generator=g) * 2 - 1
    score = 0.8 * x[:, 0] + 0.6 * x[:, 1] + 0.4 * x[:, 2] + 0.5 * torch.sin(3 * x[:, 0] * x[:, 2])
    y = (score > 0.1).long()
    boundary_mask = score.abs() < 0.35
    flip = (torch.rand(n, generator=g) < 0.06) | (boundary_mask & (torch.rand(n, generator=g) < 0.22))
    return x, torch.where(flip, 1 - y, y)


def make_dataset(model_name: str, n: int, seed: int = 0):
    g = torch.Generator().manual_seed(seed)
    if model_name == "AstroFeatureSVM":
        return _astro(n, g)
    y = (torch.rand(n, generator=g) < 0.5).long()
    # Flip ~6% labels near ambiguous regimes so validation tracks genuine generalization (< 100%)
    noise_flip = (torch.rand(n, generator=g) < 0.06).long()
    y_noisy = torch.abs(y - noise_flip)
    if model_name == "DipoleConvNet3D":
        return _dipole(y, g), y_noisy
    if model_name == "SpectralResNet102":
        return _spectral(y, g), y_noisy
    raise ValueError(f"Unknown model: {model_name}")


def make_probe(model_name: str):
    """Pinned WISE 0855 probe, shape [1, ...]. Deterministic across epochs and runs."""
    d = os.getenv("WISE0855_PROBE_DIR")
    if d and (Path(d) / f"{model_name}.npy").is_file():
        return torch.from_numpy(np.load(Path(d) / f"{model_name}.npy")).float()[None]
    g = torch.Generator().manual_seed(855)
    pos = torch.ones(1, dtype=torch.long)
    if model_name == "DipoleConvNet3D":
        return _dipole(pos, g)
    if model_name == "SpectralResNet102":
        return _spectral(pos, g)
    if model_name == "AstroFeatureSVM":
        return torch.tensor([[0.9, 0.95, 0.9]])  # very red, high motion SNR, deep methane
    raise ValueError(f"Unknown model: {model_name}")
