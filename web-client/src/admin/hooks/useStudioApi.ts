import { useSyncExternalStore } from 'react';

/**
 * Session-only in-memory admin token & studio state bus shared across all 3 /admin tabs.
 * Never persisted to localStorage (SPECIFICATION.md §4.2.1).
 */
interface StudioGlobalState {
  adminToken: string;
  hasDemoData: boolean;
  demoCount: number;
  totalExamples: number;
  mutationsEnabled: boolean;
  requiresToken: boolean;
  backendOnline: boolean;
  datasetRevision: number;
}

let state: StudioGlobalState = {
  adminToken: '',
  hasDemoData: false,
  demoCount: 0,
  totalExamples: 0,
  mutationsEnabled: true,
  requiresToken: false,
  backendOnline: true,
  datasetRevision: 0,
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function setStudioAdminToken(token: string): void {
  state = { ...state, adminToken: token.trim() };
  emit();
}

export function updateStudioGlobalMeta(patch: Partial<StudioGlobalState>): void {
  state = { ...state, ...patch };
  emit();
}

export function bumpStudioDatasetRevision(): void {
  state = { ...state, datasetRevision: state.datasetRevision + 1 };
  emit();
}

export function getStudioAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (state.adminToken) {
    headers['X-Admin-Token'] = state.adminToken;
    headers['Authorization'] = `Bearer ${state.adminToken}`;
  }
  return headers;
}

export async function studioFetchJson<T = any>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...getStudioAuthHeaders(),
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const msg = parsed?.detail || parsed?.message || `HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return parsed as T;
}

export function useStudioGlobalState(): StudioGlobalState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}
