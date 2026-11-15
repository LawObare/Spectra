import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CutoutProbeMinimap } from '../components/CutoutProbeMinimap';
import {
  fetchInstalledSections,
  useInstalledSectionState,
  type InstalledSection,
} from '../lib/installedSections';
import {
  bumpStudioDatasetRevision,
  studioFetchJson,
  updateStudioGlobalMeta,
  useStudioGlobalState,
} from './hooks/useStudioApi';

interface StudioClassItem {
  id: number;
  name: string;
  science_name: string;
  color: string;
  hint: string;
  count: number;
  isCustom?: boolean;
}

interface LabeledExample {
  example_id: string;
  section_id: string | null;
  target_name: string;
  ra: number | null;
  dec: number | null;
  px: number | null;
  py: number | null;
  class_id: number;
  class_label: string;
  source: string;
  note: string | null;
  updated_at: string | null;
}

interface DatasetResponse {
  classes: StudioClassItem[];
  examples: LabeledExample[];
  total_examples: number;
  demo_count: number;
  has_demo_data: boolean;
  can_train: boolean;
  is_empty_state: boolean;
  mutations_enabled: boolean;
  requires_token: boolean;
}

interface EpochFrame {
  epoch: number;
  epochs: number;
  loss: number;
  acc: number;
  val_loss: number;
  val_acc: number;
  elapsed_s: number;
}

interface StudioRun {
  run_id: string;
  model_architecture: string;
  epochs_completed: number;
  final_train_loss: number | null;
  final_val_loss: number | null;
  final_val_acc: number | null;
  is_promoted: boolean;
  status: string;
  weights_size_bytes: number;
  created_at: string | null;
}

interface RunsResponse {
  runs: StudioRun[];
  active_run: StudioRun | null;
  live: {
    running: boolean;
    run_id: string | null;
    error: string | null;
    frames: EpochFrame[];
  };
}

interface PredictResponse {
  section_id: string;
  target_name: string;
  is_trained: boolean;
  top_class_id: number | null;
  top_class_name: string;
  confidence: number;
  probabilities: Array<{
    class_id: number;
    name: string;
    science_name: string;
    color: string;
    probability: number;
  }>;
  wavelengths_um: number[];
  flux_jy: number[];
  gradcam_102: number[];
  peak_wavelength_um: number | null;
  explanation: string;
}

interface WirePath {
  id: string;
  d: string;
  color: string;
  active: boolean;
}

const CUSTOM_PALETTE = ['#22d3ee', '#c084fc', '#f472b6', '#facc15', '#4ade80', '#fb923c'];

export const TrainingDynamics: React.FC = () => {
  const globalState = useStudioGlobalState();
  const { installedSections } = useInstalledSectionState();
  const readySections = useMemo(
    () => installedSections.filter((s) => s.status === 'ready'),
    [installedSections]
  );

  // Dataset, custom classes, removed classes & empty-state pop-up
  const [dataset, setDataset] = useState<DatasetResponse | null>(null);
  const [customClasses, setCustomClasses] = useState<StudioClassItem[]>([]);
  const [hiddenClassIds, setHiddenClassIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem('spx_studio_hidden_classes');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  });
  const [renamedNames, setRenamedNames] = useState<Record<number, string>>({});
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [removingClassId, setRemovingClassId] = useState<number | null>(null);
  const [dismissedEmptyModal, setDismissedEmptyModal] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Add-sample modal
  const [addingForClassId, setAddingForClassId] = useState<number | null>(null);
  const [sampleSectionId, setSampleSectionId] = useState<string>('');
  const [samplePixel, setSamplePixel] = useState<{ x: number; y: number }>({ x: 24, y: 24 });
  const [sampleName, setSampleName] = useState<string>('');
  const [savingSample, setSavingSample] = useState(false);

  // Training settings (Advanced collapsed by default)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelArch, setModelArch] = useState<'SpectralResNet102' | 'AstroFeatureSVM'>('SpectralResNet102');
  const [epochs, setEpochs] = useState(12);
  const [learningRate, setLearningRate] = useState(0.008);
  const [useLora, setUseLora] = useState(false);
  const [augment, setAugment] = useState(true);
  const [runsData, setRunsData] = useState<RunsResponse | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [resettingModel, setResettingModel] = useState(false);
  const [datasetDirtySinceTrain, setDatasetDirtySinceTrain] = useState(false);

  // Live Test panel
  const [testSectionId, setTestSectionId] = useState<string>('');
  const [testPixel, setTestPixel] = useState<{ x: number; y: number }>({ x: 24, y: 24 });
  const [prediction, setPrediction] = useState<PredictResponse | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [fixClassId, setFixClassId] = useState<number>(0);
  const [savingFix, setSavingFix] = useState(false);

  // Draggable linked-card canvas state
  const canvasRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOriginRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [wires, setWires] = useState<WirePath[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem('spx_studio_hidden_classes', JSON.stringify(hiddenClassIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [hiddenClassIds]);

  const mergedClasses = useMemo<StudioClassItem[]>(() => {
    const hiddenSet = new Set(hiddenClassIds);
    const base = dataset?.classes || [];
    const byId = new Map<number, StudioClassItem>();
    for (const c of base) {
      if (hiddenSet.has(c.id)) continue;
      byId.set(c.id, {
        ...c,
        name: renamedNames[c.id] ?? c.name,
      });
    }
    for (const custom of customClasses) {
      if (hiddenSet.has(custom.id)) continue;
      if (!byId.has(custom.id)) {
        byId.set(custom.id, {
          ...custom,
          name: renamedNames[custom.id] ?? custom.name,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }, [dataset?.classes, customClasses, renamedNames, hiddenClassIds]);

  const setCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const recomputeWires = useCallback(() => {
    const container = canvasRef.current;
    const trainEl = cardRefs.current.get('train');
    const previewEl = cardRefs.current.get('preview');
    if (!container || !trainEl || !previewEl) {
      setWires([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const tRect = trainEl.getBoundingClientRect();
    const pRect = previewEl.getBoundingClientRect();

    // Only draw horizontal bezier wires on wide desktop layouts where columns sit side by side
    if (cRect.width < 900) {
      setWires([]);
      return;
    }

    const tInX = tRect.left - cRect.left;
    const tInY = tRect.top - cRect.top + Math.min(110, tRect.height * 0.35);
    const tOutX = tRect.right - cRect.left;
    const tOutY = tRect.top - cRect.top + Math.min(110, tRect.height * 0.35);
    const pInX = pRect.left - cRect.left;
    const pInY = pRect.top - cRect.top + Math.min(110, pRect.height * 0.25);

    const nextWires: WirePath[] = [];
    for (const cls of mergedClasses) {
      const el = cardRefs.current.get(`class-${cls.id}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x1 = r.right - cRect.left;
      const y1 = r.top - cRect.top + r.height / 2;
      const dx = Math.max(48, Math.abs(tInX - x1) * 0.52);
      nextWires.push({
        id: `wire-class-${cls.id}`,
        d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(tInX - dx).toFixed(1)} ${tInY.toFixed(1)}, ${tInX.toFixed(1)} ${tInY.toFixed(1)}`,
        color: cls.color,
        active: cls.count > 0,
      });
    }

    const dx2 = Math.max(48, Math.abs(pInX - tOutX) * 0.52);
    nextWires.push({
      id: 'wire-train-preview',
      d: `M ${tOutX.toFixed(1)} ${tOutY.toFixed(1)} C ${(tOutX + dx2).toFixed(1)} ${tOutY.toFixed(1)}, ${(pInX - dx2).toFixed(1)} ${pInY.toFixed(1)}, ${pInX.toFixed(1)} ${pInY.toFixed(1)}`,
      color: '#38bdf8',
      active: true,
    });
    setWires(nextWires);
  }, [mergedClasses]);

  useLayoutEffect(() => {
    recomputeWires();
  }, [recomputeWires, offsets, dataset, showAdvanced, runsData?.runs.length, prediction]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputeWires());
    ro.observe(el);
    window.addEventListener('resize', recomputeWires);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recomputeWires);
    };
  }, [recomputeWires]);

  const startCardDrag = useCallback(
    (cardId: string, e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
      e.preventDefault();
      const curr = offsets[cardId] || { x: 0, y: 0 };
      dragOriginRef.current = {
        id: cardId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: curr.x,
        origY: curr.y,
      };
      setDraggingId(cardId);
      const onMove = (ev: PointerEvent) => {
        const origin = dragOriginRef.current;
        if (!origin) return;
        const nx = origin.origX + (ev.clientX - origin.startClientX);
        const ny = origin.origY + (ev.clientY - origin.startClientY);
        setOffsets((prev) => ({ ...prev, [origin.id]: { x: nx, y: ny } }));
      };
      const onUp = () => {
        dragOriginRef.current = null;
        setDraggingId(null);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [offsets]
  );

  const hasCustomLayout = Object.values(offsets).some((o) => Math.abs(o.x) > 1 || Math.abs(o.y) > 1);

  useEffect(() => {
    if (installedSections.length === 0) {
      void fetchInstalledSections();
    }
  }, [installedSections.length]);

  useEffect(() => {
    if (readySections.length > 0 && !sampleSectionId) {
      setSampleSectionId(readySections[0].section_id);
    }
  }, [readySections, sampleSectionId]);

  const loadDataset = useCallback(async () => {
    try {
      const data = await studioFetchJson<DatasetResponse>('/api/admin/dataset');
      setDataset(data);
      updateStudioGlobalMeta({
        hasDemoData: data.has_demo_data,
        demoCount: data.demo_count,
        totalExamples: data.total_examples,
        mutationsEnabled: data.mutations_enabled,
        requiresToken: data.requires_token,
        backendOnline: true,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not load dataset');
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await studioFetchJson<RunsResponse>('/api/admin/runs');
      setRunsData(data);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void loadDataset();
    void loadRuns();
  }, [loadDataset, loadRuns, globalState.datasetRevision]);

  const isTraining = Boolean(runsData?.live.running);
  const hasTrainedModel = Boolean(runsData?.active_run);

  // Zero-DB fast RAM polling while training is running; refresh full Postgres run list on completion
  useEffect(() => {
    if (!isTraining && !startingRun) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const live = await studioFetchJson<RunsResponse['live']>('/api/admin/studio/live');
        if (!active) return;
        setRunsData((prev) =>
          prev
            ? { ...prev, live }
            : { runs: [], active_run: null, live }
        );
        if (!live.running) {
          setStartingRun(false);
          setDatasetDirtySinceTrain(false);
          await loadRuns();
        }
      } catch {
        // Non-fatal
      }
    }, 350);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isTraining, startingRun, loadRuns]);

  const runLivePrediction = useCallback(
    async (overrideSectionId?: string, overridePixel?: { x: number; y: number }) => {
      const sid = overrideSectionId ?? testSectionId;
      const pxObj = overridePixel ?? testPixel;
      if (!sid || !hasTrainedModel) {
        setPrediction(null);
        return;
      }
      setPredicting(true);
      try {
        const qs = new URLSearchParams({
          section_id: sid,
          px: String(pxObj.x),
          py: String(pxObj.y),
          model_architecture: modelArch,
        });
        const res = await studioFetchJson<PredictResponse>(`/api/admin/predict?${qs.toString()}`);
        setPrediction(res);
        if (res.top_class_id !== null) {
          setFixClassId(res.top_class_id);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Prediction failed');
      } finally {
        setPredicting(false);
      }
    },
    [testSectionId, testPixel, modelArch, hasTrainedModel]
  );

  const handleAddClassCard = () => {
    const maxId = mergedClasses.reduce((m, c) => Math.max(m, c.id), 5);
    const nextId = maxId + 1;
    if (nextId > 24) {
      setActionError('Maximum of 25 classes reached.');
      return;
    }
    setCustomClasses((prev) => [
      ...prev,
      {
        id: nextId,
        name: `Class ${nextId + 1}`,
        science_name: 'Custom User Class',
        color: CUSTOM_PALETTE[nextId % CUSTOM_PALETTE.length],
        hint: 'Add 2+ sky samples to train this class',
        count: 0,
        isCustom: true,
      },
    ]);
  };

  const handleRemoveClass = async (cls: StudioClassItem) => {
    setRemovingClassId(cls.id);
    setActionError(null);
    try {
      if (cls.count > 0) {
        await studioFetchJson(`/api/admin/classes/${cls.id}`, { method: 'DELETE' });
      }
      setCustomClasses((prev) => prev.filter((c) => c.id !== cls.id));
      setHiddenClassIds((prev) => (prev.includes(cls.id) ? prev : [...prev, cls.id]));
      setOffsets((prev) => {
        const copy = { ...prev };
        delete copy[`class-${cls.id}`];
        return copy;
      });
      setDatasetDirtySinceTrain(true);
      setActionNotice(`Removed class "${cls.name}".`);
      bumpStudioDatasetRevision();
      await loadDataset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove class');
    } finally {
      setRemovingClassId(null);
    }
  };

  const handleRestoreDefaultClasses = () => {
    setHiddenClassIds([]);
    setActionNotice('Restored default sky classes.');
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRunId(runId);
    setActionError(null);
    try {
      const wasActive = runsData?.active_run?.run_id === runId;
      await studioFetchJson(`/api/admin/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
      if (wasActive) {
        setPrediction(null);
      }
      setActionNotice(`Deleted model ${runId}.`);
      await loadRuns();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete model');
    } finally {
      setDeletingRunId(null);
    }
  };

  const handleSeedDemo = async () => {
    setActionError(null);
    setSeedingDemo(true);
    try {
      const res = await studioFetchJson<{ seeded_count: number }>('/api/admin/demo/seed?per_class=10', {
        method: 'POST',
      });
      setHiddenClassIds([]);
      setDismissedEmptyModal(true);
      setActionNotice(`Seeded ${res.seeded_count} demo spectra into Postgres. Click "Train Model" to train!`);
      bumpStudioDatasetRevision();
      await loadDataset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not seed demo data');
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleStartTraining = async () => {
    setActionError(null);
    setActionNotice(null);
    setStartingRun(true);
    try {
      await studioFetchJson('/api/admin/studio/run', {
        method: 'POST',
        body: JSON.stringify({
          model_architecture: modelArch,
          epochs,
          learning_rate: learningRate,
          batch_size: 64,
          use_lora: useLora,
          augment,
        }),
      });
      setRunsData((prev) =>
        prev
          ? { ...prev, live: { running: true, run_id: null, error: null, frames: [] } }
          : { runs: [], active_run: null, live: { running: true, run_id: null, error: null, frames: [] } }
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Training could not start');
      setStartingRun(false);
    }
  };

  const handleResetModel = async () => {
    setResettingModel(true);
    setActionError(null);
    try {
      await studioFetchJson('/api/admin/studio/reset', { method: 'POST' });
      setPrediction(null);
      setDatasetDirtySinceTrain(false);
      setActionNotice('Model reset. Click "Train Model" to train fresh weights and unlock Preview.');
      await loadRuns();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not reset model');
    } finally {
      setResettingModel(false);
    }
  };

  const handleAbortTraining = async () => {
    try {
      await studioFetchJson('/api/admin/studio/abort', { method: 'POST' });
      setActionNotice('Stop requested — halting at next epoch.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not stop training');
    }
  };

  const handlePromoteRun = async (runId: string) => {
    setActionError(null);
    try {
      await studioFetchJson('/api/admin/studio/promote', {
        method: 'POST',
        body: JSON.stringify({ run_id: runId }),
      });
      setActionNotice(`Promoted ${runId} as the active classifier. Pick a sky field in Preview to test it.`);
      setPrediction(null);
      await loadRuns();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not promote run');
    }
  };

  const handleDeleteExample = async (exampleId: string) => {
    try {
      await studioFetchJson(`/api/admin/labels/${encodeURIComponent(exampleId)}`, { method: 'DELETE' });
      setDatasetDirtySinceTrain(true);
      bumpStudioDatasetRevision();
      await loadDataset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete example');
    }
  };

  const handleSaveSampleModal = async () => {
    if (addingForClassId === null || !sampleSectionId) return;
    const sec = readySections.find((s) => s.section_id === sampleSectionId);
    const targetCls = mergedClasses.find((c) => c.id === addingForClassId);
    setSavingSample(true);
    setActionError(null);
    try {
      await studioFetchJson('/api/admin/labels', {
        method: 'POST',
        body: JSON.stringify({
          section_id: sampleSectionId,
          target_name: sampleName.trim() || `${sec?.label || sampleSectionId} (${samplePixel.x},${samplePixel.y})`,
          ra: sec?.ra,
          dec: sec?.dec,
          px: samplePixel.x,
          py: samplePixel.y,
          class_id: addingForClassId,
          class_label: targetCls?.name,
        }),
      });
      setAddingForClassId(null);
      setSampleName('');
      setDatasetDirtySinceTrain(true);
      setActionNotice(`Saved real SPHEREx spectrum to "${targetCls?.name || 'Class'}".`);
      bumpStudioDatasetRevision();
      await loadDataset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save labeled spectrum');
    } finally {
      setSavingSample(false);
    }
  };

  const handleSaveLiveFix = async () => {
    if (!testSectionId) return;
    const sec = readySections.find((s) => s.section_id === testSectionId);
    const targetCls = mergedClasses.find((c) => c.id === fixClassId);
    setSavingFix(true);
    setActionError(null);
    try {
      await studioFetchJson('/api/admin/labels', {
        method: 'POST',
        body: JSON.stringify({
          section_id: testSectionId,
          target_name: `${sec?.label || testSectionId} (${testPixel.x},${testPixel.y})`,
          ra: sec?.ra,
          dec: sec?.dec,
          px: testPixel.x,
          py: testPixel.y,
          class_id: fixClassId,
          class_label: targetCls?.name,
          note: 'Corrected from Preview panel',
        }),
      });
      setActionNotice(`Saved correction to "${targetCls?.name || 'Class'}"! Click "Train Model" to update.`);
      bumpStudioDatasetRevision();
      await loadDataset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save correction');
    } finally {
      setSavingFix(false);
    }
  };

  const testSection: InstalledSection | null =
    readySections.find((s) => s.section_id === testSectionId) || null;
  const sampleSection: InstalledSection | null =
    readySections.find((s) => s.section_id === sampleSectionId) || null;

  const liveFrames = runsData?.live.frames || [];
  const lastFrame = liveFrames[liveFrames.length - 1] || null;
  const progressPct = lastFrame ? Math.round((lastFrame.epoch / Math.max(1, lastFrame.epochs)) * 100) : 0;

  const chartPaths = useMemo(() => {
    if (liveFrames.length < 2) return null;
    const w = 300;
    const h = 96;
    const maxLoss = Math.max(1.8, ...liveFrames.map((f) => Math.max(f.loss, f.val_loss)));
    const sx = (i: number) => (i / Math.max(1, liveFrames.length - 1)) * (w - 16) + 8;
    const syLoss = (v: number) => h - 10 - (Math.min(v, maxLoss) / maxLoss) * (h - 20);
    const syAcc = (v: number) => h - 10 - Math.max(0, Math.min(1, v)) * (h - 20);
    const line = (pts: Array<[number, number]>) =>
      pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return {
      trainLoss: line(liveFrames.map((f, i) => [sx(i), syLoss(f.loss)])),
      valLoss: line(liveFrames.map((f, i) => [sx(i), syLoss(f.val_loss)])),
      valAcc: line(liveFrames.map((f, i) => [sx(i), syAcc(f.val_acc)])),
    };
  }, [liveFrames]);

  const spectrumSvg = useMemo(() => {
    if (!prediction || !prediction.flux_jy || prediction.flux_jy.length === 0) return null;
    const flux = prediction.flux_jy.slice(0, 102);
    const cam = prediction.gradcam_102.slice(0, 102);
    const finite = flux.filter(Number.isFinite);
    if (finite.length < 2) return null;
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const span = Math.max(hi - lo, 1e-6);
    const w = 300;
    const h = 80;
    const pts = flux
      .map((v, i) => {
        if (!Number.isFinite(v)) return null;
        const x = (i / Math.max(1, flux.length - 1)) * (w - 12) + 6;
        const y = h - 10 - ((v - lo) / span) * (h - 20);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean) as string[];
    return {
      path: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' '),
      bars: cam.map((c, i) => ({
        x: (i / Math.max(1, cam.length - 1)) * (w - 12) + 6,
        opacity: c * 0.55,
      })),
    };
  }, [prediction]);

  const getCardStyle = (id: string): React.CSSProperties => {
    const off = offsets[id];
    if (!off) return {};
    return {
      transform: `translate3d(${off.x}px, ${off.y}px, 0)`,
      zIndex: draggingId === id ? 30 : 10,
    };
  };

  return (
    <div
      className="min-h-full p-4 sm:p-6"
      style={{
        backgroundImage: 'radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="max-w-[1680px] mx-auto space-y-4">
        {/* Studio Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0d1016]/90 backdrop-blur px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-white">Teachable Sky Studio</span>
            <span className="text-neutral-600">|</span>
            <span className="text-neutral-400">
              Drag any card header (<span className="font-mono text-neutral-300">⋮⋮</span>) to arrange ·{' '}
              <strong className="text-white font-mono">{dataset?.total_examples ?? 0}</strong> labeled spectra across{' '}
              <strong className="text-white font-mono">{mergedClasses.length}</strong> classes
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasCustomLayout && (
              <button
                type="button"
                onClick={() => setOffsets({})}
                className="rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] px-2.5 py-1 text-[11px] font-medium text-neutral-200 cursor-pointer"
              >
                Reset Layout
              </button>
            )}
            <button
              type="button"
              disabled={seedingDemo}
              onClick={handleSeedDemo}
              className="rounded-lg border border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-200 cursor-pointer disabled:opacity-50"
            >
              {seedingDemo ? 'Seeding…' : 'Seed Demo (60)'}
            </button>
          </div>
        </div>

        {/* Status banners */}
        {actionError && (
          <div className="flex items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="text-red-300 hover:text-white">
              ×
            </button>
          </div>
        )}
        {actionNotice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
            <span>{actionNotice}</span>
            <button type="button" onClick={() => setActionNotice(null)} className="text-emerald-300 hover:text-white">
              ×
            </button>
          </div>
        )}

        {/* INTERACTIVE DRAGGABLE LINKED-CARD CANVAS */}
        <div ref={canvasRef} className="relative min-h-[760px]">
          {/* Dynamic SVG Curved Connector Wires */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible z-0"
            aria-hidden="true"
          >
            {wires.map((w) => (
              <g key={w.id}>
                <path
                  d={w.d}
                  fill="none"
                  stroke={w.color}
                  strokeWidth={w.active ? 2.2 : 1.4}
                  strokeOpacity={w.active ? 0.55 : 0.22}
                  strokeDasharray={isTraining ? '6 6' : w.active ? undefined : '4 4'}
                />
              </g>
            ))}
          </svg>

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            {/* LEFT COLUMN: SEPARATE DRAGGABLE SKY CLASS CARDS + ADD A CLASS */}
            <div className="lg:col-span-4 space-y-3.5">
              {mergedClasses.map((cls, clsIdx) => {
                const cardId = `class-${cls.id}`;
                const clsExamples = (dataset?.examples || []).filter((e) => e.class_id === cls.id);
                return (
                  <div
                    key={cls.id}
                    data-tour={clsIdx === 0 ? 'studio-class-cards' : undefined}
                    ref={(el) => setCardRef(cardId, el)}
                    style={getCardStyle(cardId)}
                    className={`relative rounded-2xl border bg-[#11141b]/95 shadow-xl transition-shadow ${
                      draggingId === cardId
                        ? 'border-sky-400/70 shadow-sky-500/20'
                        : 'border-white/12 hover:border-white/20'
                    }`}
                  >
                    {/* Right-edge Output Anchor Port */}
                    <span
                      className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-[#0B0C0E] shadow"
                      style={{ backgroundColor: cls.color }}
                      aria-hidden="true"
                    />

                    {/* Draggable Card Header */}
                    <div
                      onPointerDown={(e) => startCardDrag(cardId, e)}
                      className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5 cursor-grab active:cursor-grabbing select-none"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-mono text-xs text-neutral-500" title="Drag card">
                          ⋮⋮
                        </span>
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cls.color }}
                        />
                        <input
                          type="text"
                          value={cls.name}
                          onChange={(e) =>
                            setRenamedNames((prev) => ({ ...prev, [cls.id]: e.target.value }))
                          }
                          aria-label={`Class ${cls.id + 1} name`}
                          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-white focus:outline-none focus:bg-white/[0.06] rounded px-1 py-0.5"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-neutral-300">
                          {cls.count} {cls.count === 1 ? 'sample' : 'samples'}
                        </span>
                        <button
                          type="button"
                          disabled={removingClassId === cls.id}
                          onClick={() => void handleRemoveClass(cls)}
                          className="rounded p-1 text-neutral-500 hover:bg-red-500/15 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-40"
                          title={`Remove class "${cls.name}"${cls.count > 0 ? ` and its ${cls.count} samples` : ''}`}
                          aria-label={`Remove class ${cls.name}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-3.5 space-y-2.5">
                      <p className="text-[10px] text-neutral-400">{cls.hint}</p>

                      {clsExamples.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {clsExamples.slice(0, 6).map((ex) => (
                            <span
                              key={ex.example_id}
                              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/50 px-1.5 py-0.5 text-[10px] text-neutral-300"
                            >
                              <span className="max-w-[115px] truncate">{ex.target_name}</span>
                              {ex.source === 'demo_synthetic' && (
                                <span className="text-[9px] text-amber-300">demo</span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteExample(ex.example_id)}
                                className="text-neutral-500 hover:text-red-300 cursor-pointer"
                                title="Remove sample"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {clsExamples.length > 6 && (
                            <span className="px-1.5 py-0.5 text-[10px] text-neutral-500">
                              +{clsExamples.length - 6} more
                            </span>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={readySections.length === 0}
                        onClick={() => {
                          setAddingForClassId(cls.id);
                          setSamplePixel({ x: 24, y: 24 });
                          setSampleName('');
                        }}
                        className="w-full rounded-xl border border-sky-400/25 bg-sky-500/10 hover:bg-sky-500/20 py-1.5 text-[11px] font-medium text-sky-200 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        + Add Sky Sample
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Teachable Machine "+ Add a class" Button */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleAddClassCard}
                  className="w-full rounded-2xl border-2 border-dashed border-white/15 hover:border-sky-400/60 bg-white/[0.02] hover:bg-sky-500/10 py-3.5 text-xs font-semibold text-neutral-300 hover:text-sky-200 transition-all cursor-pointer"
                >
                  + Add a Class
                </button>
                {hiddenClassIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRestoreDefaultClasses}
                    className="w-full text-center text-[11px] text-neutral-400 hover:text-sky-300 transition-colors cursor-pointer py-1"
                  >
                    Restore hidden default classes ({hiddenClassIds.length})
                  </button>
                )}
              </div>
            </div>

            {/* MIDDLE COLUMN: DRAGGABLE TRAINING CARD */}
            <div className="lg:col-span-4 lg:mt-24">
              <div
                data-tour="studio-train-card"
                ref={(el) => setCardRef('train', el)}
                style={getCardStyle('train')}
                className={`relative rounded-2xl border bg-[#11141b]/95 shadow-2xl transition-shadow ${
                  draggingId === 'train'
                    ? 'border-sky-400/70 shadow-sky-500/20'
                    : 'border-white/15 hover:border-white/25'
                }`}
              >
                {/* Left Input Port + Right Output Port */}
                <span
                  className="hidden lg:block absolute -left-2 top-[96px] h-3.5 w-3.5 rounded-full border-2 border-[#0B0C0E] bg-sky-400 shadow"
                  aria-hidden="true"
                />
                <span
                  className="hidden lg:block absolute -right-2 top-[96px] h-3.5 w-3.5 rounded-full border-2 border-[#0B0C0E] bg-sky-400 shadow"
                  aria-hidden="true"
                />

                {/* Draggable Header */}
                <div
                  onPointerDown={(e) => startCardDrag('train', e)}
                  className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 cursor-grab active:cursor-grabbing select-none"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-neutral-500" title="Drag card">
                      ⋮⋮
                    </span>
                    <h2 className="text-sm font-semibold text-white">Training</h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {hasTrainedModel && !isTraining && (
                      <button
                        type="button"
                        disabled={resettingModel}
                        onClick={handleResetModel}
                        className="rounded-md border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] px-2 py-0.5 text-[10px] font-medium text-neutral-300 cursor-pointer disabled:opacity-50"
                        title="Un-promote the active model so Preview returns to its untrained state"
                      >
                        {resettingModel ? 'Resetting…' : 'Reset Model'}
                      </button>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        dataset?.can_train
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {dataset?.can_train ? 'Ready' : 'Need 2+ classes'}
                    </span>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!dataset?.can_train || isTraining || startingRun}
                      onClick={handleStartTraining}
                      className="flex-1 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-neutral-800 disabled:text-neutral-500 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-all cursor-pointer"
                    >
                      {isTraining || startingRun
                        ? `Training… ${progressPct}%`
                        : useLora
                          ? 'Fine-Tune Model (LoRA)'
                          : 'Train Model'}
                    </button>
                    {isTraining && (
                      <button
                        type="button"
                        onClick={handleAbortTraining}
                        className="rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 px-3.5 py-3 text-xs font-semibold text-red-200 cursor-pointer"
                      >
                        Stop
                      </button>
                    )}
                  </div>

                  {lastFrame && (
                    <div className="rounded-xl border border-white/[0.08] bg-black/45 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-neutral-300">
                          Epoch {lastFrame.epoch}/{lastFrame.epochs}
                        </span>
                        <span className="text-emerald-300">
                          Val Acc: {(lastFrame.val_acc * 100).toFixed(1)}%
                        </span>
                        <span className="text-sky-300">Loss: {lastFrame.val_loss.toFixed(3)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                        <div
                          className="h-full bg-sky-400 transition-all duration-200"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      {chartPaths && (
                        <div>
                          <svg viewBox="0 0 300 96" className="w-full h-24 rounded-lg bg-neutral-950/90 border border-white/5">
                            <path d={chartPaths.trainLoss} fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeDasharray="3 3" />
                            <path d={chartPaths.valLoss} fill="none" stroke="#38bdf8" strokeWidth="1.8" />
                            <path d={chartPaths.valAcc} fill="none" stroke="#34d399" strokeWidth="1.8" />
                          </svg>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-400">
                            <span>
                              <span className="text-emerald-400">Green</span> = Val Acc ·{' '}
                              <span className="text-sky-400">Blue</span> = Val Loss
                            </span>
                            <span className="font-mono">{lastFrame.elapsed_s.toFixed(1)}s</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {runsData?.live.error && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-200">
                      {runsData.live.error}
                    </div>
                  )}

                  {/* Collapsed Advanced Drawer */}
                  <div className="rounded-xl border border-white/[0.08] bg-neutral-950/70">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-neutral-300 hover:text-white cursor-pointer"
                    >
                      <span>Advanced</span>
                      <span className="text-neutral-500">{showAdvanced ? '▲' : '▼'}</span>
                    </button>
                    {showAdvanced && (
                      <div className="border-t border-white/[0.07] p-3 space-y-2.5 text-xs">
                        <label className="block">
                          <span className="text-[11px] text-neutral-400">Classifier Model</span>
                          <select
                            value={modelArch}
                            onChange={(e) => setModelArch(e.target.value as 'SpectralResNet102' | 'AstroFeatureSVM')}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-xs text-white"
                          >
                            <option value="SpectralResNet102">102-Band Spectrum Classifier (Recommended)</option>
                            <option value="AstroFeatureSVM">Fast 3-Feature Baseline (RBF SVM)</option>
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[11px] text-neutral-400">Epochs</span>
                            <input
                              type="number"
                              min={5}
                              max={100}
                              value={epochs}
                              onChange={(e) => setEpochs(Math.max(5, Math.min(100, Number(e.target.value) || 25)))}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black px-2.5 py-1.5 font-mono text-xs text-white"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] text-neutral-400">Learning Rate</span>
                            <input
                              type="number"
                              step={0.0005}
                              min={0.0001}
                              max={0.1}
                              value={learningRate}
                              onChange={(e) => setLearningRate(Number(e.target.value) || 0.003)}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black px-2.5 py-1.5 font-mono text-xs text-white"
                            />
                          </label>
                        </div>
                        <label className="flex items-center justify-between text-[11px] text-neutral-300 cursor-pointer">
                          <span>Fine-tune active model (LoRA)</span>
                          <input
                            type="checkbox"
                            checked={useLora}
                            onChange={(e) => setUseLora(e.target.checked)}
                            className="accent-sky-400"
                          />
                        </label>
                        <label className="flex items-center justify-between text-[11px] text-neutral-300 cursor-pointer">
                          <span>Noise augmentation</span>
                          <input
                            type="checkbox"
                            checked={augment}
                            onChange={(e) => setAugment(e.target.checked)}
                            className="accent-sky-400"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Saved Runs */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-200">Saved Checkpoints</span>
                      <span className="text-[10px] text-neutral-500">Postgres</span>
                    </div>
                    {(runsData?.runs || []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-[11px] text-neutral-500">
                        No trained models yet.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {(runsData?.runs || []).map((run) => (
                          <div
                            key={run.run_id}
                            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] ${
                              run.is_promoted
                                ? 'border-emerald-500/50 bg-emerald-500/10'
                                : 'border-white/[0.08] bg-neutral-950/70'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-white">{run.run_id}</span>
                                {run.is_promoted && (
                                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                                    ACTIVE
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-neutral-400 font-mono">
                                Val: {run.final_val_acc !== null ? `${(run.final_val_acc * 100).toFixed(1)}%` : '—'} ·{' '}
                                {(run.weights_size_bytes / 1024).toFixed(1)} KB
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {!run.is_promoted && (
                                <button
                                  type="button"
                                  onClick={() => handlePromoteRun(run.run_id)}
                                  className="rounded-md border border-white/15 bg-white/[0.05] hover:bg-white/[0.12] px-2 py-1 text-[10px] font-medium text-white cursor-pointer"
                                >
                                  Use
                                </button>
                              )}
                              <a
                                href={`/api/admin/models/${encodeURIComponent(run.run_id)}/download`}
                                className="rounded-md border border-sky-400/35 bg-sky-500/10 hover:bg-sky-500/20 px-2 py-1 text-[10px] font-medium text-sky-200"
                              >
                                .pt
                              </a>
                              <button
                                type="button"
                                disabled={deletingRunId === run.run_id}
                                onClick={() => void handleDeleteRun(run.run_id)}
                                className="rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 px-2 py-1 text-[10px] font-medium text-red-200 cursor-pointer disabled:opacity-40"
                                title={`Discard and delete model ${run.run_id}`}
                                aria-label={`Delete model ${run.run_id}`}
                              >
                                {deletingRunId === run.run_id ? '…' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: DRAGGABLE PREVIEW / TEST LIVE CARD */}
            <div className="lg:col-span-4 lg:mt-10">
              <div
                data-tour="studio-preview-card"
                ref={(el) => setCardRef('preview', el)}
                style={getCardStyle('preview')}
                className={`relative rounded-2xl border bg-[#11141b]/95 shadow-2xl transition-shadow ${
                  draggingId === 'preview'
                    ? 'border-sky-400/70 shadow-sky-500/20'
                    : 'border-white/15 hover:border-white/25'
                }`}
              >
                {/* Left Input Anchor Port */}
                <span
                  className="hidden lg:block absolute -left-2 top-[96px] h-3.5 w-3.5 rounded-full border-2 border-[#0B0C0E] bg-sky-400 shadow"
                  aria-hidden="true"
                />

                {/* Draggable Header */}
                <div
                  onPointerDown={(e) => startCardDrag('preview', e)}
                  className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 cursor-grab active:cursor-grabbing select-none"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-neutral-500" title="Drag card">
                      ⋮⋮
                    </span>
                    <h2 className="text-sm font-semibold text-white">Preview (Test Live)</h2>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                      hasTrainedModel
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {hasTrainedModel ? 'Trained' : 'Waiting for Model'}
                  </span>
                </div>

                {!hasTrainedModel ? (
                  <div className="p-6 text-center space-y-3">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-lg text-neutral-400">
                      ⏳
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-white">
                        Model Not Trained Yet
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        You must train a model in the middle card before you can preview live sky predictions here.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!dataset?.can_train || isTraining || startingRun}
                      onClick={handleStartTraining}
                      className="inline-flex items-center justify-center rounded-xl bg-sky-500/20 border border-sky-400/40 hover:bg-sky-500/30 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-sky-200 transition-colors cursor-pointer"
                    >
                      {isTraining || startingRun ? `Training… ${progressPct}%` : 'Train Model Now →'}
                    </button>
                  </div>
                ) : (
                <div className="p-4 space-y-3.5">
                  {datasetDirtySinceTrain && (
                    <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                      Classes or samples changed since last training — click <strong>Train Model</strong> to update predictions.
                    </div>
                  )}
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-neutral-400">Input Sky Field</span>
                    <select
                      value={testSectionId}
                      onChange={(e) => {
                        setTestSectionId(e.target.value);
                        setTestPixel({ x: 24, y: 24 });
                        setPrediction(null);
                      }}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-neutral-950 px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="">— Select a sky field to test —</option>
                      {readySections.map((sec) => (
                        <option key={sec.section_id} value={sec.section_id}>
                          {sec.label} ({sec.ra.toFixed(2)}°, {sec.dec >= 0 ? '+' : ''}
                          {sec.dec.toFixed(2)}°)
                        </option>
                      ))}
                    </select>
                  </label>

                  {!testSection ? (
                    <div className="rounded-xl border border-dashed border-white/12 bg-black/35 px-4 py-7 text-center space-y-1.5">
                      <div className="text-xs font-semibold text-neutral-200">
                        No Sky Field Selected
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        Pick a sky field above, then click any star or press <strong>Run Model</strong> to classify it live.
                      </p>
                    </div>
                  ) : (
                    <>
                      <CutoutProbeMinimap
                        section={testSection}
                        probePixel={testPixel}
                        fallbackRa={testSection.ra}
                        fallbackDec={testSection.dec}
                        fallbackFovArcsec={testSection.fov_arcsec ?? 300}
                        onSelectPixel={(px, py) => {
                          const nextPx = { x: px, y: py };
                          setTestPixel(nextPx);
                          void runLivePrediction(testSectionId, nextPx);
                        }}
                        caption="Click or drag any star to classify it with your model"
                      />

                      <button
                        type="button"
                        disabled={predicting}
                        onClick={() => void runLivePrediction()}
                        className="w-full rounded-xl border border-sky-400/40 bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-50 py-2 text-xs font-semibold text-sky-200 transition-colors cursor-pointer"
                      >
                        {predicting
                          ? 'Running Model on Pixel…'
                          : `Run Model on Pixel (${testPixel.x}, ${testPixel.y})`}
                      </button>

                      {/* Output Bars (empty until user runs model) */}
                      {prediction && prediction.is_trained && prediction.top_class_id !== null ? (
                        <div className="rounded-xl border border-white/[0.08] bg-black/45 p-3 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-white">
                              Output: {renamedNames[prediction.top_class_id] ?? prediction.top_class_name}
                            </span>
                            <span className="font-mono text-[11px] text-sky-300">
                              {(prediction.confidence * 100).toFixed(1)}%
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {prediction.probabilities.map((p) => (
                              <div key={p.class_id} className="space-y-0.5">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-neutral-200">
                                    {renamedNames[p.class_id] ?? p.name}
                                  </span>
                                  <span className="font-mono text-neutral-400">
                                    {(p.probability * 100).toFixed(1)}%
                                  </span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${Math.max(2, p.probability * 100)}%`,
                                      backgroundColor: p.color,
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>

                          {spectrumSvg && (
                            <div className="pt-2 border-t border-white/[0.07] space-y-1">
                              <div className="text-[10px] font-medium text-neutral-300">
                                Why it guessed this (key wavelengths highlighted):
                              </div>
                              <svg viewBox="0 0 300 80" className="w-full h-20 rounded-lg bg-neutral-950 border border-white/5">
                                {spectrumSvg.bars.map((b, i) => (
                                  <rect key={i} x={b.x - 1.5} y={4} width={3} height={72} fill="#38bdf8" opacity={b.opacity} />
                                ))}
                                <path d={spectrumSvg.path} fill="none" stroke="#ffffff" strokeWidth="1.5" />
                              </svg>
                              <div className="text-[10px] text-sky-300/90">{prediction.explanation}</div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-white/[0.07] bg-black/35 p-3 text-center text-[11px] text-neutral-400">
                          {predicting
                            ? 'Running PyTorch inference on this pixel…'
                            : 'Click any star on the cutout or press "Run Model" above to classify it.'}
                        </div>
                      )}

                      {/* 1-Click Fix Label (shown once user has tested a pixel) */}
                      {prediction && prediction.is_trained && (
                        <div className="rounded-xl border border-white/[0.08] bg-neutral-950/80 p-3 space-y-2">
                          <div className="text-[11px] font-medium text-neutral-300">
                            Wrong guess? Fix label &amp; add to training:
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={fixClassId}
                              onChange={(e) => setFixClassId(Number(e.target.value))}
                              className="flex-1 rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs text-white"
                            >
                              {mergedClasses.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={savingFix}
                              onClick={handleSaveLiveFix}
                              className="shrink-0 rounded-lg bg-emerald-500/20 border border-emerald-400/50 hover:bg-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 cursor-pointer disabled:opacity-50"
                            >
                              {savingFix ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* EMPTY-STATE POP-UP: "No data to work on, seed dummy data" */}
      {dataset?.is_empty_state && !dismissedEmptyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-neutral-950 p-6 shadow-2xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-200">
              Empty Training Database
            </div>
            <h3 className="text-lg font-semibold text-white">No data to work on yet</h3>
            <p className="text-xs leading-relaxed text-neutral-300">
              Your database doesn&apos;t have enough labeled sky spectra to train a classifier yet.
              For presentations or testing, you can seed <strong>60 demo spectra</strong> (10 per class,
              clearly badged as Demo data) into Postgres right now — or dismiss this to label your own SPHEREx cutouts.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDismissedEmptyModal(true)}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-white/5 cursor-pointer"
              >
                Dismiss — I&apos;ll Label My Own
              </button>
              <button
                type="button"
                disabled={seedingDemo}
                onClick={handleSeedDemo}
                className="rounded-xl bg-sky-500 hover:bg-sky-400 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/25 cursor-pointer disabled:opacity-50"
              >
                {seedingDemo ? 'Seeding Demo Data…' : 'Seed Dummy Data (60 Examples)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD SKY SAMPLE MODAL */}
      {addingForClassId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setAddingForClassId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-neutral-950 p-5 shadow-2xl space-y-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Add Sky Sample → {mergedClasses.find((c) => c.id === addingForClassId)?.name}
              </h3>
              <button
                type="button"
                onClick={() => setAddingForClassId(null)}
                className="text-neutral-400 hover:text-white cursor-pointer"
              >
                ×
              </button>
            </div>
            <label className="block">
              <span className="text-[11px] text-neutral-400">Pick Installed Cutout</span>
              <select
                value={sampleSectionId}
                onChange={(e) => {
                  setSampleSectionId(e.target.value);
                  setSamplePixel({ x: 24, y: 24 });
                }}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black px-2.5 py-1.5 text-xs text-white"
              >
                {readySections.map((sec) => (
                  <option key={sec.section_id} value={sec.section_id}>
                    {sec.label}
                  </option>
                ))}
              </select>
            </label>
            <CutoutProbeMinimap
              section={sampleSection}
              probePixel={samplePixel}
              fallbackRa={sampleSection?.ra ?? 269.45}
              fallbackDec={sampleSection?.dec ?? 4.77}
              fallbackFovArcsec={sampleSection?.fov_arcsec ?? 300}
              onSelectPixel={(px, py) => setSamplePixel({ x: px, y: py })}
              caption="Click the exact star or sky pixel you want to label"
            />
            <label className="block">
              <span className="text-[11px] text-neutral-400">Optional Sample Name</span>
              <input
                type="text"
                value={sampleName}
                onChange={(e) => setSampleName(e.target.value)}
                placeholder={`${sampleSection?.label || 'Target'} (${samplePixel.x},${samplePixel.y})`}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black px-2.5 py-1.5 text-xs text-white"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAddingForClassId(null)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingSample}
                onClick={handleSaveSampleModal}
                className="rounded-lg bg-sky-500 hover:bg-sky-400 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                {savingSample ? 'Saving…' : 'Add to Class'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingDynamics;
