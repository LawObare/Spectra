import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ADMIN_LAYERS,
  AdminLayerName,
  BaseModelCard,
  ModelArchitecture,
  useAdminTelemetry,
} from './hooks/useAdminTelemetry';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { cn } from '../lib/utils';

const MODEL_DESCRIPTIONS: Record<ModelArchitecture, string> = {
  SpectralResNet102: '1D ResNet + Multi-Head Attention over 102-channel SPHEREx SEDs [0.75–5.00 µm]. Fast CPU SFT & gradient attribution.',
  DipoleConvNet3D: '3D Spatio-Temporal ConvNet over multi-epoch [6, T, 32, 32] proper-motion cutout stamps. Emits 32×32 Grad-CAM maps.',
  AstroFeatureSVM: 'Learnable Gaussian RBF Kernel machine over [D5/D2 IR color, motion SNR, CH4/H2O depth] in [-1, 1]³.',
};

const SAMPLE_PROMPT_TOKENS = [
  'SPHEREx', 'Target', 'WISE', '0855', '|', 'D2=0.0012Jy', 'D5=0.0184Jy', '|',
  '3.32µm', 'CH4=0.72', '|', 'Classify', 'target:',
];
const SAMPLE_COMPLETION_TOKENS = [
  '<think>', 'Red', 'D5/D2', 'excess', '+', 'strong', 'CH4', '3.32µm', 'trough', 'indicates', 'cold', 'substellar', 'photosphere.', '</think>',
  'Class:', 'Y4', 'Brown', 'Dwarf',
];

const FALLBACK_BASE_MODELS: BaseModelCard[] = [
  {
    model_name: 'SpectralResNet102',
    title: 'SpectralResNet-102 + Multi-Head Attention',
    family: '1D Spectral Transformer-ResNet',
    input_shape: '[B, 2, 102] (Flux + Ivar)',
    layers_summary: 'Conv1d Stem → 2× ResBlock1D → 2-Head Self-Attention → LoRA Head',
    total_params: 6706,
    recommended_for: 'Fast CPU fine-tuning, 102-channel continuum + ice/CH4 attribution',
    training_cost_label: 'CPU LoRA · ~1.5s · $0 GPU',
    target_modules: ['attn', 'head'],
    supported_classes: [
      'Brown Dwarf (Y/T/L)',
      'M-Dwarf / High-PM Star',
      'Pulsating / T-Tauri Variable',
      'Ice-Absorbed Protostar',
      'Solar System / Moving',
      'Galaxy / AGN / Field',
    ],
    layer_specs: [
      { name: 'stem', type: 'Conv1d(2→16, k=7) + BN', shape: '[B, 16, 102]', params: 272, trainable_in_lora: false, role: 'Frozen continuum feature stem' },
      { name: 'block1', type: 'ResBlock1D(16→16, k=5)', shape: '[B, 16, 102]', params: 2656, trainable_in_lora: false, role: 'Frozen spectral band encoder' },
      { name: 'block2', type: 'ResBlock1D(16→16, k=5)', shape: '[B, 16, 102]', params: 2656, trainable_in_lora: false, role: 'Saliency hook (block2.out_act)' },
      { name: 'attn', type: 'MultiheadAttention(16, 2h)', shape: '[B, 102, 16]', params: 1088, trainable_in_lora: true, role: 'LoRA out_proj cross-band attention' },
      { name: 'head', type: 'LoraLinear(16→2)', shape: '[B, 2]', params: 34, trainable_in_lora: true, role: 'Low-rank adapted classifier readout' },
    ],
    has_trained_checkpoint: false,
    active_checkpoint: null,
  },
  {
    model_name: 'DipoleConvNet3D',
    title: 'DipoleConvNet-3D + Spatial Grad-CAM',
    family: '3D Spatio-Temporal ConvNet',
    input_shape: '[B, 6, 4, 32, 32] Cutouts',
    layers_summary: 'Conv3d(6→8) → Pool3d → Conv3d(8→16) → act2 (Grad-CAM) → LoRA Head',
    total_params: 4858,
    recommended_for: 'Multi-epoch proper-motion dipole blinking & Grad-CAM heatmaps',
    training_cost_label: 'CPU LoRA · ~1.5s · $0 GPU',
    target_modules: ['head'],
    supported_classes: [
      'Brown Dwarf (Y/T/L)',
      'M-Dwarf / High-PM Star',
      'Pulsating / T-Tauri Variable',
      'Ice-Absorbed Protostar',
      'Solar System / Moving',
      'Galaxy / AGN / Field',
    ],
    layer_specs: [
      { name: 'conv1+bn1', type: 'Conv3d(6→8, k=3) + BN3d', shape: '[B, 8, T, 16, 16]', params: 1320, trainable_in_lora: false, role: 'Frozen multi-band spatial stem' },
      { name: 'conv2+bn2', type: 'Conv3d(8→16, k=3) + BN3d', shape: '[B, 16, T, 8, 8]', params: 3504, trainable_in_lora: false, role: 'Spatio-temporal Grad-CAM map (act2)' },
      { name: 'head', type: 'LoraLinear(16→2)', shape: '[B, 2]', params: 34, trainable_in_lora: true, role: 'Low-rank adapted dipole classifier' },
    ],
    has_trained_checkpoint: false,
    active_checkpoint: null,
  },
  {
    model_name: 'AstroFeatureSVM',
    title: 'AstroFeatureSVM (Gaussian RBF Margin)',
    family: 'Learnable RBF Kernel Classifier',
    input_shape: '[B, 3] ([D5/D2, Motion SNR, Ice Depth])',
    layers_summary: 'RBFLayer(32 Landmarks, γ) → LoRA Linear Readout',
    total_params: 163,
    recommended_for: 'Ultra-lightweight interpretable decision boundary & anomaly margin',
    training_cost_label: 'CPU LoRA · <0.5s · $0 GPU',
    target_modules: ['readout'],
    supported_classes: [
      'Brown Dwarf (Y/T/L)',
      'M-Dwarf / High-PM Star',
      'Pulsating / T-Tauri Variable',
      'Ice-Absorbed Protostar',
      'Solar System / Moving',
      'Galaxy / AGN / Field',
    ],
    layer_specs: [
      { name: 'rbf', type: 'RBFLayer(3→32 landmarks, γ)', shape: '[B, 32]', params: 97, trainable_in_lora: false, role: 'Learnable Gaussian basis in [-1, 1]³' },
      { name: 'readout', type: 'LoraLinear(32→2)', shape: '[B, 2]', params: 66, trainable_in_lora: true, role: 'Low-rank margin hyperplane readout' },
    ],
    has_trained_checkpoint: false,
    active_checkpoint: null,
  },
];

interface StudioDatasetToken {
  text: string;
  masked: boolean;
  label_id: number;
}

interface StudioDatasetRecord {
  target_id?: string;
  label?: string;
  domain_class?: string;
  split?: 'train' | 'val';
  source?: string;
  tokens_preview?: StudioDatasetToken[];
}

interface StudioClassBucket {
  class_name: string;
  count: number;
  train_count: number;
  val_count: number;
}

interface StudioDatasetSnapshot {
  total_records: number;
  feedback_count: number;
  split_summary?: { train: number; val: number };
  class_buckets?: StudioClassBucket[];
  records: StudioDatasetRecord[];
}

export const TrainingDynamics: React.FC = () => {
  const {
    hyperparams,
    setHyperparams,
    activeEpoch,
    totalEpochs,
    currentFrame,
    frames,
    isRunning,
    isPaused,
    isTrainingLive,
    statusMessage,
    isConnected,
    isDemoMode,
    selectedLayer,
    setSelectedLayer,
    overfittingAnalysis,
    modelsRegistry,
    promotingModelId,
    refreshModelsRegistry,
    promoteTrainedModel,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  } = useAdminTelemetry();

  const lossCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const neuralCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showScriptDrawer, setShowScriptDrawer] = useState(false);
  const [showModelSpecs, setShowModelSpecs] = useState(true);
  const [copiedScript, setCopiedScript] = useState(false);
  const [datasetSnapshot, setDatasetSnapshot] = useState<StudioDatasetSnapshot | null>(null);
  const [selectedSampleIdx, setSelectedSampleIdx] = useState(0);
  const [neuralYaw, setNeuralYaw] = useState(-0.42);
  const [neuralPitch, setNeuralPitch] = useState(0.24);
  const [neuralAutoOrbit, setNeuralAutoOrbit] = useState(true);
  const neuralDragRef = useRef<{ dragging: boolean; x: number; y: number }>({
    dragging: false,
    x: 0,
    y: 0,
  });
  const neuralAngleRef = useRef<{ yaw: number; pitch: number }>({
    yaw: -0.42,
    pitch: 0.24,
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/sft-dataset?schema=prompt_completion')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: StudioDatasetSnapshot | null) => {
        if (!cancelled && payload) setDatasetSnapshot(payload);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    neuralAngleRef.current = { yaw: neuralYaw, pitch: neuralPitch };
  }, [neuralYaw, neuralPitch]);

  const activeLayerKeys = useMemo(() => {
    const keys = Object.keys(currentFrame?.histograms || {});
    return keys.length > 0 ? keys : [...ADMIN_LAYERS];
  }, [currentFrame]);

  useEffect(() => {
    if (activeLayerKeys.length > 0 && !activeLayerKeys.includes(selectedLayer)) {
      setSelectedLayer(activeLayerKeys[0] as AdminLayerName);
    }
  }, [activeLayerKeys, selectedLayer, setSelectedLayer]);

  const trl = currentFrame?.trl;
  const paramSummary = useMemo(() => {
    if (trl?.param_summary) return trl.param_summary;
    const total = hyperparams.model === 'DipoleConvNet3D' ? 4858 : hyperparams.model === 'SpectralResNet102' ? 6706 : 163;
    const loraEst = hyperparams.loraR > 0 ? hyperparams.loraR * 18 : total;
    const trainable = hyperparams.loraR > 0 && hyperparams.freezeBackbone ? loraEst : total;
    return {
      total_params: total,
      trainable_params: trainable,
      frozen_params: total - trainable,
      lora_params: hyperparams.loraR > 0 ? loraEst : 0,
      trainable_pct: Number(((trainable / total) * 100).toFixed(2)),
      lora_r: hyperparams.loraR,
      lora_alpha: hyperparams.loraAlpha,
      quantization_bits: hyperparams.quantizationBits,
      vram_estimate_mb: Number(((total * (hyperparams.quantizationBits / 8)) / (1024 * 1024)).toFixed(4)),
    };
  }, [trl, hyperparams]);

  const activeDatasetRecord = useMemo(() => {
    if (!datasetSnapshot?.records?.length) return null;
    return datasetSnapshot.records[selectedSampleIdx] || datasetSnapshot.records[0];
  }, [datasetSnapshot, selectedSampleIdx]);

  const selectedBaseSpec = useMemo(() => {
    const list = modelsRegistry?.base_models?.length ? modelsRegistry.base_models : FALLBACK_BASE_MODELS;
    return list.find((m) => m.model_name === hyperparams.model) || list[0];
  }, [modelsRegistry, hyperparams.model]);

  // Draw Loss + Val Accuracy + TRL Entropy Canvas
  useEffect(() => {
    const canvas = lossCanvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    const padL = 48;
    const padR = 46;
    const padT = 22;
    const padB = 30;
    const cw = Math.max(40, width - padL - padR);
    const ch = Math.max(40, height - padT - padB);

    const maxEpoch = Math.max(2, frames[frames.length - 1]?.epoch || totalEpochs);
    const maxLoss = Math.max(
      1.0,
      ...frames.map((f) => Math.max(f.metrics.train_loss || 0, f.metrics.val_loss || 0, f.trl?.entropy || 0))
    );

    const xForEp = (ep: number) => padL + ((ep - 1) / Math.max(1, maxEpoch - 1)) * cw;
    const yForLoss = (val: number) => padT + ch - Math.min(1, Math.max(0, val / maxLoss)) * ch;
    const yForAcc = (acc: number) => padT + ch - Math.min(1, Math.max(0, acc)) * ch;

    // Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * ch;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + cw, y);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(((1 - i / 4) * maxLoss).toFixed(2), padL - 6, y + 3);
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round((1 - i / 4) * 100)}%`, padL + cw + 6, y + 3);
    }

    // X-axis epoch ticks
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    const stepTick = Math.max(1, Math.round(maxEpoch / 5));
    for (let ep = 1; ep <= maxEpoch; ep += stepTick) {
      ctx.fillText(`E${ep}`, xForEp(ep), padT + ch + 16);
    }

    const drawSeries = (getter: (f: (typeof frames)[number]) => number, yFn: (v: number) => number, color: string, dashed = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      frames.forEach((f, idx) => {
        const x = xForEp(f.epoch);
        const y = yFn(getter(f));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    drawSeries((f) => f.metrics.train_loss, yForLoss, '#38bdf8', false);
    drawSeries((f) => f.metrics.val_loss, yForLoss, '#f59e0b', true);
    drawSeries((f) => f.trl?.entropy ?? 0.4, yForLoss, '#c084fc', true);
    drawSeries((f) => f.trl?.mean_token_accuracy ?? f.metrics.val_f1, yForAcc, '#10b981', false);

    // Active Epoch playhead
    const xPlay = xForEp(activeEpoch);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xPlay, padT);
    ctx.lineTo(xPlay, padT + ch);
    ctx.stroke();
  }, [frames, activeEpoch, totalEpochs]);

  // Draw Layer Weight Histogram Canvas
  useEffect(() => {
    const canvas = histCanvasRef.current;
    if (!canvas || !currentFrame) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    const layerHist = currentFrame.histograms?.[selectedLayer] || Object.values(currentFrame.histograms || {})[0];
    const counts = layerHist?.counts || new Array(40).fill(0);
    const maxCount = Math.max(1, ...counts);
    const padL = 12;
    const padB = 18;
    const padT = 8;
    const bw = (width - padL * 2) / counts.length;
    const ch = height - padT - padB;

    counts.forEach((cnt, idx) => {
      const h = (cnt / maxCount) * ch;
      const x = padL + idx * bw;
      const distMid = Math.abs(idx - counts.length / 2) / (counts.length / 2);
      ctx.fillStyle = distMid < 0.25 ? '#38bdf8' : distMid < 0.65 ? '#818cf8' : '#34d399';
      ctx.fillRect(x + 0.5, padT + ch - h, Math.max(1.5, bw - 1), h);
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('-1.0', padL, height - 4);
    ctx.textAlign = 'center';
    ctx.fillText('0.0', width / 2, height - 4);
    ctx.textAlign = 'right';
    ctx.fillText('+1.0', width - padL, height - 4);
  }, [currentFrame, selectedLayer]);

  // 3D Live Neural & PEFT LoRA Layer Visualizer
  useEffect(() => {
    const canvas = neuralCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const startTime = performance.now();

    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
          canvas.width = Math.round(rect.width * dpr);
          canvas.height = Math.round(rect.height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = rect.width;
        const height = rect.height;
        const t = (now - startTime) * 0.001;

        if (neuralAutoOrbit && !neuralDragRef.current.dragging) {
          neuralAngleRef.current.yaw = Math.sin(t * 0.35) * 0.42 - 0.18;
          neuralAngleRef.current.pitch = 0.24 + Math.cos(t * 0.28) * 0.08;
        }

        const yaw = neuralAngleRef.current.yaw;
        const pitch = neuralAngleRef.current.pitch;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);

        const cx = width * 0.5;
        const cyPx = height * 0.53;
        const unit = Math.min(width / 6.2, height / 2.65);

        const proj = (x: number, y: number, z: number) => {
          const x1 = x * cy - z * sy;
          const z1 = x * sy + z * cy;
          const y2 = y * cp - z1 * sp;
          const z2 = y * sp + z1 * cp;
          const fov = 6.0;
          const scale = fov / Math.max(1.4, fov + z2);
          return {
            sx: cx + x1 * unit * scale,
            sy: cyPx + y2 * unit * scale,
            depth: z2,
            scale,
          };
        };

        // Background
        const bg = ctx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, '#070b14');
        bg.addColorStop(1, '#0b1220');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);

        // Subtle 3D floor grid
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
        ctx.lineWidth = 1;
        for (let gx = -2.6; gx <= 2.61; gx += 0.65) {
          const a = proj(gx, 0.92, -0.95);
          const b = proj(gx, 0.92, 0.95);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
        for (let gz = -0.95; gz <= 0.96; gz += 0.475) {
          const a = proj(-2.6, 0.92, gz);
          const b = proj(2.6, 0.92, gz);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }

        const loraActive = hyperparams.loraR > 0;
        const rankScale = loraActive ? Math.min(1.0, 0.25 + hyperparams.loraR / 32) : 0.18;
        const gradEnergy = Math.min(1, (currentFrame?.metrics.global_grad_norm ?? 0.35) / 1.5);
        const pulseSpeed = isTrainingLive || isRunning ? 0.95 : 0.42;

        type LayerBox = {
          id: string;
          label: string;
          sub: string;
          x: number;
          y: number;
          z: number;
          dx: number;
          dy: number;
          dz: number;
          fill: string;
          stroke: string;
          glow?: boolean;
          dashed?: boolean;
        };

        const archSpec: Record<ModelArchitecture, [string, string, string, string]> = {
          SpectralResNet102: ['[B, 2, 102] SED', 'Conv1d Stem', '2× ResBlock + MHA', 'Y/T/M/K/M Logits'],
          DipoleConvNet3D: ['[B, 6, T, 32²]', 'Conv3d(6→16)', 'Conv3d(16→32)+Pool', 'Dipole Class Logits'],
          AstroFeatureSVM: ['[B, 3] Features', '12× RBF Kernels', 'Margin Gram Space', 'Hyperplane Score'],
        };
        const [inSub, stemSub, hidSub, outSub] = archSpec[hyperparams.model];

        const boxes: LayerBox[] = [
          {
            id: 'input',
            label: 'Input Tensor',
            sub: inSub,
            x: -2.25,
            y: 0.08,
            z: 0,
            dx: 0.34,
            dy: 0.72,
            dz: 0.72,
            fill: 'rgba(14, 165, 233, 0.22)',
            stroke: '#38bdf8',
          },
          {
            id: 'stem',
            label: 'Encoder Stem',
            sub: stemSub,
            x: -1.18,
            y: 0.08,
            z: 0,
            dx: 0.42,
            dy: 0.86,
            dz: 0.78,
            fill: 'rgba(56, 189, 248, 0.20)',
            stroke: '#7dd3fc',
          },
          {
            id: 'hidden',
            label: 'Feature Block',
            sub: hidSub,
            x: -0.05,
            y: 0.08,
            z: 0,
            dx: 0.48,
            dy: 0.94,
            dz: 0.84,
            fill: `rgba(129, 140, 248, ${0.22 + gradEnergy * 0.16})`,
            stroke: '#818cf8',
          },
          {
            id: 'base',
            label: hyperparams.freezeBackbone || loraActive ? 'W₀ Frozen Base' : 'W₀ Full Train',
            sub: `${hyperparams.quantizationBits}-bit Base`,
            x: 1.08,
            y: 0.28,
            z: 0,
            dx: 0.46,
            dy: 0.56,
            dz: 0.68,
            fill:
              hyperparams.freezeBackbone || loraActive
                ? 'rgba(100, 116, 139, 0.24)'
                : 'rgba(16, 185, 129, 0.24)',
            stroke: hyperparams.freezeBackbone || loraActive ? '#94a3b8' : '#34d399',
            dashed: hyperparams.freezeBackbone || loraActive,
          },
          {
            id: 'head',
            label: 'Output + Entropy',
            sub: outSub,
            x: 2.25,
            y: 0.08,
            z: 0,
            dx: 0.34,
            dy: 0.66,
            dz: 0.66,
            fill: 'rgba(16, 185, 129, 0.24)',
            stroke: '#34d399',
          },
        ];

        if (loraActive) {
          boxes.push(
            {
              id: 'loraA',
              label: `LoRA A (d×${hyperparams.loraR})`,
              sub: `α=${hyperparams.loraAlpha}`,
              x: 0.82,
              y: -0.58,
              z: 0,
              dx: 0.26,
              dy: 0.26 + rankScale * 0.12,
              dz: 0.34 + rankScale * 0.14,
              fill: 'rgba(245, 158, 11, 0.34)',
              stroke: '#fbbf24',
              glow: true,
            },
            {
              id: 'loraB',
              label: `LoRA B (${hyperparams.loraR}×k)`,
              sub: `ΔW = B·A`,
              x: 1.36,
              y: -0.58,
              z: 0,
              dx: 0.26,
              dy: 0.26 + rankScale * 0.12,
              dz: 0.34 + rankScale * 0.14,
              fill: 'rgba(16, 185, 129, 0.34)',
              stroke: '#34d399',
              glow: true,
            }
          );
        }

        // Draw spine connections + animated forward signal pulses
        const draw3DLink = (
          p1: [number, number, number],
          p2: [number, number, number],
          color: string,
          pulseColor: string,
          phaseOffset: number,
          active = true
        ) => {
          const a = proj(p1[0], p1[1], p1[2]);
          const b = proj(p2[0], p2[1], p2[2]);
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = active ? 1.8 : 1.1;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();

          if (active) {
            const u = ((t * pulseSpeed + phaseOffset) % 1 + 1) % 1;
            const px = a.sx + (b.sx - a.sx) * u;
            const py = a.sy + (b.sy - a.sy) * u;
            ctx.fillStyle = pulseColor;
            ctx.beginPath();
            ctx.arc(px, py, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        };

        draw3DLink([-2.05, 0.08, 0], [-1.42, 0.08, 0], 'rgba(56,189,248,0.45)', '#38bdf8', 0.0);
        draw3DLink([-0.94, 0.08, 0], [-0.32, 0.08, 0], 'rgba(129,140,248,0.45)', '#818cf8', 0.25);
        draw3DLink([0.22, 0.14, 0], [0.82, 0.28, 0], 'rgba(148,163,184,0.38)', '#cbd5e1', 0.45);
        draw3DLink([1.34, 0.28, 0], [2.05, 0.12, 0], 'rgba(16,185,129,0.45)', '#34d399', 0.72);
        if (loraActive) {
          draw3DLink([0.16, -0.05, 0], [0.68, -0.58, 0], 'rgba(245,158,11,0.65)', '#fbbf24', 0.38);
          draw3DLink([0.96, -0.58, 0], [1.22, -0.58, 0], 'rgba(245,158,11,0.75)', '#fde68a', 0.54);
          draw3DLink([1.50, -0.58, 0], [2.05, 0.02, 0], 'rgba(52,211,153,0.72)', '#34d399', 0.78);
        }

        // Depth-sort 3D boxes back-to-front
        const sortedBoxes = [...boxes].sort((a, b) => proj(b.x, b.y, b.z).depth - proj(a.x, a.y, a.z).depth);

        const faceVerts: number[][] = [
          [0, 1, 2, 3], // -z
          [4, 5, 6, 7], // +z
          [0, 1, 5, 4], // -y
          [2, 3, 7, 6], // +y
          [0, 3, 7, 4], // -x
          [1, 2, 6, 5], // +x
        ];

        for (const box of sortedBoxes) {
          const hx = box.dx * 0.5;
          const hy = box.dy * 0.5;
          const hz = box.dz * 0.5;
          const corners = [
            proj(box.x - hx, box.y - hy, box.z - hz),
            proj(box.x + hx, box.y - hy, box.z - hz),
            proj(box.x + hx, box.y + hy, box.z - hz),
            proj(box.x - hx, box.y + hy, box.z - hz),
            proj(box.x - hx, box.y - hy, box.z + hz),
            proj(box.x + hx, box.y - hy, box.z + hz),
            proj(box.x + hx, box.y + hy, box.z + hz),
            proj(box.x - hx, box.y + hy, box.z + hz),
          ];

          const sortedFaces = faceVerts
            .map((idxs) => ({
              pts: idxs.map((i) => corners[i]),
              depth: idxs.reduce((acc, i) => acc + corners[i].depth, 0) / 4,
            }))
            .sort((a, b) => b.depth - a.depth);

          ctx.save();
          if (box.glow) {
            ctx.shadowColor = box.stroke;
            ctx.shadowBlur = 10;
          }
          if (box.dashed) {
            ctx.setLineDash([4, 3]);
          }
          for (const face of sortedFaces) {
            ctx.beginPath();
            ctx.moveTo(face.pts[0].sx, face.pts[0].sy);
            for (let k = 1; k < face.pts.length; k++) {
              ctx.lineTo(face.pts[k].sx, face.pts[k].sy);
            }
            ctx.closePath();
            ctx.fillStyle = box.fill;
            ctx.fill();
            ctx.strokeStyle = box.stroke;
            ctx.lineWidth = box.glow ? 1.4 : 1.0;
            ctx.stroke();
          }
          ctx.restore();

          const topPt = proj(box.x, box.y - hy - 0.14, box.z);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '600 10px "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(box.label, topPt.sx, Math.max(14, topPt.sy));

          const botPt = proj(box.x, box.y + hy + 0.15, box.z);
          ctx.fillStyle = '#94a3b8';
          ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
          ctx.fillText(box.sub, botPt.sx, Math.min(height - 18, botPt.sy));
        }

        // Bottom HUD overlay
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(
          `Drag to rotate 3D stack · Arch: ${hyperparams.model} · LoRA r=${hyperparams.loraR} · GradNorm ${(currentFrame?.metrics.global_grad_norm ?? 0).toFixed(3)}`,
          12,
          height - 7
        );
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [
    hyperparams.model,
    hyperparams.loraR,
    hyperparams.loraAlpha,
    hyperparams.freezeBackbone,
    hyperparams.quantizationBits,
    currentFrame,
    isTrainingLive,
    isRunning,
    neuralAutoOrbit,
  ]);

  const pythonSnippet = useMemo(
    () => `from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

peft_config = LoraConfig(
    r=${hyperparams.loraR},
    lora_alpha=${hyperparams.loraAlpha},
    lora_dropout=${hyperparams.loraDropout},
    bias="none",
    task_type="CAUSAL_LM",
    target_modules=["q_proj", "v_proj", "head", "out_proj"],
)

training_args = SFTConfig(
    output_dir="./checkpoints/${hyperparams.model.toLowerCase()}-sft",
    loss_type="${hyperparams.lossType}",  # "${hyperparams.lossType === 'dft' ? 'Dynamic Fine-Tuning' : 'Cross-Entropy NLL'}"
    completion_only_loss=${hyperparams.completionOnlyLoss ? 'True' : 'False'},
    packing=${hyperparams.packing ? 'True' : 'False'},
    learning_rate=${hyperparams.lr},
    per_device_train_batch_size=${hyperparams.batchSize},
    num_train_epochs=${hyperparams.totalEpochs},
    logging_steps=1,
)

trainer = SFTTrainer(
    model="${hyperparams.model}",
    args=training_args,
    train_dataset=dataset,  # JSONL prompt + <think> completion from Tab 4
    peft_config=${hyperparams.loraR > 0 ? 'peft_config' : 'None'},
)
trainer.train()`,
    [hyperparams]
  );

  const handleCopyScript = () => {
    navigator.clipboard.writeText(pythonSnippet);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 border-b border-border bg-card/70 px-3 sm:px-5 py-2.5 shrink-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              SFT & LoRA Training Studio
            </h2>
            <p className="text-[11px] text-muted-foreground">
              4-step PyTorch + PEFT LoRA workflow modeled on Hugging Face TRL <code className="font-mono text-sky-400">SFTTrainer</code>
            </p>
          </div>
          <Badge variant={isConnected ? 'sky' : 'amber'} className="font-mono text-[10px]">
            {isTrainingLive
              ? 'LIVE PYTORCH TRAINING'
              : isDemoMode
                ? 'Local Trajectory Preview'
                : 'Backend PyTorch Stream'}
          </Badge>
          <span className="hidden lg:inline text-[11px] font-mono text-muted-foreground">
            {statusMessage}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-mono"
            onClick={() => setShowScriptDrawer((v) => !v)}
          >
            {showScriptDrawer ? 'Hide Python Script' : '{ } TRL Python Code'}
          </Button>
          {isRunning && !isTrainingLive ? (
            isPaused ? (
              <Button size="sm" onClick={resumeTrainingRun} className="text-xs">
                ▶ Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={pauseTrainingRun} className="text-xs">
                ⏸ Pause
              </Button>
            )
          ) : null}
          {isRunning && (
            <Button size="sm" variant="outline" onClick={abortTrainingRun} className="text-xs">
              Reset
            </Button>
          )}
          <Button
            size="sm"
            disabled={isTrainingLive}
            onClick={startTrainingRun}
            className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            {isTrainingLive ? '⏳ Training PyTorch...' : '▶ + Train New Model'}
          </Button>
        </div>
      </div>

      {/* MAIN 2-COLUMN WORKSPACE */}
      <div className="flex flex-1 flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* LEFT COLUMN: 4-STEP TRAINING STUDIO */}
        <aside className="w-full lg:w-[360px] xl:w-[390px] shrink-0 border-b lg:border-b-0 lg:border-r border-border bg-card/30 lg:overflow-y-auto p-3 flex flex-col gap-2.5">
          {/* STEP 1: ARCHITECTURE & PEFT LORA */}
          <Card className="border-border">
            <CardHeader className="py-2 px-3 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 1 · Base Model &amp; LoRA Adapter</CardTitle>
              <Badge variant="sky" className="font-mono text-[10px]">LoraConfig</Badge>
            </CardHeader>
            <CardContent className="p-2.5 flex flex-col gap-2 text-xs">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-semibold">
                  New Model Name (Optional)
                </label>
                <input
                  type="text"
                  value={hyperparams.customName}
                  onChange={(e) => setHyperparams((p) => ({ ...p, customName: e.target.value }))}
                  placeholder={`e.g. ${hyperparams.model.toLowerCase()}-v2`}
                  className="mt-1 w-full bg-background border border-border rounded px-2.5 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/60"
                />
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['SpectralResNet102', 'DipoleConvNet3D', 'AstroFeatureSVM'] as ModelArchitecture[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setHyperparams((p) => ({ ...p, model: m }))}
                    className={cn(
                      'px-2 py-1.5 rounded text-[10px] font-mono border transition-colors truncate',
                      hyperparams.model === m
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'bg-secondary/40 border-border text-muted-foreground hover:text-foreground'
                    )}
                    title={m}
                  >
                    {m.replace('Net', '').replace('Feature', '')}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-muted-foreground leading-snug">
                {MODEL_DESCRIPTIONS[hyperparams.model]}
              </p>

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground font-semibold">
                    LoRA Rank (r={hyperparams.loraR})
                  </label>
                  <select
                    value={hyperparams.loraR}
                    onChange={(e) => setHyperparams((p) => ({ ...p, loraR: Number(e.target.value) }))}
                    className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-[11px] font-mono"
                  >
                    <option value={0}>r=0 · Full Fine-Tune</option>
                    <option value={4}>r=4 · Ultra-Light</option>
                    <option value={8}>r=8 · Balanced</option>
                    <option value={16}>r=16 · High Cap</option>
                    <option value={32}>r=32 · Dense</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground font-semibold">
                    Precision / α
                  </label>
                  <select
                    value={`${hyperparams.quantizationBits}-${hyperparams.loraAlpha}`}
                    onChange={(e) => {
                      const [q, a] = e.target.value.split('-').map(Number);
                      setHyperparams((p) => ({ ...p, quantizationBits: q as 4 | 8 | 16, loraAlpha: a }));
                    }}
                    className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-[11px] font-mono"
                  >
                    <option value="4-32">4-bit QLoRA · α=32</option>
                    <option value="8-32">8-bit Adapter · α=32</option>
                    <option value="16-16">FP16 / BF16 · α=16</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center justify-between text-[11px] pt-0.5 cursor-pointer">
                <span className="text-muted-foreground">Freeze Backbone Weights (PEFT-Only)</span>
                <input
                  type="checkbox"
                  checked={hyperparams.freezeBackbone}
                  onChange={(e) => setHyperparams((p) => ({ ...p, freezeBackbone: e.target.checked }))}
                  className="accent-primary"
                />
              </label>
            </CardContent>
          </Card>

          {/* STEP 2: ATTACHED DATASET & CLASS BUCKETS PREVIEW */}
          <Card className="border-border">
            <CardHeader className="py-2 px-3 bg-secondary/40 border-b border-border flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-xs font-semibold">Step 2 · Attached Dataset &amp; Loss Mask</CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                {datasetSnapshot?.split_summary
                  ? `${datasetSnapshot.split_summary.train}T / ${datasetSnapshot.split_summary.val}V`
                  : hyperparams.completionOnlyLoss
                    ? 'Mask=-100'
                    : 'Full Seq'}
              </Badge>
            </CardHeader>
            <CardContent className="p-2.5 flex flex-col gap-2 text-xs">
              {datasetSnapshot?.class_buckets && datasetSnapshot.class_buckets.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {datasetSnapshot.class_buckets.map((b) => (
                    <span
                      key={b.class_name}
                      className="px-1.5 py-0.5 rounded bg-secondary/50 border border-border/70 font-mono text-[9px] text-foreground"
                    >
                      {b.class_name.split(' ')[0]}: <strong className="text-sky-300">{b.count}</strong>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  Sample ({datasetSnapshot?.total_records ?? 0} total):
                </span>
                {datasetSnapshot?.records?.length ? (
                  <select
                    value={selectedSampleIdx}
                    onChange={(e) => setSelectedSampleIdx(Number(e.target.value))}
                    className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-[10px] font-mono"
                  >
                    {datasetSnapshot.records.map((rec, idx) => (
                      <option key={`${rec.target_id || idx}-${idx}`} value={idx}>
                        [{rec.split || 'train'}] {rec.label || rec.target_id} ({rec.domain_class || 'Sample'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground">WISE 0855 reference</span>
                )}
              </div>

              <div className="flex flex-wrap gap-1 p-2 rounded bg-background/80 border border-border/70 font-mono text-[9.5px] leading-relaxed max-h-24 overflow-y-auto">
                {activeDatasetRecord?.tokens_preview?.length ? (
                  activeDatasetRecord.tokens_preview.map((tok, i) => (
                    <span
                      key={`${selectedSampleIdx}-${i}`}
                      title={tok.masked ? 'Prompt token masked with -100 (no gradient)' : 'Supervised completion token'}
                      className={cn(
                        'px-1 rounded',
                        tok.masked && hyperparams.completionOnlyLoss
                          ? 'bg-slate-800/80 text-slate-400 line-through decoration-slate-600'
                          : tok.text.includes('think')
                            ? 'bg-violet-500/25 text-violet-300 font-semibold'
                            : tok.masked
                              ? 'bg-sky-500/20 text-sky-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                      )}
                    >
                      {tok.text}
                    </span>
                  ))
                ) : (
                  <>
                    {SAMPLE_PROMPT_TOKENS.map((tok, i) => (
                      <span
                        key={`p-${i}`}
                        className={cn(
                          'px-1 rounded',
                          hyperparams.completionOnlyLoss
                            ? 'bg-slate-800/80 text-slate-400 line-through decoration-slate-600'
                            : 'bg-sky-500/20 text-sky-300'
                        )}
                      >
                        {tok}
                      </span>
                    ))}
                    {SAMPLE_COMPLETION_TOKENS.map((tok, i) => (
                      <span
                        key={`c-${i}`}
                        className={cn(
                          'px-1 rounded',
                          tok.includes('think')
                            ? 'bg-violet-500/25 text-violet-300 font-semibold'
                            : 'bg-emerald-500/20 text-emerald-300'
                        )}
                      >
                        {tok}
                      </span>
                    ))}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between text-[10.5px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={hyperparams.completionOnlyLoss}
                    onChange={(e) => setHyperparams((p) => ({ ...p, completionOnlyLoss: e.target.checked }))}
                    className="accent-primary"
                  />
                  <span>Mask Prompt (-100)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={hyperparams.packing}
                    onChange={(e) => setHyperparams((p) => ({ ...p, packing: e.target.checked }))}
                    className="accent-primary"
                  />
                  <span>packing=True</span>
                </label>
                <Link to="/admin/exports" className="font-mono text-[10px] text-sky-400 hover:underline">
                  Class Buckets →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* STEP 3: HARDWARE & PARAMETER BUDGET */}
          <Card className="border-border">
            <CardHeader className="py-1.5 px-3 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 3 · Parameter &amp; Memory Budget</CardTitle>
              <span className="font-mono text-[10px] text-emerald-400 font-semibold">
                {paramSummary.trainable_pct}% trainable
              </span>
            </CardHeader>
            <CardContent className="p-2.5 flex flex-col gap-1.5 text-xs">
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                <div
                  className="bg-emerald-500 h-full transition-all"
                  style={{ width: `${Math.max(3, paramSummary.trainable_pct)}%` }}
                />
                <div className="bg-slate-600/60 h-full flex-1" />
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                <div className="bg-secondary/30 p-1.5 rounded">
                  <div className="text-muted-foreground">Trainable</div>
                  <div className="text-emerald-400 font-bold">{paramSummary.trainable_params.toLocaleString()}</div>
                </div>
                <div className="bg-secondary/30 p-1.5 rounded">
                  <div className="text-muted-foreground">LoRA Adapter</div>
                  <div className="text-sky-400 font-bold">{paramSummary.lora_params.toLocaleString()}</div>
                </div>
                <div className="bg-secondary/30 p-1.5 rounded">
                  <div className="text-muted-foreground">CPU Memory</div>
                  <div className="text-foreground font-bold">{paramSummary.vram_estimate_mb} MB</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* STEP 4: SFTCONFIG & RUN */}
          <Card className="border-border">
            <CardHeader className="py-1.5 px-3 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 4 · SFTConfig Objective &amp; Loop</CardTitle>
              <Badge variant="amber" className="font-mono text-[10px]">{hyperparams.lossType.toUpperCase()}</Badge>
            </CardHeader>
            <CardContent className="p-2.5 flex flex-col gap-2 text-xs">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setHyperparams((p) => ({ ...p, lossType: 'dft' }))}
                  className={cn(
                    'py-1 px-2 rounded border text-[11px] font-mono',
                    hyperparams.lossType === 'dft'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-semibold'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  loss_type=&quot;dft&quot;
                </button>
                <button
                  onClick={() => setHyperparams((p) => ({ ...p, lossType: 'nll' }))}
                  className={cn(
                    'py-1 px-2 rounded border text-[11px] font-mono',
                    hyperparams.lossType === 'nll'
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300 font-semibold'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  loss_type=&quot;nll&quot;
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Epochs</label>
                  <select
                    value={hyperparams.totalEpochs}
                    onChange={(e) => setHyperparams((p) => ({ ...p, totalEpochs: Number(e.target.value) }))}
                    className="mt-0.5 w-full bg-background border border-border rounded px-1.5 py-1 font-mono text-xs"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={25}>25</option>
                    <option value={40}>40</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">LR</label>
                  <select
                    value={hyperparams.lr}
                    onChange={(e) => setHyperparams((p) => ({ ...p, lr: Number(e.target.value) }))}
                    className="mt-0.5 w-full bg-background border border-border rounded px-1.5 py-1 font-mono text-xs"
                  >
                    <option value={1e-3}>1e-3</option>
                    <option value={3e-3}>3e-3</option>
                    <option value={1e-2}>1e-2</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Batch</label>
                  <select
                    value={hyperparams.batchSize}
                    onChange={(e) => setHyperparams((p) => ({ ...p, batchSize: Number(e.target.value) }))}
                    className="mt-0.5 w-full bg-background border border-border rounded px-1.5 py-1 font-mono text-xs"
                  >
                    <option value={16}>16</option>
                    <option value={32}>32</option>
                    <option value={64}>64</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* RIGHT WORKSPACE: LIVE TELEMETRY & SCRIPT */}
        <section className="flex-1 lg:overflow-y-auto p-3 sm:p-4 flex flex-col gap-4">
          {showScriptDrawer && (
            <Card className="border-sky-500/40 bg-slate-950/90">
              <CardHeader className="py-2 px-4 border-b border-border flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-mono text-sky-300">
                  Generated HF TRL SFTTrainer + PEFT LoRA Script
                </CardTitle>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCopyScript}>
                  {copiedScript ? 'Copied ✓' : 'Copy Python'}
                </Button>
              </CardHeader>
              <CardContent className="p-3">
                <pre className="text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed">
                  {pythonSnippet}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* MODEL REGISTRY & + TRAIN NEW MODEL */}
          <Card className="border-sky-500/30 bg-card/85">
            <CardHeader className="py-2.5 px-4 border-b border-border bg-secondary/35 flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs font-semibold">
                  Models Registry &amp; + Train New Model
                </CardTitle>
                <Badge variant="sky" className="font-mono text-[10px]">
                  {(modelsRegistry?.base_models || FALLBACK_BASE_MODELS).length} Base · {(modelsRegistry?.trained_models || []).length} Trained
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={hyperparams.customName}
                  onChange={(e) => setHyperparams((p) => ({ ...p, customName: e.target.value }))}
                  placeholder={`New model name (e.g. my-${hyperparams.model.toLowerCase()})`}
                  aria-label="New model name"
                  className="h-7 w-52 bg-background border border-border rounded px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/60"
                />
                <Button
                  size="sm"
                  disabled={isTrainingLive}
                  onClick={startTrainingRun}
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  {isTrainingLive ? '⏳ Training...' : '▶ + Train New Model'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowModelSpecs((s) => !s)}
                  className="h-7 text-[11px] font-mono"
                >
                  {showModelSpecs ? 'Hide Model Specs' : 'Model Specs'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshModelsRegistry()}
                  className="h-7 text-[11px] font-mono"
                >
                  ↻ Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3.5 flex flex-col gap-3">
              {/* 3 BASE PYTORCH ARCHITECTURES */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  PyTorch Base Architectures (Click to Select for Training)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {(modelsRegistry?.base_models?.length ? modelsRegistry.base_models : FALLBACK_BASE_MODELS).map((card) => {
                    const selected = hyperparams.model === card.model_name;
                    return (
                      <div
                        key={card.model_name}
                        role="button"
                        tabIndex={0}
                        onClick={() => setHyperparams((p) => ({ ...p, model: card.model_name }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setHyperparams((p) => ({ ...p, model: card.model_name }));
                          }
                        }}
                        className={cn(
                          'rounded-md border p-2.5 text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5',
                          selected
                            ? 'border-sky-400 bg-sky-500/10 ring-1 ring-sky-400/40'
                            : 'border-border bg-secondary/20 hover:border-border/80 hover:bg-secondary/35'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-foreground leading-tight">
                              {card.title}
                            </div>
                            <div className="text-[10px] font-mono text-sky-400 mt-0.5">
                              {card.family}
                            </div>
                          </div>
                          <Badge
                            variant={card.has_trained_checkpoint ? 'emerald' : 'muted'}
                            className="font-mono text-[9px] shrink-0"
                          >
                            {card.has_trained_checkpoint ? 'Trained ✓' : 'Base Ready'}
                          </Badge>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          In: {card.input_shape} · {card.total_params.toLocaleString()} params
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-snug">
                          {card.layers_summary}
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[10px] font-mono">
                          <span className={selected ? 'text-sky-300 font-semibold' : 'text-muted-foreground'}>
                            {selected ? '● Selected Base' : 'Click to use base'}
                          </span>
                          {card.active_checkpoint && (
                            <span className="text-emerald-400">
                              Best {(card.active_checkpoint.val_acc * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* MODEL ARCHITECTURE & LAYER SPECIFICATION SHEET */}
              {showModelSpecs && selectedBaseSpec && (
                <div className="rounded-md border border-border bg-secondary/15 p-3 flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        Architecture &amp; Layer Specification — {selectedBaseSpec.title}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {selectedBaseSpec.total_params.toLocaleString()} exact base params · Target modules:{' '}
                        <span className="text-sky-300">
                          {(selectedBaseSpec.target_modules || ['head']).join(', ')}
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px] border-emerald-500/40 text-emerald-300">
                      {selectedBaseSpec.training_cost_label || 'CPU LoRA · ~1.5s · $0 GPU'}
                    </Badge>
                  </div>

                  {selectedBaseSpec.layer_specs && selectedBaseSpec.layer_specs.length > 0 && (
                    <div className="overflow-x-auto rounded border border-border/70">
                      <table className="w-full text-left font-mono text-[10px]">
                        <thead className="bg-secondary/50 text-muted-foreground border-b border-border/70">
                          <tr>
                            <th className="px-2 py-1.5">Layer</th>
                            <th className="px-2 py-1.5">Module Type</th>
                            <th className="px-2 py-1.5">Output Shape</th>
                            <th className="px-2 py-1.5 text-right">Params</th>
                            <th className="px-2 py-1.5">LoRA Mode</th>
                            <th className="px-2 py-1.5">Role</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {selectedBaseSpec.layer_specs.map((layer) => (
                            <tr key={layer.name} className="hover:bg-secondary/25">
                              <td className="px-2 py-1.5 font-semibold text-foreground">{layer.name}</td>
                              <td className="px-2 py-1.5 text-sky-300">{layer.type}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{layer.shape}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                                {layer.params.toLocaleString()}
                              </td>
                              <td className="px-2 py-1.5">
                                <Badge
                                  variant={layer.trainable_in_lora ? 'emerald' : 'muted'}
                                  className="font-mono text-[9px]"
                                >
                                  {layer.trainable_in_lora ? 'LoRA Target' : 'Frozen'}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground font-sans text-[11px]">
                                {layer.role}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {selectedBaseSpec.supported_classes && selectedBaseSpec.supported_classes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">
                        Supported Classes:
                      </span>
                      {selectedBaseSpec.supported_classes.map((cls) => (
                        <Badge key={cls} variant="outline" className="font-mono text-[9px] text-slate-300">
                          {cls}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TRAINED CHECKPOINTS / LORA RUNS */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  Trained Model Checkpoints ({modelsRegistry?.trained_models?.length ?? 0})
                </div>
                {modelsRegistry?.trained_models && modelsRegistry.trained_models.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {modelsRegistry.trained_models.map((tm) => {
                      const isActive = Boolean(
                        modelsRegistry.base_models?.some(
                          (bm) => bm.active_checkpoint?.model_id === tm.model_id
                        )
                      );
                      const isPromoting = promotingModelId === tm.model_id;
                      return (
                        <div
                          key={tm.model_id}
                          className={cn(
                            'rounded border px-3 py-2 flex flex-col gap-1.5',
                            isActive
                              ? 'border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/30'
                              : 'border-emerald-500/30 bg-emerald-500/5'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono font-bold text-foreground truncate" title={tm.custom_name}>
                              {tm.custom_name}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {isActive && (
                                <Badge variant="emerald" className="font-mono text-[9px]">
                                  Active
                                </Badge>
                              )}
                              <Badge variant="outline" className="font-mono text-[9px] border-emerald-500/40 text-emerald-300">
                                {(tm.val_acc * 100).toFixed(1)}% acc
                              </Badge>
                            </div>
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            Base: {tm.base_model} · {tm.lora_r > 0 ? `LoRA r=${tm.lora_r}` : 'Full'} · {tm.loss_type.toUpperCase()} · E{tm.epochs_completed}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-border/40 text-[10px] font-mono">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setHyperparams((p) => ({ ...p, model: tm.model_name }))}
                                className="text-sky-400 hover:text-sky-300 underline"
                              >
                                Select {tm.model_name}
                              </button>
                              {!isActive && (
                                <button
                                  type="button"
                                  disabled={isPromoting}
                                  onClick={() => void promoteTrainedModel(tm.model_id)}
                                  className="px-1.5 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-[9px] font-semibold disabled:opacity-50"
                                >
                                  {isPromoting ? 'Promoting...' : 'Promote Active'}
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Link
                                to="/admin/internals"
                                className="text-amber-300 hover:text-amber-200 underline"
                              >
                                Test Identification →
                              </Link>
                              <Link
                                to="/admin/boundaries"
                                className="text-violet-300 hover:text-violet-200 underline"
                              >
                                3D Graph →
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] font-mono text-muted-foreground rounded border border-dashed border-border px-3 py-2">
                    Loading trained PyTorch checkpoints or click <span className="text-emerald-400">▶ + Train New Model</span> above to train and save a custom run.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* OFFICIAL TRL LOGGED METRICS GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {[
              { k: 'global_step', v: String(trl?.global_step ?? activeEpoch * 6), c: 'text-foreground' },
              { k: 'epoch', v: `${activeEpoch}/${totalEpochs}`, c: 'text-sky-400' },
              { k: 'num_tokens', v: (trl?.num_tokens ?? 0).toLocaleString(), c: 'text-foreground' },
              { k: 'loss', v: (currentFrame?.metrics.train_loss ?? 0).toFixed(4), c: 'text-sky-400' },
              { k: 'val_loss', v: (currentFrame?.metrics.val_loss ?? 0).toFixed(4), c: 'text-amber-400' },
              { k: 'entropy', v: `${(trl?.entropy ?? 0).toFixed(3)} b`, c: 'text-violet-400' },
              { k: 'mean_tok_acc', v: `${((trl?.mean_token_accuracy ?? currentFrame?.metrics.val_f1 ?? 0) * 100).toFixed(1)}%`, c: 'text-emerald-400' },
              { k: 'grad_norm', v: (currentFrame?.metrics.global_grad_norm ?? 0).toFixed(4), c: 'text-foreground' },
            ].map((item) => (
              <div key={item.k} className="rounded border border-border bg-card/70 px-2.5 py-2">
                <div className="text-[10px] font-mono text-muted-foreground">{item.k}</div>
                <div className={cn('text-sm font-mono font-bold mt-0.5', item.c)}>{item.v}</div>
              </div>
            ))}
          </div>

          {/* LIVE TRAINING CHART */}
          <Card className="border-border">
            <CardHeader className="py-2.5 px-4 border-b border-border bg-secondary/30 flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-xs font-semibold">Live Loss, Validation Accuracy & Shannon Entropy</CardTitle>
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <span className="text-sky-400">━ Train Loss</span>
                  <span className="text-amber-400">┅ Val Loss</span>
                  <span className="text-violet-400">┅ Entropy (bits)</span>
                  <span className="text-emerald-400">━ Mean Token Acc (%)</span>
                </div>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">
                {overfittingAnalysis.message}
              </span>
            </CardHeader>
            <CardContent className="p-3 flex flex-col gap-2">
              <canvas ref={lossCanvasRef} className="w-full h-56 rounded border border-border/60" />
              <div className="flex items-center gap-3 px-1">
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">Scrub Epoch:</span>
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, totalEpochs)}
                  value={activeEpoch}
                  onChange={(e) => scrubToEpoch(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-[11px] font-mono font-semibold text-foreground w-14 text-right">
                  E{activeEpoch}/{totalEpochs}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 3D LIVE NEURAL & PEFT LORA TOPOLOGY VISUALIZER */}
          <Card className="border-violet-500/30">
            <CardHeader className="py-2.5 px-4 border-b border-border bg-secondary/30 flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xs font-semibold">
                  3D Live Neural &amp; PEFT LoRA Architecture Visualizer
                </CardTitle>
                <Badge variant="outline" className="font-mono text-[10px] border-violet-500/40 bg-violet-500/15 text-violet-300">
                  {hyperparams.model}
                </Badge>
                <Badge variant={hyperparams.loraR > 0 ? 'amber' : 'emerald'} className="font-mono text-[10px]">
                  {hyperparams.loraR > 0
                    ? `LoRA r=${hyperparams.loraR} · ${paramSummary.trainable_pct.toFixed(1)}% trainable`
                    : 'Full Fine-Tune (100%)'}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={neuralAutoOrbit ? 'default' : 'outline'}
                  className="h-6 text-[10px] font-mono px-2"
                  onClick={() => setNeuralAutoOrbit((v) => !v)}
                >
                  {neuralAutoOrbit ? 'Auto-Orbit: ON' : 'Auto-Orbit: OFF'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] font-mono px-2"
                  onClick={() => {
                    setNeuralAutoOrbit(false);
                    neuralAngleRef.current = { yaw: -0.42, pitch: 0.24 };
                    setNeuralYaw(-0.42);
                    setNeuralPitch(0.24);
                  }}
                >
                  Reset 3D
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              <canvas
                ref={neuralCanvasRef}
                aria-label="3D neural and LoRA architecture canvas"
                onMouseDown={(e) => {
                  setNeuralAutoOrbit(false);
                  neuralDragRef.current = { dragging: true, x: e.clientX, y: e.clientY };
                }}
                onMouseMove={(e) => {
                  if (!neuralDragRef.current.dragging) return;
                  const dx = e.clientX - neuralDragRef.current.x;
                  const dy = e.clientY - neuralDragRef.current.y;
                  neuralDragRef.current.x = e.clientX;
                  neuralDragRef.current.y = e.clientY;
                  neuralAngleRef.current.yaw += dx * 0.008;
                  neuralAngleRef.current.pitch = Math.max(
                    -1.1,
                    Math.min(1.1, neuralAngleRef.current.pitch + dy * 0.006)
                  );
                }}
                onMouseUp={() => {
                  neuralDragRef.current.dragging = false;
                }}
                onMouseLeave={() => {
                  neuralDragRef.current.dragging = false;
                }}
                className="w-full h-64 rounded border border-border/60 cursor-grab active:cursor-grabbing"
              />
            </CardContent>
          </Card>

          {/* BOTTOM ROW: CONFUSION MATRIX + LAYER WEIGHT HISTOGRAM */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-border">
              <CardHeader className="py-2.5 px-4 border-b border-border bg-secondary/30 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold">Validation Confusion Matrix</CardTitle>
                <span className="font-mono text-[11px] text-emerald-400">
                  Precision {currentFrame?.confusion.precision ?? 0}% · Recall {currentFrame?.confusion.recall ?? 0}%
                </span>
              </CardHeader>
              <CardContent className="p-4">
                <table className="w-full text-center font-mono text-xs border border-border">
                  <thead className="bg-secondary/40 text-[10px] text-muted-foreground">
                    <tr>
                      <th className="p-2 border border-border text-left">True \ Pred</th>
                      {(currentFrame?.confusion.classes || ['Field', 'Anomaly']).map((c) => (
                        <th key={c} className="p-2 border border-border">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(currentFrame?.confusion.matrix || [[0, 0], [0, 0]]).map((row, ri) => (
                      <tr key={ri}>
                        <td className="p-2 border border-border text-left font-sans text-[11px] text-muted-foreground">
                          {currentFrame?.confusion.classes[ri] || `Class ${ri}`}
                        </td>
                        {row.map((val, ci) => (
                          <td
                            key={ci}
                            className={cn(
                              'p-2 border border-border font-bold',
                              ri === ci ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
                            )}
                          >
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="py-2.5 px-4 border-b border-border bg-secondary/30 flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-xs font-semibold">PyTorch Layer Weight Distribution</CardTitle>
                <select
                  value={selectedLayer}
                  onChange={(e) => setSelectedLayer(e.target.value as AdminLayerName)}
                  className="bg-background border border-border rounded px-2 py-0.5 text-[10px] font-mono max-w-[190px]"
                >
                  {activeLayerKeys.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </CardHeader>
              <CardContent className="p-3">
                <canvas ref={histCanvasRef} className="w-full h-36 rounded border border-border/60" />
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TrainingDynamics;
