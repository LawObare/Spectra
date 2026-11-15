import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ADMIN_LAYERS,
  AdminLayerName,
  BaseModelCard,
  ModelArchitecture,
  useAdminTelemetry,
} from './hooks/useAdminTelemetry';
import { Button } from '../components/ui';
import { cn } from '../lib/utils';
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminSearchInput,
  AdminStatusPill,
  IconActivity,
  IconCheckCircle,
  IconCpu,
  IconLayers,
  SegmentedProgressBar,
} from './components/AdminPrimitives';

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
  const [workspaceTab, setWorkspaceTab] = useState<'setup' | 'specs' | 'topology'>('setup');
  const [checkpointSearch, setCheckpointSearch] = useState('');
  const [checkpointModelFilter, setCheckpointModelFilter] = useState<string>('ALL');
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
  }, [currentFrame, selectedLayer, workspaceTab]);

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
    workspaceTab,
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

  const baseModelsList = useMemo(
    () => (modelsRegistry?.base_models?.length ? modelsRegistry.base_models : FALLBACK_BASE_MODELS),
    [modelsRegistry]
  );

  const trainedModelsList = useMemo(
    () => modelsRegistry?.trained_models || [],
    [modelsRegistry]
  );

  const bestValAcc = useMemo(() => {
    if (trainedModelsList.length === 0) return currentFrame?.metrics.val_f1 ?? 0.89;
    return Math.max(...trainedModelsList.map((t) => t.val_acc || 0));
  }, [trainedModelsList, currentFrame]);

  const filteredCheckpoints = useMemo(() => {
    const q = checkpointSearch.trim().toLowerCase();
    return trainedModelsList.filter((tm) => {
      if (checkpointModelFilter !== 'ALL' && tm.model_name !== checkpointModelFilter) return false;
      if (!q) return true;
      return (
        tm.custom_name.toLowerCase().includes(q) ||
        tm.model_name.toLowerCase().includes(q) ||
        tm.base_model.toLowerCase().includes(q)
      );
    });
  }, [trainedModelsList, checkpointSearch, checkpointModelFilter]);

  const liveValPct = ((currentFrame?.metrics.val_f1 ?? 0) * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-[1480px] mx-auto">
      {/* BAND 1: CLEAN HERO HEADER */}
      <AdminPageHeader
        title="Fine-Tuning & Model Workstation"
        subtitle={`${baseModelsList.length} Base Architectures, ${trainedModelsList.length} Saved Checkpoints, ${datasetSnapshot?.total_records ?? 0} Curated Examples · ${
          isTrainingLive
            ? 'Live PyTorch Run Active'
            : isDemoMode
              ? 'Local Trajectory Ready'
              : isConnected
                ? 'PyTorch Engine Connected'
                : statusMessage
        }`}
        actions={
          <div data-tour="admin-dynamics-actions" className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 rounded-lg text-xs border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07]"
              onClick={() => setShowScriptDrawer((v) => !v)}
            >
              {showScriptDrawer ? 'Hide Python' : '{ } TRL Script'}
            </Button>
            {isRunning && !isTrainingLive && (
              <Button
                size="sm"
                variant="outline"
                onClick={isPaused ? resumeTrainingRun : pauseTrainingRun}
                className="h-9 px-3 rounded-lg text-xs border-white/[0.1]"
              >
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
            )}
            {isRunning && (
              <Button
                size="sm"
                variant="outline"
                onClick={abortTrainingRun}
                className="h-9 px-3 rounded-lg text-xs border-white/[0.1]"
              >
                Reset
              </Button>
            )}
            <Button
              size="sm"
              disabled={isTrainingLive}
              onClick={startTrainingRun}
              className="h-9 px-4 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            >
              {isTrainingLive ? 'Training on CPU...' : '+ Train New Model'}
            </Button>
          </div>
        }
      />

      {showScriptDrawer && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0C0E] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]">
            <span className="text-xs font-medium text-foreground">
              Generated HF TRL <code className="font-mono text-sky-400">SFTTrainer</code> + PEFT Script
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={handleCopyScript}>
              {copiedScript ? 'Copied' : 'Copy Code'}
            </Button>
          </div>
          <pre className="p-4 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
            {pythonSnippet}
          </pre>
        </div>
      )}

      {/* BAND 2: 4 KPI SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AdminKpiCard
          label="Base Architectures"
          value={baseModelsList.length}
          delta={`${hyperparams.model} selected`}
          deltaTone="sky"
          icon={<IconLayers />}
        />
        <AdminKpiCard
          label="Trained Checkpoints"
          value={trainedModelsList.length}
          delta={modelsRegistry?.training_active ? 'Live run in progress' : 'Saved on CPU disk'}
          deltaTone="emerald"
          icon={<IconCheckCircle />}
        />
        <AdminKpiCard
          label="Best Validation Acc"
          value={`${(bestValAcc * 100).toFixed(1)}%`}
          delta={`Frame ${liveValPct}% · Epoch ${activeEpoch}/${totalEpochs}`}
          deltaTone="emerald"
          icon={<IconActivity />}
        />
        <AdminKpiCard
          label="Trainable Parameters"
          value={paramSummary.trainable_params.toLocaleString()}
          delta={`${paramSummary.trainable_pct}% of ${paramSummary.total_params.toLocaleString()} · LoRA r=${hyperparams.loraR}`}
          deltaTone="muted"
          icon={<IconCpu />}
        />
      </div>

      {/* BAND 3: ASYMMETRIC MID GRID (7 COLS WORKBENCH / 5 COLS PERFORMANCE) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* LEFT 7 COLS: TABBED FINE-TUNE SETUP / LAYER SPECS / WEIGHTS */}
        <div className="lg:col-span-7 rounded-xl border border-white/[0.075] bg-card flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.07]">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Fine-Tuning Studio &amp; Model Specifications
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Configure PEFT adapters, inspect exact PyTorch layers, or view 3D weight topology
              </p>
            </div>
            <div className="inline-flex items-center rounded-lg border border-white/[0.08] bg-background/70 p-0.5">
              {(
                [
                  { id: 'setup', label: 'Setup & Data' },
                  { id: 'specs', label: 'Layer Specs' },
                  { id: 'topology', label: 'Weights & 3D' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setWorkspaceTab(tab.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                    workspaceTab === tab.id
                      ? 'bg-white/[0.09] text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 flex-1 flex flex-col gap-4">
            {workspaceTab === 'setup' && (
              <>
                {/* BASE MODEL SELECTOR */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {baseModelsList.map((card) => {
                    const selected = hyperparams.model === card.model_name;
                    return (
                      <button
                        key={card.model_name}
                        type="button"
                        onClick={() => setHyperparams((p) => ({ ...p, model: card.model_name }))}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-all flex flex-col justify-between gap-2',
                          selected
                            ? 'border-primary/60 bg-primary/[0.07]'
                            : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground leading-snug">
                            {card.title.split('+')[0].trim()}
                          </span>
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full mt-1 shrink-0',
                              selected ? 'bg-primary' : 'bg-white/15'
                            )}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground">{card.family}</div>
                        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-[11px] font-mono">
                          <span className="text-muted-foreground">
                            {card.total_params.toLocaleString()}p
                          </span>
                          <span className={card.active_checkpoint ? 'text-emerald-400' : 'text-muted-foreground'}>
                            {card.active_checkpoint
                              ? `${(card.active_checkpoint.val_acc * 100).toFixed(1)}%`
                              : 'Base'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {MODEL_DESCRIPTIONS[hyperparams.model]}
                </p>

                {/* CLEAN HYPERPARAMETERS GRID */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Checkpoint Run Name
                    </label>
                    <input
                      type="text"
                      value={hyperparams.customName}
                      onChange={(e) => setHyperparams((p) => ({ ...p, customName: e.target.value }))}
                      placeholder={`e.g. ${hyperparams.model.toLowerCase()}-v2`}
                      className="mt-1.5 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">
                        LoRA Rank
                      </label>
                      <select
                        value={hyperparams.loraR}
                        onChange={(e) => setHyperparams((p) => ({ ...p, loraR: Number(e.target.value) }))}
                        className="mt-1.5 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-2 text-xs text-foreground"
                      >
                        <option value={0}>r=0 · Full</option>
                        <option value={4}>r=4 · Light</option>
                        <option value={8}>r=8 · Balanced</option>
                        <option value={16}>r=16 · High</option>
                        <option value={32}>r=32 · Dense</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Precision / α
                      </label>
                      <select
                        value={`${hyperparams.quantizationBits}-${hyperparams.loraAlpha}`}
                        onChange={(e) => {
                          const [q, a] = e.target.value.split('-').map(Number);
                          setHyperparams((p) => ({ ...p, quantizationBits: q as 4 | 8 | 16, loraAlpha: a }));
                        }}
                        className="mt-1.5 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-2 text-xs text-foreground"
                      >
                        <option value="4-32">4-bit · α=32</option>
                        <option value="8-32">8-bit · α=32</option>
                        <option value="16-16">FP16 · α=16</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Objective</label>
                    <select
                      value={hyperparams.lossType}
                      onChange={(e) => setHyperparams((p) => ({ ...p, lossType: e.target.value as 'dft' | 'nll' }))}
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-2 text-xs text-foreground"
                    >
                      <option value="dft">DFT Loss</option>
                      <option value="nll">NLL Loss</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Epochs</label>
                    <select
                      value={hyperparams.totalEpochs}
                      onChange={(e) => setHyperparams((p) => ({ ...p, totalEpochs: Number(e.target.value) }))}
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-2 text-xs text-foreground"
                    >
                      <option value={10}>10 epochs</option>
                      <option value={20}>20 epochs</option>
                      <option value={25}>25 epochs</option>
                      <option value={40}>40 epochs</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Learn Rate</label>
                    <select
                      value={hyperparams.lr}
                      onChange={(e) => setHyperparams((p) => ({ ...p, lr: Number(e.target.value) }))}
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-2 text-xs font-mono text-foreground"
                    >
                      <option value={1e-3}>1e-3</option>
                      <option value={3e-3}>3e-3</option>
                      <option value={1e-2}>1e-2</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Batch Size</label>
                    <select
                      value={hyperparams.batchSize}
                      onChange={(e) => setHyperparams((p) => ({ ...p, batchSize: Number(e.target.value) }))}
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 px-2 text-xs text-foreground"
                    >
                      <option value={16}>16</option>
                      <option value={32}>32</option>
                      <option value={64}>64</option>
                    </select>
                  </div>
                </div>

                {/* DATASET SNAPSHOT & TOKEN MASKING STRIP */}
                <div className="rounded-lg border border-white/[0.07] bg-background/50 p-3 flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <span>Attached SFT Corpus</span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {datasetSnapshot?.split_summary
                          ? `${datasetSnapshot.split_summary.train} train · ${datasetSnapshot.split_summary.val} val`
                          : `${datasetSnapshot?.total_records ?? 0} samples`}
                      </span>
                    </div>
                    <Link to="/admin/exports" className="text-xs font-medium text-primary hover:underline">
                      Manage Class Buckets →
                    </Link>
                  </div>

                  {datasetSnapshot?.records?.length ? (
                    <select
                      value={selectedSampleIdx}
                      onChange={(e) => setSelectedSampleIdx(Number(e.target.value))}
                      className="h-8 w-full rounded-lg border border-white/[0.08] bg-card px-2.5 text-xs text-foreground"
                    >
                      {datasetSnapshot.records.map((rec, idx) => (
                        <option key={`${rec.target_id || idx}-${idx}`} value={idx}>
                          [{rec.split || 'train'}] {rec.label || rec.target_id} ({rec.domain_class || 'Sample'})
                        </option>
                      ))}
                    </select>
                  ) : null}

                  <div className="flex flex-wrap gap-1 font-mono text-[10px] leading-relaxed max-h-20 overflow-y-auto">
                    {activeDatasetRecord?.tokens_preview?.length
                      ? activeDatasetRecord.tokens_preview.map((tok, i) => (
                          <span
                            key={`${selectedSampleIdx}-${i}`}
                            className={cn(
                              'px-1.5 py-0.5 rounded',
                              tok.masked && hyperparams.completionOnlyLoss
                                ? 'bg-white/[0.04] text-muted-foreground line-through'
                                : tok.masked
                                  ? 'bg-primary/15 text-sky-300'
                                  : 'bg-emerald-500/15 text-emerald-300'
                            )}
                          >
                            {tok.text}
                          </span>
                        ))
                      : (
                        <>
                          {SAMPLE_PROMPT_TOKENS.map((tok, i) => (
                            <span
                              key={`p-${i}`}
                              className={cn(
                                'px-1.5 py-0.5 rounded',
                                hyperparams.completionOnlyLoss
                                  ? 'bg-white/[0.04] text-muted-foreground line-through'
                                  : 'bg-primary/15 text-sky-300'
                              )}
                            >
                              {tok}
                            </span>
                          ))}
                          {SAMPLE_COMPLETION_TOKENS.map((tok, i) => (
                            <span key={`c-${i}`} className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                              {tok}
                            </span>
                          ))}
                        </>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-white/[0.06] text-[11px] text-muted-foreground">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hyperparams.freezeBackbone}
                        onChange={(e) => setHyperparams((p) => ({ ...p, freezeBackbone: e.target.checked }))}
                        className="accent-primary"
                      />
                      <span>Freeze Backbone</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hyperparams.completionOnlyLoss}
                        onChange={(e) => setHyperparams((p) => ({ ...p, completionOnlyLoss: e.target.checked }))}
                        className="accent-primary"
                      />
                      <span>Mask Prompt (-100)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hyperparams.packing}
                        onChange={(e) => setHyperparams((p) => ({ ...p, packing: e.target.checked }))}
                        className="accent-primary"
                      />
                      <span>Sequence Packing</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            {workspaceTab === 'specs' && selectedBaseSpec && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{selectedBaseSpec.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Input: <span className="font-mono">{selectedBaseSpec.input_shape}</span> · Target modules:{' '}
                      <span className="font-mono text-sky-300">
                        {(selectedBaseSpec.target_modules || ['head']).join(', ')}
                      </span>
                    </div>
                  </div>
                  <AdminStatusPill tone="emerald">
                    {selectedBaseSpec.training_cost_label || 'CPU LoRA · $0 GPU'}
                  </AdminStatusPill>
                </div>

                {selectedBaseSpec.layer_specs && selectedBaseSpec.layer_specs.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-white/[0.07] bg-white/[0.02] text-[11px] font-medium text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2.5">Layer</th>
                          <th className="px-3 py-2.5">Module</th>
                          <th className="px-3 py-2.5">Output Shape</th>
                          <th className="px-3 py-2.5 text-right">Params</th>
                          <th className="px-3 py-2.5">LoRA Mode</th>
                          <th className="px-3 py-2.5">Role</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {selectedBaseSpec.layer_specs.map((layer) => (
                          <tr key={layer.name} className="hover:bg-white/[0.02]">
                            <td className="px-3 py-2.5 font-mono font-medium text-foreground">{layer.name}</td>
                            <td className="px-3 py-2.5 font-mono text-sky-300">{layer.type}</td>
                            <td className="px-3 py-2.5 font-mono text-muted-foreground">{layer.shape}</td>
                            <td className="px-3 py-2.5 font-mono text-right tabular-nums text-foreground">
                              {layer.params.toLocaleString()}
                            </td>
                            <td className="px-3 py-2.5">
                              <AdminStatusPill tone={layer.trainable_in_lora ? 'emerald' : 'muted'}>
                                {layer.trainable_in_lora ? 'LoRA Target' : 'Frozen'}
                              </AdminStatusPill>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{layer.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedBaseSpec.supported_classes && selectedBaseSpec.supported_classes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-muted-foreground mr-1">6 Classification Classes:</span>
                    {selectedBaseSpec.supported_classes.map((cls) => (
                      <span
                        key={cls}
                        className="px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-[11px] text-foreground/85"
                      >
                        {cls}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {workspaceTab === 'topology' && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium text-foreground">
                    3D Neural &amp; PEFT LoRA Topology · {hyperparams.model}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={neuralAutoOrbit ? 'default' : 'outline'}
                      className="h-7 text-[11px] px-2.5 rounded-lg"
                      onClick={() => setNeuralAutoOrbit((v) => !v)}
                    >
                      {neuralAutoOrbit ? 'Auto-Orbit: On' : 'Auto-Orbit: Off'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] px-2.5 rounded-lg"
                      onClick={() => {
                        setNeuralAutoOrbit(false);
                        neuralAngleRef.current = { yaw: -0.42, pitch: 0.24 };
                        setNeuralYaw(-0.42);
                        setNeuralPitch(0.24);
                      }}
                    >
                      Reset View
                    </Button>
                  </div>
                </div>

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
                    neuralAngleRef.current.pitch = Math.max(-1.1, Math.min(1.1, neuralAngleRef.current.pitch + dy * 0.006));
                  }}
                  onMouseUp={() => {
                    neuralDragRef.current.dragging = false;
                  }}
                  onMouseLeave={() => {
                    neuralDragRef.current.dragging = false;
                  }}
                  className="w-full h-56 rounded-lg border border-white/[0.07] cursor-grab active:cursor-grabbing"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-white/[0.07] bg-background/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-foreground">Confusion Matrix</span>
                      <span className="text-[11px] font-mono text-emerald-400">
                        P {currentFrame?.confusion.precision ?? 0}% · R {currentFrame?.confusion.recall ?? 0}%
                      </span>
                    </div>
                    <table className="w-full text-center font-mono text-xs border border-white/[0.07]">
                      <thead className="bg-white/[0.03] text-[10px] text-muted-foreground">
                        <tr>
                          <th className="p-1.5 border border-white/[0.07] text-left">True \ Pred</th>
                          {(currentFrame?.confusion.classes || ['Field', 'Anomaly']).map((c) => (
                            <th key={c} className="p-1.5 border border-white/[0.07]">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(currentFrame?.confusion.matrix || [[0, 0], [0, 0]]).map((row, ri) => (
                          <tr key={ri}>
                            <td className="p-1.5 border border-white/[0.07] text-left font-sans text-[11px] text-muted-foreground">
                              {currentFrame?.confusion.classes[ri] || `C${ri}`}
                            </td>
                            {row.map((val, ci) => (
                              <td
                                key={ci}
                                className={cn(
                                  'p-1.5 border border-white/[0.07] font-semibold',
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
                  </div>

                  <div className="rounded-lg border border-white/[0.07] bg-background/50 p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">Layer Weight Distribution</span>
                      <select
                        value={selectedLayer}
                        onChange={(e) => setSelectedLayer(e.target.value as AdminLayerName)}
                        className="h-7 rounded border border-white/[0.08] bg-card px-2 text-[10px] font-mono max-w-[150px]"
                      >
                        {activeLayerKeys.map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                    <canvas ref={histCanvasRef} className="w-full h-32 rounded border border-white/[0.07]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT 5 COLS: PERFORMANCE CARD (mirrors Dash1 Performance widget) */}
        <div className="lg:col-span-5 rounded-xl border border-white/[0.075] bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.07]">
            <h3 className="text-sm font-semibold text-foreground">Performance</h3>
            <AdminStatusPill tone={overfittingAnalysis.isOverfitting ? 'amber' : 'emerald'}>
              {overfittingAnalysis.isOverfitting
                ? `Val Plateau · Best Ep ${overfittingAnalysis.optimalCheckpoint}`
                : `Healthy · Ep ${overfittingAnalysis.optimalCheckpoint}`}
            </AdminStatusPill>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {liveValPct}%
                </span>
                <span className="text-xs text-emerald-400 font-medium">
                  Epoch {activeEpoch}/{totalEpochs} · Val Loss {(currentFrame?.metrics.val_loss ?? 0).toFixed(3)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground mt-2">
                <span className="text-sky-400">━ Train Loss</span>
                <span className="text-amber-400">┅ Val Loss</span>
                <span className="text-violet-400">┅ Entropy</span>
                <span className="text-emerald-400">━ Val Acc %</span>
              </div>
            </div>

            <canvas ref={lossCanvasRef} className="w-full h-56 rounded-lg border border-white/[0.07]" />

            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">Epoch</span>
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, totalEpochs)}
                  value={activeEpoch}
                  onChange={(e) => scrubToEpoch(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-xs font-mono font-medium text-foreground w-14 text-right tabular-nums">
                  E{activeEpoch}/{totalEpochs}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-white/[0.07] text-center">
                <div>
                  <div className="text-[10px] text-muted-foreground">Step</div>
                  <div className="text-xs font-mono font-semibold text-foreground mt-0.5">
                    {trl?.global_step ?? activeEpoch * 6}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Train Loss</div>
                  <div className="text-xs font-mono font-semibold text-sky-400 mt-0.5">
                    {(currentFrame?.metrics.train_loss ?? 0).toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Entropy</div>
                  <div className="text-xs font-mono font-semibold text-violet-400 mt-0.5">
                    {(trl?.entropy ?? 0).toFixed(2)}b
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Grad Norm</div>
                  <div className="text-xs font-mono font-semibold text-foreground mt-0.5">
                    {(currentFrame?.metrics.global_grad_norm ?? 0).toFixed(3)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BAND 4: CLEAN MODEL CHECKPOINTS TABLE (mirrors Dash1 List Projects table) */}
      <div className="rounded-xl border border-white/[0.075] bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.07]">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Model Checkpoints &amp; Adapters
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Promote trained LoRA adapters as the active inference checkpoint for Live Identification
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminSearchInput
              value={checkpointSearch}
              onChange={setCheckpointSearch}
              placeholder="Search checkpoints..."
              className="w-48"
            />
            <select
              value={checkpointModelFilter}
              onChange={(e) => setCheckpointModelFilter(e.target.value)}
              className="h-8 rounded-lg border border-white/[0.08] bg-background/80 px-2.5 text-xs text-foreground"
            >
              <option value="ALL">All Models</option>
              <option value="SpectralResNet102">SpectralResNet102</option>
              <option value="DipoleConvNet3D">DipoleConvNet3D</option>
              <option value="AstroFeatureSVM">AstroFeatureSVM</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshModelsRegistry()}
              className="h-8 px-3 rounded-lg text-xs border-white/[0.08]"
            >
              ↻ Refresh
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-white/[0.07] text-[11px] font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Checkpoint Name</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Val Accuracy</th>
                <th className="px-4 py-2.5 font-medium">Adapter Spec</th>
                <th className="px-4 py-2.5 font-medium">Epochs</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs">
              {filteredCheckpoints.length > 0 ? (
                filteredCheckpoints.map((tm) => {
                  const isActive = Boolean(
                    modelsRegistry?.base_models?.some(
                      (bm) => bm.active_checkpoint?.model_id === tm.model_id
                    )
                  );
                  const isPromoting = promotingModelId === tm.model_id;
                  return (
                    <tr key={tm.model_id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', isActive ? 'bg-emerald-400' : 'bg-primary')} />
                          <div>
                            <div className="font-medium text-foreground">{tm.custom_name}</div>
                            <div className="text-[11px] text-muted-foreground">{tm.base_model}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <AdminStatusPill tone={isActive ? 'emerald' : 'sky'}>
                          {isActive ? 'Active' : 'Ready'}
                        </AdminStatusPill>
                      </td>
                      <td className="px-4 py-3">
                        <SegmentedProgressBar
                          percent={tm.val_acc * 100}
                          tone={isActive ? 'emerald' : 'sky'}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                        {tm.lora_r > 0 ? `LoRA r=${tm.lora_r}` : 'Full'} · {tm.loss_type.toUpperCase()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-foreground">
                        {tm.epochs_completed} epochs
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setHyperparams((p) => ({ ...p, model: tm.model_name }))}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Use Base
                          </button>
                          {!isActive && (
                            <button
                              type="button"
                              disabled={isPromoting}
                              onClick={() => void promoteTrainedModel(tm.model_id)}
                              className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 hover:bg-primary/25 text-sky-300 text-[11px] font-medium disabled:opacity-50"
                            >
                              {isPromoting ? 'Promoting...' : 'Promote'}
                            </button>
                          )}
                          <Link
                            to="/admin/internals"
                            className="px-2.5 py-1 rounded-md border border-white/[0.09] hover:bg-white/[0.06] text-[11px] text-foreground transition-colors"
                          >
                            Identify →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No matching checkpoints found. Click <span className="text-primary font-medium">+ Train New Model</span> above to train and persist a new adapter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TrainingDynamics;
