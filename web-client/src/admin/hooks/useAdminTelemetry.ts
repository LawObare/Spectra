import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * useAdminTelemetry: Mission Control Live PyTorch + HF TRL Telemetry Hook
 *
 * Connects to:
 * - WS /api/admin/ws/training?model=<model> (live epochs & cached 50-epoch replay)
 * - POST /api/admin/studio/train (starts live PyTorch + LoRA SFT run on CPU)
 * - GET /api/admin/studio/frames?model=<model> (HTTP fallback polling during active runs)
 */

export interface EpochMetrics {
  train_loss: number;
  val_loss: number;
  val_f1: number;
  lr: number;
  global_grad_norm: number;
}

export interface ParamSummary {
  total_params: number;
  trainable_params: number;
  frozen_params: number;
  lora_params: number;
  trainable_pct: number;
  lora_r: number;
  lora_alpha: number;
  quantization_bits: number;
  vram_estimate_mb: number;
}

export interface TrlMetrics {
  global_step: number;
  epoch: number;
  num_tokens: number;
  loss: number;
  val_loss: number;
  entropy: number;
  mean_token_accuracy: number;
  learning_rate: number;
  grad_norm: number;
  loss_type: 'nll' | 'dft';
  completion_only_loss: boolean;
  packing: boolean;
  lora_r: number;
  lora_alpha: number;
  param_summary?: ParamSummary;
  confusion?: number[][];
}

export interface LayerHistogram {
  counts: number[]; // 40 bins from -1.0 to +1.0
  mean: number;
  std: number;
  grad_norm: number;
  dead_neuron_pct: number;
}

export interface ConfusionMatrixData {
  classes: string[];
  matrix: number[][]; // [2x2] or [3x3]: True x Pred
  precision: number;
  recall: number;
  macro_f1: number;
}

export interface TelemetryFrame {
  epoch: number;
  seq?: number;
  run_id?: string;
  mode?: string;
  model?: string;
  metrics: EpochMetrics;
  trl: TrlMetrics;
  histograms: Record<string, LayerHistogram>;
  probe_activations: Record<string, number[][][]>;
  grad_cam: number[][];
  confusion: ConfusionMatrixData;
  decision_surface_offset: number;
  community_points: Array<{ x: number; y: number; z: number; isMover: boolean; isHardNegative?: boolean; label: string }>;
}

export type ModelArchitecture = 'SpectralResNet102' | 'DipoleConvNet3D' | 'AstroFeatureSVM';

export interface TrainedModelCard {
  model_id: string;
  custom_name: string;
  model_name: ModelArchitecture;
  base_model: string;
  run_id: string;
  source: string;
  trained_at: string;
  epochs_completed: number;
  val_acc: number;
  val_loss: number;
  entropy: number;
  lora_r: number;
  lora_alpha: number;
  loss_type: 'nll' | 'dft';
  param_summary?: Record<string, number>;
}

export interface BaseModelCard {
  model_name: ModelArchitecture;
  title: string;
  family: string;
  input_shape: string;
  layers_summary: string;
  total_params: number;
  recommended_for: string;
  has_trained_checkpoint: boolean;
  active_checkpoint: TrainedModelCard | null;
}

export interface ModelsRegistryResponse {
  base_models: BaseModelCard[];
  trained_models: TrainedModelCard[];
  training_active: boolean;
}

export interface Hyperparameters {
  customName: string;
  model: ModelArchitecture;
  batchSize: number;
  lr: number;
  optimizer: 'AdamW' | 'Adam' | 'SGD';
  totalEpochs: number;
  communityWeight: number;
  loraR: number;
  loraAlpha: number;
  loraDropout: number;
  freezeBackbone: boolean;
  lossType: 'nll' | 'dft';
  completionOnlyLoss: boolean;
  packing: boolean;
  quantizationBits: 4 | 8 | 16;
}

export const DEFAULT_HYPERPARAMS: Hyperparameters = {
  customName: '',
  model: 'SpectralResNet102',
  batchSize: 32,
  lr: 3e-3,
  optimizer: 'AdamW',
  totalEpochs: 25,
  communityWeight: 70,
  loraR: 8,
  loraAlpha: 32,
  loraDropout: 0.05,
  freezeBackbone: false,
  lossType: 'dft',
  completionOnlyLoss: true,
  packing: true,
  quantizationBits: 4,
};

export const ADMIN_LAYERS = [
  'Conv1_Spatial_Stem',
  'Conv2_Temporal_Residual',
  'Conv3_Dilated_Bottleneck',
  'Dense_Softmax_Head',
] as const;

export type AdminLayerName = typeof ADMIN_LAYERS[number];

export const PROBE_TARGETS = [
  { name: 'WISE 0855 (Moving Dipole)', ra: 133.7371, dec: -7.2404, type: 'Y4 Brown Dwarf' },
  { name: "Barnard's Star (High PM M-Dwarf)", ra: 269.4464, dec: 4.7668, type: 'M4V Fast Mover' },
  { name: 'Epsilon Indi B (Cold T-Dwarf)', ra: 331.0957, dec: -56.8003, type: 'T1+T6 Binary' },
  { name: 'RW Aurigae (T Tauri Flare)', ra: 76.9565, dec: 30.4013, type: 'Stationary Monopole' },
  { name: 'R Draconis (Mira Variable)', ra: 248.1677, dec: 66.7550, type: 'Pulsing Monopole' },
] as const;

function decodeBase64Grid2D(packed: { shape?: number[]; data?: string } | undefined): number[][] {
  if (!packed?.data || !packed.shape || packed.shape.length < 2) {
    return [];
  }
  try {
    const bin = atob(packed.data);
    const h = packed.shape[packed.shape.length - 2];
    const w = packed.shape[packed.shape.length - 1];
    const grid: number[][] = [];
    let k = 0;
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) {
        row.push(k < bin.length ? bin.charCodeAt(k++) / 255 : 0);
      }
      grid.push(row);
    }
    return grid;
  } catch {
    return [];
  }
}

function summarizeBins(counts: number[], gradNorm: number): LayerHistogram {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  let sumX = 0;
  let sumX2 = 0;
  for (let i = 0; i < counts.length; i++) {
    const center = -1.0 + ((i + 0.5) * 2.0) / Math.max(1, counts.length);
    const p = counts[i] / total;
    sumX += p * center;
    sumX2 += p * center * center;
  }
  const midIdx = Math.floor(counts.length / 2);
  const nearZero = (counts[midIdx - 1] || 0) + (counts[midIdx] || 0);
  return {
    counts,
    mean: Number(sumX.toFixed(4)),
    std: Number(Math.sqrt(Math.max(0, sumX2 - sumX * sumX)).toFixed(4)),
    grad_norm: Number(gradNorm.toFixed(4)),
    dead_neuron_pct: Number(((nearZero / total) * 100 * 0.1).toFixed(2)),
  };
}

export function normalizeBackendFrame(raw: Record<string, any>, fallbackHyper: Hyperparameters): TelemetryFrame {
  // Support already-normalized local simulation frames as well as raw backend frames
  if (raw.metrics && raw.trl) {
    return raw as TelemetryFrame;
  }

  const epoch = Number(raw.epoch || 1);
  const trlRaw = raw.trl || {};
  const trainLoss = Number(raw.loss ?? trlRaw.loss ?? 0.5);
  const valLoss = Number(raw.val_loss ?? trlRaw.val_loss ?? trainLoss);
  const valAcc = Number(raw.val_acc ?? trlRaw.mean_token_accuracy ?? raw.acc ?? 0.5);
  const gradNorm = Number(raw.grad_norm ?? trlRaw.grad_norm ?? 0.04);
  const lr = Number(trlRaw.learning_rate ?? fallbackHyper.lr);

  const layerHistograms: Record<string, LayerHistogram> = {};
  const rawLayers = raw.histograms?.layers || {};
  for (const [lname, val] of Object.entries(rawLayers)) {
    if (Array.isArray(val)) {
      layerHistograms[lname] = summarizeBins(val as number[], gradNorm);
    } else if (val && typeof val === 'object' && Array.isArray((val as LayerHistogram).counts)) {
      layerHistograms[lname] = val as LayerHistogram;
    }
  }

  const confMat: number[][] = Array.isArray(trlRaw.confusion)
    ? trlRaw.confusion
    : [
        [Math.max(1, Math.round(valAcc * 48)), Math.max(0, Math.round((1 - valAcc) * 12))],
        [Math.max(0, Math.round((1 - valAcc) * 10)), Math.max(1, Math.round(valAcc * 50))],
      ];

  const tn = confMat[0]?.[0] ?? 1;
  const fp = confMat[0]?.[1] ?? 0;
  const fn = confMat[1]?.[0] ?? 0;
  const tp = confMat[1]?.[1] ?? 1;
  const prec = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const rec = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
  void tn;

  const gradCam = decodeBase64Grid2D(raw.probe?.gradcam);

  return {
    epoch,
    seq: raw.seq,
    run_id: raw.run_id,
    mode: raw.mode,
    model: raw.model || fallbackHyper.model,
    metrics: {
      train_loss: Number(trainLoss.toFixed(4)),
      val_loss: Number(valLoss.toFixed(4)),
      val_f1: Number(valAcc.toFixed(4)),
      lr,
      global_grad_norm: Number(gradNorm.toFixed(4)),
    },
    trl: {
      global_step: Number(trlRaw.global_step ?? epoch * 6),
      epoch,
      num_tokens: Number(trlRaw.num_tokens ?? epoch * 6 * fallbackHyper.batchSize * (fallbackHyper.packing ? 64 : 42)),
      loss: Number(trainLoss.toFixed(5)),
      val_loss: Number(valLoss.toFixed(5)),
      entropy: Number((trlRaw.entropy ?? Math.max(0.06, 1.0 - valAcc * 0.78)).toFixed(4)),
      mean_token_accuracy: Number(valAcc.toFixed(4)),
      learning_rate: lr,
      grad_norm: Number(gradNorm.toFixed(5)),
      loss_type: trlRaw.loss_type === 'dft' || trlRaw.loss_type === 'nll' ? trlRaw.loss_type : fallbackHyper.lossType,
      completion_only_loss: Boolean(trlRaw.completion_only_loss ?? fallbackHyper.completionOnlyLoss),
      packing: Boolean(trlRaw.packing ?? fallbackHyper.packing),
      lora_r: Number(trlRaw.lora_r ?? fallbackHyper.loraR),
      lora_alpha: Number(trlRaw.lora_alpha ?? fallbackHyper.loraAlpha),
      param_summary: trlRaw.param_summary,
      confusion: confMat,
    },
    histograms: layerHistograms,
    probe_activations: {},
    grad_cam: gradCam,
    confusion: {
      classes: ['Field / Stationary', 'Moving / Anomaly'],
      matrix: confMat,
      precision: Number(prec.toFixed(1)),
      recall: Number(rec.toFixed(1)),
      macro_f1: Number((valAcc * 100).toFixed(1)),
    },
    decision_surface_offset: 0,
    community_points: [],
  };
}

/**
 * Deterministic fallback trajectory ONLY used if the FastAPI backend is unreachable.
 */
function generateOfflineFallbackFrames(hyper: Hyperparameters): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  const total = hyper.totalEpochs;
  const totalParams = hyper.model === 'DipoleConvNet3D' ? 4858 : hyper.model === 'SpectralResNet102' ? 6850 : 226;
  const loraParams = hyper.loraR > 0 ? hyper.loraR * 18 : totalParams;

  for (let e = 1; e <= total; e++) {
    const t = e / Math.max(1, total);
    const trainLoss = Number(Math.max(0.06, 0.72 * Math.exp(-3.2 * t) + 0.05).toFixed(4));
    const valLoss = Number(Math.max(0.08, 0.74 * Math.exp(-2.9 * t) + 0.07).toFixed(4));
    const valAcc = Number(Math.min(0.96, 0.56 + 0.39 * (1 - Math.exp(-3.4 * t))).toFixed(4));
    const curLr = Number((hyper.lr * (0.1 + 0.45 * (1 + Math.cos(Math.PI * t)))).toFixed(6));
    const gradNorm = Number(Math.max(0.015, 0.24 * Math.exp(-2.1 * t) + 0.02).toFixed(4));

    const histograms: Record<string, LayerHistogram> = {};
    for (const layer of ADMIN_LAYERS) {
      const counts = new Array(40).fill(0).map((_, b) => {
        const x = -1.0 + ((b + 0.5) * 2.0) / 40;
        return Math.round(Math.exp(-0.5 * Math.pow(x / (0.22 + 0.08 * t), 2)) * 220);
      });
      histograms[layer] = summarizeBins(counts, gradNorm);
    }

    const tp = Math.round(valAcc * 48);
    const tn = Math.round(valAcc * 48);
    const fp = Math.max(0, 48 - tn);
    const fn = Math.max(0, 48 - tp);

    frames.push({
      epoch: e,
      mode: 'offline_fallback',
      model: hyper.model,
      metrics: { train_loss: trainLoss, val_loss: valLoss, val_f1: valAcc, lr: curLr, global_grad_norm: gradNorm },
      trl: {
        global_step: e * 6,
        epoch: e,
        num_tokens: e * 6 * hyper.batchSize * (hyper.packing ? 64 : 42),
        loss: trainLoss,
        val_loss: valLoss,
        entropy: Number(Math.max(0.08, 1.0 - valAcc * 0.76).toFixed(4)),
        mean_token_accuracy: valAcc,
        learning_rate: curLr,
        grad_norm: gradNorm,
        loss_type: hyper.lossType,
        completion_only_loss: hyper.completionOnlyLoss,
        packing: hyper.packing,
        lora_r: hyper.loraR,
        lora_alpha: hyper.loraAlpha,
        param_summary: {
          total_params: totalParams,
          trainable_params: hyper.freezeBackbone ? loraParams : totalParams,
          frozen_params: hyper.freezeBackbone ? totalParams - loraParams : 0,
          lora_params: loraParams,
          trainable_pct: hyper.freezeBackbone ? Number(((loraParams / totalParams) * 100).toFixed(2)) : 100,
          lora_r: hyper.loraR,
          lora_alpha: hyper.loraAlpha,
          quantization_bits: hyper.quantizationBits,
          vram_estimate_mb: Number(((totalParams * (hyper.quantizationBits / 8)) / (1024 * 1024)).toFixed(4)),
        },
        confusion: [
          [tn, fp],
          [fn, tp],
        ],
      },
      histograms,
      probe_activations: {},
      grad_cam: [],
      confusion: {
        classes: ['Field / Stationary', 'Moving / Anomaly'],
        matrix: [
          [tn, fp],
          [fn, tp],
        ],
        precision: Number(((tp / Math.max(1, tp + fp)) * 100).toFixed(1)),
        recall: Number(((tp / Math.max(1, tp + fn)) * 100).toFixed(1)),
        macro_f1: Number((valAcc * 100).toFixed(1)),
      },
      decision_surface_offset: 0,
      community_points: [],
    });
  }
  return frames;
}

export function useAdminTelemetry() {
  const [hyperparams, setHyperparams] = useState<Hyperparameters>(DEFAULT_HYPERPARAMS);
  const [activeEpoch, setActiveEpoch] = useState<number>(1);
  const [modelsRegistry, setModelsRegistry] = useState<ModelsRegistryResponse | null>(null);

  const refreshModelsRegistry = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/models');
      if (!res.ok) return;
      const data: ModelsRegistryResponse = await res.json();
      if (data && Array.isArray(data.base_models)) {
        setModelsRegistry(data);
      }
    } catch {
      // Backend offline or unavailable; ignore
    }
  }, []);

  useEffect(() => {
    void refreshModelsRegistry();
  }, [refreshModelsRegistry]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState<number>(250);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [isTrainingLive, setIsTrainingLive] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Connecting to PyTorch WS hub...');
  const [selectedLayer, setSelectedLayer] = useState<AdminLayerName>('Conv2_Temporal_Residual');
  const [selectedProbeTarget, setSelectedProbeTarget] = useState<string>('WISE 0855 (Moving Dipole)');

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const hyperRef = useRef<Hyperparameters>(hyperparams);
  hyperRef.current = hyperparams;

  const fallbackFrames = useMemo(() => generateOfflineFallbackFrames(hyperparams), [hyperparams]);
  const [frames, setFrames] = useState<TelemetryFrame[]>(fallbackFrames);

  // Overfitting & early-stopping detector across observed frames
  const overfittingAnalysis = useMemo(() => {
    let triggered = false;
    let triggerEpoch: number | null = null;
    let optimalCheckpoint = 1;

    if (frames.length >= 4) {
      let minValLoss = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const v = frames[i].metrics.val_loss;
        if (v < minValLoss) {
          minValLoss = v;
          optimalCheckpoint = frames[i].epoch;
        }
        if (i >= 3) {
          const d1 = frames[i].metrics.val_loss - frames[i - 1].metrics.val_loss;
          const d2 = frames[i - 1].metrics.val_loss - frames[i - 2].metrics.val_loss;
          const d3 = frames[i - 2].metrics.val_loss - frames[i - 3].metrics.val_loss;
          const t1 = frames[i].metrics.train_loss < frames[i - 1].metrics.train_loss;
          if (d1 > 0 && d2 > 0 && d3 > 0 && t1 && !triggered) {
            triggered = true;
            triggerEpoch = frames[i].epoch;
          }
        }
      }
    }

    return {
      isOverfitting: triggered,
      triggerEpoch,
      optimalCheckpoint,
      message: triggered
        ? `Validation loss drifted up for 3 steps — best checkpoint is Epoch ${optimalCheckpoint}.`
        : `Generalization nominal; lowest validation loss at Epoch ${optimalCheckpoint}.`,
    };
  }, [frames]);

  const currentFrame = useMemo(() => {
    const found = frames.find((f) => f.epoch === activeEpoch);
    return found || frames[frames.length - 1] || null;
  }, [frames, activeEpoch]);

  // Connect WebSocket for selected architecture
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/admin/ws/training?model=${encodeURIComponent(hyperparams.model)}`;
    let closed = false;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (closed) return;
        setIsConnected(true);
        setIsDemoMode(false);
        setStatusMessage(`Connected to ${hyperparams.model} WS stream`);
      };

      socket.onmessage = (event) => {
        if (closed) return;
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'status') {
            if (data.mode === 'live') {
              setIsTrainingLive(true);
              setIsRunning(true);
              setStatusMessage(data.detail || `Live PyTorch SFT run (${data.model})...`);
            } else if (data.mode === 'complete') {
              setIsTrainingLive(false);
              setIsRunning(false);
              setStatusMessage(`Training complete (${data.model}) — checkpoint cached for Tab 2 & Tab 3`);
              void refreshModelsRegistry();
            } else if (data.mode === 'error') {
              setIsTrainingLive(false);
              setIsRunning(false);
              setStatusMessage(`Training error: ${data.detail || 'unknown'}`);
            } else if (data.detail) {
              setStatusMessage(data.detail);
            }
          } else if (data && typeof data.epoch === 'number') {
            const norm = normalizeBackendFrame(data, hyperRef.current);
            setIsDemoMode(false);
            setFrames((prev) => {
              const filtered = prev.filter((f) => f.mode !== 'offline_fallback' && f.epoch !== norm.epoch);
              return [...filtered, norm].sort((a, b) => a.epoch - b.epoch);
            });
            setActiveEpoch(norm.epoch);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onerror = () => {
        if (closed) return;
        setIsConnected(false);
        setIsDemoMode(true);
        setStatusMessage('WS unreachable — using local deterministic preview');
      };

      socket.onclose = () => {
        if (closed) return;
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
      setIsDemoMode(true);
    }

    return () => {
      closed = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [hyperparams.model]);

  // Also fetch latest cached studio frames via HTTP when switching models
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/studio/frames?model=${encodeURIComponent(hyperparams.model)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.frames) || data.frames.length === 0) return;
        const normalized = data.frames.map((raw: Record<string, any>) => normalizeBackendFrame(raw, hyperRef.current));
        setIsDemoMode(false);
        setFrames(normalized);
        setActiveEpoch(normalized[normalized.length - 1].epoch);
      })
      .catch(() => {
        // Keep WS or offline fallback
      });
    return () => {
      cancelled = true;
    };
  }, [hyperparams.model]);

  // Poll /api/admin/studio/frames during active live training as a resilient companion to WS
  useEffect(() => {
    if (!isTrainingLive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/studio/frames?model=${encodeURIComponent(hyperRef.current.model)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.frames) && data.frames.length > 0) {
          const normalized = data.frames.map((raw: Record<string, any>) => normalizeBackendFrame(raw, hyperRef.current));
          setIsDemoMode(false);
          setFrames(normalized);
          setActiveEpoch(normalized[normalized.length - 1].epoch);
        }
        if (!data.training_active && Array.isArray(data.frames) && data.frames.length > 0) {
          setIsTrainingLive(false);
          setIsRunning(false);
          setStatusMessage(`Training complete (${hyperRef.current.model}) — checkpoint ready in Graph & Co-Pilot`);
          void refreshModelsRegistry();
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 300);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isTrainingLive, refreshModelsRegistry]);

  // Offline replay timer only when backend live run is not active and user plays replay
  useEffect(() => {
    if (isRunning && !isPaused && !isTrainingLive) {
      timerRef.current = window.setInterval(() => {
        setActiveEpoch((prev) => {
          const maxEp = frames[frames.length - 1]?.epoch || hyperparams.totalEpochs;
          if (prev >= maxEp) {
            setIsRunning(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeedMs);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRunning, isPaused, isTrainingLive, playbackSpeedMs, hyperparams.totalEpochs, frames]);

  const startTrainingRun = useCallback(async () => {
    const cfg = hyperRef.current;
    setIsPaused(false);
    setIsRunning(true);
    setIsTrainingLive(true);
    setActiveEpoch(1);
    setFrames([]);
    setStatusMessage(`Starting live PyTorch ${cfg.lossType.toUpperCase()} SFT + LoRA (r=${cfg.loraR}) on ${cfg.model}...`);

    try {
      const res = await fetch('/api/admin/studio/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          custom_name: cfg.customName.trim() || undefined,
          epochs: cfg.totalEpochs,
          learning_rate: cfg.lr,
          batch_size: cfg.batchSize,
          lora_r: cfg.loraR,
          lora_alpha: cfg.loraAlpha,
          lora_dropout: cfg.loraDropout,
          freeze_backbone: cfg.freezeBackbone,
          loss_type: cfg.lossType,
          completion_only_loss: cfg.completionOnlyLoss,
          packing: cfg.packing,
          quantization_bits: cfg.quantizationBits,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setIsTrainingLive(false);
        setStatusMessage(`Backend status: ${err.detail || res.status}`);
        if (res.status === 409) {
          setIsTrainingLive(true);
        } else {
          setFrames(generateOfflineFallbackFrames(cfg));
          setIsDemoMode(true);
        }
      }
    } catch {
      // Fallback to local offline playback if backend offline
      setIsTrainingLive(false);
      setIsDemoMode(true);
      setFrames(generateOfflineFallbackFrames(cfg));
      setStatusMessage('Backend offline — replaying local deterministic trajectory');
    }
  }, []);

  const pauseTrainingRun = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resumeTrainingRun = useCallback(() => {
    setIsPaused(false);
    setIsRunning(true);
  }, []);

  const abortTrainingRun = useCallback(() => {
    setIsRunning(false);
    setIsPaused(false);
    setIsTrainingLive(false);
    setActiveEpoch(1);
  }, []);

  const scrubToEpoch = useCallback(
    (epoch: number) => {
      const maxEp = frames[frames.length - 1]?.epoch || hyperparams.totalEpochs;
      setActiveEpoch(Math.max(1, Math.min(maxEp, epoch)));
    },
    [frames, hyperparams.totalEpochs]
  );

  return {
    hyperparams,
    setHyperparams,
    activeEpoch,
    totalEpochs: frames[frames.length - 1]?.epoch || hyperparams.totalEpochs,
    currentFrame,
    frames,
    isRunning,
    isPaused,
    isTrainingLive,
    statusMessage,
    playbackSpeedMs,
    setPlaybackSpeedMs,
    isConnected,
    isDemoMode,
    selectedLayer,
    setSelectedLayer,
    selectedProbeTarget,
    setSelectedProbeTarget,
    overfittingAnalysis,
    modelsRegistry,
    refreshModelsRegistry,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  };
}
