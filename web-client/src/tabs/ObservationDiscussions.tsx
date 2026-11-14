import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { useRealtimeDiscussions } from '../hooks/useRealtimeDiscussions';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
} from '../components/GlobalCommandHeader';
import {
  findMatchingSection,
  useInstalledSectionState,
  type InstalledSection,
} from '../lib/installedSections';
import type { TensorHeader, TensorWorkerResponse } from '../workers/tensorWorker';
import { Badge, Button, Input } from '../components/ui';

/**
 * Spectra Tab 5: Observation Discussions & External Archive Cross-Match (<ObservationDiscussions />)
 * Specification Anchor: SPECIFICATION.md §3.3, §6.3.5; DESIGN.md
 * Role: E4 (role:E4-frontend)
 */

export interface DiscussionReply {
  id: string;
  authorHandle: string;
  isModerator: boolean;
  timestampIso: string;
  body: string;
}

export interface DiscussionThread {
  id: string;
  title: string;
  authorHandle: string;
  isModerator: boolean;
  timestampIso: string;
  classification: string;
  confidencePct: number;
  ra: number;
  dec: number;
  fovArcsec: number;
  renderMode: 'blink' | 'difference' | 'coadd';
  targetName: string;
  body: string;
  upvotes: number;
  replies: DiscussionReply[];
  hashtags?: string[];
  classVotes?: Partial<Record<ClassVoteKey, number>>;
}

type ClassVoteKey = 'V_mover' | 'V_var' | 'V_ice' | 'V_artifact';

interface ClassificationShortcut {
  id: string;
  label: string;
  classification: string;
  hashtag: string;
  voteKey: ClassVoteKey;
  channel: string;
}

const CLASSIFICATION_CATEGORIES = [
  { id: 'moving_brown_dwarf', label: 'High-PM Substellar / Brown Dwarf' },
  { id: 'variable_star', label: 'Flashing Variable' },
  { id: 'circumstellar_disk', label: 'Circumstellar Disk / Dipper Occultation' },
  { id: 'mira_agb_pulsator', label: 'AGB / Mira Long-Period Variable' },
  { id: 'interstellar_ice', label: 'Molecular Cloud 3.0–4.67 µm Ice Absorption' },
  { id: 'high_z_emission', label: 'Extragalactic Hα / [OIII] Line Emitter' },
  { id: 'solar_system_mover', label: 'Solar System Asteroid / NEOWISE Mover' },
  { id: 'optical_blend_artifact', label: 'Optical Blend / Artifact' },
  { id: 'instrumental_flag', label: 'Detector Persistence / Cosmic Ray Artifact' },
];

const CLASSIFICATION_SHORTCUTS: ClassificationShortcut[] = [
  {
    id: 'mover',
    label: '[+ Dipole/Mover]',
    classification: 'moving_brown_dwarf',
    hashtag: '#mover',
    voteKey: 'V_mover',
    channel: 'movers',
  },
  {
    id: 'variable',
    label: '[+ Flashing Variable]',
    classification: 'variable_star',
    hashtag: '#variable',
    voteKey: 'V_var',
    channel: 'discoveries',
  },
  {
    id: 'ice_source',
    label: '[+ Interstellar Ice]',
    classification: 'interstellar_ice',
    hashtag: '#ice_source',
    voteKey: 'V_ice',
    channel: 'ices',
  },
  {
    id: 'blend_artifact',
    label: '[+ Optical Blend/Artifact]',
    classification: 'optical_blend_artifact',
    hashtag: '#blend_artifact',
    voteKey: 'V_artifact',
    channel: 'artifacts',
  },
];

// Web Crypto API identity generator (satisfies DESIGN.md §6)
function ensureZeroAuthIdentity(): { observerId: string; observerKey: string; handle: string } {
  let obsId = localStorage.getItem('spx_observer_id');
  let obsKey = localStorage.getItem('spx_observer_key');

  if (!obsId && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    obsId = crypto.randomUUID();
    localStorage.setItem('spx_observer_id', obsId);
  } else if (!obsId) {
    obsId = '00000000-0000-4000-8000-000000007f3a';
    localStorage.setItem('spx_observer_id', obsId);
  }

  if (!obsKey && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    obsKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('spx_observer_key', obsKey);
  } else if (!obsKey) {
    obsKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    localStorage.setItem('spx_observer_key', obsKey);
  }

  const shortSuffix = obsId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return {
    observerId: obsId,
    observerKey: obsKey,
    handle: `Obs-${shortSuffix}`,
  };
}

const BENCHMARK_TENSOR_URLS: Record<string, string> = {
  barnard: '/benchmarks/barnard.f32',
  wise0855: '/benchmarks/wise0855.f32',
  eps_indi_b: '/benchmarks/eps_indi_b.f32',
  rw_aur: '/benchmarks/rw_aur.f32',
  r_dra: '/benchmarks/r_dra.f32',
};

const BAND_SHORT_NAMES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

interface DecodedStampTensor {
  epochs: number;
  bands: number;
  width: number;
  height: number;
  fluxData: Float32Array[][];
  varData: Float32Array[][];
  nExpData: Uint16Array[][];
  wcs?: { crval: [number, number]; cdelt: [number, number]; crpix: [number, number] };
  sourceBadge: string;
}

const MAX_STAMP_TENSORS = 16;
const STAMP_TENSOR_LRU = new Map<string, DecodedStampTensor>();
const STAMP_INFLIGHT = new Map<string, Promise<DecodedStampTensor | null>>();

function decodeStampWithWorker(buffer: ArrayBuffer): Promise<TensorWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/tensorWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<TensorWorkerResponse>) => {
      worker.terminate();
      if (event.data.success) resolve(event.data);
      else reject(new Error(event.data.error || 'Unable to decode binary tensor.'));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Tensor decoder worker failed.'));
    };
    worker.postMessage({ buffer }, [buffer]);
  });
}

async function fetchBinaryTensorResponse(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (response.ok && !contentType.includes('text/html')) {
      return response;
    }
  } catch {
    // Ignore transient fetch failures so fallback candidates can run
  }
  return null;
}

async function fetchAndDecodeStampTensor(
  cacheKey: string,
  url: string,
  fallbackUrl?: string
): Promise<DecodedStampTensor | null> {
  const hit = STAMP_TENSOR_LRU.get(cacheKey);
  if (hit) {
    STAMP_TENSOR_LRU.delete(cacheKey);
    STAMP_TENSOR_LRU.set(cacheKey, hit);
    return hit;
  }
  const existingFlight = STAMP_INFLIGHT.get(cacheKey);
  if (existingFlight) return existingFlight;

  const flight = (async () => {
    try {
      let response = await fetchBinaryTensorResponse(url);
      if (!response) {
        const secMatch = url.match(/^\/api\/sections\/([^/?]+)\/tensor/);
        if (secMatch) {
          response = await fetchBinaryTensorResponse(`/benchmarks/${secMatch[1]}.f32`);
        }
      }
      if (!response && fallbackUrl) {
        response = await fetchBinaryTensorResponse(fallbackUrl);
      }
      if (!response) return null;
      const buf = await response.arrayBuffer();
      const decoded = await decodeStampWithWorker(buf);
      const hdr: TensorHeader = decoded.header;
      const [epochs, bands, height, width] = hdr.shape;
      const planePixels = height * width;
      const totalPixels = decoded.totalPixels;
      const payload = decoded.payloadBuffer;
      const allFlux = new Float32Array(payload, 0, totalPixels);
      const allVar = new Float32Array(payload, totalPixels * 4, totalPixels);
      const allNExp = new Uint16Array(payload, totalPixels * 12, totalPixels);

      const fluxData: Float32Array[][] = [];
      const varData: Float32Array[][] = [];
      const nExpData: Uint16Array[][] = [];
      for (let e = 0; e < epochs; e++) {
        fluxData[e] = [];
        varData[e] = [];
        nExpData[e] = [];
        for (let b = 0; b < bands; b++) {
          const offset = (e * bands + b) * planePixels;
          fluxData[e][b] = allFlux.subarray(offset, offset + planePixels);
          varData[e][b] = allVar.subarray(offset, offset + planePixels);
          nExpData[e][b] = allNExp.subarray(offset, offset + planePixels);
        }
      }

      const parsed: DecodedStampTensor = {
        epochs,
        bands,
        width,
        height,
        fluxData,
        varData,
        nExpData,
        wcs:
          Array.isArray(hdr.crval) && Array.isArray(hdr.cdelt)
            ? {
                crval: hdr.crval,
                cdelt: hdr.cdelt,
                crpix: Array.isArray(hdr.crpix)
                  ? hdr.crpix
                  : [(width + 1) / 2, (height + 1) / 2],
              }
            : undefined,
        sourceBadge: hdr.source_badge || '[SPHEREx Cutout]',
      };

      STAMP_TENSOR_LRU.set(cacheKey, parsed);
      while (STAMP_TENSOR_LRU.size > MAX_STAMP_TENSORS) {
        const oldestKey = STAMP_TENSOR_LRU.keys().next().value;
        if (oldestKey === undefined) break;
        STAMP_TENSOR_LRU.delete(oldestKey);
      }
      return parsed;
    } catch {
      return null;
    } finally {
      STAMP_INFLIGHT.delete(cacheKey);
    }
  })();

  STAMP_INFLIGHT.set(cacheKey, flight);
  return flight;
}

function resolveThreadTargetMeta(t: DiscussionThread): {
  targetLabel: string;
  benchmarkId: string | null;
} {
  const rawTarget = (t.targetName ?? '').trim();
  const hasExplicitTarget = rawTarget.length > 0 && rawTarget !== 'Selected Field';
  const haystack = `${rawTarget} ${t.title} ${(t.hashtags ?? []).join(' ')}`.toLowerCase();
  const cosDec = Math.max(0.05, Math.cos((t.dec * Math.PI) / 180));

  const matched = SEARCHABLE_SKY_CATALOG.find((item) => {
    const dRa = ((item.ra - t.ra + 540) % 360) - 180;
    if (Math.hypot(dRa * cosDec, item.dec - t.dec) <= 0.35) return true;
    const wiseMatch = item.id === 'wise0855' && haystack.includes('wise 0855');
    return (
      haystack.includes(item.name.toLowerCase()) ||
      haystack.includes(item.id.toLowerCase()) ||
      wiseMatch
    );
  });

  if (matched) {
    const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === matched.id);
    return {
      targetLabel: hasExplicitTarget ? rawTarget : matched.name,
      benchmarkId: isBench ? matched.id : null,
    };
  }

  const isSplicesThread =
    Math.hypot(t.ra - 272.5, t.dec - -18.0333) <= 0.35 || haystack.includes('splices');
  if (isSplicesThread) {
    return {
      targetLabel: hasExplicitTarget ? rawTarget : 'SPLICES J1810-1802',
      benchmarkId: null,
    };
  }

  return {
    targetLabel: hasExplicitTarget
      ? rawTarget
      : `J2000 ${t.ra.toFixed(4)}°, ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(4)}°`,
    benchmarkId: null,
  };
}

function asinhStretchScalar(norm: number, a = 0.08): number {
  const safeA = Math.max(a, 1e-6);
  return Math.asinh(norm / safeA) / Math.asinh(1 / safeA);
}

const VIRIDIS_STOPS: Array<[number, number, number]> = [
  [12, 16, 36],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function sampleViridisRgb(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (VIRIDIS_STOPS.length - 1);
  const idx = Math.min(VIRIDIS_STOPS.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = VIRIDIS_STOPS[idx];
  const c1 = VIRIDIS_STOPS[idx + 1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

function sampleDiffRgb(signedNorm: number): [number, number, number] {
  const clamped = Math.max(-1, Math.min(1, signedNorm));
  if (clamped >= 0) {
    // Positive flux change -> mid-charcoal to warm amber-gold
    return [
      Math.round(18 + 232 * clamped),
      Math.round(22 + 166 * clamped),
      Math.round(32 + 20 * clamped),
    ];
  }
  // Negative flux change -> mid-charcoal to bright cyan-blue
  const neg = -clamped;
  return [
    Math.round(18 + 38 * neg),
    Math.round(22 + 168 * neg),
    Math.round(32 + 218 * neg),
  ];
}

function bandCoverageCount(
  flux: Float32Array | undefined,
  nExp: Uint16Array | undefined
): number {
  if (!flux || !nExp) return 0;
  let count = 0;
  for (let i = 0; i < flux.length; i++) {
    if (nExp[i] > 0 && Number.isFinite(flux[i])) count += 1;
  }
  return count;
}

function computeQuantileBounds(
  values: Float32Array,
  validMask?: Uint8Array
): { low: number; high: number; maxFinite: number } {
  const samples: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (validMask && !validMask[i]) continue;
    const v = values[i];
    if (Number.isFinite(v)) samples.push(v);
  }
  if (samples.length === 0) return { low: 0, high: 1, maxFinite: 0 };
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(samples.length * 0.03)];
  const hi = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.992))];
  const maxFinite = samples[samples.length - 1];
  return { low: lo, high: hi > lo ? hi : lo + 1, maxFinite };
}

function computeBandCoadd(
  tensor: DecodedStampTensor,
  bandIndex: number
): { flux: Float32Array; valid: Uint8Array; validCount: number } {
  const total = tensor.width * tensor.height;
  const sumWFlux = new Float64Array(total);
  const sumW = new Float64Array(total);
  const outFlux = new Float32Array(total);
  const valid = new Uint8Array(total);

  for (let e = 0; e < tensor.epochs; e++) {
    const fPlane = tensor.fluxData[e]?.[bandIndex];
    const vPlane = tensor.varData[e]?.[bandIndex];
    const nPlane = tensor.nExpData[e]?.[bandIndex];
    if (!fPlane || !nPlane) continue;
    for (let i = 0; i < total; i++) {
      const f = fPlane[i];
      if (nPlane[i] === 0 || !Number.isFinite(f)) continue;
      const v = vPlane?.[i] ?? 1;
      const w = Number.isFinite(v) && v > 0 ? 1 / Math.max(v, 1e-8) : 1;
      sumWFlux[i] += f * w;
      sumW[i] += w;
    }
  }

  let validCount = 0;
  for (let i = 0; i < total; i++) {
    if (sumW[i] > 0) {
      outFlux[i] = sumWFlux[i] / sumW[i];
      valid[i] = 1;
      validCount += 1;
    } else {
      outFlux[i] = Number.NaN;
    }
  }
  return { flux: outFlux, valid, validCount };
}

function skyToStampPixel(
  raDeg: number,
  decDeg: number,
  wcs: DecodedStampTensor['wcs'],
  width: number,
  height: number,
  flipY: boolean
): { x: number; y: number } {
  const fallback = { x: width * 0.5, y: height * 0.5 };
  if (!wcs) return fallback;
  const toRad = Math.PI / 180;
  const ra0 = wcs.crval[0] * toRad;
  const dec0 = wcs.crval[1] * toRad;
  const ra1 = raDeg * toRad;
  const dec1 = decDeg * toRad;
  const dra = ra1 - ra0;
  const sinD0 = Math.sin(dec0);
  const cosD0 = Math.cos(dec0);
  const sinD1 = Math.sin(dec1);
  const cosD1 = Math.cos(dec1);
  const cosDra = Math.cos(dra);
  const denom = sinD0 * sinD1 + cosD0 * cosD1 * cosDra;
  if (denom <= 0) return fallback;
  const xiDeg = (cosD1 * Math.sin(dra)) / denom / toRad;
  const etaDeg = (cosD0 * sinD1 - sinD0 * cosD1 * cosDra) / denom / toRad;
  const pxX = wcs.crpix[0] - 0.5 + xiDeg / wcs.cdelt[0];
  const rawPy = wcs.crpix[1] - 0.5 + etaDeg / wcs.cdelt[1];
  const pxY = flipY ? height - rawPy : rawPy;
  if (pxX < 0 || pxX > width || pxY < 0 || pxY > height) return fallback;
  return { x: pxX, y: pxY };
}

interface StampRenderMetrics {
  modeSummary: string;
  peakFluxLabel: string;
  gridLabel: string;
  hasDiffPair: boolean;
  epochCount: number;
}

function selectStampPlan(
  tensor: DecodedStampTensor,
  preferredBandOrder: number[]
): {
  primaryBand: number;
  coveredEpochs: number[];
  diffBand: number | null;
  diffEp0: number;
  diffEpN: number;
} {
  let primaryBand = 0;
  let primaryEpochs: number[] = [];
  let diffBand: number | null = null;
  let diffEp0 = 0;
  let diffEpN = 0;

  for (const b of preferredBandOrder) {
    if (b < 0 || b >= tensor.bands) continue;
    const cov: number[] = [];
    for (let e = 0; e < tensor.epochs; e++) {
      if (bandCoverageCount(tensor.fluxData[e]?.[b], tensor.nExpData[e]?.[b]) > 0) {
        cov.push(e);
      }
    }
    if (cov.length > 0 && primaryEpochs.length === 0) {
      primaryBand = b;
      primaryEpochs = cov;
    }
    if (cov.length >= 2 && diffBand === null) {
      diffBand = b;
      diffEp0 = cov[0];
      diffEpN = cov[cov.length - 1];
    }
  }

  return {
    primaryBand,
    coveredEpochs: primaryEpochs,
    diffBand,
    diffEp0,
    diffEpN,
  };
}

function renderTensorStampToCanvas(
  canvas: HTMLCanvasElement,
  tensor: DecodedStampTensor,
  thread: DiscussionThread,
  stampMode: 'blink' | 'difference' | 'coadd',
  blinkEpochSlot: 0 | 1,
  benchmarkId: string | null
): StampRenderMetrics {
  const { width, height } = tensor;
  const total = width * height;
  const flipY = (tensor.wcs?.cdelt?.[1] ?? 1) > 0;
  const isCold = benchmarkId === 'wise0855' || thread.classification === 'moving_brown_dwarf';
  const bandOrder = isCold ? [4, 5, 3, 2, 1, 0] : [1, 2, 4, 3, 5, 0];
  const plan = selectStampPlan(tensor, bandOrder);

  const imgData = new ImageData(width, height);
  const rgba = imgData.data;
  let modeSummary = '';
  let maxFlux = 0;

  if (stampMode === 'difference' && plan.diffBand !== null) {
    const f0 = tensor.fluxData[plan.diffEp0][plan.diffBand];
    const fN = tensor.fluxData[plan.diffEpN][plan.diffBand];
    const n0 = tensor.nExpData[plan.diffEp0][plan.diffBand];
    const nN = tensor.nExpData[plan.diffEpN][plan.diffBand];
    const absSamples: number[] = [];
    for (let i = 0; i < total; i++) {
      if (n0[i] > 0 && nN[i] > 0 && Number.isFinite(f0[i]) && Number.isFinite(fN[i])) {
        absSamples.push(Math.abs(fN[i] - f0[i]));
      }
    }
    absSamples.sort((a, b) => a - b);
    const diffScale =
      absSamples.length > 0
        ? Math.max(absSamples[Math.min(absSamples.length - 1, Math.floor(absSamples.length * 0.99))], 1e-4)
        : 1.0;

    for (let dispY = 0; dispY < height; dispY++) {
      const srcY = flipY ? height - 1 - dispY : dispY;
      for (let x = 0; x < width; x++) {
        const srcIdx = srcY * width + x;
        const outIdx = (dispY * width + x) * 4;
        if (
          n0[srcIdx] > 0 &&
          nN[srcIdx] > 0 &&
          Number.isFinite(f0[srcIdx]) &&
          Number.isFinite(fN[srcIdx])
        ) {
          const diff = fN[srcIdx] - f0[srcIdx];
          if (Math.abs(diff) > maxFlux) maxFlux = Math.abs(diff);
          const stretched = asinhStretchScalar(diff / diffScale, 0.12);
          const [r, g, b] = sampleDiffRgb(stretched);
          rgba[outIdx] = r;
          rgba[outIdx + 1] = g;
          rgba[outIdx + 2] = b;
          rgba[outIdx + 3] = 255;
        } else {
          rgba[outIdx] = 8;
          rgba[outIdx + 1] = 11;
          rgba[outIdx + 2] = 18;
          rgba[outIdx + 3] = 255;
        }
      }
    }
    modeSummary = `Diff ${BAND_SHORT_NAMES[plan.diffBand] ?? `B${plan.diffBand + 1}`} · P${plan.diffEpN + 1}−P${plan.diffEp0 + 1}`;
  } else if (stampMode === 'coadd') {
    const rBand = tensor.bands >= 5 ? computeBandCoadd(tensor, 4) : null;
    const gBand = tensor.bands >= 3 ? computeBandCoadd(tensor, 2) : null;
    const bBand = tensor.bands >= 1 ? computeBandCoadd(tensor, 0) : null;
    const rgbActiveCount =
      (rBand && rBand.validCount > 0 ? 1 : 0) +
      (gBand && gBand.validCount > 0 ? 1 : 0) +
      (bBand && bBand.validCount > 0 ? 1 : 0);

    if (rgbActiveCount >= 2 && rBand && gBand && bBand) {
      const rStats = computeQuantileBounds(rBand.flux, rBand.valid);
      const gStats = computeQuantileBounds(gBand.flux, gBand.valid);
      const bStats = computeQuantileBounds(bBand.flux, bBand.valid);
      maxFlux = Math.max(rStats.maxFinite, gStats.maxFinite, bStats.maxFinite);

      const channelVal = (
        band: { flux: Float32Array; valid: Uint8Array },
        stats: { low: number; high: number },
        idx: number
      ) => {
        if (!band.valid[idx] || !Number.isFinite(band.flux[idx])) return 0;
        const norm = Math.max(0, (band.flux[idx] - stats.low) / (stats.high - stats.low));
        return Math.round(Math.max(0, Math.min(1, asinhStretchScalar(norm, 0.08))) * 255);
      };

      for (let dispY = 0; dispY < height; dispY++) {
        const srcY = flipY ? height - 1 - dispY : dispY;
        for (let x = 0; x < width; x++) {
          const srcIdx = srcY * width + x;
          const outIdx = (dispY * width + x) * 4;
          const anyCovered = rBand.valid[srcIdx] || gBand.valid[srcIdx] || bBand.valid[srcIdx];
          if (!anyCovered) {
            rgba[outIdx] = 8;
            rgba[outIdx + 1] = 11;
            rgba[outIdx + 2] = 18;
            rgba[outIdx + 3] = 255;
            continue;
          }
          rgba[outIdx] = channelVal(rBand, rStats, srcIdx);
          rgba[outIdx + 1] = channelVal(gBand, gStats, srcIdx);
          rgba[outIdx + 2] = channelVal(bBand, bStats, srcIdx);
          rgba[outIdx + 3] = 255;
        }
      }
      modeSummary = `Coadd RGB (D5/D3/D1)`;
    } else {
      const single = computeBandCoadd(tensor, plan.primaryBand);
      const stats = computeQuantileBounds(single.flux, single.valid);
      maxFlux = stats.maxFinite;
      for (let dispY = 0; dispY < height; dispY++) {
        const srcY = flipY ? height - 1 - dispY : dispY;
        for (let x = 0; x < width; x++) {
          const srcIdx = srcY * width + x;
          const outIdx = (dispY * width + x) * 4;
          if (!single.valid[srcIdx] || !Number.isFinite(single.flux[srcIdx])) {
            rgba[outIdx] = 8;
            rgba[outIdx + 1] = 11;
            rgba[outIdx + 2] = 18;
            rgba[outIdx + 3] = 255;
            continue;
          }
          const norm = Math.max(0, (single.flux[srcIdx] - stats.low) / (stats.high - stats.low));
          const [r, g, b] = sampleViridisRgb(asinhStretchScalar(norm, 0.08));
          rgba[outIdx] = r;
          rgba[outIdx + 1] = g;
          rgba[outIdx + 2] = b;
          rgba[outIdx + 3] = 255;
        }
      }
      modeSummary = `Coadd ${BAND_SHORT_NAMES[plan.primaryBand] ?? `B${plan.primaryBand + 1}`}`;
    }
  } else {
    const epochs = plan.coveredEpochs.length > 0 ? plan.coveredEpochs : [0];
    const ep = blinkEpochSlot === 0 ? epochs[0] : epochs[epochs.length - 1];
    const flux = tensor.fluxData[ep]?.[plan.primaryBand];
    const nExp = tensor.nExpData[ep]?.[plan.primaryBand];
    if (flux && nExp) {
      const validMask = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        if (nExp[i] > 0 && Number.isFinite(flux[i])) validMask[i] = 1;
      }
      const stats = computeQuantileBounds(flux, validMask);
      maxFlux = stats.maxFinite;
      for (let dispY = 0; dispY < height; dispY++) {
        const srcY = flipY ? height - 1 - dispY : dispY;
        for (let x = 0; x < width; x++) {
          const srcIdx = srcY * width + x;
          const outIdx = (dispY * width + x) * 4;
          if (!validMask[srcIdx]) {
            rgba[outIdx] = 8;
            rgba[outIdx + 1] = 11;
            rgba[outIdx + 2] = 18;
            rgba[outIdx + 3] = 255;
            continue;
          }
          const norm = Math.max(0, (flux[srcIdx] - stats.low) / (stats.high - stats.low));
          const [r, g, b] = sampleViridisRgb(asinhStretchScalar(norm, 0.08));
          rgba[outIdx] = r;
          rgba[outIdx + 1] = g;
          rgba[outIdx + 2] = b;
          rgba[outIdx + 3] = 255;
        }
      }
    }
    modeSummary = `Blink ${BAND_SHORT_NAMES[plan.primaryBand] ?? `B${plan.primaryBand + 1}`} · P${ep + 1}/${tensor.epochs}`;
  }

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const displayCssSize = canvas.clientWidth || 184;
  canvas.width = Math.round(displayCssSize * dpr);
  canvas.height = Math.round(displayCssSize * dpr);

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const octx = offscreen.getContext('2d');
    if (octx) {
      octx.putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0, displayCssSize, displayCssSize);
    }

    // Center J2000 Crosshair Reticle
    const targetPt = skyToStampPixel(thread.ra, thread.dec, tensor.wcs, width, height, flipY);
    const rx = (targetPt.x / width) * displayCssSize;
    const ry = (targetPt.y / height) * displayCssSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(rx - 10, ry);
    ctx.lineTo(rx - 4, ry);
    ctx.moveTo(rx + 4, ry);
    ctx.lineTo(rx + 10, ry);
    ctx.moveTo(rx, ry - 10);
    ctx.lineTo(rx, ry - 4);
    ctx.moveTo(rx, ry + 4);
    ctx.lineTo(rx, ry + 10);
    ctx.stroke();

    // North-Up / East-Left Compass Overlay (top-right)
    const cx0 = displayCssSize - 14;
    const cy0 = 24;
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
    ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.font = '600 9px "IBM Plex Mono", ui-monospace, monospace';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(cx0, cy0 - 11);
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(cx0 - 11, cy0);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText('N', cx0, cy0 - 13);
    ctx.textAlign = 'right';
    ctx.fillText('E', cx0 - 13, cy0 + 3);

    // Angular Scale Bar (bottom-left)
    const pixelScaleArcsec = Math.abs((tensor.wcs?.cdelt?.[1] ?? 6.2 / 3600) * 3600) || 6.2;
    const totalFovArcsec = width * pixelScaleArcsec;
    const barArcsec = totalFovArcsec >= 240 ? 60 : 30;
    const barPx = (barArcsec / totalFovArcsec) * displayCssSize;
    const bx = 8;
    const by = displayCssSize - 10;
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by - 3);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.lineTo(bx + barPx, by - 3);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillText(`${barArcsec}"`, bx, by - 5);
    ctx.restore();
  }

  return {
    modeSummary,
    peakFluxLabel: `${maxFlux.toFixed(maxFlux >= 10 ? 1 : 2)} MJy/sr`,
    gridLabel: `${width}×${height} px · ${(Math.abs((tensor.wcs?.cdelt?.[1] ?? 6.2 / 3600) * 3600)).toFixed(1)}"/px`,
    hasDiffPair: plan.diffBand !== null,
    epochCount: tensor.epochs,
  };
}

function renderOfflineWcsGrid(canvas: HTMLCanvasElement, thread: DiscussionThread): void {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const w = canvas.clientWidth || 620;
  const h = canvas.clientHeight || 176;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.lineWidth = 1;
  for (let x = (w % 40) * 0.5; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = (h % 40) * 0.5; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const cx = w * 0.5;
  const cy = h * 0.5;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.moveTo(cx - 28, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy);
  ctx.lineTo(cx + 28, cy);
  ctx.moveTo(cx, cy - 28);
  ctx.lineTo(cx, cy - 8);
  ctx.moveTo(cx, cy + 8);
  ctx.lineTo(cx, cy + 28);
  ctx.stroke();

  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    `J2000 ${thread.ra.toFixed(4)}°, ${thread.dec >= 0 ? '+' : ''}${thread.dec.toFixed(4)}° · FoV ${thread.fovArcsec}"`,
    cx,
    cy + 34
  );
  ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
  ctx.fillText('Offline — Install Sky Section to View Tensor', cx, cy + 50);
}

const SkyPatchPreview: React.FC<{
  thread: DiscussionThread;
  targetLabel: string;
  benchmarkId: string | null;
  installedSections: InstalledSection[];
  onInspectInComparator: () => void;
}> = ({ thread, targetLabel, benchmarkId, installedSections, onInspectInComparator }) => {
  const matchedSection = useMemo(
    () => findMatchingSection(installedSections, thread.ra, thread.dec, thread.fovArcsec),
    [installedSections, thread.dec, thread.fovArcsec, thread.ra]
  );

  const tensorSource = useMemo(() => {
    if (matchedSection) {
      return {
        cacheKey: `${matchedSection.section_id}:${matchedSection.updated_at || matchedSection.size_bytes}`,
        url: `/api/sections/${matchedSection.section_id}/tensor?v=${encodeURIComponent(
          String(matchedSection.updated_at || matchedSection.size_bytes)
        )}`,
        fallbackUrl:
          benchmarkId && BENCHMARK_TENSOR_URLS[benchmarkId]
            ? BENCHMARK_TENSOR_URLS[benchmarkId]
            : undefined,
      };
    }
    if (benchmarkId && BENCHMARK_TENSOR_URLS[benchmarkId]) {
      return {
        cacheKey: BENCHMARK_TENSOR_URLS[benchmarkId],
        url: BENCHMARK_TENSOR_URLS[benchmarkId],
      };
    }
    return null;
  }, [benchmarkId, matchedSection]);

  const [tensor, setTensor] = useState<DecodedStampTensor | null>(() =>
    tensorSource ? STAMP_TENSOR_LRU.get(tensorSource.cacheKey) ?? null : null
  );
  const [viewMode, setViewMode] = useState<'tensor' | 'survey'>(() =>
    tensorSource ? 'tensor' : 'survey'
  );
  const [stampMode, setStampMode] = useState<'blink' | 'difference' | 'coadd'>(
    thread.renderMode
  );
  const [blinkEpochSlot, setBlinkEpochSlot] = useState<0 | 1>(1);
  const [isHoverBlinking, setIsHoverBlinking] = useState(false);
  const [surveyStage, setSurveyStage] = useState<'2mass' | 'dss2' | 'offline'>('2mass');
  const [stampMetrics, setStampMetrics] = useState<StampRenderMetrics | null>(null);

  const stampCanvasRef = useRef<HTMLCanvasElement>(null);
  const offlineCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!tensorSource) {
      setTensor(null);
      setViewMode('survey');
      return;
    }
    const cached = STAMP_TENSOR_LRU.get(tensorSource.cacheKey);
    if (cached) {
      setTensor(cached);
      setViewMode('tensor');
      return;
    }
    void fetchAndDecodeStampTensor(
      tensorSource.cacheKey,
      tensorSource.url,
      tensorSource.fallbackUrl
    ).then((loaded) => {
      if (cancelled) return;
      if (loaded) {
        setTensor(loaded);
        setViewMode('tensor');
      } else {
        setTensor(null);
        setViewMode('survey');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tensorSource]);

  useEffect(() => {
    if (!isHoverBlinking || stampMode !== 'blink' || viewMode !== 'tensor') return;
    const id = window.setInterval(() => {
      setBlinkEpochSlot((prev) => (prev === 0 ? 1 : 0));
    }, 900);
    return () => window.clearInterval(id);
  }, [isHoverBlinking, stampMode, viewMode]);

  useEffect(() => {
    if (viewMode !== 'tensor' || !tensor || !stampCanvasRef.current) return;
    const metrics = renderTensorStampToCanvas(
      stampCanvasRef.current,
      tensor,
      thread,
      stampMode,
      blinkEpochSlot,
      benchmarkId
    );
    setStampMetrics(metrics);
  }, [benchmarkId, blinkEpochSlot, stampMode, tensor, thread, viewMode]);

  useEffect(() => {
    if (viewMode !== 'survey' || surveyStage !== 'offline' || !offlineCanvasRef.current) return;
    renderOfflineWcsGrid(offlineCanvasRef.current, thread);
  }, [surveyStage, thread, viewMode]);

  const fovDeg = Math.max(0.04, (thread.fovArcsec || 180) / 3600).toFixed(4);
  const hipsSurvey = surveyStage === 'dss2' ? 'CDS%2FP%2FDSS2%2Fcolor' : 'CDS%2FP%2F2MASS%2Fcolor';
  const cutoutUrl = `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=${hipsSurvey}&width=640&height=280&fov=${fovDeg}&ra=${encodeURIComponent(
    String(thread.ra)
  )}&dec=${encodeURIComponent(String(thread.dec))}&projection=TAN&format=jpg`;

  return (
    <div className="border-b border-border/70 bg-[#060911]">
      {viewMode === 'tensor' && tensor ? (
        <div
          className="flex flex-col sm:flex-row items-stretch"
          onMouseEnter={() => setIsHoverBlinking(true)}
          onMouseLeave={() => setIsHoverBlinking(false)}
        >
          <div className="relative h-44 w-44 sm:h-48 sm:w-48 shrink-0 self-center sm:self-auto bg-black border-b sm:border-b-0 sm:border-r border-border/60 overflow-hidden">
            <canvas
              ref={stampCanvasRef}
              onClick={() => {
                if (stampMode === 'blink') setBlinkEpochSlot((s) => (s === 0 ? 1 : 0));
                else onInspectInComparator();
              }}
              title={
                stampMode === 'blink'
                  ? 'Click to toggle Pass 1 vs latest Pass (hover to blink)'
                  : 'Inspect full interactive tensor in Time-Domain Comparator'
              }
              className="block h-full w-full cursor-pointer"
            />
          </div>

          <div className="flex flex-1 flex-col justify-between p-3 gap-2.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] font-medium text-primary">
                [SPHEREx Float32 · {stampMetrics?.modeSummary || stampMode}]
              </span>
              <div className="inline-flex rounded-md border border-border bg-background/80 p-0.5 font-mono text-[9px]">
                <button
                  type="button"
                  onClick={() => setViewMode('tensor')}
                  className="rounded px-1.5 py-0.5 bg-primary/20 text-primary font-medium"
                >
                  SPHEREx Stamp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSurveyStage('2mass');
                    setViewMode('survey');
                  }}
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                >
                  2MASS Survey
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px] tabular-nums">
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">Peak Amplitude</div>
                <div className="text-foreground">{stampMetrics?.peakFluxLabel ?? '—'}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">Sampling</div>
                <div className="text-foreground">{stampMetrics?.gridLabel ?? `${tensor.width}×${tensor.height}`}</div>
              </div>
              <div className="col-span-2 truncate text-[10px] text-muted-foreground">
                Source: <span className="text-foreground/85">{tensor.sourceBadge}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
              {(['blink', 'difference', 'coadd'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setStampMode(m)}
                  disabled={m === 'difference' && stampMetrics?.hasDiffPair === false}
                  className={`rounded border px-1.5 py-0.5 capitalize transition-colors ${
                    stampMode === m
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-border bg-background/50 text-muted-foreground hover:text-foreground disabled:opacity-40'
                  }`}
                >
                  {m === 'difference' ? 'Diff' : m}
                </button>
              ))}
              {stampMode === 'blink' && (stampMetrics?.epochCount ?? 1) > 1 && (
                <button
                  type="button"
                  onClick={() => setBlinkEpochSlot((s) => (s === 0 ? 1 : 0))}
                  className="ml-auto rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300"
                >
                  {blinkEpochSlot === 0 ? 'Frame T₀ (Click → Tₙ)' : 'Frame Tₙ (Click → T₀)'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative h-44 sm:h-48 w-full overflow-hidden group">
          {surveyStage === 'offline' ? (
            <canvas ref={offlineCanvasRef} className="block h-full w-full" />
          ) : (
            <>
              <img
                src={cutoutUrl}
                alt={`${targetLabel} sky cutout at ${thread.ra.toFixed(4)}°, ${thread.dec.toFixed(4)}°`}
                loading="lazy"
                decoding="async"
                onError={() =>
                  setSurveyStage((cur) => (cur === '2mass' ? 'dss2' : 'offline'))
                }
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              />
              {/* Center J2000 Target Crosshair Reticle */}
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                aria-hidden="true"
              >
                <div className="relative h-7 w-7">
                  <div className="absolute left-1/2 top-0 h-2 w-[1px] -translate-x-1/2 bg-sky-400/90" />
                  <div className="absolute left-1/2 bottom-0 h-2 w-[1px] -translate-x-1/2 bg-sky-400/90" />
                  <div className="absolute top-1/2 left-0 h-[1px] w-2 -translate-y-1/2 bg-sky-400/90" />
                  <div className="absolute top-1/2 right-0 h-[1px] w-2 -translate-y-1/2 bg-sky-400/90" />
                </div>
              </div>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/35" />
            </>
          )}

          <div className="absolute top-2 left-2.5 right-2.5 flex items-center justify-between gap-2">
            <span className="pointer-events-none rounded-md border border-white/15 bg-black/70 px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/90 backdrop-blur-sm">
              {thread.ra.toFixed(2)}°, {thread.dec >= 0 ? '+' : ''}
              {thread.dec.toFixed(2)}° · {thread.fovArcsec}&quot;
            </span>
            {tensor && (
              <div className="inline-flex rounded-md border border-border bg-black/80 p-0.5 font-mono text-[9px] backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setViewMode('tensor')}
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                >
                  SPHEREx Stamp
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('survey')}
                  className="rounded px-1.5 py-0.5 bg-primary/20 text-primary font-medium"
                >
                  2MASS Survey
                </button>
              </div>
            )}
          </div>

          <span className="pointer-events-none absolute bottom-1.5 left-2.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white/80 backdrop-blur-sm">
            N↑ ←E · TAN Sky Cutout
          </span>
          <span className="pointer-events-none absolute bottom-1.5 right-2.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white/75 backdrop-blur-sm">
            {surveyStage === 'dss2'
              ? '[DSS2 Color Cutout · CDS HiPS2FITS]'
              : surveyStage === 'offline'
                ? '[WCS Tangent Grid · Offline]'
                : '[2MASS JHKs Cutout · CDS HiPS2FITS]'}
          </span>
        </div>
      )}
    </div>
  );
};

export const ObservationDiscussions: React.FC = () => {
  const {
    ra,
    dec,
    fovArcsec,
    renderMode,
    activeTargetName,
    setCoordinates,
    setFov,
    setRenderMode,
  } = useTelemetryStore();

  const {
    setTab,
    setRa,
    setDec,
    setFov: setUrlFov,
    setMode: setUrlMode,
  } = useSpectraUrlState();

  const identity = useMemo(() => ensureZeroAuthIdentity(), []);

  const { threads, setThreads, sseConnected, isLoading, loadError } =
    useRealtimeDiscussions<DiscussionThread>([]);
  const { installedSections } = useInstalledSectionState();
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'TARGET' | 'VERIFIED'>('ALL');
  const [feedSort, setFeedSort] = useState<'latest' | 'top'>('latest');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newBody, setNewBody] = useState<string>('');
  const [newClass, setNewClass] = useState<string>('moving_brown_dwarf');
  const [selectedShortcut, setSelectedShortcut] =
    useState<ClassificationShortcut | null>(null);
  const [showMoreCategories, setShowMoreCategories] = useState<boolean>(false);
  const [newConfidence, setNewConfidence] = useState<number>(90);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [upvotedIds, setUpvotedIds] = useState<Record<string, boolean>>({});
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const composerTitleRef = useRef<HTMLInputElement>(null);

  const nearbyCount = useMemo(
    () => threads.filter((t) => Math.hypot(t.ra - ra, t.dec - dec) <= 1.5).length,
    [dec, ra, threads]
  );

  const verifiedCount = useMemo(
    () => threads.filter((t) => t.isModerator).length,
    [threads]
  );

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of threads) {
      counts[t.classification] = (counts[t.classification] ?? 0) + 1;
    }
    return counts;
  }, [threads]);

  const trendingTopics = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const t of threads) {
      for (const raw of t.hashtags ?? []) {
        const tag = raw.startsWith('#') ? raw : `#${raw}`;
        freq[tag] = (freq[tag] ?? 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12);
  }, [threads]);

  const topDiscussions = useMemo(() => {
    return [...threads]
      .sort(
        (a, b) =>
          b.upvotes + b.replies.length - (a.upvotes + a.replies.length) ||
          b.timestampIso.localeCompare(a.timestampIso)
      )
      .slice(0, 3);
  }, [threads]);

  const filteredThreads = useMemo(() => {
    const matching = threads.filter((t) => {
      if (scopeFilter === 'TARGET' && Math.hypot(t.ra - ra, t.dec - dec) > 1.5) {
        return false;
      }
      if (scopeFilter === 'VERIFIED' && !t.isModerator) {
        return false;
      }
      if (classFilter !== 'ALL' && t.classification !== classFilter) {
        return false;
      }
      if (
        tagFilter &&
        !(t.hashtags ?? []).some((tag) => (tag.startsWith('#') ? tag : `#${tag}`) === tagFilter)
      ) {
        return false;
      }
      return true;
    });
    if (feedSort === 'top') {
      return [...matching].sort(
        (a, b) =>
          b.upvotes + b.replies.length - (a.upvotes + a.replies.length) ||
          b.timestampIso.localeCompare(a.timestampIso)
      );
    }
    return matching;
  }, [classFilter, dec, feedSort, ra, scopeFilter, tagFilter, threads]);

  // Submit new observation thread (attaches X-Observer-ID and X-Observer-Key per SPECIFICATION.md §3.3)
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim() || isSubmitting) return;

    setSubmitError(null);
    setIsSubmitting(true);
    const hashtags = selectedShortcut ? [selectedShortcut.hashtag] : [];
    const taggedBody = hashtags.length > 0 && !newBody.includes(hashtags[0])
      ? `${newBody.trim()} ${hashtags[0]}`
      : newBody.trim();
    const draftTitle = newTitle.trim();
    const targetName =
      activeTargetName ||
      `J2000 ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`;

    try {
      const response = await fetch('/api/forum/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify({
          title: draftTitle,
          body: taggedBody,
          classification: newClass,
          confidencePct: newConfidence,
          ra,
          dec,
          fovArcsec,
          renderMode,
          targetName,
          hashtags,
          classificationVote: selectedShortcut?.id ?? null,
          channel: selectedShortcut?.channel ?? 'discoveries',
        }),
      });
      if (!response.ok) {
        setSubmitError(`Failed to publish observation (HTTP ${response.status}).`);
        return;
      }
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (payload.thread?.id !== undefined) {
        const saved = {
          ...payload.thread,
          id: String(payload.thread.id),
          replies: payload.thread.replies ?? [],
        } as DiscussionThread;
        setThreads((prev) =>
          prev.some((thread) => thread.id === saved.id)
            ? prev.map((thread) => (thread.id === saved.id ? saved : thread))
            : [saved, ...prev]
        );
      }
      setNewTitle('');
      setNewBody('');
      setSelectedShortcut(null);
      setShowMoreCategories(false);
      setNewClass('moving_brown_dwarf');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to reach forum API.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddReply = async (threadId: string) => {
    const text = (replyDrafts[threadId] || '').trim();
    if (!text || !/^\d+$/.test(threadId)) return;

    setSubmitError(null);
    try {
      const response = await fetch('/api/forum/replies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify({ threadId: Number(threadId), body: text }),
      });
      if (!response.ok) {
        setSubmitError(`Failed to post reply (HTTP ${response.status}).`);
        return;
      }
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (payload.thread) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId ? ({ ...t, ...payload.thread, id: threadId } as DiscussionThread) : t
          )
        );
      }
      setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
      setExpandedReplies((prev) => ({ ...prev, [threadId]: true }));
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to post reply.');
    }
  };

  const handleUpvoteThread = async (threadId: string) => {
    if (!/^\d+$/.test(threadId) || upvotedIds[threadId]) return;

    setUpvotedIds((prev) => ({ ...prev, [threadId]: true }));
    try {
      const response = await fetch(`/api/forum/threads/${threadId}/upvote`, {
        method: 'POST',
        headers: {
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
      });
      if (!response.ok) {
        setUpvotedIds((prev) => ({ ...prev, [threadId]: false }));
        return;
      }
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (payload.thread) {
        setThreads((prev) =>
          prev.map((item) =>
            item.id === threadId ? { ...item, ...payload.thread, id: threadId } : item
          )
        );
      }
    } catch {
      setUpvotedIds((prev) => ({ ...prev, [threadId]: false }));
    }
  };

  const handleClassificationVote = async (
    thread: DiscussionThread,
    shortcut: ClassificationShortcut
  ) => {
    if (!/^\d+$/.test(thread.id)) return;

    try {
      const response = await fetch(`/api/forum/threads/${thread.id}/classifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': identity.observerId,
          'X-Observer-Key': identity.observerKey,
        },
        body: JSON.stringify({ classificationVote: shortcut.id }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { thread?: Partial<DiscussionThread> };
      if (!payload.thread) return;
      setThreads((prev) =>
        prev.map((item) =>
          item.id === thread.id
            ? { ...item, ...payload.thread, id: thread.id }
            : item
        )
      );
    } catch {
      // Surface feed availability via loadError / submitError rather than mutating unpersisted state.
    }
  };

  // Restore exact sky coordinate & comparator state from a discussion post
  const handleRestorePinnedState = (
    t: DiscussionThread,
    destTab: 'navigator' | 'comparator'
  ) => {
    const matched = SEARCHABLE_SKY_CATALOG.find(
      (item) => Math.abs(item.ra - t.ra) < 0.05 && Math.abs(item.dec - t.dec) < 0.05
    );
    const isBench = matched && MANDATORY_BENCHMARKS.some((b) => b.id === matched.id);
    setCoordinates(
      t.ra,
      t.dec,
      t.targetName,
      isBench ? '[NASA Benchmark (Pre-cached)]' : '[Community Observation]'
    );
    setRa(t.ra);
    setDec(t.dec);
    setFov(t.fovArcsec);
    setUrlFov(t.fovArcsec);
    setRenderMode(t.renderMode);
    setUrlMode(t.renderMode);
    setTab(destTab);
  };

  // External Archive Cross-Match URLs for Active Coordinate (ra, dec)
  const externalArchives = useMemo(
    () => [
      {
        name: 'NASA/IPAC IRSA SPHEREx Explorer',
        desc: 'Official IPAC Firefly spectral image & HiPS portal',
        url: `https://irsa.ipac.caltech.edu/applications/spherex/search-spectral-images`,
      },
      {
        name: 'CDS SIMBAD Astronomical Database',
        desc: `2' cone search around ${ra.toFixed(4)}°, ${dec.toFixed(4)}°`,
        url: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${encodeURIComponent(
          `${ra} ${dec >= 0 ? '+' : ''}${dec}`
        )}&Radius=2&Radius.unit=arcmin`,
      },
      {
        name: 'VizieR Gaia DR3 Astrometry (I/355)',
        desc: 'Parallax, proper motion (pmRA, pmDE), and G/BP/RP photometry',
        url: `https://vizier.cds.unistra.fr/viz-bin/VizieR-4?-source=I/355/gaiadr3&-c=${encodeURIComponent(
          `${ra} ${dec >= 0 ? '+' : ''}${dec}`
        )}&-c.rs=60`,
      },
      {
        name: 'IRSA ZTF / WISE Time-Domain Archive',
        desc: 'Optical & mid-infrared historical light curves',
        url: `https://irsa.ipac.caltech.edu/irsaviewer/?__action=layout.showDropDown&view=HiPSList`,
      },
      {
        name: 'Pan-STARRS PS1 Optical Cutouts',
        desc: 'Color and grizy stack cutouts at the active J2000 position',
        url: `https://ps1images.stsci.edu/cgi-bin/ps1cutouts?pos=${encodeURIComponent(
          `${ra.toFixed(6)} ${dec.toFixed(6)}`
        )}`,
      },
      {
        name: 'IAU Transient Name Server (TNS)',
        desc: 'Supernovae, tidal disruption events, and fast transients',
        url: `https://www.wis-tns.org/search?&ra=${ra.toFixed(5)}&decl=${dec.toFixed(
          5
        )}&radius=120&coords_unit=arcsec`,
      },
    ],
    [dec, ra]
  );

  return (
    <div
      className="relative flex h-full w-full justify-center overflow-hidden bg-background bg-cover bg-center bg-no-repeat font-sans text-xs text-foreground"
      style={{ backgroundImage: "url('/images/galaxy.jpg')" }}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-background/65 backdrop-blur-[1px]"
        aria-hidden="true"
      />
      <div className="relative z-10 flex h-full w-full max-w-[1440px] flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* LEFT RAIL: Feed Views, External Archives & Zero-Auth Observer Footer */}
        <aside
          aria-label="Forum Navigation and Archives"
          className="flex w-full lg:w-[236px] xl:w-[252px] shrink-0 flex-col border-b lg:border-b-0 lg:border-r border-border/80 bg-card/55 backdrop-blur-md lg:overflow-y-auto px-3.5 py-3 lg:py-4 gap-3 lg:gap-5"
        >
          {/* Feed Navigation Views (modeled on My Feed / Groups / Bookmarks) */}
          <nav className="flex flex-row lg:flex-col gap-1.5 lg:gap-1 overflow-x-auto" aria-label="Feed Scope">
            <button
              type="button"
              onClick={() => setScopeFilter('ALL')}
              className={`flex items-center justify-between gap-2 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                scopeFilter === 'ALL'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l9-8 9 8v8a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-8z" />
                </svg>
                All Sky Feed
              </span>
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {threads.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScopeFilter('TARGET')}
              className={`flex items-center justify-between gap-2 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                scopeFilter === 'TARGET'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364 0a6.364 6.364 0 11-12.728 0 6.364 6.364 0 0112.728 0z" />
                </svg>
                Near Active Field
              </span>
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-300">
                {nearbyCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setScopeFilter('VERIFIED')}
              className={`flex items-center justify-between gap-2 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                scopeFilter === 'VERIFIED'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Moderator Verified
              </span>
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {verifiedCount}
              </span>
            </button>
          </nav>

          {/* External Astronomical Archive Cross-Match */}
          <div className="hidden lg:block border-t border-border/70 pt-4">
            <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Archive Cross-Match
            </h3>
            <div className="flex flex-col gap-1">
              {externalArchives.map((arch) => (
                <a
                  key={arch.name}
                  href={arch.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={arch.desc}
                  className="group flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                >
                  <span className="truncate font-medium">{arch.name}</span>
                  <svg className="h-3 w-3 shrink-0 opacity-60 group-hover:text-primary group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Bottom Observer Identity & SSE Status */}
          <div className="hidden lg:flex mt-auto border-t border-border/70 pt-3 items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/40 font-mono text-[10px] font-semibold text-primary">
                {identity.handle.slice(-2)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px] font-medium text-foreground">
                  {identity.handle}
                </div>
                <div className="text-[10px] text-muted-foreground">Zero-Auth Session</div>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] ${
                sseConnected
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-secondary text-muted-foreground border border-border'
              }`}
            >
              {sseConnected ? 'SSE Live' : 'Offline'}
            </span>
          </div>
        </aside>

        {/* CENTER CHAT STREAM */}
        <section
          aria-label="Community Chat Stream"
          className="min-w-0 flex-1 lg:overflow-y-auto px-3 py-4 sm:px-6 sm:py-5"
        >
          <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 pb-8">
            {/* New Post / Observation Note Composer (modeled on design.webp New Post card) */}
            <form
              onSubmit={handleCreateThread}
              className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md shadow-sm overflow-hidden"
            >
              <div className="px-4 pt-3.5 pb-2 space-y-1.5">
                <input
                  ref={composerTitleRef}
                  id="obs-title"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Observation headline (e.g. Dipole shift in D5 at MJD 61360)..."
                  className="w-full bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <label htmlFor="obs-body" className="sr-only">
                  Detailed astrophysical notes, MJD pass numbers, and band metrics
                </label>
                <textarea
                  id="obs-body"
                  rows={3}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="New observation note... record MJD passes, bands (D1–D6), proper motion vectors, or ice column metrics."
                  className="w-full resize-none bg-transparent text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[10px] text-muted-foreground">
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 text-primary tabular-nums">
                    Pin: {activeTargetName || 'Field'} ({ra.toFixed(4)}°, {dec >= 0 ? '+' : ''}{dec.toFixed(4)}° · {fovArcsec}&quot; · {renderMode})
                  </span>
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 text-foreground/90">
                    {CLASSIFICATION_CATEGORIES.find((c) => c.id === newClass)?.label || newClass} ({newConfidence}%)
                  </span>
                  {selectedShortcut && (
                    <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
                      {selectedShortcut.hashtag}
                    </span>
                  )}
                </div>
              </div>

              {showMoreCategories && (
                <div className="border-t border-border/60 bg-background/50 px-4 py-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Select Candidate Classification
                    </span>
                    <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      Confidence {newConfidence}%
                      <input
                        id="obs-conf"
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={newConfidence}
                        onChange={(e) => setNewConfidence(Number(e.target.value))}
                        className="w-24 accent-primary"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CLASSIFICATION_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setNewClass(cat.id);
                          setSelectedShortcut(null);
                        }}
                        className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                          newClass === cat.id
                            ? 'border-primary bg-primary/15 text-foreground font-medium'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-background/40 px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {CLASSIFICATION_SHORTCUTS.map((shortcut) => (
                    <button
                      key={shortcut.id}
                      type="button"
                      aria-pressed={selectedShortcut?.id === shortcut.id}
                      onClick={() => {
                        if (selectedShortcut?.id === shortcut.id) {
                          setSelectedShortcut(null);
                        } else {
                          setSelectedShortcut(shortcut);
                          setNewClass(shortcut.classification);
                        }
                      }}
                      className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                        selectedShortcut?.id === shortcut.id
                          ? 'border-primary/60 bg-primary/15 text-primary font-medium'
                          : 'border-transparent bg-secondary/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {shortcut.hashtag}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowMoreCategories((prev) => !prev)}
                    className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                      showMoreCategories
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                    }`}
                  >
                    Classification ▾
                  </button>
                </div>

                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={isSubmitting || !newTitle.trim() || !newBody.trim()}
                  className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3"
                  title="Publish Observation Note"
                >
                  {isSubmitting ? 'Posting…' : 'Post'}
                  <svg className="ml-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14m-6-6l6 6-6 6" />
                  </svg>
                </Button>
              </div>
              {submitError && (
                <p className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-[11px] text-destructive" role="alert">
                  {submitError}
                </p>
              )}
            </form>

            {/* Sort / Filter Tabs Strip (modeled on Following | Featured | Rising) */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFeedSort('latest')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    feedSort === 'latest'
                      ? 'bg-card border border-border text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Latest
                </button>
                <button
                  type="button"
                  onClick={() => setFeedSort('top')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    feedSort === 'top'
                      ? 'bg-card border border-border text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Featured
                </button>
                <button
                  type="button"
                  onClick={() => setScopeFilter(scopeFilter === 'TARGET' ? 'ALL' : 'TARGET')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    scopeFilter === 'TARGET'
                      ? 'bg-card border border-primary/50 text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <svg className="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  Active Target (r ≤ 1.5°)
                </button>
              </div>

              {(classFilter !== 'ALL' || tagFilter !== null || scopeFilter !== 'ALL') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {classFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setClassFilter('ALL')}
                      className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                    >
                      {CLASSIFICATION_CATEGORIES.find((c) => c.id === classFilter)?.label || classFilter} ×
                    </button>
                  )}
                  {tagFilter && (
                    <button
                      type="button"
                      onClick={() => setTagFilter(null)}
                      className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-500/20"
                    >
                      {tagFilter} ×
                    </button>
                  )}
                  {scopeFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setScopeFilter('ALL')}
                      className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Reset Scope ×
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Threaded Observations List */}
            <div className="space-y-4">
              {isLoading && (
                <div className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-6 text-center font-mono text-xs text-muted-foreground">
                  Loading community discussions from archive database…
                </div>
              )}
              {!isLoading && loadError && (
                <div className="rounded-xl border border-destructive/50 bg-card/85 backdrop-blur-md p-4 text-center font-mono text-xs text-destructive" role="alert">
                  Forum archive unavailable ({loadError}). Check database connectivity.
                </div>
              )}
              {!isLoading && !loadError && filteredThreads.length === 0 && (
                <div className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-6 text-center text-xs text-muted-foreground">
                  No community observations match the active filters.
                </div>
              )}
              {filteredThreads.map((t) => {
                const catLabel =
                  t.classification === 'unclassified'
                    ? 'Unclassified'
                    : CLASSIFICATION_CATEGORIES.find((c) => c.id === t.classification)?.label ||
                      t.classification;
                const repliesOpen =
                  expandedReplies[t.id] ?? t.replies.length > 0;
                const targetMeta = resolveThreadTargetMeta(t);

                return (
                  <article
                    key={t.id}
                    id={`thread-${t.id}`}
                    className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-4 space-y-3"
                  >
                    {/* Post Author Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary font-mono text-[10px] font-semibold text-foreground">
                          {t.authorHandle.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-foreground">
                              {t.authorHandle}
                            </span>
                            {t.isModerator && (
                              <Badge variant="amber" className="text-[9px] px-1.5 py-0">
                                [Moderator]
                              </Badge>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {t.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleRestorePinnedState(t, 'navigator')}
                        className="font-mono text-[10px] text-muted-foreground hover:text-foreground tabular-nums"
                        title="Center Sky Map on this observation's coordinates"
                      >
                        Sky Map ({t.ra.toFixed(2)}°, {t.dec.toFixed(2)}°)
                      </Button>
                    </div>

                    {/* Title + Body */}
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-semibold text-foreground leading-snug">
                        {t.title}
                      </h4>
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {t.body}
                      </p>
                    </div>

                    {/* Embedded Telemetry State Card (modeled on code preview + Read All ->) */}
                    <div className="rounded-lg border border-border bg-background/90 overflow-hidden">
                      <SkyPatchPreview
                        thread={t}
                        targetLabel={targetMeta.targetLabel}
                        benchmarkId={targetMeta.benchmarkId}
                        installedSections={installedSections}
                        onInspectInComparator={() => handleRestorePinnedState(t, 'comparator')}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-secondary/30 px-3 py-1.5 font-mono text-[10px]">
                        <span className="text-foreground/90 font-medium">
                          {targetMeta.targetLabel}
                        </span>
                        <span className="text-primary">
                          {t.confidencePct > 0 ? `${catLabel} · ${t.confidencePct}%` : catLabel}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 py-2 font-mono text-[11px] tabular-nums">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">RA (J2000)</div>
                          <div className="text-foreground">{t.ra.toFixed(5)}°</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Dec (J2000)</div>
                          <div className="text-foreground">
                            {t.dec >= 0 ? `+${t.dec.toFixed(5)}` : t.dec.toFixed(5)}°
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">FoV</div>
                          <div className="text-foreground">{t.fovArcsec}&quot;</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Render Mode</div>
                          <div className="text-amber-400">{t.renderMode}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestorePinnedState(t, 'comparator')}
                        className="flex w-full items-center justify-center gap-1.5 border-t border-border/70 bg-secondary/20 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary/50"
                      >
                        Inspect in Comparator
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>

                    {/* Hashtags Row */}
                    {t.hashtags && t.hashtags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.hashtags.map((rawTag) => {
                          const tag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setTagFilter((cur) => (cur === tag ? null : tag))
                              }
                              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                                tagFilter === tag
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Action / Reaction Footer Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleUpvoteThread(t.id)}
                          disabled={Boolean(upvotedIds[t.id])}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors ${
                            upvotedIds[t.id] || t.upvotes > 0
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                              : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground'
                          }`}
                          title="Upvote observation note"
                        >
                          <span aria-hidden="true">▲</span>
                          <span>{t.upvotes}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedReplies((prev) => ({ ...prev, [t.id]: !repliesOpen }))
                          }
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                          title="Toggle verification replies"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h8m-8 4h5m-7 5l-4 1 1-4V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H6z" />
                          </svg>
                          <span>{t.replies.length}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRestorePinnedState(t, 'navigator')}
                          className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                          title="Open field in Sky Map"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        {CLASSIFICATION_SHORTCUTS.map((shortcut) => {
                          const votes = t.classVotes?.[shortcut.voteKey] ?? 0;
                          return (
                            <button
                              key={shortcut.id}
                              type="button"
                              onClick={() => void handleClassificationVote(t, shortcut)}
                              className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                            >
                              {shortcut.hashtag}
                              {votes > 0 ? ` · ${votes}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Replies & Quick Reply Form */}
                    {repliesOpen && (
                      <div className="space-y-2 border-t border-border/70 pt-3">
                        {t.replies.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-lg border border-border/80 bg-background/80 p-2.5 text-xs"
                          >
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span className="font-mono font-medium text-foreground">
                                {r.authorHandle}
                              </span>
                              {r.isModerator && (
                                <Badge variant="amber" className="text-[9px] px-1 py-0">
                                  [Moderator]
                                </Badge>
                              )}
                              <span>·</span>
                              <span className="font-mono">
                                {r.timestampIso.slice(0, 16).replace('T', ' ')} UTC
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-foreground/90">{r.body}</p>
                          </div>
                        ))}

                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleAddReply(t.id);
                          }}
                          className="flex items-center gap-2 pt-0.5"
                        >
                          <Input
                            type="text"
                            value={replyDrafts[t.id] || ''}
                            onChange={(e) =>
                              setReplyDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                            }
                            placeholder="Add verification reply or ephemeris note..."
                            className="flex-1 h-7 text-xs bg-background"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="xs"
                            disabled={!(replyDrafts[t.id] || '').trim()}
                          >
                            Reply
                          </Button>
                        </form>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* RIGHT RAIL: Active Field Card, Classifications Filter (replaces dropdown), Trending Topics, Top Discussions */}
        <aside
          aria-label="Classifications and Trending Topics"
          className="flex w-full lg:w-[276px] xl:w-[300px] shrink-0 flex-col border-t lg:border-t-0 lg:border-l border-border/80 bg-card/55 backdrop-blur-md lg:overflow-y-auto p-4 gap-5"
        >
          {/* Active Sky Field Highlight Card (modeled on top-right promo card) */}
          <div className="rounded-xl border border-border/80 bg-card/85 backdrop-blur-md p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground truncate">
                {activeTargetName || 'Active Sky Field'}
              </span>
              <Badge variant="amber" className="shrink-0 font-mono text-[9px]">
                Community
              </Badge>
            </div>
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground leading-relaxed">
              J2000 RA {ra.toFixed(4)}° · Dec {dec >= 0 ? `+${dec.toFixed(4)}` : dec.toFixed(4)}° · FoV {fovArcsec}&quot; ({renderMode})
            </p>
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <Button
                type="button"
                size="xs"
                onClick={() => setTab('comparator')}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold"
              >
                Inspect Field
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => composerTitleRef.current?.focus()}
                className="rounded-lg"
              >
                Pin Note
              </Button>
            </div>
          </div>

          {/* Classifications List (replaces the dropdown directly right of the chat stream) */}
          <div role="region" aria-label="Classifications">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Classifications</h3>
              {classFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setClassFilter('ALL')}
                  className="text-[10px] text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                aria-pressed={classFilter === 'ALL'}
                onClick={() => setClassFilter('ALL')}
                className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors ${
                  classFilter === 'ALL'
                    ? 'border-border bg-card text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground'
                }`}
              >
                <span className="truncate">All Classifications</span>
                <span className="ml-2 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {threads.length}
                </span>
              </button>
              {CLASSIFICATION_CATEGORIES.map((cat) => {
                const count = classCounts[cat.id] ?? 0;
                const active = classFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setClassFilter(active ? 'ALL' : cat.id)}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                      active
                        ? 'border-primary/50 bg-card text-foreground font-medium'
                        : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground'
                    }`}
                  >
                    <span className="truncate">{cat.label}</span>
                    <span
                      className={`ml-2 shrink-0 font-mono text-[10px] tabular-nums ${
                        count > 0 ? 'text-primary' : 'text-muted-foreground/60'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trending Topics (dynamic tags from live archive discussions) */}
          {trendingTopics.length > 0 && (
            <div role="region" aria-label="Trending Topics">
              <h3 className="mb-2 text-xs font-semibold text-foreground">Trending Topics</h3>
              <div className="flex flex-wrap gap-1.5">
                {trendingTopics.map(([tag]) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={tagFilter === tag}
                    onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
                      tagFilter === tag
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Top Discussions */}
          {topDiscussions.length > 0 && (
            <div role="region" aria-label="Top Discussions">
              <h3 className="mb-2 text-xs font-semibold text-foreground">Top Discussions</h3>
              <div className="flex flex-col divide-y divide-border/60">
                {topDiscussions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setClassFilter('ALL');
                      setScopeFilter('ALL');
                      setTagFilter(null);
                      document.getElementById(`thread-${item.id}`)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      });
                    }}
                    className="py-2.5 text-left transition-colors hover:text-primary"
                  >
                    <div className="line-clamp-2 text-[11px] font-medium text-foreground/90 leading-snug">
                      {item.title}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {item.replies.length} replies · {item.upvotes} upvotes
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
