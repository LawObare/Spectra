import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CutoutProbeMinimap } from '../components/CutoutProbeMinimap';
import type { InstalledSection } from '../lib/installedSections';
import {
  bumpStudioDatasetRevision,
  studioFetchJson,
  useStudioGlobalState,
} from './hooks/useStudioApi';

interface StudioClassItem {
  id: number;
  name: string;
  science_name: string;
  color: string;
  hint: string;
}

interface ReviewItem {
  section: InstalledSection;
  section_id: string;
  target_name: string;
  ra: number;
  dec: number;
  predicted_class_id: number | null;
  predicted_class_name: string;
  confidence: number;
  probabilities: Array<{ class_id: number; name: string; color: string; probability: number }>;
  explanation: string;
  wavelengths_um: number[];
  flux_jy: number[];
  gradcam_102: number[];
  human_label: string | null;
  human_class_id: number | null;
  example_id: string | null;
  disagreement: boolean;
}

interface ReviewQueueResponse {
  items: ReviewItem[];
  classes: StudioClassItem[];
  active_run: { run_id: string; final_val_acc: number | null } | null;
  confusion_matrix: number[][] | null;
}

export const HardNegativeTriage: React.FC = () => {
  const globalState = useStudioGlobalState();
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [probePixel, setProbePixel] = useState<{ x: number; y: number }>({ x: 24, y: 24 });
  const [savingClassId, setSavingClassId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const data = await studioFetchJson<ReviewQueueResponse>('/api/admin/review-queue');
      setQueue(data);
      if (data.items.length > 0) {
        setSelectedId((prev) =>
          prev && data.items.some((i) => i.section_id === prev) ? prev : data.items[0].section_id
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load review queue');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue(queue !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadQueue, globalState.datasetRevision]);

  const activeItem = useMemo(
    () => queue?.items.find((i) => i.section_id === selectedId) || queue?.items[0] || null,
    [queue, selectedId]
  );

  // Dynamic compact confusion matrix: only include classes with >= 1 validation example
  const compactMatrix = useMemo(() => {
    const cm = queue?.confusion_matrix;
    const classes = queue?.classes || [];
    if (!cm || cm.length === 0 || classes.length === 0) return null;
    const activeIndices = classes
      .map((c) => c.id)
      .filter((idx) => {
        const rowSum = (cm[idx] || []).reduce((a, b) => a + b, 0);
        const colSum = cm.reduce((a, row) => a + (row?.[idx] || 0), 0);
        return rowSum > 0 || colSum > 0;
      });
    if (activeIndices.length === 0) return null;
    let total = 0;
    let correct = 0;
    let worstMix: { count: number; trueName: string; predName: string } | null = null;
    for (const r of activeIndices) {
      for (const c of activeIndices) {
        const val = cm[r]?.[c] || 0;
        total += val;
        if (r === c) correct += val;
        else if (val > 0 && (!worstMix || val > worstMix.count)) {
          worstMix = {
            count: val,
            trueName: classes[r]?.name || `Class ${r}`,
            predName: classes[c]?.name || `Class ${c}`,
          };
        }
      }
    }
    if (total === 0) return null;
    const pct = ((correct / total) * 100).toFixed(0);
    const summary = worstMix
      ? `Got ${correct} of ${total} right (${pct}%). Main mix-up: mistook ${worstMix.count} ${worstMix.trueName} for ${worstMix.predName}.`
      : `Got ${correct} of ${total} validation spectra right (${pct}%) with zero mix-ups.`;
    return { activeIndices, cm, summary };
  }, [queue]);

  const handleAssignLabel = async (classId: number) => {
    if (!activeItem) return;
    setSavingClassId(classId);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await studioFetchJson('/api/admin/labels', {
        method: 'POST',
        body: JSON.stringify({
          example_id: activeItem.example_id || `sec_${activeItem.section_id}`,
          section_id: activeItem.section_id,
          target_name: activeItem.target_name,
          ra: activeItem.ra,
          dec: activeItem.dec,
          px: probePixel.x,
          py: probePixel.y,
          class_id: classId,
          note: 'Verified in Review & Label queue',
        }),
      });
      const clsName = queue?.classes.find((c) => c.id === classId)?.name || 'Class';
      setNoticeMsg(`Labeled "${activeItem.target_name}" as ${clsName} and saved to Postgres.`);
      setQueue((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) =>
                it.section_id === activeItem.section_id
                  ? {
                      ...it,
                      human_label: clsName,
                      human_class_id: classId,
                      disagreement: it.predicted_class_id !== null && it.predicted_class_id !== classId,
                    }
                  : it
              ),
            }
          : prev
      );
      bumpStudioDatasetRevision();
      void loadQueue(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save label');
    } finally {
      setSavingClassId(null);
    }
  };

  return (
    <div data-tour="admin-review-workspace" className="p-4 sm:p-6 max-w-[1500px] mx-auto space-y-5">
      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-red-300 hover:text-white">
            ×
          </button>
        </div>
      )}
      {noticeMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          <span>{noticeMsg}</span>
          <button type="button" onClick={() => setNoticeMsg(null)} className="text-emerald-300 hover:text-white">
            ×
          </button>
        </div>
      )}

      {/* 1. Dynamic Confusion Matrix ("What it got right vs. what it confused") */}
      <section className="rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Model Accuracy Check (Confusion Matrix)</h2>
            <p className="text-[11px] text-neutral-400">
              {compactMatrix
                ? compactMatrix.summary
                : 'Train a model in Train & Test Studio to see what it got right vs. what it confused.'}
            </p>
          </div>
          {queue?.active_run && (
            <span className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300">
              Active: {queue.active_run.run_id}
            </span>
          )}
        </div>

        {compactMatrix && (
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl border-collapse text-center font-mono text-[11px]">
              <thead>
                <tr>
                  <th className="p-2 text-left text-[10px] font-sans text-neutral-500">True ↓ / Guessed →</th>
                  {compactMatrix.activeIndices.map((cid) => (
                    <th key={cid} className="p-2 text-[10px] font-sans font-medium text-neutral-300">
                      {queue?.classes[cid]?.name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compactMatrix.activeIndices.map((r) => (
                  <tr key={r} className="border-t border-white/[0.06]">
                    <td className="p-2 text-left font-sans text-[11px] text-neutral-200 whitespace-nowrap">
                      {queue?.classes[r]?.name}
                    </td>
                    {compactMatrix.activeIndices.map((c) => {
                      const val = compactMatrix.cm[r]?.[c] || 0;
                      const isDiag = r === c;
                      return (
                        <td key={c} className="p-1.5">
                          <span
                            className={`inline-flex h-7 w-10 items-center justify-center rounded-md ${
                              val === 0
                                ? 'bg-white/[0.02] text-neutral-600'
                                : isDiag
                                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40 font-semibold'
                                  : 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40 font-semibold'
                            }`}
                          >
                            {val}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2. Real Sky Cutout Review & Label Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Real Sky Cutouts to Review</h2>
              <p className="text-[11px] text-neutral-400">
                Sorted by disagreements and lowest confidence first.
              </p>
            </div>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-neutral-300">
              {queue?.items.length ?? 0}
            </span>
          </div>

          {loading ? (
            <div className="py-10 text-center text-xs text-neutral-400">Scoring installed cutouts…</div>
          ) : (queue?.items || []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-neutral-400">
              No ready sky cutouts found. Install a region in Sky Explorer first.
            </div>
          ) : (
            <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
              {(queue?.items || []).map((item) => {
                const isSel = activeItem?.section_id === item.section_id;
                return (
                  <button
                    key={item.section_id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.section_id);
                      setProbePixel({ x: 24, y: 24 });
                    }}
                    className={`w-full text-left rounded-xl border p-3 transition-all cursor-pointer ${
                      isSel
                        ? 'border-sky-400/60 bg-sky-500/10'
                        : 'border-white/[0.08] bg-neutral-950/70 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate">{item.target_name}</span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          item.disagreement
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-white/[0.06] text-neutral-300'
                        }`}
                      >
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                      <span className="text-sky-300">Model: {item.predicted_class_name}</span>
                      {item.human_label && (
                        <span className="text-emerald-300">· Labeled: {item.human_label}</span>
                      )}
                      {item.disagreement && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                          Disagreement
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Real Cutout Inspector & 1-Click Relabel */}
        <section className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#111318] p-4 space-y-4">
          {activeItem ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">{activeItem.target_name}</h3>
                  <div className="font-mono text-[11px] text-neutral-400">
                    RA {activeItem.ra?.toFixed(4)}° · Dec {activeItem.dec >= 0 ? '+' : ''}
                    {activeItem.dec?.toFixed(4)}° · {activeItem.section_id}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-sky-300">
                    Model guess: {activeItem.predicted_class_name} ({(activeItem.confidence * 100).toFixed(1)}%)
                  </div>
                  <div className="text-[10px] text-neutral-400">{activeItem.explanation}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <CutoutProbeMinimap
                  section={activeItem.section}
                  probePixel={probePixel}
                  fallbackRa={activeItem.ra}
                  fallbackDec={activeItem.dec}
                  fallbackFovArcsec={activeItem.section.fov_arcsec || 300}
                  onSelectPixel={(px, py) => setProbePixel({ x: px, y: py })}
                  caption="Real SPHEREx cutout — inspect passes or click a pixel"
                />

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-white">Assign the true class:</div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {(queue?.classes || []).map((cls) => {
                      const isCurrent = activeItem.human_class_id === cls.id;
                      return (
                        <button
                          key={cls.id}
                          type="button"
                          disabled={savingClassId !== null}
                          onClick={() => handleAssignLabel(cls.id)}
                          className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition-colors cursor-pointer disabled:opacity-50 ${
                            isCurrent
                              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
                              : 'border-white/10 bg-neutral-950/80 text-neutral-200 hover:border-sky-400/50 hover:bg-sky-500/10'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: cls.color }}
                            />
                            <span className="font-medium">{cls.name}</span>
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            {savingClassId === cls.id ? 'Saving…' : isCurrent ? 'Saved ✓' : 'Select'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-neutral-400">
              Select a sky cutout on the left to inspect and label it.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HardNegativeTriage;
