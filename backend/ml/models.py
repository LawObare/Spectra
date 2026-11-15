"""The three active-learning architectures (SPECIFICATION.md section 6.4.1)."""
import math

import torch
import torch.nn.functional as F
from torch import nn

# Module whose activations/gradients feed the feature maps and Grad-CAM.
TARGET_LAYERS = {
    "DipoleConvNet3D": "act2",
    "SpectralResNet102": "block2.out_act",
    "AstroFeatureSVM": "rbf",
}
FEATURE_AXES = ["ir_color_d5_d2", "motion_snr", "ice_methane_depth"]
CLASS_LABELS = ["Field / Stationary", "Moving / Spectral Anomaly"]
DOMAIN_CLASSES = [
    "Brown Dwarf (Y/T/L)",
    "M-Dwarf / High-PM Star",
    "Pulsating / T-Tauri Variable",
    "Ice-Absorbed Protostar",
    "Solar System / Moving",
    "Galaxy / AGN / Field",
]

# Exact layer-by-layer specifications for the /admin Model Registry & Spec Inspector
MODEL_LAYER_SPECS: dict[str, list[dict[str, object]]] = {
    "SpectralResNet102": [
        {"name": "stem", "type": "Conv1d(2→16, k=7) + BN + ReLU", "shape": "[B, 16, 102]", "params": 272, "trainable_in_lora": False, "role": "Frozen continuum feature stem"},
        {"name": "block1", "type": "ResBlock1D(16→16, k=5)", "shape": "[B, 16, 102]", "params": 2656, "trainable_in_lora": False, "role": "Frozen spectral band residual encoder"},
        {"name": "block2", "type": "ResBlock1D(16→16, k=5)", "shape": "[B, 16, 102]", "params": 2656, "trainable_in_lora": False, "role": "Saliency & gradient attribution hook (block2.out_act)"},
        {"name": "attn", "type": "MultiheadAttention(16, heads=2)", "shape": "[B, 102, 16]", "params": 1088, "trainable_in_lora": True, "role": "Cross-band absorption correlation (LoRA out_proj)"},
        {"name": "head", "type": "LoraLinear(16→2)", "shape": "[B, 2]", "params": 34, "trainable_in_lora": True, "role": "Low-rank adapted anomaly/class readout"},
    ],
    "DipoleConvNet3D": [
        {"name": "conv1+bn1", "type": "Conv3d(6→8, k=3) + BN3d + Pool", "shape": "[B, 8, T, 16, 16]", "params": 1320, "trainable_in_lora": False, "role": "Frozen multi-band spatial aperture stem"},
        {"name": "conv2+bn2", "type": "Conv3d(8→16, k=3) + BN3d + Pool", "shape": "[B, 16, T, 8, 8]", "params": 3504, "trainable_in_lora": False, "role": "Spatio-temporal motion feature map (act2 Grad-CAM)"},
        {"name": "head", "type": "LoraLinear(16→2)", "shape": "[B, 2]", "params": 34, "trainable_in_lora": True, "role": "Low-rank adapted moving dipole classifier"},
    ],
    "AstroFeatureSVM": [
        {"name": "rbf", "type": "RBFLayer(3→32 landmarks, γ)", "shape": "[B, 32]", "params": 97, "trainable_in_lora": False, "role": "Learnable Gaussian distance basis in [-1, 1]³"},
        {"name": "readout", "type": "LoraLinear(32→2)", "shape": "[B, 2]", "params": 66, "trainable_in_lora": True, "role": "Low-rank adapted margin hyperplane readout"},
    ],
}


class DipoleConvNet3D(nn.Module):
    """3D spatio-temporal ConvNet on [B, 6, N_epochs, 32, 32] difference stamps."""

    def __init__(self, in_ch: int = 6, num_classes: int = 2):
        super().__init__()
        self.conv1 = nn.Conv3d(in_ch, 8, 3, padding=1)
        self.bn1 = nn.BatchNorm3d(8)
        self.act1 = nn.ReLU()
        self.pool1 = nn.MaxPool3d((1, 2, 2))
        self.conv2 = nn.Conv3d(8, 16, 3, padding=1)
        self.bn2 = nn.BatchNorm3d(16)
        self.act2 = nn.ReLU()
        self.pool2 = nn.MaxPool3d((1, 2, 2))
        self.head = nn.Linear(16, num_classes)

    def forward_features(self, x):
        x = self.pool1(self.act1(self.bn1(self.conv1(x))))
        x = self.pool2(self.act2(self.bn2(self.conv2(x))))
        return x.mean(dim=(2, 3, 4))

    def forward(self, x):
        return self.head(self.forward_features(x))


class ResBlock1D(nn.Module):
    def __init__(self, ch: int):
        super().__init__()
        self.conv1 = nn.Conv1d(ch, ch, 5, padding=2)
        self.bn1 = nn.BatchNorm1d(ch)
        self.act = nn.ReLU()
        self.conv2 = nn.Conv1d(ch, ch, 5, padding=2)
        self.bn2 = nn.BatchNorm1d(ch)
        self.out_act = nn.ReLU()

    def forward(self, x):
        h = self.bn2(self.conv2(self.act(self.bn1(self.conv1(x)))))
        return self.out_act(h + x)


class SpectralResNet102(nn.Module):
    """1D ResNet + self-attention over a 102-bin spectrum.

    Input [B, 2, 102]: channel 0 = flux, channel 1 = inverse-variance weights.
    """

    def __init__(self, in_ch: int = 2, width: int = 16, num_classes: int = 2):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv1d(in_ch, width, 7, padding=3), nn.BatchNorm1d(width), nn.ReLU())
        self.block1 = ResBlock1D(width)
        self.block2 = ResBlock1D(width)
        self.attn = nn.MultiheadAttention(width, num_heads=2, batch_first=True)
        self.head = nn.Linear(width, num_classes)

    def forward_features(self, x):
        h = self.block2(self.block1(self.stem(x)))  # [B, C, L]
        seq = h.transpose(1, 2)  # [B, L, C]
        attn_out, _ = self.attn(seq, seq, seq, need_weights=False)
        return (seq + attn_out).mean(dim=1)

    def forward(self, x):
        return self.head(self.forward_features(x))


class RBFLayer(nn.Module):
    """Gaussian kernel against learnable landmarks: exp(-gamma * ||x - c||^2)."""

    def __init__(self, in_dim: int, n_centers: int, gamma: float = 2.0):
        super().__init__()
        self.centers = nn.Parameter(torch.rand(n_centers, in_dim) * 2 - 1)
        self.log_gamma = nn.Parameter(torch.tensor(math.log(gamma)))

    def forward(self, x):
        return torch.exp(-self.log_gamma.exp() * torch.cdist(x, self.centers).pow(2))


class AstroFeatureSVM(nn.Module):
    """RBF kernel machine on [IR color D5/D2, motion SNR, ice/methane depth], each scaled to [-1, 1].

    Implemented in torch (learned RBF landmarks + linear readout) so it trains
    epoch by epoch and exposes weights/gradients like the other two models.
    """

    def __init__(self, in_dim: int = 3, n_centers: int = 32, num_classes: int = 2):
        super().__init__()
        self.rbf = RBFLayer(in_dim, n_centers)
        self.readout = nn.Linear(n_centers, num_classes)

    def forward_features(self, x):
        return self.rbf(x)

    def forward(self, x):
        return self.readout(self.forward_features(x))

    @torch.no_grad()
    def boundary_probs(self, n: int = 25):
        """P(class 1) on an n x n x n grid over the 3D feature space, indexing='ij'."""
        was_training = self.training
        self.eval()
        ax = torch.linspace(-1, 1, n)
        grid = torch.stack(torch.meshgrid(ax, ax, ax, indexing="ij"), dim=-1).reshape(-1, 3)
        probs = F.softmax(self(grid), dim=1)[:, 1].reshape(n, n, n)
        self.train(was_training)
        return probs


class LoraLinear(nn.Module):
    """Low-Rank Adaptation wrapper matching PEFT LoraConfig on nn.Linear."""

    def __init__(self, base: nn.Linear, r: int = 8, lora_alpha: int = 32, lora_dropout: float = 0.05):
        super().__init__()
        self.base = base
        self.r = max(1, int(r))
        self.lora_alpha = int(lora_alpha)
        self.scaling = float(self.lora_alpha) / float(self.r)
        self.dropout = nn.Dropout(p=float(lora_dropout)) if lora_dropout > 0 else nn.Identity()

        # Freeze pre-trained / base linear parameters while training rank-r matrices A & B
        self.base.weight.requires_grad_(False)
        if self.base.bias is not None:
            self.base.bias.requires_grad_(False)

        self.lora_A = nn.Parameter(torch.empty(self.r, base.in_features, dtype=base.weight.dtype))
        self.lora_B = nn.Parameter(torch.zeros(base.out_features, self.r, dtype=base.weight.dtype))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))

    @property
    def weight(self) -> torch.Tensor:
        return self.base.weight + self.scaling * (self.lora_B @ self.lora_A)

    @property
    def bias(self) -> torch.Tensor | None:
        return self.base.bias

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        base_out = self.base(x)
        lora_out = F.linear(F.linear(self.dropout(x), self.lora_A), self.lora_B) * self.scaling
        return base_out + lora_out


def apply_lora(
    model: nn.Module,
    r: int = 8,
    lora_alpha: int = 32,
    lora_dropout: float = 0.05,
    freeze_backbone: bool = False,
) -> nn.Module:
    """Attach LoraLinear adapters to all nn.Linear layers; optionally freeze non-LoRA params."""
    if r <= 0:
        return model

    if freeze_backbone:
        for param in model.parameters():
            param.requires_grad_(False)

    for _parent_name, module in list(model.named_modules()):
        for child_name, child in list(module.named_children()):
            if isinstance(child, nn.Linear) and not isinstance(module, LoraLinear):
                setattr(module, child_name, LoraLinear(child, r=r, lora_alpha=lora_alpha, lora_dropout=lora_dropout))
    return model


def parameter_summary(
    model: nn.Module,
    lora_r: int = 0,
    lora_alpha: int = 32,
    quantization_bits: int = 16,
) -> dict:
    """Return total, trainable, frozen, LoRA parameter counts and estimated memory footprint."""
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    lora_params = sum(
        p.numel()
        for name, p in model.named_parameters()
        if p.requires_grad and ("lora_A" in name or "lora_B" in name)
    )
    return {
        "total_params": int(total_params),
        "trainable_params": int(trainable_params),
        "frozen_params": int(total_params - trainable_params),
        "lora_params": int(lora_params),
        "trainable_pct": round(100.0 * trainable_params / max(1, total_params), 2),
        "lora_r": int(lora_r),
        "lora_alpha": int(lora_alpha),
        "quantization_bits": int(quantization_bits),
        "vram_estimate_mb": round(total_params * (quantization_bits / 8.0) / (1024 * 1024), 4),
    }


@torch.no_grad()
def extract_latent_vector(model: nn.Module, x: torch.Tensor) -> torch.Tensor:
    """Extract normalized penultimate latent representation [B, D] for similarity graphing."""
    was_training = model.training
    model.eval()
    try:
        if hasattr(model, "forward_features"):
            feat = model.forward_features(x)
        else:
            feat = model(x)
        return F.normalize(feat.float(), p=2, dim=-1)
    finally:
        model.train(was_training)


def build_model(
    name: str,
    lora_r: int = 0,
    lora_alpha: int = 32,
    lora_dropout: float = 0.05,
    freeze_backbone: bool = False,
) -> nn.Module:
    models = {
        "DipoleConvNet3D": DipoleConvNet3D,
        "SpectralResNet102": SpectralResNet102,
        "AstroFeatureSVM": AstroFeatureSVM,
    }
    if name not in models:
        raise ValueError(f"Unknown model: {name}")
    model = models[name]()
    if lora_r > 0:
        apply_lora(model, r=lora_r, lora_alpha=lora_alpha, lora_dropout=lora_dropout, freeze_backbone=freeze_backbone)
    return model
