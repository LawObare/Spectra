import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui';
import { cn } from '../lib/utils';
import {
  AdminKpiCard,
  AdminPageHeader,
  AdminSearchInput,
  AdminStatusPill,
  IconActivity,
  IconCheckCircle,
  IconDatabase,
  IconLayers,
  SegmentedProgressBar,
} from './components/AdminPrimitives';

type SftSchema = 'prompt_completion' | 'conversational' | 'vlm' | 'tool_calling';

const BUCKET_CLASS_OPTIONS = [
  'Brown Dwarf (Y/T/L)',
  'M-Dwarf / High-PM Star',
  'Pulsating / T-Tauri Variable',
  'Ice-Absorbed Protostar',
  'Solar System / Moving',
  'Galaxy / AGN / Field',
] as const;

interface SftTokenPreview {
  text: string;
  masked: boolean;
  label_id: number;
}

interface SftBucketSample {
  target_id: string;
  label: string;
  ra: number | null;
  dec: number | null;
  source: string;
  source_badge: string;
  split: 'train' | 'val';
  domain_class: string;
  has_real_cutout: boolean;
  spectral_features: Record<string, number>;
  stamp_preview_16x16: number[][];
  flux_preview_34: number[];
  prompt: string;
  completion: string;
  tokens_preview: SftTokenPreview[];
}

interface SftClassBucket {
  class_name: string;
  count: number;
  train_count: number;
  val_count: number;
  sources: Record<string, number>;
  samples: SftBucketSample[];
}

interface SftDatasetResponse {
  schema: SftSchema;
  total_records: number;
  feedback_count: number;
  split_summary?: {
    train: number;
    val: number;
  };
  class_buckets?: SftClassBucket[];
  token_stats: {
    masked_prompt_tokens: number;
    supervised_completion_tokens: number;
  };
  records: Array<Record<string, any> & { tokens_preview?: SftTokenPreview[] }>;
  jsonl: string;
}

const StampPreviewSvg: React.FC<{ stamp?: number[][] }> = ({ stamp }) => {
  if (!stamp || stamp.length === 0) {
    return (
      <div className="w-16 h-16 rounded border border-dashed border-border bg-background/60 flex items-center justify-center text-[9px] font-mono text-muted-foreground text-center px-1 shrink-0">
        No Cutout
      </div>
    );
  }
  const rows = stamp.length;
  const cols = stamp[0]?.length || rows;
  const flat = stamp.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat, lo + 1e-6);
  return (
    <svg
      viewBox={`0 0 ${cols} ${rows}`}
      className="w-16 h-16 rounded border border-border bg-[#070b14] shrink-0"
      role="img"
      aria-label="16x16 sky cutout preview"
    >
      {stamp.map((row, y) =>
        row.map((val, x) => {
          const norm = Math.max(0, Math.min(1, (val - lo) / (hi - lo)));
          const r = Math.round(14 + norm * 230);
          const g = Math.round(24 + Math.pow(norm, 0.85) * 190);
          const b = Math.round(52 + (1 - Math.abs(norm - 0.45)) * 145);
          return <rect key={`${x}-${y}`} x={x} y={y} width={1.03} height={1.03} fill={`rgb(${r},${g},${b})`} />;
        })
      )}
    </svg>
  );
};

const SpectrumSparklineSvg: React.FC<{ flux?: number[] }> = ({ flux }) => {
  if (!flux || flux.length < 2) {
    return (
      <div className="w-32 h-16 rounded border border-dashed border-border bg-background/60 flex items-center justify-center text-[9px] font-mono text-muted-foreground shrink-0">
        No 102-ch SED
      </div>
    );
  }
  const w = 128;
  const h = 48;
  const lo = Math.min(...flux);
  const hi = Math.max(...flux, lo + 1e-6);
  const pts = flux
    .map((v, i) => {
      const x = (i / (flux.length - 1)) * (w - 4) + 2;
      const y = h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-32 h-16 rounded border border-border bg-[#070b14] shrink-0"
      role="img"
      aria-label="34-point spectral preview"
    >
      <line x1="2" y1={h / 2} x2={w - 2} y2={h / 2} stroke="rgba(148,163,184,0.18)" strokeDasharray="2 2" />
      <polyline fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeLinejoin="round" points={pts} />
    </svg>
  );
};

interface ProductCardInfo {
  id: string;
  title: string;
  deliverable_num: number;
  description: string;
  formats: { label: string; ext: string; mime: string }[];
  recordCount: number;
  estBytes: string;
  schemaFields: string[];
}

const DATA_PRODUCTS: ProductCardInfo[] = [
  {
    id: 'candidates',
    title: 'Community Candidate Catalog',
    deliverable_num: 1,
    description:
      'High-proper-motion candidate brown dwarfs, high-velocity movers, and sub-stellar objects discovered via citizen science consensus.',
    formats: [
      { label: 'CSV', ext: 'csv', mime: 'text/csv' },
      { label: 'VOTable (XML)', ext: 'vot', mime: 'application/x-votable+xml' },
      { label: 'JSON', ext: 'json', mime: 'application/json' },
    ],
    recordCount: 142,
    estBytes: '28.4 KB',
    schemaFields: ['subject_id', 'ra', 'dec', 'pm_ra_mas_yr', 'pm_dec_mas_yr', 'total_pm_arcsec_yr', 'primary_class', 'confidence', 'shannon_entropy', 'verification_status'],
  },
  {
    id: 'ices',
    title: 'Ice Feature Atlas',
    deliverable_num: 2,
    description:
      'Point-source interstellar and circumstellar ice column densities (H2O 3.05µm, CO2 4.27µm, CO 4.67µm, CH3OH 3.54µm) from SPLICES background stars.',
    formats: [
      { label: 'CSV', ext: 'csv', mime: 'text/csv' },
      { label: 'FITS Binary Table', ext: 'fits', mime: 'application/fits' },
    ],
    recordCount: 89,
    estBytes: '44.1 KB',
    schemaFields: ['subject_id', 'target_star', 'ra', 'dec', 'cloud_region', 'tau_h2o_3_05um', 'tau_co2_4_27um', 'n_h2o_cm2', 'n_co2_cm2', 'continuum_snr'],
  },
  {
    id: 'variability',
    title: 'Variability Alert List',
    deliverable_num: 3,
    description:
      'Multi-epoch flashing stellar monitors, occulting young stellar objects (RW Aurigae type), and pulsating Mira variables across survey passes.',
    formats: [
      { label: 'CSV', ext: 'csv', mime: 'text/csv' },
      { label: 'JSON', ext: 'json', mime: 'application/json' },
    ],
    recordCount: 67,
    estBytes: '18.9 KB',
    schemaFields: ['subject_id', 'title', 'ra', 'dec', 'amplitude_delta_mag', 'variability_type', 'period_days', 'dimming_ratio', 'verification_status'],
  },
  {
    id: 'artifacts',
    title: 'Artifact Atlas',
    deliverable_num: 4,
    description:
      'Catalog of false-positive optical blends, diffraction spikes, cosmic ray glints, and ghost reflections used to retrain AI classifiers.',
    formats: [
      { label: 'JSON', ext: 'json', mime: 'application/json' },
      { label: 'HDF5 Bundle', ext: 'h5', mime: 'application/x-hdf5' },
    ],
    recordCount: 215,
    estBytes: '92.3 KB',
    schemaFields: ['subject_id', 'ra', 'dec', 'artifact_class', 'divergence_score', 'ai_prediction', 'community_consensus', 'flag_mask_hex', 'explanation'],
  },
  {
    id: 'ml-dataset',
    title: 'PyTorch ML Training Tensor Bundle',
    deliverable_num: 5,
    description:
      '4D normalized Float32 tensors [Epochs, Bands, H, W] with ground-truth benchmark and calibration labels ready for PyTorch DataLoader ingestion.',
    formats: [
      { label: 'FITS Binary', ext: 'fits', mime: 'application/fits' },
      { label: 'HDF5 + DataLoader', ext: 'h5', mime: 'application/x-hdf5' },
    ],
    recordCount: 100,
    estBytes: '1.24 MB',
    schemaFields: ['subject_id', 'tensor_shape', 'crval', 'cdelt', 'flux_tensor', 'variance_tensor', 'flags_tensor', 'ground_truth_class'],
  },
];

interface CalibrationControl {
  id: string;
  name: string;
  type: string;
  pm_arcsec_yr: number;
  expected_class: string;
  times_seen: number;
  volunteer_accuracy: number;
  status: 'active' | 'heldout';
}

const CALIBRATION_CONTROLS: CalibrationControl[] = [
  { id: 'synth_a', name: 'Synth A (WISE 0855 Analogue)', type: 'Synthetic Mover', pm_arcsec_yr: 8.18, expected_class: 'moving_brown_dwarf', times_seen: 412, volunteer_accuracy: 0.94, status: 'active' },
  { id: 'synth_b', name: 'Synth B (Occulting Variable)', type: 'Synthetic Variable', pm_arcsec_yr: 5.52, expected_class: 'variable_star', times_seen: 388, volunteer_accuracy: 0.91, status: 'active' },
  { id: 'synth_control', name: 'Synth Control (Stationary Reference)', type: 'Stationary Star', pm_arcsec_yr: 0.0, expected_class: 'stationary_star', times_seen: 520, volunteer_accuracy: 0.96, status: 'active' },
  { id: 'heldout_barnard', name: "Barnard's Star (Held-Out)", type: 'NASA Benchmark', pm_arcsec_yr: 10.39, expected_class: 'high_proper_motion_star', times_seen: 290, volunteer_accuracy: 0.99, status: 'heldout' },
  { id: 'heldout_eps_indi', name: 'Epsilon Indi B (Held-Out)', type: 'NASA Benchmark', pm_arcsec_yr: 4.71, expected_class: 'moving_brown_dwarf', times_seen: 245, volunteer_accuracy: 0.93, status: 'heldout' },
];

const SCHEMA_META: Record<SftSchema, { label: string; note: string }> = {
  prompt_completion: {
    label: 'Prompt-Completion (<think> Masking)',
    note: 'Uses {"prompt", "completion"} so SFTTrainer applies -100 prompt masking (completion_only_loss=True).',
  },
  conversational: {
    label: 'Conversational (messages)',
    note: 'Multi-turn system/user/assistant messages array supporting assistant_only_loss=True.',
  },
  vlm: {
    label: 'Vision-Language (images + cutout)',
    note: 'Multi-modal dataset linking 32×32 sky cutout stamps. Requires SFTConfig(max_length=None) so image tokens are never truncated.',
  },
  tool_calling: {
    label: 'Tool Calling (similarity_search_102ch)',
    note: 'Teaches assistant to invoke similarity_search_102ch before emitting final SPHEREx verdict.',
  },
};

export const DataProductExports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sft' | 'exporters' | 'reliability' | 'calibration'>('sft');
  const [sftSchema, setSftSchema] = useState<SftSchema>('prompt_completion');
  const [sftData, setSftData] = useState<SftDatasetResponse | null>(null);
  const [sftLoading, setSftLoading] = useState<boolean>(false);
  const [copiedJsonl, setCopiedJsonl] = useState<boolean>(false);
  const [selectedBucket, setSelectedBucket] = useState<string>('ALL');
  const [sampleSearch, setSampleSearch] = useState<string>('');
  const [relabelMap, setRelabelMap] = useState<Record<string, string>>({});
  const [relabelingTargetId, setRelabelingTargetId] = useState<string | null>(null);
  const [relabelStatus, setRelabelStatus] = useState<string | null>(null);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<string | null>(null);
  const [liveSummary, setLiveSummary] = useState<Record<string, { count: number; verified_count: number }> | null>(null);

  const loadSftDataset = useCallback(async (schema: SftSchema) => {
    setSftLoading(true);
    try {
      const res = await fetch(`/api/admin/sft-dataset?schema=${schema}`);
      if (res.ok) {
        const data: SftDatasetResponse = await res.json();
        setSftData(data);
      }
    } catch {
      // ignore offline error
    } finally {
      setSftLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSftDataset(sftSchema);
  }, [sftSchema, loadSftDataset]);

  const bucketSamples = useMemo(() => {
    const buckets = sftData?.class_buckets || [];
    const list =
      selectedBucket === 'ALL'
        ? buckets.flatMap((b) => b.samples || [])
        : buckets.find((b) => b.class_name === selectedBucket)?.samples || [];
    const q = sampleSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.target_id.toLowerCase().includes(q) ||
        s.domain_class.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q)
    );
  }, [sftData, selectedBucket, sampleSearch]);

  const handleQuickRelabel = async (sample: SftBucketSample) => {
    const chosenClass = relabelMap[sample.target_id] || sample.domain_class;
    setRelabelingTargetId(sample.target_id);
    setRelabelStatus(null);
    try {
      const res = await fetch('/api/admin/sft-dataset/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: sample.target_id,
          label: sample.label,
          predicted_class: sample.domain_class,
          human_class: chosenClass,
          action: chosenClass === sample.domain_class ? 'confirmed' : 'overridden',
          reasoning: `Curated in Class Buckets Inspector (${sample.domain_class} -> ${chosenClass})`,
          metrics: sample.spectral_features || {},
        }),
      });
      if (res.ok) {
        setRelabelStatus(`Saved ${sample.label} -> ${chosenClass} into SFT corpus`);
        await loadSftDataset(sftSchema);
      } else {
        setRelabelStatus(`Failed to save re-label (${res.status})`);
      }
    } catch {
      setRelabelStatus('Network error saving dataset label override');
    } finally {
      setRelabelingTargetId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/export/summary')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.products) setLiveSummary(data.products);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownloadJsonl = () => {
    if (!sftData?.jsonl) return;
    const blob = new Blob([sftData.jsonl + '\n'], { type: 'application/x-ndjson' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spherex_sft_${sftSchema}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleCopyJsonl = () => {
    if (!sftData?.jsonl) return;
    navigator.clipboard.writeText(sftData.jsonl);
    setCopiedJsonl(true);
    setTimeout(() => setCopiedJsonl(false), 2500);
  };

  const handleDownload = async (productId: string, format: string) => {
    const downloadKey = `${productId}_${format}`;
    setDownloadingId(downloadKey);
    try {
      const url = `/api/admin/export/${format}?product=${productId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Export failed with status ${res.status}`);
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `spherex_community_${productId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch {
      window.open(`/api/admin/export/${format}?product=${productId}`, '_blank');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopyCurl = (productId: string, format: string) => {
    const curl = `curl -O -H "X-Observer-Key: \${OBSERVER_KEY}" https://spectra.internal/api/admin/export/${format}?product=${productId}`;
    navigator.clipboard.writeText(curl);
    setCopiedCurl(`${productId}_${format}`);
    setTimeout(() => setCopiedCurl(null), 3000);
  };

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-[1480px] mx-auto">
      {/* CLEAN PAGE HEADER */}
      <AdminPageHeader
        title="Datasets & Class Buckets"
        subtitle={`${sftData?.total_records ?? 0} curated examples (${sftData?.split_summary?.train ?? 0} train · ${sftData?.split_summary?.val ?? 0} val) · HF TRL JSONL corpora & citizen-science catalogs`}
        actions={
          <div data-tour="admin-exports-actions" className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-white/[0.08] bg-card p-0.5">
              {(
                [
                  ['sft', 'Class Buckets'],
                  ['exporters', 'Catalog Exports'],
                  ['reliability', 'Reliability'],
                  ['calibration', 'Calibration Pool'],
                ] as const
              ).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                    activeTab === id
                      ? 'bg-white/[0.09] text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {activeTab === 'sft' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyJsonl}
                  disabled={!sftData?.jsonl}
                  className="h-9 px-3 rounded-lg text-xs border-white/[0.1]"
                >
                  {copiedJsonl ? 'Copied JSONL' : 'Copy JSONL'}
                </Button>
                <Button
                  size="sm"
                  onClick={handleDownloadJsonl}
                  disabled={!sftData?.jsonl}
                  className="h-9 px-4 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  ↓ Export .jsonl
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* VIEW 1: TRL SFT DATASET BUILDER & CLASS BUCKETS */}
      {activeTab === 'sft' && (
        <div className="flex flex-col gap-5">
          {/* 4 KPI STAT CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <AdminKpiCard
              label="Total Training Records"
              value={sftData?.total_records ?? '—'}
              delta="Sections + Benchmarks + Forum"
              icon={<IconDatabase />}
            />
            <AdminKpiCard
              label="Train / Validation Split"
              value={`${sftData?.split_summary?.train ?? 0} / ${sftData?.split_summary?.val ?? 0}`}
              delta="Deterministic stratified split"
              deltaTone="sky"
              icon={<IconLayers />}
            />
            <AdminKpiCard
              label="Operator Overrides"
              value={sftData?.feedback_count ?? 0}
              delta="Synced from active learning"
              deltaTone="emerald"
              icon={<IconCheckCircle />}
            />
            <AdminKpiCard
              label="Supervised Tokens"
              value={(sftData?.token_stats.supervised_completion_tokens ?? 0).toLocaleString()}
              delta={`${(sftData?.token_stats.masked_prompt_tokens ?? 0).toLocaleString()} masked (-100)`}
              deltaTone="muted"
              icon={<IconActivity />}
            />
          </div>

          {/* CLASS BUCKETS + SCHEMA TOOLBAR */}
          <div className="rounded-xl border border-white/[0.075] bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.07]">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Training Class Buckets
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {SCHEMA_META[sftSchema].note}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sftSchema}
                  onChange={(e) => setSftSchema(e.target.value as SftSchema)}
                  aria-label="TRL Dataset Schema"
                  className="h-8 rounded-lg border border-white/[0.08] bg-background/80 px-2.5 text-xs text-foreground"
                >
                  {(Object.keys(SCHEMA_META) as SftSchema[]).map((schema) => (
                    <option key={schema} value={schema}>
                      {SCHEMA_META[schema].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSelectedBucket('ALL')}
                  className={cn(
                    'h-8 px-3 rounded-lg text-xs font-medium border transition-colors',
                    selectedBucket === 'ALL'
                      ? 'border-primary/50 bg-primary/15 text-foreground'
                      : 'border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground'
                  )}
                >
                  All ({sftData?.total_records ?? 0})
                </button>
              </div>
            </div>

            <div className="p-4">
              {sftData?.class_buckets && sftData.class_buckets.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sftData.class_buckets.map((bucket) => {
                    const active = selectedBucket === bucket.class_name;
                    const trainPct = bucket.count > 0 ? (bucket.train_count / bucket.count) * 100 : 0;
                    const srcEntries = Object.entries(bucket.sources || {});
                    return (
                      <button
                        key={bucket.class_name}
                        type="button"
                        onClick={() => setSelectedBucket(active ? 'ALL' : bucket.class_name)}
                        className={cn(
                          'rounded-xl border p-3.5 text-left transition-all flex flex-col gap-2.5',
                          active
                            ? 'border-primary/60 bg-primary/[0.07]'
                            : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={cn('w-2 h-2 rounded-full shrink-0', bucket.count > 0 ? 'bg-primary' : 'bg-white/20')} />
                            <span className="text-xs font-semibold text-foreground truncate">
                              {bucket.class_name}
                            </span>
                          </div>
                          <span className="text-xs font-mono font-medium text-foreground shrink-0">
                            {bucket.count}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <SegmentedProgressBar percent={trainPct} showLabel={false} />
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {bucket.train_count}T · {bucket.val_count}V
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {srcEntries.length > 0
                            ? srcEntries.map(([s, n]) => `${s.replace('nasa_', '').replace('installed_', '')} (${n})`).join(' · ')
                            : 'No samples assigned yet'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Loading class buckets from installed SPHEREx corpus...
                </div>
              )}
            </div>
          </div>

          {relabelStatus && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
              {relabelStatus}
            </div>
          )}

          {/* MULTI-MODAL SAMPLE INSPECTOR */}
          <div className="rounded-xl border border-white/[0.075] bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.07]">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Sample Inspector {selectedBucket !== 'ALL' ? `· ${selectedBucket}` : ''}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Showing {Math.min(8, bucketSamples.length)} of {bucketSamples.length} multi-modal records with 16×16 cutouts and SEDs
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AdminSearchInput
                  value={sampleSearch}
                  onChange={setSampleSearch}
                  placeholder="Filter samples..."
                  className="w-48"
                />
                {selectedBucket !== 'ALL' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedBucket('ALL')}
                    className="h-8 px-2.5 text-xs rounded-lg border-white/[0.08]"
                  >
                    Clear Bucket
                  </Button>
                )}
              </div>
            </div>

            <div className="p-4">
              {sftLoading ? (
                <div className="text-xs text-muted-foreground">Building TRL JSONL corpus...</div>
              ) : bucketSamples.length > 0 ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
                  {bucketSamples.slice(0, 8).map((sample, idx) => {
                    const sf = sample.spectral_features || {};
                    const selectedLabel = relabelMap[sample.target_id] ?? sample.domain_class;
                    const isSaving = relabelingTargetId === sample.target_id;
                    return (
                      <div
                        key={`${sample.target_id}-${idx}`}
                        className="rounded-xl border border-white/[0.07] bg-background/50 p-3.5 flex flex-col gap-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-foreground truncate">{sample.label}</div>
                            <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                              {sample.target_id}
                              {sample.ra !== null && sample.dec !== null
                                ? ` · ${sample.ra.toFixed(2)}°, ${sample.dec >= 0 ? '+' : ''}${sample.dec.toFixed(2)}°`
                                : ''}
                            </div>
                          </div>
                          <AdminStatusPill tone={sample.split === 'train' ? 'sky' : 'amber'}>
                            {sample.split}
                          </AdminStatusPill>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <StampPreviewSvg stamp={sample.stamp_preview_16x16} />
                          <SpectrumSparklineSvg flux={sample.flux_preview_34} />
                          <div className="flex-1 min-w-[160px] grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between border-b border-white/[0.05] pb-1">
                              <span className="text-muted-foreground">H2O 3.05</span>
                              <span className="font-mono text-foreground">{(sf.h2o_305_depth ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-white/[0.05] pb-1">
                              <span className="text-muted-foreground">CH4 3.32</span>
                              <span className="font-mono text-foreground">{(sf.ch4_332_depth ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">D5/D2</span>
                              <span className="font-mono text-foreground">{(sf.ir_color_d5_d2 ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Source</span>
                              <span className="text-sky-300 truncate max-w-[90px]">{sample.source_badge || sample.source}</span>
                            </div>
                          </div>
                        </div>

                        {sample.tokens_preview && (
                          <div className="flex flex-wrap gap-1 font-mono text-[9.5px]">
                            {sample.tokens_preview.slice(0, 14).map((tok, ti) => (
                              <span
                                key={ti}
                                className={cn(
                                  'px-1.5 py-0.5 rounded',
                                  tok.masked ? 'bg-white/[0.04] text-muted-foreground line-through' : 'bg-emerald-500/15 text-emerald-300'
                                )}
                              >
                                {tok.text}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                          <select
                            aria-label={`Re-label ${sample.label}`}
                            value={selectedLabel}
                            onChange={(e) =>
                              setRelabelMap((m) => ({ ...m, [sample.target_id]: e.target.value }))
                            }
                            className="h-8 flex-1 min-w-0 rounded-lg border border-white/[0.08] bg-card px-2.5 text-xs text-foreground"
                          >
                            {BUCKET_CLASS_OPTIONS.map((cls) => (
                              <option key={cls} value={cls}>
                                {cls}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSaving}
                            onClick={() => void handleQuickRelabel(sample)}
                            className="h-8 px-3 rounded-lg text-xs border-white/[0.1] shrink-0"
                          >
                            {isSaving ? 'Saving...' : 'Save Label'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  No samples match the current filter.
                </div>
              )}
            </div>
          </div>

          {/* COLLAPSIBLE RAW JSONL CORPUS */}
          <details className="rounded-xl border border-white/[0.075] bg-card overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-foreground hover:bg-white/[0.02]">
              Raw TRL SFTTrainer JSONL Output ({sftData?.records.length ?? 0} total · top 6 preview)
            </summary>
            <div className="p-4 flex flex-col gap-3 border-t border-white/[0.07]">
              {(sftData?.records || []).slice(0, 6).map((rec, idx) => (
                <div key={idx} className="rounded-lg border border-white/[0.07] bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-mono font-medium text-foreground">
                      {rec.label || rec.target_id || `Record #${idx + 1}`}
                    </span>
                    <AdminStatusPill tone={rec.split === 'val' ? 'amber' : 'sky'}>
                      {rec.split || sftSchema}
                    </AdminStatusPill>
                  </div>
                  <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(
                      Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'tokens_preview')),
                      null,
                      2
                    )}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* VIEW 2: DATA PRODUCT EXPORTERS */}
      {activeTab === 'exporters' && (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-white/[0.075] bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Community Data Products Protocol:</span>{' '}
            All exported bundles derive from citizen-science consensus on NASA/IPAC SPHEREx observations and carry explicit{' '}
            <span className="font-mono text-primary">[Community Product]</span> provenance headers.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DATA_PRODUCTS.map((prod) => (
              <div
                key={prod.id}
                className="rounded-xl border border-white/[0.075] bg-card p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <AdminStatusPill tone="sky">Deliverable #{prod.deliverable_num}</AdminStatusPill>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {liveSummary?.[prod.id]?.count ?? prod.recordCount} · {prod.estBytes}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground mt-3">{prod.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{prod.description}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/[0.06]">
                  {prod.formats.map((fmt) => {
                    const key = `${prod.id}_${fmt.ext}`;
                    return (
                      <div key={fmt.ext} className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs rounded-lg border-white/[0.09]"
                          disabled={downloadingId === key}
                          onClick={() => handleDownload(prod.id, fmt.ext)}
                        >
                          {downloadingId === key ? 'Saving...' : `↓ ${fmt.label}`}
                        </Button>
                        <button
                          type="button"
                          className="px-1.5 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyCurl(prod.id, fmt.ext)}
                        >
                          {copiedCurl === key ? 'copied' : 'curl'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: VOLUNTEER RELIABILITY AUDIT */}
      {activeTab === 'reliability' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <AdminKpiCard label="Active Evaluators" value="250" delta="Citizen science cohort" icon={<IconLayers />} />
            <AdminKpiCard label="Mean Reliability (w_u)" value="0.884" delta="Bayesian consensus weight" deltaTone="sky" icon={<IconActivity />} />
            <AdminKpiCard label="Calibration TPR" value="94.2%" delta="+1.8% vs baseline" deltaTone="emerald" icon={<IconCheckCircle />} />
            <AdminKpiCard label="False Alarm FPR" value="3.8%" delta="Below 5% SLA gate" deltaTone="sky" icon={<IconDatabase />} />
          </div>
          <div className="rounded-xl border border-white/[0.075] bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              Volunteer Bayesian Weight Distribution w_u ∈ [0.1, 1.0]
            </h3>
            <div className="flex items-end justify-between h-44 gap-2 border-b border-white/[0.08] pb-2 px-2">
              {[
                { bin: '0.1-0.2', pct: 1.2 }, { bin: '0.2-0.3', pct: 2.0 }, { bin: '0.3-0.4', pct: 3.2 },
                { bin: '0.4-0.5', pct: 5.6 }, { bin: '0.5-0.6', pct: 8.8 }, { bin: '0.6-0.7', pct: 14.0 },
                { bin: '0.7-0.8', pct: 20.8 }, { bin: '0.8-0.9', pct: 27.2 }, { bin: '0.9-1.0', pct: 17.2 },
              ].map((b) => (
                <div key={b.bin} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-primary/75 rounded-t-md" style={{ height: `${b.pct * 4}px` }} />
                  <span className="text-[10px] font-mono text-muted-foreground mt-1">{b.bin}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: CALIBRATION POOL MANAGER */}
      {activeTab === 'calibration' && (
        <div className="rounded-xl border border-white/[0.075] bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.07]">
            <h3 className="text-sm font-semibold text-foreground">
              Active Calibration &amp; Held-Out Benchmark Pool
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-white/[0.07] text-[11px] font-medium text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Control Identifier</th>
                  <th className="py-2.5 px-4 font-medium">Type</th>
                  <th className="py-2.5 px-4 font-medium">Motion</th>
                  <th className="py-2.5 px-4 font-medium">Expected Class</th>
                  <th className="py-2.5 px-4 font-medium">Accuracy</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {CALIBRATION_CONTROLS.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-medium text-foreground">{c.name}</td>
                    <td className="py-3 px-4 text-muted-foreground">{c.type}</td>
                    <td className="py-3 px-4 font-mono">{(c.pm_arcsec_yr * 1000).toFixed(0)} mas/yr</td>
                    <td className="py-3 px-4 font-mono text-sky-300">{c.expected_class}</td>
                    <td className="py-3 px-4">
                      <SegmentedProgressBar percent={c.volunteer_accuracy * 100} tone="emerald" />
                    </td>
                    <td className="py-3 px-4">
                      <AdminStatusPill tone={c.status === 'active' ? 'sky' : 'muted'}>
                        {c.status === 'active' ? 'Active Loop' : 'Held-Out'}
                      </AdminStatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataProductExports;
