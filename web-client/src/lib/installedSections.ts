import { useEffect, useSyncExternalStore } from 'react';

export interface InstalledSection {
  section_id: string;
  label: string;
  ra: number;
  dec: number;
  fov_arcsec: number;
  status: 'installing' | 'ready' | 'error';
  epochs: number;
  bands: number;
  height: number;
  width: number;
  source_badge: string;
  size_bytes: number;
  task_id?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DownloadingSectionMeta {
  key: string;
  section_id?: string;
  task_id?: string;
  label: string;
  ra: number;
  dec: number;
  fov_arcsec: number;
  queueState?: 'queued' | 'installing';
}

export interface DownloadingSection extends DownloadingSectionMeta {
  progress: number;
  message: string;
}

interface SectionStoreSnapshot {
  installedSections: InstalledSection[];
  downloadingSections: DownloadingSection[];
  installError: string;
}

export interface InstalledSectionState {
  installedSections: InstalledSection[];
  installError: string;
}

export interface DownloadingSummaryState {
  downloadingMeta: DownloadingSectionMeta[];
  geometryKey: string;
}

const MAX_CONCURRENT_INSTALLS = 2;

const listeners = new Set<() => void>();
const activeTaskStreamKeys = new Set<string>();
const runningWorkerKeys = new Set<string>();
let hasLoadedInitialSections = false;

let snapshot: SectionStoreSnapshot = {
  installedSections: [],
  downloadingSections: [],
  installError: '',
};

let cachedInstalledSlice: InstalledSectionState = {
  installedSections: snapshot.installedSections,
  installError: snapshot.installError,
};

let cachedDownloadSummarySlice: DownloadingSummaryState = {
  downloadingMeta: [],
  geometryKey: '',
};

function computeDownloadingGeometryKey(list: DownloadingSection[]): string {
  return list
    .map(
      (s) =>
        `${s.key}:${s.section_id || ''}:${s.queueState || ''}:${s.ra.toFixed(5)}:${s.dec.toFixed(5)}:${Math.round(s.fov_arcsec)}`
    )
    .sort()
    .join('|');
}

function syncDerivedSlices() {
  if (
    !Object.is(cachedInstalledSlice.installedSections, snapshot.installedSections) ||
    !Object.is(cachedInstalledSlice.installError, snapshot.installError)
  ) {
    cachedInstalledSlice = {
      installedSections: snapshot.installedSections,
      installError: snapshot.installError,
    };
  }
  const nextGeometryKey = computeDownloadingGeometryKey(snapshot.downloadingSections);
  if (nextGeometryKey !== cachedDownloadSummarySlice.geometryKey) {
    cachedDownloadSummarySlice = {
      downloadingMeta: snapshot.downloadingSections.map((d) => ({
        key: d.key,
        section_id: d.section_id,
        task_id: d.task_id,
        label: d.label,
        ra: d.ra,
        dec: d.dec,
        fov_arcsec: d.fov_arcsec,
        queueState: d.queueState,
      })),
      geometryKey: nextGeometryKey,
    };
  }
}

function subscribeSectionStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange() {
  syncDerivedSlices();
  listeners.forEach((listener) => listener());
}

function setSnapshot(updater: (prev: SectionStoreSnapshot) => SectionStoreSnapshot) {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  emitChange();
}

function installedSectionListsEqual(a: InstalledSection[], b: InstalledSection[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.section_id !== y.section_id ||
      x.status !== y.status ||
      x.task_id !== y.task_id ||
      x.epochs !== y.epochs ||
      x.bands !== y.bands ||
      x.size_bytes !== y.size_bytes ||
      x.updated_at !== y.updated_at ||
      x.error_message !== y.error_message ||
      x.label !== y.label ||
      x.fov_arcsec !== y.fov_arcsec
    ) {
      return false;
    }
  }
  return true;
}

function downloadKeyFor(ra: number, dec: number, fovArcsec: number): string {
  return `${ra.toFixed(5)}:${dec.toFixed(5)}:${Math.round(fovArcsec)}`;
}

function updateDownloadingEntry(key: string, patch: Partial<DownloadingSection>) {
  setSnapshot((prev) => {
    const idx = prev.downloadingSections.findIndex((item) => item.key === key);
    if (idx === -1) return prev;
    const current = prev.downloadingSections[idx];
    const nextItem = { ...current, ...patch };
    const progressChanged =
      Math.round((current.progress || 0) * 100) !== Math.round((nextItem.progress || 0) * 100);
    const otherChanged =
      current.message !== nextItem.message ||
      current.queueState !== nextItem.queueState ||
      current.section_id !== nextItem.section_id ||
      current.task_id !== nextItem.task_id ||
      current.label !== nextItem.label;
    if (!progressChanged && !otherChanged) {
      return prev;
    }
    const nextList = prev.downloadingSections.slice();
    nextList[idx] = nextItem;
    return {
      ...prev,
      downloadingSections: nextList,
    };
  });
}

function removeDownloadingEntry(key: string) {
  setSnapshot((prev) => ({
    ...prev,
    downloadingSections: prev.downloadingSections.filter((item) => item.key !== key),
  }));
}

async function trackTaskProgressAndFinalize(
  key: string,
  sectionId: string,
  taskId: string
): Promise<void> {
  if (activeTaskStreamKeys.has(key)) return;
  activeTaskStreamKeys.add(key);

  try {
    if (taskId) {
      const sseRes = await fetch(`/api/cutout/progress/${taskId}?stream=1`, {
        headers: { Accept: 'text/event-stream' },
      });
      if (sseRes.ok && sseRes.body) {
        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim());
              const patch: Partial<DownloadingSection> = {};
              if (typeof evt.progress === 'number') {
                patch.progress = Math.max(0.05, Math.min(0.96, evt.progress));
              }
              if (evt.message) {
                patch.message = String(evt.message);
              }
              if (Object.keys(patch).length > 0) {
                updateDownloadingEntry(key, patch);
              }
              if (evt.status === 'error') {
                throw new Error(String(evt.message || 'Install error'));
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
                throw parseErr;
              }
            }
          }
        }
      }
    }

    updateDownloadingEntry(key, {
      progress: 0.96,
      message: 'Saving tensor & 102-band spectrum to library…',
    });
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const list = await fetchInstalledSections();
      const match = list.find((s) => s.section_id === sectionId);
      if (match?.status === 'ready') {
        removeDownloadingEntry(key);
        return;
      }
      if (match?.status === 'error') {
        throw new Error(match.error_message || 'Section finalization failed');
      }
      await new Promise((r) => window.setTimeout(r, 300));
    }
    await fetchInstalledSections();
    removeDownloadingEntry(key);
  } catch (err) {
    removeDownloadingEntry(key);
    setSnapshot((prev) => ({
      ...prev,
      installError: err instanceof Error ? err.message : 'Install failed',
    }));
  } finally {
    activeTaskStreamKeys.delete(key);
  }
}

async function runQueuedInstall(entry: DownloadingSection): Promise<void> {
  const { key, ra, dec, fov_arcsec, label } = entry;
  runningWorkerKeys.add(key);
  updateDownloadingEntry(key, {
    queueState: 'installing',
    progress: Math.max(entry.progress, 0.05),
    message: 'Queueing cutout installation…',
  });

  try {
    const res = await fetch('/api/sections/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ra,
        dec,
        fov_arcsec,
        label,
        adaptive_window: true,
        zodi_subtracted: true,
      }),
    });

    if (res.status === 503) {
      const retrySec = Math.max(2, Number(res.headers.get('Retry-After')) || 5);
      updateDownloadingEntry(key, {
        queueState: 'queued',
        progress: 0,
        message: `Archive workers busy — retrying in ${retrySec}s…`,
      });
      runningWorkerKeys.delete(key);
      window.setTimeout(() => {
        pumpInstallQueue();
      }, retrySec * 1000);
      return;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.detail || `Install failed (${res.status})`);
    }
    const data = await res.json();
    const sectionId = String(data.section_id || '');
    const taskId = String(data.task_id || '');

    updateDownloadingEntry(key, {
      section_id: sectionId,
      task_id: taskId || entry.task_id,
    });

    if (data.already_installed || data.status === 'ready') {
      await fetchInstalledSections();
      removeDownloadingEntry(key);
      return;
    }

    await trackTaskProgressAndFinalize(key, sectionId, taskId);
  } catch (err) {
    removeDownloadingEntry(key);
    setSnapshot((prev) => ({
      ...prev,
      installError: err instanceof Error ? err.message : 'Install failed',
    }));
  } finally {
    runningWorkerKeys.delete(key);
    pumpInstallQueue();
  }
}

function pumpInstallQueue() {
  const queued = snapshot.downloadingSections.filter((d) => d.queueState === 'queued');
  if (queued.length === 0) return;

  for (const next of queued) {
    if (runningWorkerKeys.size + activeTaskStreamKeys.size >= MAX_CONCURRENT_INSTALLS) {
      break;
    }
    if (runningWorkerKeys.has(next.key)) continue;
    void runQueuedInstall(next);
  }
}

export async function fetchInstalledSections(signal?: AbortSignal): Promise<InstalledSection[]> {
  try {
    const res = await fetch('/api/sections', { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { sections?: InstalledSection[] };
    const list = Array.isArray(data.sections) ? data.sections : [];
    hasLoadedInitialSections = true;
    setSnapshot((prev) =>
      installedSectionListsEqual(prev.installedSections, list)
        ? prev
        : { ...prev, installedSections: list }
    );

    // Re-attach to any in-flight backend install (e.g., after page reload) without restarting it
    list.forEach((sec) => {
      if (sec.status !== 'installing' || !sec.task_id) return;
      const existing = snapshot.downloadingSections.find(
        (d) =>
          d.section_id === sec.section_id ||
          (Math.abs(d.ra - sec.ra) < 0.002 &&
            Math.abs(d.dec - sec.dec) < 0.002 &&
            Math.abs(d.fov_arcsec - sec.fov_arcsec) <= 1)
      );
      if (existing) {
        if (existing.queueState !== 'queued' && !activeTaskStreamKeys.has(existing.key)) {
          void trackTaskProgressAndFinalize(existing.key, sec.section_id, sec.task_id);
        }
        return;
      }
      const key = downloadKeyFor(sec.ra, sec.dec, sec.fov_arcsec);
      setSnapshot((prev) => ({
        ...prev,
        downloadingSections: [
          ...prev.downloadingSections,
          {
            key,
            section_id: sec.section_id,
            task_id: sec.task_id || undefined,
            label: sec.label,
            ra: sec.ra,
            dec: sec.dec,
            fov_arcsec: sec.fov_arcsec,
            progress: 0.2,
            message: 'Resuming archive download…',
            queueState: 'installing',
          },
        ],
      }));
      void trackTaskProgressAndFinalize(key, sec.section_id, sec.task_id);
    });

    return list;
  } catch {
    return [];
  }
}

export async function startSectionInstall(params: {
  ra: number;
  dec: number;
  fovArcsec: number;
  label?: string;
}): Promise<void> {
  const { ra, dec, fovArcsec } = params;
  const targetLabel =
    params.label?.trim() ||
    `Field (${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°)`;
  const key = downloadKeyFor(ra, dec, fovArcsec);

  // Never start a duplicate/restarted download if this box is already queued or active
  const existing = snapshot.downloadingSections.find(
    (d) =>
      d.key === key ||
      (Math.abs(d.ra - ra) < 0.002 &&
        Math.abs(d.dec - dec) < 0.002 &&
        Math.abs(d.fov_arcsec - fovArcsec) <= 1)
  );
  if (existing) return;

  const entry: DownloadingSection = {
    key,
    label: targetLabel,
    ra,
    dec,
    fov_arcsec: fovArcsec,
    progress: 0,
    message: 'Queued for download…',
    queueState: 'queued',
  };

  setSnapshot((prev) => ({
    ...prev,
    installError: '',
    downloadingSections: [...prev.downloadingSections, entry],
  }));

  pumpInstallQueue();
}

export function cancelQueuedInstall(key: string): void {
  if (runningWorkerKeys.has(key) || activeTaskStreamKeys.has(key)) return;
  removeDownloadingEntry(key);
}

export async function uninstallSectionById(sectionId: string): Promise<void> {
  await fetch(`/api/sections/${sectionId}`, { method: 'DELETE' });
  await fetchInstalledSections();
}

export function refreshInstalledSections(): Promise<InstalledSection[]> {
  return fetchInstalledSections();
}

export function useInstalledSectionState() {
  const state = useSyncExternalStore(
    subscribeSectionStore,
    () => cachedInstalledSlice
  );

  useEffect(() => {
    if (!hasLoadedInitialSections) {
      void fetchInstalledSections();
    }
  }, []);

  return {
    ...state,
    refreshInstalledSections,
    startSectionInstall,
    cancelQueuedInstall,
    uninstallSectionById,
  };
}

export function useDownloadingSummary() {
  return useSyncExternalStore(
    subscribeSectionStore,
    () => cachedDownloadSummarySlice
  );
}

export function useDownloadingSections() {
  return useSyncExternalStore(
    subscribeSectionStore,
    () => snapshot.downloadingSections
  );
}

export function useSectionManager() {
  const state = useSyncExternalStore(
    subscribeSectionStore,
    () => snapshot
  );

  useEffect(() => {
    if (!hasLoadedInitialSections) {
      void fetchInstalledSections();
    }
  }, []);

  return {
    ...state,
    refreshInstalledSections,
    startSectionInstall,
    cancelQueuedInstall,
    uninstallSectionById,
  };
}

export function findMatchingSection(
  sections: InstalledSection[],
  ra: number,
  dec: number,
  fovArcsec?: number
): InstalledSection | null {
  const ready = sections.filter((s) => s.status === 'ready');
  const cosDec = Math.max(0.05, Math.cos((dec * Math.PI) / 180));
  for (const sec of ready) {
    if (
      fovArcsec !== undefined &&
      Math.abs(sec.fov_arcsec - fovArcsec) < 1 &&
      Math.abs(sec.ra - ra) < 0.001 &&
      Math.abs(sec.dec - dec) < 0.001
    ) {
      return sec;
    }
  }
  for (const sec of ready) {
    const halfDeg = (sec.fov_arcsec / 3600) * 0.55;
    const dra = (((sec.ra - ra + 180) % 360) + 360) % 360 - 180;
    const ddec = sec.dec - dec;
    if (Math.abs(dra * cosDec) <= halfDeg && Math.abs(ddec) <= halfDeg) {
      return sec;
    }
  }
  return null;
}

export function formatSectionBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
