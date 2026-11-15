import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui';
import { ModelArchitecture } from './hooks/useAdminTelemetry';
import { cn } from '../lib/utils';
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminSearchInput,
  AdminStatusPill,
  IconActivity,
  IconCheckCircle,
  IconCompass,
  IconScan,
  SegmentedProgressBar,
} from './components/AdminPrimitives';

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
  base_predicted_domain?: string;
  predicted_domain: string;
  top_domain_prob?: number;
  top_cosine_sim: number;
  has_real_cutout: boolean;
}

interface ClassProbabilityRow {
  class_name: string;
  base_prob: number;
  trained_prob: number;
}

interface SourceCentroid {
  x: number;
  y: number;
  radius_px: number;
  peak_snr: number;
  gradcam_peak_x: number;
  gradcam_peak_y: number;
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
  class_probabilities?: ClassProbabilityRow[];
  source_centroid?: SourceCentroid;
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
  'Brown Dwarf (Y/T/L)',
  'M-Dwarf / High-PM Star',
  'Pulsating / T-Tauri Variable',
  'Ice-Absorbed Protostar',
  'Solar System / Moving',
  'Galaxy / AGN / Field',
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
  const [targetSearch, setTargetSearch] = useState<string>('');

  const [overrideClass, setOverrideClass] = useState<string>(DOMAIN_CLASS_OPTIONS[0]);
  const [manualCentroid, setManualCentroid] = useState<{ x: number; y: number } | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<string>('');
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState<boolean>(false);

  const filteredTargets = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    const list = data?.targets || [];
    if (!q) return list;
    return list.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.predicted_domain.toLowerCase().includes(q) ||
        t.target_id.toLowerCase().includes(q)
    );
  }, [data?.targets, targetSearch]);

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

  useEffect(() => {
    setManualCentroid(null);
  }, [selected?.target_id]);

  const handleStampClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = gradCamCanvasRef.current;
    if (!canvas || !selected) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rows = selected.stamp_32x32.length || 32;
    const cols = selected.stamp_32x32[0]?.length || 32;
    const gx = Math.max(0.5, Math.min(cols - 0.5, ((e.clientX - rect.left) / rect.width) * cols - 0.5));
    const gy = Math.max(0.5, Math.min(rows - 0.5, ((e.clientY - rect.top) / rect.height) * rows - 0.5));
    setManualCentroid({ x: Number(gx.toFixed(2)), y: Number(gy.toFixed(2)) });
  };

  // Render Real 32x32 Cutout Stamp + Source Centroid Circle + PyTorch Grad-CAM Saliency Canvas
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

    // 1. Flux-weighted (or operator-adjusted) Source Centroid Circle + Crosshair
    const centX = manualCentroid?.x ?? selected.source_centroid?.x ?? cols / 2;
    const centY = manualCentroid?.y ?? selected.source_centroid?.y ?? rows / 2;
    const centRadius = (selected.source_centroid?.radius_px ?? 3.2) * cellW;
    const cxPx = (centX + 0.5) * cellW;
    const cyPx = (centY + 0.5) * cellH;

    ctx.save();
    ctx.strokeStyle = manualCentroid ? '#f59e0b' : '#10b981';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cxPx, cyPx, centRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cxPx - 5, cyPx);
    ctx.lineTo(cxPx + 5, cyPx);
    ctx.moveTo(cxPx, cyPx - 5);
    ctx.lineTo(cxPx, cyPx + 5);
    ctx.stroke();
    ctx.restore();

    // 2. Peak Grad-CAM attribution diamond marker (separate from photometric centroid)
    const camPeakX = selected.source_centroid?.gradcam_peak_x ?? peakX;
    const camPeakY = selected.source_centroid?.gradcam_peak_y ?? peakY;
    const rx = (camPeakX + 0.5) * cellW;
    const ry = (camPeakY + 0.5) * cellH;
    const dSize = cellW * 1.35;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(rx, ry - dSize);
    ctx.lineTo(rx + dSize, ry);
    ctx.lineTo(rx, ry + dSize);
    ctx.lineTo(rx - dSize, ry);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }, [selected, overlayAlpha, manualCentroid]);

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
    const padT = 34;
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

    // 2. Staggered molecular band markers (2-tier header prevents 3.05µm vs 3.32µm overlap)
    MOLECULAR_LINES.forEach((line, idx) => {
      const x = xForW(line.wave);
      const labelY = idx % 2 === 0 ? 11 : 24;
      ctx.strokeStyle = line.color;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT - 4);
      ctx.lineTo(x, padT + ch);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
      const tw = ctx.measureText(line.label).width;
      const boxX = Math.max(padL, Math.min(width - padR - tw - 6, x - tw / 2 - 3));
      ctx.fillStyle = 'rgba(7, 11, 19, 0.88)';
      ctx.fillRect(boxX, labelY - 9, tw + 6, 12);
      ctx.fillStyle = line.color;
      ctx.textAlign = 'left';
      ctx.fillText(line.label, boxX + 3, labelY);
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
    ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
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
            centroid_x: manualCentroid?.x ?? selected.source_centroid?.x ?? 16,
            centroid_y: manualCentroid?.y ?? selected.source_centroid?.y ?? 16,
            ...selected.spectral_features,
          },
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.detail || `HTTP ${res.status}`);
      setFeedbackStatus(`Saved "${chosenClass}" to Datasets & Class Buckets (${out.total_feedback} operator examples).`);
    } catch (err) {
      setFeedbackStatus(err instanceof Error ? err.message : 'Failed saving feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5">
        <AdminPageHeader
          title="AI Identification Co-Pilot"
          subtitle="Compare base vs. fine-tuned SPHEREx predictions, Grad-CAM centroid apertures, and 102-channel attributions."
          actions={
            <>
              {data?.checkpoint_meta && (
                <AdminStatusPill tone="sky">
                  {data.checkpoint_meta.source === 'studio_train' ? 'Studio Run' : 'Warmstart'} · LoRA r=
                  {data.checkpoint_meta.lora_r} · {Math.round((data.checkpoint_meta.val_acc || 0) * 100)}% acc
                </AdminStatusPill>
              )}
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value as ModelArchitecture)}
                className="h-8 rounded-lg border border-white/[0.1] bg-background/80 px-3 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
              >
                <option value="SpectralResNet102">SpectralResNet102</option>
                <option value="DipoleConvNet3D">DipoleConvNet3D</option>
                <option value="AstroFeatureSVM">AstroFeatureSVM</option>
              </select>
              <Button
                size="sm"
                onClick={() => runScan(selectedTargetId)}
                disabled={loading}
                className="h-8 rounded-lg px-3.5 text-xs font-medium"
              >
                {loading ? 'Scanning Targets...' : '↻ Run Batch Scan'}
              </Button>
            </>
          }
        />

        {error && (
          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* BAND 2: 4-CARD KPI SUMMARY */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AdminKpiCard
            label="Selected Target"
            value={selected ? selected.label : 'Loading...'}
            delta={selected ? `${selected.ra.toFixed(3)}°, ${selected.dec.toFixed(3)}°` : 'Awaiting scan'}
            deltaTone="muted"
            icon={<IconCompass className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Trained Confidence"
            value={selected ? `${(selected.trained_anomaly_prob * 100).toFixed(1)}%` : '—'}
            delta={
              selected
                ? `Base ${(selected.base_anomaly_prob * 100).toFixed(1)}% · H=${selected.trained_entropy.toFixed(2)}b`
                : 'Base vs. LoRA'
            }
            deltaTone="emerald"
            icon={<IconActivity className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="6-Class Prediction"
            value={selected ? selected.predicted_domain : '—'}
            delta={selected ? `Prior: ${selected.base_predicted_domain || 'Field'}` : 'Multi-class head'}
            deltaTone="sky"
            icon={<IconScan className="h-4 w-4" />}
          />
          <AdminKpiCard
            label="Archive Similarity"
            value={selected ? `cos ${selected.top_cosine_sim.toFixed(4)}` : '—'}
            delta={
              selected
                ? `${selected.has_real_cutout ? 'Real .spx.zst Cutout' : 'Band-Derived PSF'} · ${selected.source_badge}`
                : 'Reference bank'
            }
            deltaTone="muted"
            icon={<IconCheckCircle className="h-4 w-4" />}
          />
        </div>

        {/* BAND 3: TARGET ROSTER + INSPECTOR WORKSPACE */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
          {/* LEFT ROSTER */}
          <aside className="admin-surface rounded-xl flex flex-col overflow-hidden lg:col-span-4">
            <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Installed Sky Targets</h2>
                  <p className="text-xs text-muted-foreground">Select a field to inspect model attribution</p>
                </div>
                <AdminStatusPill tone="muted">{filteredTargets.length}</AdminStatusPill>
              </div>
              <AdminSearchInput
                value={targetSearch}
                onChange={setTargetSearch}
                placeholder="Search target or class..."
              />
            </div>

            <div className="max-h-[420px] lg:max-h-[780px] overflow-y-auto divide-y divide-white/[0.06]">
              {filteredTargets.map((t) => {
                const isSel = selected?.target_id === t.target_id;
                const gainPct = Math.round(t.confidence_gain * 100);
                const trainedPct = Math.round(t.trained_anomaly_prob * 100);
                return (
                  <button
                    key={t.target_id}
                    type="button"
                    onClick={() => {
                      setSelectedTargetId(t.target_id);
                      setSearchParams({ target: t.target_id });
                      runScan(t.target_id);
                    }}
                    className={cn(
                      'w-full text-left px-4 py-3 transition-colors flex flex-col gap-2',
                      isSel
                        ? 'bg-primary/[0.09] border-l-2 border-l-primary'
                        : 'hover:bg-white/[0.03]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">{t.label}</span>
                      <AdminStatusPill tone={t.trained_anomaly_prob >= 0.5 ? 'sky' : 'muted'}>
                        {trainedPct}%
                      </AdminStatusPill>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate">{t.predicted_domain}</span>
                      <span className={cn('font-mono tabular-nums', gainPct >= 0 ? 'text-emerald-400' : 'text-amber-400')}>
                        {(t.base_anomaly_prob * 100).toFixed(0)}% → {trainedPct}%
                      </span>
                    </div>
                    <SegmentedProgressBar
                      percent={trainedPct}
                      tone={t.trained_anomaly_prob >= 0.5 ? 'emerald' : 'sky'}
                      showLabel={false}
                    />
                  </button>
                );
              })}
              {filteredTargets.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No targets match &ldquo;{targetSearch}&rdquo;.
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT INSPECTOR */}
          <section className="lg:col-span-8 flex flex-col gap-5">
            {selected ? (
              <>
                {/* 6-CLASS PROBABILITY COMPARISON */}
                {selected.class_probabilities && selected.class_probabilities.length > 0 && (
                  <div className="admin-surface rounded-xl overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-5 py-3.5">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          Base vs. Fine-Tuned Class Probabilities
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          6-class spectral distribution shift after LoRA adaptation
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-sm bg-slate-400/75" /> Base Prior
                        </span>
                        <span className="flex items-center gap-1.5 text-emerald-300">
                          <span className="h-2 w-2 rounded-sm bg-emerald-400" /> Post-LoRA
                        </span>
                        <Link
                          to={`/explore?tab=navigator&ra=${selected.ra}&dec=${selected.dec}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Open in Sky View →
                        </Link>
                      </div>
                    </div>

                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {selected.class_probabilities.map((cp) => {
                        const basePct = Math.round(cp.base_prob * 100);
                        const trainedPct = Math.round(cp.trained_prob * 100);
                        const delta = trainedPct - basePct;
                        const isWinner = cp.class_name === selected.predicted_domain;
                        return (
                          <div
                            key={cp.class_name}
                            className={cn(
                              'rounded-lg border p-3 flex flex-col gap-2',
                              isWinner
                                ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                                : 'border-white/[0.07] bg-white/[0.02]'
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5 text-xs">
                              <span
                                className={cn(
                                  'truncate font-medium',
                                  isWinner ? 'text-emerald-300 font-semibold' : 'text-foreground'
                                )}
                              >
                                {cp.class_name}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums shrink-0">
                                <span className="text-muted-foreground">{basePct}%</span>
                                <span className="text-muted-foreground mx-1">→</span>
                                <span className={isWinner ? 'text-emerald-300 font-semibold' : 'text-sky-300'}>
                                  {trainedPct}%
                                </span>
                                <span className={cn('ml-1', delta >= 0 ? 'text-emerald-400' : 'text-amber-400')}>
                                  ({delta >= 0 ? '+' : ''}
                                  {delta})
                                </span>
                              </span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                                <div className="h-full bg-slate-400/70" style={{ width: `${Math.min(100, basePct)}%` }} />
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                                <div
                                  className={cn('h-full rounded-full', isWinner ? 'bg-emerald-400' : 'bg-sky-400')}
                                  style={{ width: `${Math.min(100, trainedPct)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* VISUAL EVIDENCE: GRAD-CAM STAMP + 102-BAND SALIENCY */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                  <div className="admin-surface rounded-xl xl:col-span-5 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">32×32 Stamp &amp; Grad-CAM</h3>
                      <div className="flex items-center gap-2 text-[11px]">
                        {manualCentroid && (
                          <button
                            type="button"
                            onClick={() => setManualCentroid(null)}
                            className="text-amber-300 hover:text-amber-200 underline"
                          >
                            Reset
                          </button>
                        )}
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
                    </div>
                    <div className="p-4 flex flex-col items-center gap-3">
                      <canvas
                        ref={gradCamCanvasRef}
                        width={224}
                        height={224}
                        onClick={handleStampClick}
                        title="Click stamp to reposition source centroid aperture"
                        className="rounded-lg border border-white/[0.08] w-56 h-56 cursor-crosshair"
                      />
                      <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-mono text-muted-foreground">
                        <span className={manualCentroid ? 'text-amber-300' : 'text-emerald-400'}>
                          ◯ {manualCentroid ? 'Manual' : 'Flux'} ({(manualCentroid?.x ?? selected.source_centroid?.x ?? 16).toFixed(1)},{' '}
                          {(manualCentroid?.y ?? selected.source_centroid?.y ?? 16).toFixed(1)} · r=
                          {(selected.source_centroid?.radius_px ?? 3.2).toFixed(1)}px)
                        </span>
                        <span className="text-sky-400">
                          ◇ Peak ({selected.source_centroid?.gradcam_peak_x ?? 16},{' '}
                          {selected.source_centroid?.gradcam_peak_y ?? 16})
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        {selected.has_real_cutout
                          ? 'Decoded from installed multi-epoch cutout · Click stamp to refine centroid'
                          : 'Deterministic PSF reconstruction · Click stamp to refine centroid'}
                      </p>
                    </div>
                  </div>

                  <div className="admin-surface rounded-xl xl:col-span-7 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">102-Channel Spectrum Attribution</h3>
                      <span className="text-[11px] font-mono text-amber-300">Amber = d(logit)/d(flux)</span>
                    </div>
                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <canvas
                        ref={specCanvasRef}
                        className="w-full h-48 rounded-lg border border-white/[0.07]"
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                        <div className="admin-surface-subtle rounded-lg px-3 py-2">
                          <span className="text-[11px] text-muted-foreground block">H2O 3.05µm</span>
                          <span className="font-mono font-semibold text-sky-300 tabular-nums">
                            {selected.spectral_features.h2o_305_depth}
                          </span>
                        </div>
                        <div className="admin-surface-subtle rounded-lg px-3 py-2">
                          <span className="text-[11px] text-muted-foreground block">CH4 3.32µm</span>
                          <span className="font-mono font-semibold text-amber-300 tabular-nums">
                            {selected.spectral_features.ch4_332_depth}
                          </span>
                        </div>
                        <div className="admin-surface-subtle rounded-lg px-3 py-2">
                          <span className="text-[11px] text-muted-foreground block">CO2 4.27µm</span>
                          <span className="font-mono font-semibold text-violet-300 tabular-nums">
                            {selected.spectral_features.co2_427_depth}
                          </span>
                        </div>
                        <div className="admin-surface-subtle rounded-lg px-3 py-2">
                          <span className="text-[11px] text-muted-foreground block">D5/D2 Color</span>
                          <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                            {selected.spectral_features.ir_color_d5_d2}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CO-PILOT <think> REASONING + SIMILARITY MATCHES + ACTIVE LEARNING */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                  <div className="admin-surface rounded-xl xl:col-span-7 flex flex-col overflow-hidden">
                    <div className="border-b border-white/[0.07] px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">Co-Pilot Reasoning &amp; Top Matches</h3>
                    </div>
                    <div className="p-4 flex flex-col gap-3 text-xs">
                      {parsedThink.think && (
                        <pre className="p-3 rounded-lg bg-violet-500/[0.08] border border-violet-500/25 font-mono text-[11px] text-violet-200 whitespace-pre-wrap leading-relaxed">
                          {parsedThink.think}
                        </pre>
                      )}
                      <div className="font-mono text-xs text-emerald-300 font-semibold">{parsedThink.answer}</div>
                      <div className="flex flex-col gap-2">
                        {(selected.similarity_matches || []).map((m, idx) => (
                          <div
                            key={`${m.id}-${idx}`}
                            className="flex items-center justify-between px-3 py-2 rounded-lg admin-surface-subtle"
                          >
                            <div>
                              <span className="font-medium text-foreground">{m.name}</span>
                              <span className="text-muted-foreground ml-2 font-mono text-[11px]">
                                [{m.spectral_class}]
                              </span>
                            </div>
                            <AdminStatusPill tone="sky">cos {m.cosine_similarity.toFixed(4)}</AdminStatusPill>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="admin-surface rounded-xl xl:col-span-5 flex flex-col overflow-hidden">
                    <div className="border-b border-white/[0.07] px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">Human-in-the-Loop SFT Feedback</h3>
                    </div>
                    <div className="p-4 flex flex-col gap-3 text-xs">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Confirm the Co-Pilot verdict or supply an override class to append this spectrum into Datasets &amp;
                        Class Buckets.
                      </p>
                      <Button
                        size="sm"
                        disabled={submittingFeedback}
                        onClick={() => submitFeedback('confirmed')}
                        className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                      >
                        ✓ Confirm AI Identification ({selected.predicted_domain})
                      </Button>

                      <div className="border-t border-white/[0.07] pt-3 flex flex-col gap-2.5">
                        <label className="text-xs font-medium text-muted-foreground">Or Override Class</label>
                        <select
                          value={overrideClass}
                          onChange={(e) => setOverrideClass(e.target.value)}
                          className="h-9 rounded-lg border border-white/[0.1] bg-background/80 px-3 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          {DOMAIN_CLASS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={feedbackNote}
                          onChange={(e) => setFeedbackNote(e.target.value)}
                          placeholder="Optional diagnostic note for reasoning trace..."
                          className="h-9 rounded-lg border border-white/[0.1] bg-background/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={submittingFeedback}
                          onClick={() => submitFeedback('overridden')}
                          className="rounded-lg"
                        >
                          Save Override to SFT Dataset
                        </Button>
                      </div>

                      {feedbackStatus && (
                        <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                          {feedbackStatus}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="admin-surface rounded-xl p-8 text-center text-xs text-muted-foreground">
                Loading SPHEREx targets for AI inspection...
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ActivationInspector;
