import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ADMIN_LAYERS,
  AdminLayerName,
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
    startTrainingRun,
    pauseTrainingRun,
    resumeTrainingRun,
    abortTrainingRun,
    scrubToEpoch,
  } = useAdminTelemetry();

  const lossCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showScriptDrawer, setShowScriptDrawer] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

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
    const total = hyperparams.model === 'DipoleConvNet3D' ? 4858 : hyperparams.model === 'SpectralResNet102' ? 6850 : 226;
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
      ctx.font = '10px ui-monospace, monospace';
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
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('-1.0', padL, height - 4);
    ctx.textAlign = 'center';
    ctx.fillText('0.0', width / 2, height - 4);
    ctx.textAlign = 'right';
    ctx.fillText('+1.0', width - padL, height - 4);
  }, [currentFrame, selectedLayer]);

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
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

        <div className="flex items-center gap-2">
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
            {isTrainingLive ? '⏳ Training PyTorch...' : '▶ Train Model (Live PyTorch)'}
          </Button>
        </div>
      </div>

      {/* MAIN 2-COLUMN WORKSPACE */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT COLUMN: 4-STEP TRAINING STUDIO */}
        <aside className="w-[380px] shrink-0 border-r border-border bg-card/30 overflow-y-auto p-4 flex flex-col gap-3.5">
          {/* STEP 1: ARCHITECTURE & PEFT LORA */}
          <Card className="border-border">
            <CardHeader className="py-2.5 px-3.5 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 1 · Base Model & LoRA Adapter</CardTitle>
              <Badge variant="sky" className="font-mono text-[10px]">LoraConfig</Badge>
            </CardHeader>
            <CardContent className="p-3.5 flex flex-col gap-2.5 text-xs">
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
              <p className="text-[11px] text-muted-foreground leading-snug">
                {MODEL_DESCRIPTIONS[hyperparams.model]}
              </p>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground font-semibold">
                    LoRA Rank (r={hyperparams.loraR})
                  </label>
                  <select
                    value={hyperparams.loraR}
                    onChange={(e) => setHyperparams((p) => ({ ...p, loraR: Number(e.target.value) }))}
                    className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                  >
                    <option value={0}>r=0 (Full Fine-Tune)</option>
                    <option value={4}>r=4 (Ultra-Compact)</option>
                    <option value={8}>r=8 (Recommended)</option>
                    <option value={16}>r=16 (High Capacity)</option>
                    <option value={32}>r=32 (Dense Adapter)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground font-semibold">
                    Quantization / α
                  </label>
                  <select
                    value={`${hyperparams.quantizationBits}-${hyperparams.loraAlpha}`}
                    onChange={(e) => {
                      const [q, a] = e.target.value.split('-').map(Number);
                      setHyperparams((p) => ({ ...p, quantizationBits: q as 4 | 8 | 16, loraAlpha: a }));
                    }}
                    className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                  >
                    <option value="4-32">4-bit QLoRA (α=32)</option>
                    <option value="8-32">8-bit Adapter (α=32)</option>
                    <option value="16-16">FP16 / BF16 (α=16)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center justify-between text-[11px] pt-1 cursor-pointer">
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

          {/* STEP 2: DATASET & TOKEN LOSS MASKING */}
          <Card className="border-border">
            <CardHeader className="py-2.5 px-3.5 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 2 · Dataset & Token Loss Mask</CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                {hyperparams.completionOnlyLoss ? 'Mask=-100' : 'Full Seq'}
              </Badge>
            </CardHeader>
            <CardContent className="p-3.5 flex flex-col gap-2 text-xs">
              <div className="flex flex-wrap gap-1 p-2 rounded bg-background/80 border border-border/70 font-mono text-[10px] leading-relaxed">
                {SAMPLE_PROMPT_TOKENS.map((tok, i) => (
                  <span
                    key={`p-${i}`}
                    title={hyperparams.completionOnlyLoss ? 'Prompt token masked with -100 (no gradient)' : 'Loss active'}
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
                    title="Supervised completion / <think> reasoning token"
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
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">completion_only_loss (Mask Prompt -100)</span>
                <input
                  type="checkbox"
                  checked={hyperparams.completionOnlyLoss}
                  onChange={(e) => setHyperparams((p) => ({ ...p, completionOnlyLoss: e.target.checked }))}
                  className="accent-primary"
                />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">packing=True (Zero-Waste Batching)</span>
                <input
                  type="checkbox"
                  checked={hyperparams.packing}
                  onChange={(e) => setHyperparams((p) => ({ ...p, packing: e.target.checked }))}
                  className="accent-primary"
                />
              </div>
            </CardContent>
          </Card>

          {/* STEP 3: HARDWARE & PARAMETER BUDGET */}
          <Card className="border-border">
            <CardHeader className="py-2 px-3.5 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 3 · Parameter & Memory Budget</CardTitle>
              <span className="font-mono text-[10px] text-emerald-400 font-semibold">
                {paramSummary.trainable_pct}% trainable
              </span>
            </CardHeader>
            <CardContent className="p-3.5 flex flex-col gap-2 text-xs">
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden flex">
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
                  <div className="text-muted-foreground">Est. Memory</div>
                  <div className="text-foreground font-bold">{paramSummary.vram_estimate_mb} MB</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* STEP 4: SFTCONFIG & RUN */}
          <Card className="border-border">
            <CardHeader className="py-2 px-3.5 bg-secondary/40 border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold">Step 4 · SFTConfig Objective & Loop</CardTitle>
              <Badge variant="amber" className="font-mono text-[10px]">{hyperparams.lossType.toUpperCase()}</Badge>
            </CardHeader>
            <CardContent className="p-3.5 flex flex-col gap-2.5 text-xs">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setHyperparams((p) => ({ ...p, lossType: 'dft' }))}
                  className={cn(
                    'py-1.5 px-2 rounded border text-[11px] font-mono',
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
                    'py-1.5 px-2 rounded border text-[11px] font-mono',
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
        <section className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
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
