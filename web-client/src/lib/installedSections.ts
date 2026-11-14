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

export interface DownloadingSection {
  key: string;
  section_id?: string;
  task_id?: string;
  label: string;
  ra: number;
  dec: number;
  fov_arcsec: number;
  progress: number;
  message: string;
  queueState?: 'queued' | 'installing';
}

interface SectionStoreSnapshot {
  installedSections: InstalledSection[];
  downloadingSections: DownloadingSection[];
  installError: string;
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

function emitChange() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(updater: (prev: SectionStoreSnapshot) => SectionStoreSnapshot) {
  snapshot = updater(snapshot);
  emitChange();
}

function downloadKeyFor(ra: number, dec: number, fovArcsec: number): string {
  return `${ra.toFixed(5)}:${dec.toFixed(5)}:${Math.round(fovArcsec)}`;
}

function updateDownloadingEntry(key: string, patch: Partial<DownloadingSection>) {
  setSnapshot((prev) => ({
    ...prev,
    downloadingSections: prev.downloadingSections.map((item) =>
      item.key === key ? { ...item, ...patch } : item
    ),
  }));
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
              if (typeof evt.progress === 'number') {
                updateDownloadingEntry(key, {
                  progress: Math.max(0.05, Math.min(0.96, evt.progress)),
                });
              }
              if (evt.message) {
                updateDownloadingEntry(key, { message: String(evt.message) });
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
    setSnapshot((prev) => ({ ...prev, installedSections: list }));

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

export function useSectionManager() {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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
