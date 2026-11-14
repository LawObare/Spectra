import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { ModelArchitecture } from './hooks/useAdminTelemetry';
import { cn } from '../lib/utils';

interface TargetSummary {
  target_id: string;
  label: string;
  ra: number;
  dec: number;
  source_badge: string;
  domain_class: string;
  base_anomaly_prob: number;
  trained_anomaly_prob: number;
  base_entropy: number;
  trained_entropy: number;
  confidence_gain: number;
  predicted_binary: string;
  predicted_domain: string;
  top_cosine_sim: number;
  has_real_cutout: boolean;
}

interface SimilarityMatch {
  id: string;
  name: string;
  spectral_class: string;
  category: string;
  cosine_similarity: number;
}

interface SelectedTargetDetail extends TargetSummary {
  wavelengths_um: number[];
  flux_jy: number[];
  band_fluxes_jy: Record<string, number>;
  spectral_features: Record<string, number>;
  stamp_32x32: number[][];
  gradcam_32x32: number[][];
  channel_saliency_102: number[];
  similarity_matches: SimilarityMatch[];
  reasoning_trace: string;
}

interface IdentifyPayload {
  model_name: string;
  checkpoint_meta: Record<string, any>;
  targets: TargetSummary[];
  selected: SelectedTargetDetail | null;
}

const DOMAIN_CLASS_OPTIONS = [
  'Y4 Brown Dwarf',
  'T1+T6 Brown Dwarf Binary',
  'M4V High-PM Star',
  'T Tauri Variable Disk',
  'Mira AGB Pulsating Variable',
  'Ice-Absorbed Protostar',
  'Extragalactic / AGN',
  'Detector / Cosmic-Ray Artifact',
];

const MOLECULAR_LINES = [
  { wave: 1.9, label: 'H2O 1.9µm', color: '#38bdf8' },
  { wave: 3.05, label: 'H2O Ice 3.05µm', color: '#60a5fa' },
  { wave: 3.32, label: 'CH4 3.32µm', color: '#f59e0b' },
  { wave: 4.27, label: 'CO2 4.27µm', color: '#c084fc' },
];

export const ActivationInspector: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTarget = searchParams.get('target');

  const [modelName, setModelName] = useState<ModelArchitecture>('SpectralResNet102');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(initialTarget);
  const [data, setData] = useState<IdentifyPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayAlpha, setOverlayAlpha] = useState<number>(0.65);

  const [overrideClass, setOverrideClass] = useState<string>(DOMAIN_CLASS_OPTIONS[0]);
  const [feedbackNote, setFeedbackNote] = useState<string>('');
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState<boolean>(false);

  const gradCamCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const runScan = useCallback(
    async (targetIdToFetch?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ model: modelName });
        const effectiveId = targetIdToFetch ?? selectedTargetId;
        if (effectiveId) qs.set('target_id', effectiveId);
        const res = await fetch(`/api/admin/identify?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload: IdentifyPayload = await res.json();
        setData(payload);
        if (payload.selected?.target_id) {
          setSelectedTargetId(payload.selected.target_id);
          setOverrideClass(payload.selected.predicted_domain || DOMAIN_CLASS_OPTIONS[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Identification request failed');
      } finally {
        setLoading(false);
      }
    },
    [modelName, selectedTargetId]
  );

  useEffect(() => {
    runScan(selectedTargetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelName]);

  const selected = data?.selected || null;

  // Render Real 32x32 Cutout Stamp + PyTorch Grad-CAM Saliency Canvas (ZERO Math.random)
  useEffect(() => {
    const canvas = gradCamCanvasRef.current;
    if (!canvas || !selected) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const stamp = selected.stamp_32x32;
    const cam = selected.gradcam_32x32;
    const rows = stamp.length || 32;
    const cols = stamp[0]?.length || 32;
    const cellW = w / cols;
    const cellH = h / rows;

    let peakVal = -1;
    let peakX = 16;
    let peakY = 16;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const raw = Math.max(0, Math.min(1, stamp[y]?.[x] ?? 0));
        const sal = Math.max(0, Math.min(1, cam[y]?.[x] ?? 0));
        if (sal > peakVal) {
          peakVal = sal;
          peakX = x;
          peakY = y;
        }
        const g = Math.round(raw * 220);
        ctx.fillStyle = `rgb(${g}, ${g}, ${Math.min(255, g + 22)})`;
        ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));

        if (sal > 0.04) {
          const rC = Math.round(255 * Math.min(1, sal * 1.4));
          const gC = Math.round(180 * Math.max(0, 1 - Math.abs(sal - 0.5) * 2));
          const bC = Math.round(60 * (1 - sal));
          ctx.fillStyle = `rgba(${rC}, ${gC}, ${bC}, ${(sal * overlayAlpha).toFixed(3)})`;
          ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }

    // Peak Grad-CAM attribution reticle
    const rx = (peakX + 0.5) * cellW;
    const ry = (peakY + 0.5) * cellH;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(rx, ry, cellW * 2.2, 0, Math.PI * 2);
    ctx.stroke();
  }, [selected, overlayAlpha]);

  // Render 102-Channel SPHEREx Spectrum + PyTorch Gradient Saliency Bars
  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas || !selected) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, width, height);

    const waves = selected.wavelengths_um || [];
    const flux = selected.flux_jy || [];
    const sal = selected.channel_saliency_102 || [];
    if (waves.length === 0 || flux.length === 0) return;

    const padL = 46;
    const padR = 14;
    const padT = 18;
    const padB = 26;
    const cw = width - padL - padR;
    const ch = height - padT - padB;

    const minW = waves[0];
    const maxW = waves[waves.length - 1];
    const maxF = Math.max(1e-5, ...flux.map((v) => Math.abs(v)));
    const minF = Math.min(0, ...flux);
    const spanF = Math.max(1e-5, maxF - minF);

    const xForW = (w: number) => padL + ((w - minW) / Math.max(0.01, maxW - minW)) * cw;
    const yForF = (f: number) => padT + ch - ((f - minF) / spanF) * ch;

    // 1. Channel gradient saliency backdrop bars
    const bw = cw / waves.length;
    waves.forEach((w, idx) => {
      const s = sal[idx] ?? 0;
      if (s <= 0.05) return;
      ctx.fillStyle = `rgba(245, 158, 11, ${(s * 0.45).toFixed(3)})`;
      ctx.fillRect(xForW(w) - bw * 0.4, padT + ch * (1 - s), Math.max(2, bw * 0.8), ch * s);
    });

    // 2. Molecular band markers
    MOLECULAR_LINES.forEach((line) => {
      const x = xForW(line.wave);
      ctx.strokeStyle = line.color;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + ch);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = line.color;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(line.label, x, padT + 9);
    });

    // 3. Real 102-channel SPHEREx SED curve
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    waves.forEach((w, idx) => {
      const x = xForW(w);
      const y = yForF(flux[idx] ?? 0);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#64748b';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${maxF.toExponential(1)} Jy`, padL - 5, padT + 8);
    ctx.fillText(`${minF.toFixed(2)}`, padL - 5, padT + ch);
    ctx.textAlign = 'center';
    for (const wMark of [1.0, 2.0, 3.0, 4.0, 5.0]) {
      ctx.fillText(`${wMark.toFixed(1)}µm`, xForW(wMark), height - 6);
    }
  }, [selected]);

  const parsedThink = useMemo(() => {
    if (!selected?.reasoning_trace) return { think: '', answer: '' };
    const m = selected.reasoning_trace.match(/<think>([\s\S]*?)<\/think>\s*([\s\S]*)/);
    if (!m) return { think: '', answer: selected.reasoning_trace };
    return { think: m[1].trim(), answer: m[2].trim() };
  }, [selected]);

  const submitFeedback = async (action: 'confirmed' | 'overridden') => {
    if (!selected) return;
    setSubmittingFeedback(true);
    setFeedbackStatus(null);
    const chosenClass = action === 'confirmed' ? selected.predicted_domain : overrideClass;
    try {
      const res = await fetch('/api/admin/sft-dataset/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: selected.target_id,
          label: selected.label,
          predicted_class: selected.predicted_domain,
          human_class: chosenClass,
          action,
          reasoning:
            feedbackNote.trim() ||
            `${selected.predicted_domain} verified via PyTorch (${Math.round(selected.trained_anomaly_prob * 100)}%) & cosine similarity (${selected.top_cosine_sim}).`,
          metrics: {
            trained_prob: selected.trained_anomaly_prob,
            top_cosine_sim: selected.top_cosine_sim,
            ...selected.spectral_features,
          },
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.detail || `HTTP ${res.status}`);
      setFeedbackStatus(`Saved "${chosenClass}" to Tab 4 SFT Training Dataset (${out.total_feedback} operator examples).`);
    } catch (err) {
      setFeedbackStatus(err instanceof Error ? err.message : 'Failed saving feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Live AI Identification Co-Pilot
            </h2>
            <p className="text-[11px] text-muted-foreground">
              PyTorch Base vs. Trained inference over installed SPHEREx sections, Grad-CAM stamps, and 102-band spectra
            </p>
          </div>
          {data?.checkpoint_meta && (
            <Badge variant="sky" className="font-mono text-[10px]">
              Checkpoint: {data.checkpoint_meta.source === 'studio_train' ? 'Studio Run' : 'Warmstart'} · LoRA r=
              {data.checkpoint_meta.lora_r} · {Math.round((data.checkpoint_meta.val_acc || 0) * 100)}% val acc
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={modelName}
            onChange={(e) => setModelName(e.target.value as ModelArchitecture)}
            className="bg-background border border-border rounded px-2.5 py-1 text-xs font-mono"
          >
            <option value="SpectralResNet102">SpectralResNet102</option>
            <option value="DipoleConvNet3D">DipoleConvNet3D</option>
            <option value="AstroFeatureSVM">AstroFeatureSVM</option>
          </select>
          <Button size="sm" onClick={() => runScan(selectedTargetId)} disabled={loading} className="text-xs">
            {loading ? 'Scanning Targets...' : '↻ Run Batch Scan'}
          </Button>
        </div>
      </div>

      {/* MAIN BODY */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT ROSTER: INSTALLED TARGETS */}
        <aside className="w-[340px] shrink-0 border-r border-border bg-card/30 overflow-y-auto p-3 flex flex-col gap-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1">
            Installed Sky Targets ({data?.targets.length || 0})
          </div>
          {(data?.targets || []).map((t) => {
            const isSel = selected?.target_id === t.target_id;
            const gainPct = Math.round(t.confidence_gain * 100);
            return (
              <button
                key={t.target_id}
                onClick={() => {
                  setSelectedTargetId(t.target_id);
                  setSearchParams({ target: t.target_id });
                  runScan(t.target_id);
                }}
                className={cn(
                  'text-left p-2.5 rounded-md border transition-colors flex flex-col gap-1.5',
                  isSel ? 'border-primary bg-primary/10' : 'border-border/70 bg-card/60 hover:border-border'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{t.label}</span>
                  <Badge variant={t.trained_anomaly_prob >= 0.5 ? 'sky' : 'outline'} className="font-mono text-[9px] shrink-0">
                    {(t.trained_anomaly_prob * 100).toFixed(0)}%
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span className="truncate">{t.predicted_domain}</span>
                  <span className={cn(gainPct >= 0 ? 'text-emerald-400' : 'text-amber-400')}>
                    Base {(t.base_anomaly_prob * 100).toFixed(0)}% → {(t.trained_anomaly_prob * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-1.5 rounded bg-secondary overflow-hidden flex">
                  <div className="bg-amber-400/70 h-full" style={{ width: `${Math.round(t.base_anomaly_prob * 100)}%` }} />
                  {t.trained_anomaly_prob > t.base_anomaly_prob && (
                    <div
                      className="bg-emerald-400 h-full"
                      style={{ width: `${Math.round((t.trained_anomaly_prob - t.base_anomaly_prob) * 100)}%` }}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </aside>

        {/* RIGHT INSPECTOR */}
        <section className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {error && (
            <div className="rounded border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">{error}</div>
          )}

          {selected ? (
            <>
              {/* SELECTED TARGET KPI STRIP */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="border-border p-3 bg-card/60">
                  <div className="text-[10px] font-mono text-muted-foreground">Target & Coords</div>
                  <div className="text-sm font-semibold truncate mt-0.5">{selected.label}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {selected.ra.toFixed(3)}°, {selected.dec.toFixed(3)}°
                    </span>
                    <Link
                      to={`/explore?tab=navigator&ra=${selected.ra}&dec=${selected.dec}`}
                      className="text-[10px] text-sky-400 hover:underline font-mono"
                    >
                      Sky View →
                    </Link>
                  </div>
                </Card>

                <Card className="border-border p-3 bg-card/60">
                  <div className="text-[10px] font-mono text-muted-foreground">Untrained Base vs. Trained</div>
                  <div className="text-sm font-mono font-bold mt-0.5">
                    <span className="text-amber-300">{(selected.base_anomaly_prob * 100).toFixed(1)}%</span>
                    <span className="text-muted-foreground mx-1.5">→</span>
                    <span className="text-emerald-400">{(selected.trained_anomaly_prob * 100).toFixed(1)}%</span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-1">
                    Entropy: {selected.base_entropy.toFixed(2)}b → {selected.trained_entropy.toFixed(2)}b
                  </div>
                </Card>

                <Card className="border-border p-3 bg-card/60">
                  <div className="text-[10px] font-mono text-muted-foreground">AI Identification</div>
                  <div className="text-sm font-semibold text-sky-300 truncate mt-0.5">{selected.predicted_domain}</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-1">{selected.predicted_binary}</div>
                </Card>

                <Card className="border-border p-3 bg-card/60">
                  <div className="text-[10px] font-mono text-muted-foreground">Archive Similarity Match</div>
                  <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">
                    cos = {selected.top_cosine_sim.toFixed(4)}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate mt-1">
                    {selected.has_real_cutout ? 'Real .spx.zst Cutout' : 'Band-Derived PSF'} · {selected.source_badge}
                  </div>
                </Card>
              </div>

              {/* VISUAL EVIDENCE: GRAD-CAM STAMP + 102-BAND SALIENCY */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <Card className="lg:col-span-5 border-border">
                  <CardHeader className="py-2 px-3.5 border-b border-border bg-secondary/30 flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-xs font-semibold">32×32 Stamp + PyTorch Grad-CAM</CardTitle>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      <span className="text-muted-foreground">CAM</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={overlayAlpha}
                        onChange={(e) => setOverlayAlpha(Number(e.target.value))}
                        className="w-16 accent-primary"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 flex flex-col items-center gap-2">
                    <canvas
                      ref={gradCamCanvasRef}
                      width={224}
                      height={224}
                      className="rounded border border-border w-56 h-56"
                    />
                    <div className="text-[10px] font-mono text-muted-foreground text-center">
                      {selected.has_real_cutout
                        ? 'Decoded from installed multi-epoch SPHEREx cutout + DipoleConvNet3D.act2 Grad-CAM'
                        : 'Deterministic PSF reconstruction + DipoleConvNet3D.act2 Grad-CAM'}
                    </div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-7 border-border flex flex-col">
                  <CardHeader className="py-2 px-3.5 border-b border-border bg-secondary/30 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-semibold">102-Channel Spectrum + Gradient Attribution</CardTitle>
                    <span className="text-[10px] font-mono text-amber-300">Amber bars = d(logit)/d(flux)</span>
                  </CardHeader>
                  <CardContent className="p-3 flex-1 flex flex-col justify-between gap-2">
                    <canvas ref={specCanvasRef} className="w-full h-48 rounded border border-border/60" />
                    <div className="grid grid-cols-4 gap-2 text-[10px] font-mono">
                      <div className="bg-secondary/30 p-1.5 rounded">
                        <span className="text-muted-foreground block">H2O 3.05µm</span>
                        <span className="font-bold text-sky-300">{selected.spectral_features.h2o_305_depth}</span>
                      </div>
                      <div className="bg-secondary/30 p-1.5 rounded">
                        <span className="text-muted-foreground block">CH4 3.32µm</span>
                        <span className="font-bold text-amber-300">{selected.spectral_features.ch4_332_depth}</span>
                      </div>
                      <div className="bg-secondary/30 p-1.5 rounded">
                        <span className="text-muted-foreground block">CO2 4.27µm</span>
                        <span className="font-bold text-violet-300">{selected.spectral_features.co2_427_depth}</span>
                      </div>
                      <div className="bg-secondary/30 p-1.5 rounded">
                        <span className="text-muted-foreground block">D5/D2 Color</span>
                        <span className="font-bold text-emerald-300">{selected.spectral_features.ir_color_d5_d2}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* CO-PILOT <think> REASONING + SIMILARITY MATCHES + ACTIVE LEARNING */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <Card className="lg:col-span-7 border-border">
                  <CardHeader className="py-2 px-3.5 border-b border-border bg-secondary/30">
                    <CardTitle className="text-xs font-semibold">TRL &lt;think&gt; Co-Pilot Reasoning & Top Matches</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3.5 flex flex-col gap-3 text-xs">
                    {parsedThink.think && (
                      <pre className="p-2.5 rounded bg-violet-950/30 border border-violet-500/30 font-mono text-[11px] text-violet-200 whitespace-pre-wrap leading-relaxed">
                        {parsedThink.think}
                      </pre>
                    )}
                    <div className="font-mono text-xs text-emerald-300 font-semibold">{parsedThink.answer}</div>
                    <div className="flex flex-col gap-1.5">
                      {(selected.similarity_matches || []).map((m, idx) => (
                        <div
                          key={`${m.id}-${idx}`}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded bg-secondary/30 border border-border/50 text-[11px]"
                        >
                          <div>
                            <span className="font-semibold">{m.name}</span>
                            <span className="text-muted-foreground ml-2 font-mono text-[10px]">[{m.spectral_class}]</span>
                          </div>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            cos {m.cosine_similarity.toFixed(4)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-5 border-border">
                  <CardHeader className="py-2 px-3.5 border-b border-border bg-secondary/30">
                    <CardTitle className="text-xs font-semibold">Human-in-the-Loop SFT Feedback</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3.5 flex flex-col gap-2.5 text-xs">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Confirm the Co-Pilot verdict or supply an override class to append this spectrum into Tab 4&apos;s TRL fine-tuning JSONL dataset.
                    </p>
                    <Button
                      size="sm"
                      disabled={submittingFeedback}
                      onClick={() => submitFeedback('confirmed')}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      ✓ Confirm AI Identification ({selected.predicted_domain})
                    </Button>

                    <div className="border-t border-border/60 pt-2.5 flex flex-col gap-2">
                      <label className="text-[10px] font-mono uppercase text-muted-foreground">Or Override Class:</label>
                      <select
                        value={overrideClass}
                        onChange={(e) => setOverrideClass(e.target.value)}
                        className="bg-background border border-border rounded px-2 py-1.5 text-xs font-mono"
                      >
                        {DOMAIN_CLASS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={feedbackNote}
                        onChange={(e) => setFeedbackNote(e.target.value)}
                        placeholder="Optional diagnostic note for <think> trace..."
                        className="bg-background border border-border rounded px-2.5 py-1.5 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submittingFeedback}
                        onClick={() => submitFeedback('overridden')}
                      >
                        Save Override to SFT Dataset
                      </Button>
                    </div>

                    {feedbackStatus && (
                      <div className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1.5 text-[11px] text-emerald-200 font-mono">
                        {feedbackStatus}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground p-6">Loading SPHEREx targets for AI inspection...</div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ActivationInspector;
