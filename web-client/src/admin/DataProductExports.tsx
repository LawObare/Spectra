import React, { useEffect, useState } from 'react';
import { Button, Badge, Card, CardHeader, CardTitle, CardContent } from '../components/ui';
import { cn } from '../lib/utils';

type SftSchema = 'prompt_completion' | 'conversational' | 'vlm' | 'tool_calling';

interface SftTokenPreview {
  text: string;
  masked: boolean;
  label_id: number;
}

interface SftDatasetResponse {
  schema: SftSchema;
  total_records: number;
  feedback_count: number;
  token_stats: {
    masked_prompt_tokens: number;
    supervised_completion_tokens: number;
  };
  records: Array<Record<string, any> & { tokens_preview?: SftTokenPreview[] }>;
  jsonl: string;
}

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

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<string | null>(null);
  const [liveSummary, setLiveSummary] = useState<Record<string, { count: number; verified_count: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSftLoading(true);
    fetch(`/api/admin/sft-dataset?schema=${sftSchema}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SftDatasetResponse | null) => {
        if (!cancelled && data) setSftData(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sftSchema]);

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
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* TOP HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/60 px-3 sm:px-6 py-3 shrink-0 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              TRL Dataset Builder & Community Export Hub
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Export HF TRL <code className="font-mono text-sky-400">SFTTrainer</code> JSONL corpora, IVOA science catalogs & observer reliability audits
            </p>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">
            Attribution: Community Product
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1 bg-secondary/50 p-1 rounded border border-border">
          {(
            [
              ['sft', '1. TRL SFT Dataset Builder'],
              ['exporters', '2. Science Exporters'],
              ['reliability', '3. Reliability Audit (w_u)'],
              ['calibration', '4. Calibration Pool'],
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                activeTab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* WORKSPACE CONTENT */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {/* VIEW 1: TRL SFT DATASET BUILDER */}
        {activeTab === 'sft' && (
          <div className="flex flex-col gap-5 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-card/60 border border-border rounded-md p-4">
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(SCHEMA_META) as SftSchema[]).map((schema) => (
                  <button
                    key={schema}
                    onClick={() => setSftSchema(schema)}
                    className={cn(
                      'px-3 py-1.5 rounded text-xs font-mono border transition-colors',
                      sftSchema === schema
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {SCHEMA_META[schema].label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyJsonl} disabled={!sftData?.jsonl}>
                  {copiedJsonl ? 'Copied JSONL ✓' : 'Copy JSONL'}
                </Button>
                <Button size="sm" onClick={handleDownloadJsonl} disabled={!sftData?.jsonl}>
                  ↓ Download .jsonl
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card className="p-3 border-border bg-card/60">
                <div className="text-[10px] font-mono text-muted-foreground">Total Training Records</div>
                <div className="text-xl font-mono font-bold mt-0.5">{sftData?.total_records ?? '—'}</div>
                <div className="text-[10px] text-muted-foreground">Sections + Benchmarks + Forum</div>
              </Card>
              <Card className="p-3 border-border bg-card/60">
                <div className="text-[10px] font-mono text-muted-foreground">Co-Pilot Feedback Examples</div>
                <div className="text-xl font-mono font-bold text-emerald-400 mt-0.5">{sftData?.feedback_count ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">Saved from Tab 3 active learning</div>
              </Card>
              <Card className="p-3 border-border bg-card/60">
                <div className="text-[10px] font-mono text-muted-foreground">Masked Prompt Tokens (-100)</div>
                <div className="text-xl font-mono font-bold text-slate-400 mt-0.5">
                  {sftData?.token_stats.masked_prompt_tokens ?? 0}
                </div>
                <div className="text-[10px] text-muted-foreground">Excluded from gradient updates</div>
              </Card>
              <Card className="p-3 border-border bg-card/60">
                <div className="text-[10px] font-mono text-muted-foreground">Supervised Completion Tokens</div>
                <div className="text-xl font-mono font-bold text-sky-400 mt-0.5">
                  {sftData?.token_stats.supervised_completion_tokens ?? 0}
                </div>
                <div className="text-[10px] text-muted-foreground">Active NLL / DFT loss tokens</div>
              </Card>
            </div>

            <div className="rounded border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 text-xs text-sky-200">
              <strong>Schema Note:</strong> {SCHEMA_META[sftSchema].note}
            </div>

            {sftLoading ? (
              <div className="text-xs font-mono text-muted-foreground">Building TRL JSONL corpus...</div>
            ) : (
              <div className="flex flex-col gap-3">
                {(sftData?.records || []).slice(0, 6).map((rec, idx) => (
                  <Card key={idx} className="border-border">
                    <CardHeader className="py-2 px-4 border-b border-border bg-secondary/30 flex flex-row items-center justify-between">
                      <CardTitle className="text-xs font-mono">{rec.label || rec.target_id || `Record #${idx + 1}`}</CardTitle>
                      <Badge variant="outline" className="font-mono text-[10px]">{rec.source || sftSchema}</Badge>
                    </CardHeader>
                    <CardContent className="p-3 flex flex-col gap-2">
                      {rec.tokens_preview && (
                        <div className="flex flex-wrap gap-1 p-2 rounded bg-background/80 border border-border/60 font-mono text-[10px]">
                          {rec.tokens_preview.map((tok, ti) => (
                            <span
                              key={ti}
                              className={cn(
                                'px-1 rounded',
                                tok.masked ? 'bg-slate-800/80 text-slate-400 line-through' : 'bg-emerald-500/20 text-emerald-300'
                              )}
                            >
                              {tok.text}
                            </span>
                          ))}
                        </div>
                      )}
                      <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(
                          Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'tokens_preview')),
                          null,
                          2
                        )}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: DATA PRODUCT EXPORTERS */}
        {activeTab === 'exporters' && (
          <div className="flex flex-col gap-6 max-w-6xl mx-auto">
            <div className="bg-secondary/20 border border-border/80 rounded-md p-4 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Community Data Products Protocol:</span> All exported bundles are generated from citizen science consensus classifications on public NASA/IPAC SPHEREx observations and stamped with <span className="font-mono text-primary">[Community Product]</span> headers.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {DATA_PRODUCTS.map((prod) => (
                <Card key={prod.id} className="border-border flex flex-col justify-between shadow-sm">
                  <CardHeader className="p-4 border-b border-border bg-secondary/30">
                    <div className="flex items-center justify-between">
                      <Badge variant="sky" className="font-mono text-[10px]">Deliverable #{prod.deliverable_num}</Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {liveSummary?.[prod.id]?.count ?? prod.recordCount} records · {prod.estBytes}
                      </span>
                    </div>
                    <CardTitle className="text-sm font-semibold mt-2">{prod.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 flex flex-col gap-3 flex-1 justify-between">
                    <p className="text-xs text-muted-foreground leading-relaxed">{prod.description}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {prod.formats.map((fmt) => {
                        const key = `${prod.id}_${fmt.ext}`;
                        return (
                          <div key={fmt.ext} className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={downloadingId === key}
                              onClick={() => handleDownload(prod.id, fmt.ext)}
                            >
                              {downloadingId === key ? 'Downloading...' : `↓ ${fmt.label}`}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-[10px] text-muted-foreground"
                              onClick={() => handleCopyCurl(prod.id, fmt.ext)}
                            >
                              {copiedCurl === key ? 'COPIED' : 'curl'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 3: VOLUNTEER RELIABILITY AUDIT */}
        {activeTab === 'reliability' && (
          <div className="flex flex-col gap-6 max-w-5xl mx-auto">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <Card className="border-border p-4 bg-card/60">
                <div className="text-xs text-muted-foreground">Active Evaluators</div>
                <div className="text-2xl font-bold font-mono mt-1">250</div>
              </Card>
              <Card className="border-border p-4 bg-card/60">
                <div className="text-xs text-muted-foreground">Mean Reliability (w_u)</div>
                <div className="text-2xl font-bold font-mono text-primary mt-1">0.884</div>
              </Card>
              <Card className="border-border p-4 bg-card/60">
                <div className="text-xs text-muted-foreground">Calibration TPR</div>
                <div className="text-2xl font-bold font-mono text-green-400 mt-1">94.2%</div>
              </Card>
              <Card className="border-border p-4 bg-card/60">
                <div className="text-xs text-muted-foreground">False Alarm FPR</div>
                <div className="text-2xl font-bold font-mono text-sky-400 mt-1">3.8%</div>
              </Card>
            </div>
            <Card className="border-border">
              <CardHeader className="py-3 px-5 border-b border-border bg-secondary/30">
                <CardTitle className="text-xs font-semibold">Volunteer Bayesian Weight Distribution w_u ∈ [0.1, 1.0]</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex items-end justify-between h-44 gap-2 border-b border-border pb-2 px-4">
                  {[
                    { bin: '0.1-0.2', pct: 1.2 }, { bin: '0.2-0.3', pct: 2.0 }, { bin: '0.3-0.4', pct: 3.2 },
                    { bin: '0.4-0.5', pct: 5.6 }, { bin: '0.5-0.6', pct: 8.8 }, { bin: '0.6-0.7', pct: 14.0 },
                    { bin: '0.7-0.8', pct: 20.8 }, { bin: '0.8-0.9', pct: 27.2 }, { bin: '0.9-1.0', pct: 17.2 },
                  ].map((b) => (
                    <div key={b.bin} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-primary/70 rounded-t" style={{ height: `${b.pct * 4}px` }} />
                      <span className="text-[10px] font-mono text-muted-foreground mt-1">{b.bin}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* VIEW 4: CALIBRATION POOL MANAGER */}
        {activeTab === 'calibration' && (
          <div className="flex flex-col gap-5 max-w-5xl mx-auto">
            <Card className="border-border">
              <CardHeader className="py-3 px-4 border-b border-border bg-secondary/30">
                <CardTitle className="text-xs font-semibold">Active Calibration & Held-Out Benchmark Pool</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="bg-secondary/40 border-b border-border text-[11px] font-medium text-muted-foreground">
                      <tr>
                        <th className="py-2.5 px-4">Control Identifier</th>
                        <th className="py-2.5 px-4">Type</th>
                        <th className="py-2.5 px-4">Motion</th>
                        <th className="py-2.5 px-4">Expected Class</th>
                        <th className="py-2.5 px-4">Accuracy</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono text-xs">
                      {CALIBRATION_CONTROLS.map((c) => (
                        <tr key={c.id} className="hover:bg-secondary/30">
                          <td className="py-2.5 px-4 font-semibold">{c.name}</td>
                          <td className="py-2.5 px-4 font-sans text-muted-foreground">{c.type}</td>
                          <td className="py-2.5 px-4">{(c.pm_arcsec_yr * 1000).toFixed(0)} mas/yr</td>
                          <td className="py-2.5 px-4 text-primary">{c.expected_class}</td>
                          <td className="py-2.5 px-4 text-green-400 font-semibold">{(c.volunteer_accuracy * 100).toFixed(1)}%</td>
                          <td className="py-2.5 px-4">
                            <Badge variant={c.status === 'active' ? 'sky' : 'outline'} className="text-[10px]">
                              {c.status === 'active' ? 'Active Loop' : 'Held-Out Gold'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataProductExports;
