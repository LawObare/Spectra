import type { InstalledSection } from './installedSections';
import type { TensorHeader, TensorWorkerResponse } from '../workers/tensorWorker';

export const THUMBNAIL_BAND_IDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const;

export interface DecodedSectionTensor {
  fluxData: Float32Array[][];
  varData: Float32Array[][];
  flagsData: Uint32Array[][];
  nExpData: Uint16Array[][];
  width: number;
  height: number;
  epochs: number;
  isSimulated: boolean;
  sourceBadge: string;
  wcs?: { crval: [number, number]; cdelt: [number, number]; crpix: [number, number] };
  mjdRanges?: number[][][];
  exposureIds?: string[][] | string[];
}

export type DecodedSectionEntry = { parsed: DecodedSectionTensor; sourceBadge: string };

export function getPlaneMaxNExp(plane: Uint16Array | null | undefined): number {
  if (!plane || plane.length === 0) return 0;
  let max = 0;
  for (let i = 0; i < plane.length; i++) {
    if (plane[i] > max) max = plane[i];
  }
  return max;
}

export function pickObservedCell(
  nExpData: Uint16Array[][],
  preferredBandIndex: number
): { epochIndex: number; bandIndex: number } {
  const epochs = nExpData.length;
  const bands = nExpData[0]?.length ?? 6;
  for (let e = 0; e < epochs; e++) {
    if (getPlaneMaxNExp(nExpData[e]?.[preferredBandIndex]) > 0) {
      return { epochIndex: e, bandIndex: preferredBandIndex };
    }
  }
  for (const b of [4, 5, 3, 2, 1, 0]) {
    if (b >= bands) continue;
    for (let e = 0; e < epochs; e++) {
      if (getPlaneMaxNExp(nExpData[e]?.[b]) > 0) {
        return { epochIndex: e, bandIndex: b };
      }
    }
  }
  return { epochIndex: 0, bandIndex: preferredBandIndex };
}

const MAX_DECODED_TENSOR_CACHE = 48;
const DECODED_TENSOR_LRU = new Map<string, DecodedSectionEntry>();
const SECTION_TENSOR_INFLIGHT = new Map<string, Promise<DecodedSectionEntry | null>>();

const MAX_CONCURRENT_THUMBNAIL_FETCHES = 4;
let activeThumbnailFetches = 0;
const thumbnailWaiters: Array<() => void> = [];

function acquireThumbnailSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  if (activeThumbnailFetches < MAX_CONCURRENT_THUMBNAIL_FETCHES) {
    activeThumbnailFetches += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const idx = thumbnailWaiters.indexOf(grant);
      if (idx >= 0) thumbnailWaiters.splice(idx, 1);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const grant = () => {
      signal?.removeEventListener('abort', onAbort);
      activeThumbnailFetches += 1;
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    thumbnailWaiters.push(grant);
  });
}

function releaseThumbnailSlot(): void {
  activeThumbnailFetches = Math.max(0, activeThumbnailFetches - 1);
  const next = thumbnailWaiters.shift();
  if (next) next();
}

export function getSectionTensorCacheKey(section: InstalledSection): string {
  return `${section.section_id}:${section.updated_at || section.size_bytes}`;
}

export function getCachedDecodedTensor(key: string): DecodedSectionEntry | null {
  const hit = DECODED_TENSOR_LRU.get(key);
  if (!hit) return null;
  DECODED_TENSOR_LRU.delete(key);
  DECODED_TENSOR_LRU.set(key, hit);
  return hit;
}

function setCachedDecodedTensor(key: string, value: DecodedSectionEntry): void {
  if (DECODED_TENSOR_LRU.has(key)) {
    DECODED_TENSOR_LRU.delete(key);
  } else if (DECODED_TENSOR_LRU.size >= MAX_DECODED_TENSOR_CACHE) {
    const oldestKey = DECODED_TENSOR_LRU.keys().next().value;
    if (oldestKey !== undefined) {
      DECODED_TENSOR_LRU.delete(oldestKey);
    }
  }
  DECODED_TENSOR_LRU.set(key, value);
}

export function decodeBinaryTensorBuffer(
  buf: ArrayBuffer,
  worker: Worker
): Promise<TensorWorkerResponse> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<TensorWorkerResponse>) => {
      if (event.data.success) resolve(event.data);
      else reject(new Error(event.data.error || 'Unable to decode the archive tensor.'));
    };
    worker.onerror = (event) => reject(new Error(event.message || 'Tensor worker failed.'));
    worker.postMessage({ buffer: buf }, [buf]);
  });
}

export function mapDecodedTensor(
  decoded: TensorWorkerResponse,
  hasBenchmark = false
): DecodedSectionTensor {
  const hdr: TensorHeader = decoded.header;
  const [epochs, bands, h, w] = hdr.shape;
  const planePixels = h * w;
  const totalPixels = decoded.totalPixels;
  const payload = decoded.payloadBuffer;
  const allFlux = new Float32Array(payload, 0, totalPixels);
  const varianceOffset = totalPixels * 4;
  const flagsOffset = totalPixels * 8;
  const nExpOffset = totalPixels * 12;
  const allVar = new Float32Array(payload, varianceOffset, totalPixels);
  const allFlags = new Uint32Array(payload, flagsOffset, totalPixels);
  const allNExp = new Uint16Array(payload, nExpOffset, totalPixels);

  const fluxData: Float32Array[][] = [];
  const varData: Float32Array[][] = [];
  const flagsData: Uint32Array[][] = [];
  const nExpData: Uint16Array[][] = [];

  for (let e = 0; e < epochs; e++) {
    fluxData[e] = [];
    varData[e] = [];
    flagsData[e] = [];
    nExpData[e] = [];
    for (let b = 0; b < bands; b++) {
      const startIdx = (e * bands + b) * planePixels;
      fluxData[e][b] = allFlux.subarray(startIdx, startIdx + planePixels);
      varData[e][b] = allVar.subarray(startIdx, startIdx + planePixels);
      flagsData[e][b] = allFlags.subarray(startIdx, startIdx + planePixels);
      nExpData[e][b] = allNExp.subarray(startIdx, startIdx + planePixels);
    }
  }

  const isSim = hdr.is_simulated !== false;
  const badge = isSim
    ? hasBenchmark
      ? '[Benchmark Model (Simulated)]'
      : '[Simulated Fallback (Offline)]'
    : hdr.source_badge || `[IRSA Live (${hdr.release || 'release unavailable'})]`;

  return {
    fluxData,
    varData,
    flagsData,
    nExpData,
    width: w,
    height: h,
    epochs,
    isSimulated: isSim,
    sourceBadge: badge,
    wcs:
      Array.isArray(hdr.crval) && Array.isArray(hdr.cdelt) && Array.isArray(hdr.crpix)
        ? { crval: hdr.crval, cdelt: hdr.cdelt, crpix: hdr.crpix }
        : undefined,
    mjdRanges: hdr.mjd_ranges,
    exposureIds: hdr.exposure_ids,
  };
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export async function loadOrDecodeInstalledSectionTensor(
  section: InstalledSection,
  signal?: AbortSignal
): Promise<DecodedSectionEntry | null> {
  const cacheKey = getSectionTensorCacheKey(section);
  const cached = getCachedDecodedTensor(cacheKey);
  if (cached) return cached;

  const existing = SECTION_TENSOR_INFLIGHT.get(cacheKey);
  if (existing) {
    return raceWithAbort(existing, signal);
  }

  const versionParam = encodeURIComponent(String(section.updated_at || section.size_bytes));
  const flight = (async (): Promise<DecodedSectionEntry | null> => {
    let worker: Worker | null = null;
    try {
      let secRes: Response | null = null;
      try {
        const candidate = await fetch(
          `/api/sections/${section.section_id}/tensor?v=${versionParam}`,
          signal ? { signal } : undefined
        );
        const contentType = (candidate.headers.get('content-type') || '').toLowerCase();
        if (candidate.ok && !contentType.includes('text/html')) {
          secRes = candidate;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
      }

      if (!secRes) {
        const staticCandidate = await fetch(
          `/benchmarks/${section.section_id}.f32?v=${versionParam}`,
          signal ? { signal } : undefined
        );
        const staticType = (staticCandidate.headers.get('content-type') || '').toLowerCase();
        if (staticCandidate.ok && !staticType.includes('text/html')) {
          secRes = staticCandidate;
        }
      }

      if (!secRes) return null;

      worker = new Worker(new URL('../workers/tensorWorker.ts', import.meta.url), { type: 'module' });
      const decoded = await decodeBinaryTensorBuffer(await secRes.arrayBuffer(), worker);
      const parsed = mapDecodedTensor(decoded, false);
      const installedBadge = parsed.sourceBadge.startsWith('[Installed]')
        ? parsed.sourceBadge
        : `[Installed] ${parsed.sourceBadge}`;
      parsed.sourceBadge = installedBadge;
      const entry = { parsed, sourceBadge: installedBadge };
      setCachedDecodedTensor(cacheKey, entry);
      return entry;
    } finally {
      worker?.terminate();
      worker = null;
      if (!signal) {
        SECTION_TENSOR_INFLIGHT.delete(cacheKey);
      }
    }
  })();

  if (!signal) {
    SECTION_TENSOR_INFLIGHT.set(cacheKey, flight);
  }
  return flight;
}

/**
 * Concurrency-bounded wrapper used by modal/button thumbnails so fast scrolling
 * never fires unbounded parallel tensor fetches.
 */
export async function loadInstalledSectionThumbnailTensor(
  section: InstalledSection,
  signal?: AbortSignal
): Promise<DecodedSectionEntry | null> {
  const cacheKey = getSectionTensorCacheKey(section);
  const cached = getCachedDecodedTensor(cacheKey);
  if (cached) return cached;

  await acquireThumbnailSlot(signal);
  try {
    return await loadOrDecodeInstalledSectionTensor(section, signal);
  } finally {
    releaseThumbnailSlot();
  }
}
