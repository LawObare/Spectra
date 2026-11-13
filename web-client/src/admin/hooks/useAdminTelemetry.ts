import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * useAdminTelemetry: Administrative Mission Control Telemetry Feed Hook
 * Specification Anchors: SPECIFICATION.md §6.4.1–§6.4.4, §6.5
 * 
 * Manages WebSocket connection to /api/admin/ws/training with seamless fallback
 * to physically grounded astrophysical simulation across 50 epochs.
 */

export interface EpochMetrics {
  train_loss: number;
  val_loss: number;
  val_f1: number;
  lr: number;
  global_grad_norm: number;
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
  matrix: number[][]; // [3x3]: True x Pred
  precision: number;
  recall: number;
  macro_f1: number;
}

export interface TelemetryFrame {
  epoch: number;
  metrics: EpochMetrics;
  histograms: Record<string, LayerHistogram>;
  probe_activations: Record<string, number[][][]>; // layer -> [channels][h][w]
  grad_cam: number[][]; // [32x32] saliency heatmap
  confusion: ConfusionMatrixData;
  decision_surface_offset: number; // Morphs the P(Mover)=0.5 boundary
  community_points: Array<{ x: number; y: number; z: number; isMover: boolean; isHardNegative?: boolean; label: string }>;
}

export interface Hyperparameters {
  model: 'DipoleConvNet3D' | 'SpectralResNet102' | 'AstroFeatureSVM';
  batchSize: number;
  lr: number;
  optimizer: 'AdamW' | 'Adam' | 'SGD';
  totalEpochs: number;
  communityWeight: number; // 0 to 100 (%)
}

const DEFAULT_HYPERPARAMS: Hyperparameters = {
  model: 'DipoleConvNet3D',
  batchSize: 32,
  lr: 1e-4,
  optimizer: 'AdamW',
  totalEpochs: 50,
  communityWeight: 70, // 70% community consensus, 30% gold-standard anchors
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

/**
 * Generate deterministic, physically grounded astrophysical training frames.
 * Faithfully satisfies SPECIFICATION.md §6.4.2–§6.4.4.
 */
function generateDeterministicFrames(hyper: Hyperparameters): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  const total = hyper.totalEpochs;

  for (let e = 1; e <= total; e++) {
    // 1. Loss and scalar metrics with realistic overfitting divergence after epoch 34
    // Base exponential decay
    const trainLoss = Math.max(0.04, 0.85 * Math.exp(-e / 14) + 0.08 * (Math.sin(e * 0.4) * 0.1) + 0.05);
    
    // Val loss follows train loss until epoch 32, then begins diverging (overfitting)
    let valLoss: number;
    if (e <= 32) {
      valLoss = 0.88 * Math.exp(-e / 16) + 0.12 + (e % 3 === 0 ? 0.015 : -0.01);
    } else {
      // Divergence: d/dt(L_val) > 0 for consecutive epochs
      valLoss = 0.22 + 0.012 * Math.pow(e - 32, 1.45) + (e % 2 === 0 ? 0.01 : 0);
    }

    // Macro F1 climbs from 0.62 up to 0.942, plateauing around epoch 32-36
    const valF1 = e <= 35 
      ? Math.min(0.942, 0.62 + 0.322 * (1 - Math.exp(-e / 9)))
      : 0.942 - 0.003 * Math.min(5, e - 35);

    // Cosine learning rate schedule
    const minLr = hyper.lr * 0.01;
    const curLr = minLr + 0.5 * (hyper.lr - minLr) * (1 + Math.cos((Math.PI * e) / total));

    // Global gradient L2 norm: stable around 0.042, spikes slightly on batch boundaries
    const gradNorm = Math.max(0.008, 0.042 * (1 - 0.6 * (e / total)) + 0.005 * Math.sin(e * 1.5));

    // 2. 40-bin Layer Histograms
    const histograms: Record<string, LayerHistogram> = {};
    for (const layer of ADMIN_LAYERS) {
      const counts: number[] = new Array(40).fill(0);
      const spread = 0.15 + (layer.includes('Residual') ? 0.12 : 0.08) * (e / total);
      const centerBin = 20; // 0.0 in range [-1.0, 1.0]

      for (let b = 0; b < 40; b++) {
        const x = -1.0 + (b + 0.5) * (2.0 / 40);
        // Gaussian bell + emerging multimodal features for deep layers
        let prob = Math.exp(-0.5 * Math.pow(x / spread, 2));
        if (layer === 'Conv2_Temporal_Residual' && e > 20) {
          // Bimodal split representing positive/negative dipole subtraction weights
          prob += 0.45 * Math.exp(-0.5 * Math.pow((x - 0.35) / 0.12, 2));
          prob += 0.45 * Math.exp(-0.5 * Math.pow((x + 0.35) / 0.12, 2));
        }
        counts[b] = Math.round(prob * (350 + (e * 8)));
      }

      // Dead neurons (|w| < 1e-4) are roughly 0.8%
      const deadPct = Math.max(0.4, Number((0.82 + 0.15 * Math.sin(e * 0.7)).toFixed(2)));

      histograms[layer] = {
        counts,
        mean: Number(((e % 2 === 0 ? 0.012 : -0.008) * (1 - e / total)).toFixed(4)),
        std: Number((spread * 0.95).toFixed(4)),
        grad_norm: Number((gradNorm * (layer === 'Dense_Softmax_Head' ? 1.4 : 0.8)).toFixed(4)),
        dead_neuron_pct: deadPct,
      };
    }

    // 3. Probe Feature Activations (4 feature channels for probe WISE 0855)
    // 32x32 feature maps downsampled to 16x16
    const probeActivations: Record<string, number[][][]> = {};
    for (const layer of ADMIN_LAYERS) {
      const channels: number[][][] = [];
      for (let c = 0; c < 4; c++) {
        const grid: number[][] = [];
        for (let y = 0; y < 16; y++) {
          const row: number[] = [];
          for (let x = 0; x < 16; x++) {
            const dx = x - 8;
            const dy = y - 8;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let val = 0;
            if (layer === 'Conv1_Spatial_Stem') {
              // Point-source centroid detection
              val = Math.max(0, 1.0 - dist / 5) * (1 + 0.2 * Math.sin(c + x));
            } else if (layer === 'Conv2_Temporal_Residual') {
              // Temporal subtraction dipole (positive lobe on right, negative on left)
              val = (dx / 4) * Math.exp(-0.5 * (dist / 3.5) ** 2) * (e > 10 ? 1.5 : 0.5);
            } else {
              // Deep abstract representations
              val = Math.sin((x * 0.5) + c) * Math.cos((y * 0.5) - c) * 0.5 + 0.5;
            }
            row.push(Number(val.toFixed(3)));
          }
          grid.push(row);
        }
        channels.push(grid);
      }
      probeActivations[layer] = channels;
    }

    // 4. Grad-CAM 32x32 Saliency Heatmap
    // Focusing strictly on moving brown dwarf dipole at (16, 16)
    const gradCam: number[][] = [];
    const focusSharpness = 3.5 + 4.5 * (e / total);
    for (let y = 0; y < 32; y++) {
      const row: number[] = [];
      for (let x = 0; x < 32; x++) {
        const dx = x - 16;
        const dy = y - 16;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Saliency bell around (16, 16) with noise reduction as epochs advance
        let sal = Math.exp(-0.5 * Math.pow(dist / focusSharpness, 2));
        // Boundary artifact noise suppressed at later epochs
        const edgeNoise = (Math.sin(x * 0.9) * Math.cos(y * 0.9) * 0.2) * (1 - e / total);
        sal = Math.max(0, Math.min(1.0, sal + edgeNoise));
        row.push(Number(sal.toFixed(3)));
      }
      gradCam.push(row);
    }

    // 5. Validation 3x3 Confusion Matrix
    // Classes: [Moving Dipole, Pulsing Variable, Detector Artifact]
    const moverTrue = 148;
    const varTrue = 122;
    const artTrue = 99;

    const moverCorrect = Math.min(moverTrue - 1, Math.round(90 + (moverTrue - 90) * (e / 35)));
    const varCorrect = Math.min(varTrue - 1, Math.round(80 + (varTrue - 80) * (e / 35)));
    const artCorrect = Math.min(artTrue - 1, Math.round(65 + (artTrue - 65) * (e / 35)));

    const moverMissVar = Math.max(1, Math.round((moverTrue - moverCorrect) * 0.7));
    const moverMissArt = Math.max(1, moverTrue - moverCorrect - moverMissVar);

    const varMissMover = Math.max(1, Math.round((varTrue - varCorrect) * 0.7));
    const varMissArt = Math.max(1, varTrue - varCorrect - varMissMover);

    const artMissMover = Math.max(1, Math.round((artTrue - artCorrect) * 0.4));
    const artMissVar = Math.max(1, artTrue - artCorrect - artMissMover);

    const matrix = [
      [moverCorrect, moverMissVar, moverMissArt],
      [varMissMover, varCorrect, varMissArt],
      [artMissMover, artMissVar, artCorrect],
    ];

    const totalPredMover = moverCorrect + varMissMover + artMissMover;
    const prec = totalPredMover > 0 ? (moverCorrect / totalPredMover) * 100 : 0;
    const rec = (moverCorrect / moverTrue) * 100;

    // 6. Community Points & Decision Surface Morphs
    // Decision surface offset shifts as community votes correct boundary
    const boundaryShift = Math.sin((e / total) * Math.PI) * 1.8 + (e / total) * 2.2;

    const communityPoints = [
      { x: 4.6, y: 14.8, z: 2.1, isMover: true, label: 'WISE 0855' },
      { x: 1.8, y: 9.6, z: 0.3, isMover: true, label: "Barnard's Star" },
      { x: 3.9, y: 6.4, z: 1.7, isMover: true, label: 'Epsilon Indi B' },
      { x: 2.1, y: 1.2, z: 0.8, isMover: false, label: 'RW Aurigae (Variable)' },
      { x: 2.7, y: 0.8, z: 0.4, isMover: false, label: 'R Draconis (Variable)' },
      { x: 1.1, y: 13.5, z: 0.1, isMover: false, isHardNegative: true, label: 'Glitched Pixel (Artifact)' },
      { x: 1.3, y: 11.2, z: 0.2, isMover: false, isHardNegative: true, label: 'Diffraction Spike' },
      { x: 4.2, y: 12.1, z: 1.9, isMover: true, label: 'User #842 Discovery' },
      { x: 3.5, y: 8.7, z: 1.4, isMover: true, label: 'Volunteer Candidate #109' },
      { x: 0.9, y: 8.0, z: 0.2, isMover: false, isHardNegative: true, label: 'Cosmic Ray Strike' },
    ];

    frames.push({
      epoch: e,
      metrics: {
        train_loss: Number(trainLoss.toFixed(4)),
        val_loss: Number(valLoss.toFixed(4)),
        val_f1: Number(valF1.toFixed(4)),
        lr: Number(curLr.toExponential(2)),
        global_grad_norm: Number(gradNorm.toFixed(4)),
      },
      histograms,
      probe_activations: probeActivations,
      grad_cam: gradCam,
      confusion: {
        classes: ['Moving Dipole', 'Pulsing Variable', 'Detector Artifact'],
        matrix,
        precision: Number(prec.toFixed(1)),
        recall: Number(rec.toFixed(1)),
        macro_f1: Number((valF1 * 100).toFixed(1)),
      },
      decision_surface_offset: Number(boundaryShift.toFixed(3)),
      community_points: communityPoints,
    });
  }

  return frames;
}

export function useAdminTelemetry() {
  const [hyperparams, setHyperparams] = useState<Hyperparameters>(DEFAULT_HYPERPARAMS);
  const [activeEpoch, setActiveEpoch] = useState<number>(34); // Start at informative mid-run epoch
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState<number>(400);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  const [selectedLayer, setSelectedLayer] = useState<AdminLayerName>('Conv2_Temporal_Residual');
  const [selectedProbeTarget, setSelectedProbeTarget] = useState<string>('WISE 0855 (Moving Dipole)');

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  // Pre-generate deterministic frames
  const simulatedFrames = useMemo(() => {
    return generateDeterministicFrames(hyperparams);
  }, [hyperparams]);

  const [frames, setFrames] = useState<TelemetryFrame[]>(simulatedFrames);

  // Overfitting & Early-Stopping Detector (SPECIFICATION.md §6.4.2)
  // Computes d/dt(L_val) across 3 consecutive epochs while train_loss continues to fall
  const overfittingAnalysis = useMemo(() => {
    let triggered = false;
    let triggerEpoch: number | null = null;
    let optimalCheckpoint: number = 32;

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
        ? `Overfitting Region Alert: Validation loss diverging! Early-stopping recommended at Epoch ${optimalCheckpoint}.`
        : 'Training trajectory nominal. Generalization gap is bounded.',
    };
  }, [frames]);

  // Current active frame
  const currentFrame = useMemo(() => {
    const found = frames.find((f) => f.epoch === activeEpoch);
    return found || frames[frames.length - 1] || null;
  }, [frames, activeEpoch]);

  // Attempt live WebSocket connection to FastAPI backend
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/admin/ws/training?token=spx_admin_demo_secret`;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        setIsDemoMode(false);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.epoch) {
            setFrames((prev) => {
              const updated = [...prev.filter((f) => f.epoch !== data.epoch), data];
              return updated.sort((a, b) => a.epoch - b.epoch);
            });
            setActiveEpoch(data.epoch);
          }
        } catch {
          // Swallow parse errors in live stream
        }
      };

      socket.onerror = () => {
        setIsConnected(false);
        setIsDemoMode(true);
      };

      socket.onclose = () => {
        setIsConnected(false);
        setIsDemoMode(true);
      };
    } catch {
      setIsConnected(false);
      setIsDemoMode(true);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Playback timer for live simulation loop
  useEffect(() => {
    if (isRunning && !isPaused) {
      timerRef.current = window.setInterval(() => {
        setActiveEpoch((prev) => {
          if (prev >= hyperparams.totalEpochs) {
            setIsRunning(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeedMs);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRunning, isPaused, playbackSpeedMs, hyperparams.totalEpochs]);

  // Actions
  const startTrainingRun = useCallback(() => {
    setActiveEpoch(1);
    setIsRunning(true);
    setIsPaused(false);
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
    setActiveEpoch(1);
  }, []);

  const scrubToEpoch = useCallback((epoch: number) => {
    setActiveEpoch(Math.max(1, Math.min(hyperparams.totalEpochs, epoch)));
  }, [hyperparams.totalEpochs]);

  return {
    hyperparams,
    setHyperparams,
    activeEpoch,
    totalEpochs: hyperparams.totalEpochs,
    currentFrame,
    frames,
    isRunning,
    isPaused,
    playbackSpeedMs,
    setPlaybackSpeedMs,
    isConnected,
    isDemoMode,
    selectedLayer,
    setSelectedLayer,
    selectedProbeTarget,
    setSelectedProbeTarget,
    overfittingAnalysis,
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  };
}
