import React, { useCallback, useEffect, useState } from 'react';
import { studioFetchJson, useStudioGlobalState } from './hooks/useStudioApi';

interface StudioRun {
  run_id: string;
  model_architecture: string;
  epochs_completed: number;
  final_val_acc: number | null;
  is_promoted: boolean;
  weights_size_bytes: number;
  created_at: string | null;
}

interface DatasetSummary {
  total_examples: number;
  demo_count: number;
  has_demo_data: boolean;
  classes: Array<{ id: number; name: string; color: string; count: number }>;
}

const CATALOG_PRODUCTS = [
  {
    id: 'candidates',
    title: 'Sky Candidate Catalog',
    description: 'Verified moving stars, brown dwarfs, variables, and community classifications.',
    formats: [
      { label: 'CSV', slug: 'csv', ext: 'csv' },
      { label: 'JSON', slug: 'json', ext: 'json' },
      { label: 'VOTable (XML)', slug: 'votable', ext: 'xml' },
      { label: 'FITS', slug: 'fits', ext: 'fits' },
    ],
  },
  {
    id: 'ices',
    title: 'Molecular Ice Catalog',
    description: 'Water ice (3.05 µm), CO₂ (4.27 µm), and CO (4.67 µm) optical depth measurements.',
    formats: [
      { label: 'CSV', slug: 'csv', ext: 'csv' },
      { label: 'FITS', slug: 'fits', ext: 'fits' },
      { label: 'JSON', slug: 'json', ext: 'json' },
    ],
  },
  {
    id: 'variability',
    title: 'Time-Domain Variability Catalog',
    description: 'Multi-epoch dimming, brightening, and proper-motion measurements across SPHEREx passes.',
    formats: [
      { label: 'CSV', slug: 'csv', ext: 'csv' },
      { label: 'JSON', slug: 'json', ext: 'json' },
      { label: 'VOTable (XML)', slug: 'votable', ext: 'xml' },
    ],
  },
  {
    id: 'artifacts',
    title: 'Artifact & Glitch Log',
    description: 'Flagged cosmic rays, hot pixels, and instrumental ghosts excluded from science products.',
    formats: [
      { label: 'JSON', slug: 'json', ext: 'json' },
      { label: 'CSV', slug: 'csv', ext: 'csv' },
    ],
  },
] as const;

export const DataProductExports: React.FC = () => {
  const globalState = useStudioGlobalState();
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadMetadata = useCallback(async () => {
    try {
      const [runsRes, dsRes] = await Promise.all([
        studioFetchJson<{ runs: StudioRun[] }>('/api/admin/runs'),
        studioFetchJson<DatasetSummary>('/api/admin/dataset'),
      ]);
      setRuns(runsRes.runs || []);
      setDataset(dsRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load export metadata');
    }
  }, []);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata, globalState.datasetRevision]);

  const handleDownloadCatalog = async (productId: string, formatSlug: string, ext: string) => {
    const key = `${productId}:${formatSlug}`;
    setDownloadingKey(key);
    setErrorMsg(null);
    try {
      const url = `/api/admin/export/${encodeURIComponent(formatSlug)}?product=${encodeURIComponent(productId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Export failed (HTTP ${res.status}): ${text.slice(0, 140)}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `spherex_community_${productId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleCopyCurl = (productId: string, formatSlug: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const cmd = `curl -L -o spherex_${productId}.${formatSlug} "${origin}/api/admin/export/${formatSlug}?product=${productId}"`;
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopiedKey(`${productId}:${formatSlug}`);
      window.setTimeout(() => setCopiedKey(null), 1800);
    });
  };

  const realCount = Math.max(0, (dataset?.total_examples ?? 0) - (dataset?.demo_count ?? 0));

  return (
    <div data-tour="admin-exports-workspace" className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-5">
      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-red-300 hover:text-white">
            ×
          </button>
        </div>
      )}

      {/* Honest Database Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/10 bg-[#111318] p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Real Labeled Spectra</div>
          <div className="mt-1 font-mono text-xl font-bold text-white">{realCount}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111318] p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Demo Spectra</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-300">{dataset?.demo_count ?? 0}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111318] p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Saved PyTorch Runs</div>
          <div className="mt-1 font-mono text-xl font-bold text-sky-300">{runs.length}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#111318] p-3.5">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Attribution</div>
          <div className="mt-1 text-sm font-semibold text-emerald-300">Community Product</div>
        </div>
      </div>

      {/* 1. Trained PyTorch Model Weights (.pt) */}
      <section className="rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Trained PyTorch Models (.pt)</h2>
          <p className="text-[11px] text-neutral-400">
            Download real trained 6-class PyTorch <code className="text-sky-300">state_dict</code> weights persisted in Postgres.
          </p>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-neutral-400">
            No trained models saved yet. Train a classifier in <strong>1. Train &amp; Test Studio</strong> first.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {runs.map((run) => (
              <div
                key={run.run_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-neutral-950/80 p-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-white">{run.run_id}</span>
                    {run.is_promoted && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-neutral-400">
                    {run.model_architecture} · Val Acc:{' '}
                    {run.final_val_acc !== null ? `${(run.final_val_acc * 100).toFixed(1)}%` : '—'} ·{' '}
                    {(run.weights_size_bytes / 1024).toFixed(1)} KB
                  </div>
                </div>
                <a
                  href={`/api/admin/models/${encodeURIComponent(run.run_id)}/download`}
                  className="shrink-0 rounded-lg bg-sky-500/20 border border-sky-400/40 hover:bg-sky-500/30 px-3 py-1.5 text-xs font-semibold text-sky-200"
                >
                  Download .pt
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Community Data Product Downloads */}
      <section className="rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Community Data Products</h2>
          <p className="text-[11px] text-neutral-400">
            Standard astronomy table exports (CSV, JSON, VOTable XML, FITS) with Community Product provenance headers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CATALOG_PRODUCTS.map((prod) => (
            <div
              key={prod.id}
              className="rounded-xl border border-white/[0.08] bg-neutral-950/80 p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <h3 className="text-xs font-semibold text-white">{prod.title}</h3>
                <p className="mt-1 text-[11px] text-neutral-400">{prod.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {prod.formats.map((fmt) => {
                  const key = `${prod.id}:${fmt.slug}`;
                  const busy = downloadingKey === key;
                  return (
                    <button
                      key={fmt.slug}
                      type="button"
                      disabled={busy}
                      onClick={() => handleDownloadCatalog(prod.id, fmt.slug, fmt.ext)}
                      className="rounded-lg border border-white/15 bg-white/[0.04] hover:border-sky-400/50 hover:bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-neutral-200 hover:text-white cursor-pointer disabled:opacity-50"
                    >
                      {busy ? 'Downloading…' : fmt.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => handleCopyCurl(prod.id, prod.formats[0].slug)}
                  className="ml-auto rounded-lg border border-white/10 px-2 py-1 font-mono text-[10px] text-neutral-400 hover:text-white cursor-pointer"
                >
                  {copiedKey === `${prod.id}:${prod.formats[0].slug}` ? 'Copied ✓' : 'Copy curl'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default DataProductExports;
