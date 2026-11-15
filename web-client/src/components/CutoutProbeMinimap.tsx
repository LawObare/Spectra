import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InstalledSection } from '../lib/installedSections';
import {
  THUMBNAIL_BAND_IDS,
  getCachedDecodedTensor,
  getPlaneMaxNExp,
  getSectionTensorCacheKey,
  loadInstalledSectionThumbnailTensor,
  pickObservedCell,
  type DecodedSectionEntry,
} from '../lib/sectionTensorCache';
import {
  sampleThumbnailPaletteRgb,
  type ComparatorColorPalette,
} from './InstalledCutoutsModal';

export type CutoutTimelineMode = 'coadd' | 'single' | 'diff';

export interface CutoutPassInfo {
  epochIndex: number;
  label: string;
  dateLabel: string;
  mjd: number | null;
}

export interface CutoutTimelineState {
  mode: CutoutTimelineMode;
  baselineEpoch: number;
  compareEpoch: number;
  passes: CutoutPassInfo[];
  mjdDeltaDays: number | null;
}

function mjdToIsoDate(mjd: number): string {
  const ms = (mjd - 40587) * 86400000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return `MJD ${mjd.toFixed(0)}`;
  return dt.toISOString().slice(0, 10);
}

function sampleDiffDivergingRgb(signedNorm: number): [number, number, number] {
  // signedNorm in [-1, +1]: negative = blue/cyan (earlier/dimmer), zero = dark neutral, positive = amber/orange (later/brighter)
  const v = Math.max(-1, Math.min(1, signedNorm));
  const mag = Math.abs(v);
  if (v >= 0) {
    const r = Math.round(16 + mag * 239);
    const g = Math.round(20 + Math.pow(mag, 0.85) * 125);
    const b = Math.round(28 + Math.pow(mag, 2.2) * 35);
    return [r, g, b];
  }
  const r = Math.round(16 + Math.pow(mag, 2.2) * 40);
  const g = Math.round(20 + Math.pow(mag, 0.9) * 169);
  const b = Math.round(28 + mag * 220);
  return [r, g, b];
}

export interface CutoutProbeMinimapProps {
  section: InstalledSection | null;
  epochIndex?: number | null;
  timelineMode?: CutoutTimelineMode;
  baselineEpoch?: number;
  compareEpoch?: number;
  onTimelineChange?: (state: CutoutTimelineState) => void;
  colorPalette?: ComparatorColorPalette;
  probePixel: { x: number; y: number };
  fallbackRa: number;
  fallbackDec: number;
  fallbackFovArcsec?: number;
  onSelectPixel: (
    px: number,
    py: number,
    skyCoord: { ra: number; dec: number }
  ) => void;
  onReinstall?: (section: InstalledSection) => void;
  showApertureOverlay?: boolean;
  apertureRadiusPx?: number;
  annulusInnerPx?: number;
  annulusOuterPx?: number;
  caption?: string;
}

export const CutoutProbeMinimap: React.FC<CutoutProbeMinimapProps> = ({
  section,
  epochIndex = null,
  timelineMode,
  baselineEpoch,
  compareEpoch,
  onTimelineChange,
  colorPalette = 'standard_rgb',
  probePixel,
  fallbackRa,
  fallbackDec,
  fallbackFovArcsec = 300,
  onSelectPixel,
  onReinstall,
  showApertureOverlay = false,
  apertureRadiusPx = 1.5,
  annulusInnerPx = 3.0,
  annulusOuterPx = 5.0,
  caption,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheKey = section ? getSectionTensorCacheKey(section) : '';
  const [entry, setEntry] = useState<DecodedSectionEntry | null>(() =>
    cacheKey ? getCachedDecodedTensor(cacheKey) : null
  );
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dragPixel, setDragPixel] = useState<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  // Timeline & band controls (controlled when parent passes props, local otherwise)
  const [localMode, setLocalMode] = useState<CutoutTimelineMode>('coadd');
  const [localBaseEpoch, setLocalBaseEpoch] = useState<number>(0);
  const [localCompareEpoch, setLocalCompareEpoch] = useState<number>(1);
  const [blinkShowB, setBlinkShowB] = useState<boolean>(false);
  const [selectedBandIdx, setSelectedBandIdx] = useState<number | null>(null);

  const effectiveMode: CutoutTimelineMode = timelineMode ?? (epochIndex !== null ? 'single' : localMode);

  useEffect(() => {
    if (!section || !cacheKey) {
      setEntry(null);
      setLoading(false);
      setLoadFailed(false);
      return;
    }
    const cached = getCachedDecodedTensor(cacheKey);
    if (cached) {
      setEntry(cached);
      setLoading(false);
      setLoadFailed(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setEntry(null);
    setLoading(true);
    setLoadFailed(false);
    loadInstalledSectionThumbnailTensor(section, controller.signal)
      .then((res) => {
        if (!cancelled) {
          setEntry(res);
          setLoading(false);
          setLoadFailed(!res);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoading(false);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [section, cacheKey]);

  const passes = useMemo<CutoutPassInfo[]>(() => {
    const count = entry?.parsed.epochs ?? section?.epochs ?? 0;
    if (count <= 0) return [];
    const mjdRanges = entry?.parsed.mjdRanges;
    const list: CutoutPassInfo[] = [];
    for (let e = 0; e < count; e++) {
      const mjds: number[] = [];
      const bandRanges = mjdRanges?.[e];
      if (Array.isArray(bandRanges)) {
        for (const rng of bandRanges) {
          if (Array.isArray(rng)) {
            for (const v of rng) {
              if (typeof v === 'number' && Number.isFinite(v) && v > 40000) {
                mjds.push(v);
              }
            }
          }
        }
      }
      const meanMjd = mjds.length > 0 ? mjds.reduce((a, b) => a + b, 0) / mjds.length : null;
      list.push({
        epochIndex: e,
        label: `Pass ${e + 1}`,
        dateLabel: meanMjd !== null ? mjdToIsoDate(meanMjd) : `Pass ${e + 1}`,
        mjd: meanMjd,
      });
    }
    return list;
  }, [entry, section?.epochs]);

  const maxEpochIdx = Math.max(0, passes.length - 1);
  const effectiveBaseEpoch = Math.max(
    0,
    Math.min(maxEpochIdx, baselineEpoch ?? (epochIndex !== null && timelineMode === undefined ? epochIndex : localBaseEpoch))
  );
  const rawCompareEpoch = compareEpoch ?? localCompareEpoch;
  const effectiveCompareEpoch =
    passes.length >= 2
      ? Math.max(0, Math.min(maxEpochIdx, rawCompareEpoch === effectiveBaseEpoch ? (effectiveBaseEpoch === 0 ? maxEpochIdx : 0) : rawCompareEpoch))
      : 0;

  const mjdDeltaDays = useMemo(() => {
    const mA = passes[effectiveBaseEpoch]?.mjd;
    const mB = passes[effectiveCompareEpoch]?.mjd;
    if (mA === null || mA === undefined || mB === null || mB === undefined) return null;
    return mB - mA;
  }, [passes, effectiveBaseEpoch, effectiveCompareEpoch]);

  const emitTimeline = useCallback(
    (nextMode: CutoutTimelineMode, nextBase: number, nextComp: number) => {
      const clampedBase = Math.max(0, Math.min(maxEpochIdx, nextBase));
      const clampedComp = Math.max(0, Math.min(maxEpochIdx, nextComp));
      setLocalMode(nextMode);
      setLocalBaseEpoch(clampedBase);
      setLocalCompareEpoch(clampedComp);
      setBlinkShowB(false);
      const mA = passes[clampedBase]?.mjd;
      const mB = passes[clampedComp]?.mjd;
      onTimelineChange?.({
        mode: nextMode,
        baselineEpoch: clampedBase,
        compareEpoch: clampedComp,
        passes,
        mjdDeltaDays: mA !== null && mA !== undefined && mB !== null && mB !== undefined ? mB - mA : null,
      });
    },
    [maxEpochIdx, onTimelineChange, passes]
  );

  // Publish pass list whenever a new section tensor decodes
  useEffect(() => {
    if (!onTimelineChange || passes.length === 0) return;
    onTimelineChange({
      mode: effectiveMode,
      baselineEpoch: effectiveBaseEpoch,
      compareEpoch: effectiveCompareEpoch,
      passes,
      mjdDeltaDays,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passes, section?.section_id]);

  // Reset band override when switching sections
  useEffect(() => {
    setSelectedBandIdx(null);
    setBlinkShowB(false);
  }, [section?.section_id]);

  const observedBandIndices = useMemo<number[]>(() => {
    if (!entry) return [];
    const { nExpData } = entry.parsed;
    const bands = nExpData[0]?.length ?? 6;
    const out: number[] = [];
    for (let b = 0; b < Math.min(bands, THUMBNAIL_BAND_IDS.length); b++) {
      let hasObs = false;
      for (let e = 0; e < nExpData.length; e++) {
        if (getPlaneMaxNExp(nExpData[e]?.[b]) > 0) {
          hasObs = true;
          break;
        }
      }
      if (hasObs) out.push(b);
    }
    return out;
  }, [entry]);

  const displayCell = useMemo(() => {
    if (!entry) return null;
    const { parsed } = entry;
    const picked = pickObservedCell(parsed.nExpData, 4);
    const chosenBand =
      selectedBandIdx !== null && observedBandIndices.includes(selectedBandIdx)
        ? selectedBandIdx
        : picked.bandIndex;
    const chosenEpoch =
      effectiveMode === 'single'
        ? blinkShowB
          ? effectiveCompareEpoch
          : effectiveBaseEpoch
        : picked.epochIndex;
    return {
      epochIndex: chosenEpoch,
      bandIndex: chosenBand,
      bandLabel: THUMBNAIL_BAND_IDS[chosenBand] || 'D5',
    };
  }, [entry, selectedBandIdx, observedBandIndices, effectiveMode, blinkShowB, effectiveBaseEpoch, effectiveCompareEpoch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !entry || !displayCell) return;
    const { parsed } = entry;
    const { width, height, epochs, fluxData, varData, nExpData } = parsed;
    if (width <= 0 || height <= 0) return;

    const total = width * height;
    const { bandIndex } = displayCell;
    const targetPlane = new Float32Array(total);
    const covered = new Uint8Array(total);
    const samples: number[] = [];

    if (effectiveMode === 'diff' && epochs >= 2) {
      const fA = fluxData[effectiveBaseEpoch]?.[bandIndex];
      const nA = nExpData[effectiveBaseEpoch]?.[bandIndex];
      const fB = fluxData[effectiveCompareEpoch]?.[bandIndex];
      const nB = nExpData[effectiveCompareEpoch]?.[bandIndex];
      if (fA && fB) {
        for (let i = 0; i < total; i++) {
          const hasA = nA ? nA[i] > 0 : true;
          const hasB = nB ? nB[i] > 0 : true;
          const valA = fA[i];
          const valB = fB[i];
          if (hasA && hasB && Number.isFinite(valA) && Number.isFinite(valB)) {
            const diff = valB - valA;
            targetPlane[i] = diff;
            covered[i] = 1;
            samples.push(Math.abs(diff));
          }
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(width, height);
      if (samples.length > 0) {
        samples.sort((a, b) => a - b);
        const hiAbs = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.985))] ?? 1;
        const scale = Math.max(hiAbs, 1e-4);
        const asinhNorm = Math.asinh(4.0);
        for (let i = 0; i < total; i++) {
          const offset = i * 4;
          if (!covered[i]) {
            img.data[offset] = 10;
            img.data[offset + 1] = 12;
            img.data[offset + 2] = 18;
            img.data[offset + 3] = 255;
            continue;
          }
          const signed = targetPlane[i] / scale;
          const stretched = Math.sign(signed) * Math.min(1, Math.asinh(4.0 * Math.abs(signed)) / asinhNorm);
          const [r, g, b] = sampleDiffDivergingRgb(stretched);
          img.data[offset] = r;
          img.data[offset + 1] = g;
          img.data[offset + 2] = b;
          img.data[offset + 3] = 255;
        }
      } else {
        for (let i = 0; i < total; i++) {
          const offset = i * 4;
          img.data[offset] = 10;
          img.data[offset + 1] = 12;
          img.data[offset + 2] = 18;
          img.data[offset + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return;
    }

    if (effectiveMode === 'single') {
      const targetEp = blinkShowB ? effectiveCompareEpoch : effectiveBaseEpoch;
      if (targetEp >= 0 && targetEp < epochs) {
        const fPlane = fluxData[targetEp]?.[bandIndex];
        const nPlane = nExpData[targetEp]?.[bandIndex];
        if (fPlane) {
          for (let i = 0; i < total; i++) {
            const val = fPlane[i];
            const hasExp = nPlane ? nPlane[i] > 0 : true;
            if (hasExp && Number.isFinite(val)) {
              targetPlane[i] = val;
              covered[i] = 1;
              samples.push(val);
            }
          }
        }
      }
    }

    if (samples.length === 0) {
      const sumWFlux = new Float64Array(total);
      const sumW = new Float64Array(total);
      for (let e = 0; e < epochs; e++) {
        const fPlane = fluxData[e]?.[bandIndex];
        const vPlane = varData[e]?.[bandIndex];
        const nPlane = nExpData[e]?.[bandIndex];
        if (!fPlane) continue;
        for (let i = 0; i < total; i++) {
          const f = fPlane[i];
          const hasExp = nPlane ? nPlane[i] > 0 : true;
          if (!hasExp || !Number.isFinite(f)) continue;
          const v = vPlane?.[i] ?? 1;
          const w = Number.isFinite(v) && v > 0 ? 1 / Math.max(v, 1e-8) : 1;
          sumWFlux[i] += f * w;
          sumW[i] += w;
        }
      }
      for (let i = 0; i < total; i++) {
        if (sumW[i] > 0) {
          const val = sumWFlux[i] / sumW[i];
          targetPlane[i] = val;
          covered[i] = 1;
          if (Number.isFinite(val)) samples.push(val);
        }
      }
    }

    if (samples.length === 0) return;
    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor(samples.length * 0.05)] ?? 0;
    const hi = samples[Math.floor(samples.length * 0.992)] ?? lo + 1;
    const scale = Math.max(hi - lo, 1e-4);
    const asinhNorm = Math.asinh(4.0);

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < total; i++) {
      const offset = i * 4;
      if (!covered[i]) {
        img.data[offset] = 10;
        img.data[offset + 1] = 12;
        img.data[offset + 2] = 18;
        img.data[offset + 3] = 255;
        continue;
      }
      const normalized = Math.max(0, (targetPlane[i] - lo) / scale);
      const stretched = Math.min(1, Math.asinh(4.0 * normalized) / asinhNorm);
      const [r, g, b] = sampleThumbnailPaletteRgb(stretched, colorPalette);
      img.data[offset] = r;
      img.data[offset + 1] = g;
      img.data[offset + 2] = b;
      img.data[offset + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [
    entry,
    displayCell,
    effectiveMode,
    effectiveBaseEpoch,
    effectiveCompareEpoch,
    blinkShowB,
    colorPalette,
    section?.section_id,
  ]);

  const width = entry?.parsed.width ?? section?.width ?? 48;
  const height = entry?.parsed.height ?? section?.height ?? 48;
  const activePixel = dragPixel ?? probePixel;
  const cx = Math.max(0, Math.min(width - 1, activePixel.x));
  const cy = Math.max(0, Math.min(height - 1, activePixel.y));

  const pixelToSkyCoord = useCallback(
    (px: number, py: number): { ra: number; dec: number } => {
      let raOut = section?.ra ?? fallbackRa;
      let decOut = section?.dec ?? fallbackDec;
      const wcs = entry?.parsed.wcs;
      if (wcs) {
        const crpixX = wcs.crpix?.[0] ?? width / 2;
        const crpixY = wcs.crpix?.[1] ?? height / 2;
        const cdeltRa = wcs.cdelt?.[0] ?? -((section?.fov_arcsec ?? fallbackFovArcsec) / 3600) / width;
        const cdeltDec = wcs.cdelt?.[1] ?? ((section?.fov_arcsec ?? fallbackFovArcsec) / 3600) / height;
        const cosDec = Math.max(0.1, Math.cos((wcs.crval[1] * Math.PI) / 180));
        raOut = wcs.crval[0] + ((px - crpixX) * cdeltRa) / cosDec;
        decOut = wcs.crval[1] + (py - crpixY) * cdeltDec;
      } else {
        const degPerPx = ((section?.fov_arcsec ?? fallbackFovArcsec) / 3600) / Math.max(width, 1);
        const cosDec = Math.max(0.1, Math.cos((decOut * Math.PI) / 180));
        raOut = raOut - ((px - width / 2) * degPerPx) / cosDec;
        decOut = decOut + (py - height / 2) * degPerPx;
      }
      return { ra: raOut, dec: decOut };
    },
    [entry, section, width, height, fallbackRa, fallbackDec, fallbackFovArcsec]
  );

  const clientPointToPixel = useCallback(
    (clientX: number, clientY: number, rect: DOMRect): { px: number; py: number } => {
      const fracX = Math.max(0, Math.min(0.9999, (clientX - rect.left) / Math.max(rect.width, 1)));
      const fracY = Math.max(0, Math.min(0.9999, (clientY - rect.top) / Math.max(rect.height, 1)));
      return {
        px: Math.floor(fracX * width),
        py: Math.floor(fracY * height),
      };
    },
    [width, height]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      draggingRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const { px, py } = clientPointToPixel(e.clientX, e.clientY, rect);
      setDragPixel({ x: px, y: py });
    },
    [clientPointToPixel]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const { px, py } = clientPointToPixel(e.clientX, e.clientY, rect);
      setDragPixel({ x: px, y: py });
    },
    [clientPointToPixel]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setDragPixel(null);
        return;
      }
      const { px, py } = clientPointToPixel(e.clientX, e.clientY, rect);
      setDragPixel(null);
      onSelectPixel(px, py, pixelToSkyCoord(px, py));
    },
    [clientPointToPixel, onSelectPixel, pixelToSkyCoord]
  );

  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-200">
            Interactive Sky Cutout
          </div>
          <div className="text-[10px] text-neutral-400">
            {caption || 'Click or drag any star or pixel to sample its spectrum'}
          </div>
        </div>
        <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
          {displayCell?.bandLabel || 'D5'} · ({cx},{cy})
        </span>
      </div>

      {section ? (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            draggingRef.current = false;
            setDragPixel(null);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              const nx = Math.max(0, cx - 1);
              onSelectPixel(nx, cy, pixelToSkyCoord(nx, cy));
            }
            if (e.key === 'ArrowRight') {
              const nx = Math.min(width - 1, cx + 1);
              onSelectPixel(nx, cy, pixelToSkyCoord(nx, cy));
            }
            if (e.key === 'ArrowUp') {
              const ny = Math.max(0, cy - 1);
              onSelectPixel(cx, ny, pixelToSkyCoord(cx, ny));
            }
            if (e.key === 'ArrowDown') {
              const ny = Math.min(height - 1, cy + 1);
              onSelectPixel(cx, ny, pixelToSkyCoord(cx, ny));
            }
          }}
          aria-label="Interactive sky cutout pixel selector"
          className="relative aspect-square w-full max-w-[260px] mx-auto cursor-crosshair overflow-hidden rounded-lg border border-white/15 bg-black touch-none select-none"
        >
          <canvas
            ref={canvasRef}
            className="h-full w-full block"
            style={{ imageRendering: 'pixelated' }}
          />
          {loading && !entry && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-[11px] font-mono text-neutral-300">
              Decoding Float32 cutout…
            </div>
          )}
          {loadFailed && !loading && !entry && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-3 text-center"
            >
              <span className="text-[11px] font-medium text-amber-300">
                Cutout image missing on server
              </span>
              <span className="text-[10px] text-neutral-400">
                Re-download this cutout to view the sky image and probe individual pixels.
              </span>
              {onReinstall && (
                <button
                  type="button"
                  onClick={() => onReinstall(section)}
                  className="rounded-md border border-sky-400/50 bg-sky-500/20 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-500/30 cursor-pointer"
                >
                  Re-download Cutout
                </button>
              )}
            </div>
          )}
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {showApertureOverlay && (
              <>
                <circle
                  cx={cx + 0.5}
                  cy={cy + 0.5}
                  r={annulusOuterPx}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={0.45}
                  strokeDasharray="1.1 0.8"
                  opacity={0.9}
                />
                <circle
                  cx={cx + 0.5}
                  cy={cy + 0.5}
                  r={annulusInnerPx}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={0.45}
                  strokeDasharray="1.1 0.8"
                  opacity={0.7}
                />
                <circle
                  cx={cx + 0.5}
                  cy={cy + 0.5}
                  r={apertureRadiusPx}
                  fill="rgba(16, 185, 129, 0.14)"
                  stroke="#34d399"
                  strokeWidth={0.55}
                />
              </>
            )}
            <line
              x1={0}
              y1={cy + 0.5}
              x2={Math.max(0, cx - 2)}
              y2={cy + 0.5}
              stroke="#38bdf8"
              strokeWidth={0.35}
              opacity={0.75}
            />
            <line
              x1={Math.min(width, cx + 3)}
              y1={cy + 0.5}
              x2={width}
              y2={cy + 0.5}
              stroke="#38bdf8"
              strokeWidth={0.35}
              opacity={0.75}
            />
            <line
              x1={cx + 0.5}
              y1={0}
              x2={cx + 0.5}
              y2={Math.max(0, cy - 2)}
              stroke="#38bdf8"
              strokeWidth={0.35}
              opacity={0.75}
            />
            <line
              x1={cx + 0.5}
              y1={Math.min(height, cy + 3)}
              x2={cx + 0.5}
              y2={height}
              stroke="#38bdf8"
              strokeWidth={0.35}
              opacity={0.75}
            />
            <circle
              cx={cx + 0.5}
              cy={cy + 0.5}
              r={0.85}
              fill="none"
              stroke="#ffffff"
              strokeWidth={0.35}
            />
          </svg>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/15 bg-black/40 p-3 text-center text-[11px] text-neutral-400">
          Viewing live archive coordinate ({fallbackRa.toFixed(3)}°, {fallbackDec >= 0 ? '+' : ''}
          {fallbackDec.toFixed(3)}°). Select or install a cutout to click spatial pixels directly.
        </div>
      )}

      {section && entry && passes.length >= 2 && (
        <div className="mt-2.5 space-y-2 border-t border-white/10 pt-2.5">
          {/* 3-way view mode: All Dates | Single Date | Compare (B - A) */}
          <div
            className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/40 p-0.5"
            role="group"
            aria-label="Cutout timeline view mode"
          >
            {(
              [
                { id: 'coadd', label: 'All Dates' },
                { id: 'single', label: 'Single Date' },
                { id: 'diff', label: 'Diff (B − A)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => emitTimeline(opt.id, effectiveBaseEpoch, effectiveCompareEpoch)}
                aria-pressed={effectiveMode === opt.id}
                className={`rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors cursor-pointer ${
                  effectiveMode === opt.id
                    ? opt.id === 'diff'
                      ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50'
                      : 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Single-pass picker + quick Blink A<->B */}
          {effectiveMode === 'single' && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1">
                {passes.map((p) => {
                  const activeEp = blinkShowB ? effectiveCompareEpoch : effectiveBaseEpoch;
                  const isActive = activeEp === p.epochIndex;
                  return (
                    <button
                      key={p.epochIndex}
                      type="button"
                      onClick={() => emitTimeline('single', p.epochIndex, effectiveCompareEpoch)}
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors cursor-pointer ${
                        isActive
                          ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                          : 'border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white'
                      }`}
                      title={`${p.label} · ${p.dateLabel}${p.mjd !== null ? ` (MJD ${p.mjd.toFixed(1)})` : ''}`}
                    >
                      P{p.epochIndex + 1} · {p.dateLabel}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setBlinkShowB((b) => !b)}
                className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-neutral-200 hover:bg-white/[0.08] cursor-pointer"
              >
                Blink: Showing P{(blinkShowB ? effectiveCompareEpoch : effectiveBaseEpoch) + 1} (flip to P{(blinkShowB ? effectiveBaseEpoch : effectiveCompareEpoch) + 1})
              </button>
            </div>
          )}

          {/* Pass A vs Pass B comparison selectors */}
          {effectiveMode === 'diff' && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">
                  <span className="block text-[9px] uppercase tracking-wide text-neutral-400">
                    Pass A (Earlier)
                  </span>
                  <select
                    value={effectiveBaseEpoch}
                    onChange={(e) => {
                      const nextBase = Number(e.target.value);
                      const nextComp =
                        nextBase === effectiveCompareEpoch
                          ? passes.find((p) => p.epochIndex !== nextBase)?.epochIndex ?? 0
                          : effectiveCompareEpoch;
                      emitTimeline('diff', nextBase, nextComp);
                    }}
                    className="mt-0.5 w-full rounded-md border border-white/15 bg-neutral-950 px-1.5 py-1 font-mono text-[10px] text-neutral-100"
                  >
                    {passes.map((p) => (
                      <option key={p.epochIndex} value={p.epochIndex}>
                        P{p.epochIndex + 1} · {p.dateLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[9px] uppercase tracking-wide text-sky-300">
                    Pass B (Compare)
                  </span>
                  <select
                    value={effectiveCompareEpoch}
                    onChange={(e) => {
                      const nextComp = Number(e.target.value);
                      const nextBase =
                        nextComp === effectiveBaseEpoch
                          ? passes.find((p) => p.epochIndex !== nextComp)?.epochIndex ?? 0
                          : effectiveBaseEpoch;
                      emitTimeline('diff', nextBase, nextComp);
                    }}
                    className="mt-0.5 w-full rounded-md border border-sky-500/35 bg-neutral-950 px-1.5 py-1 font-mono text-[10px] text-sky-100"
                  >
                    {passes.map((p) => (
                      <option key={p.epochIndex} value={p.epochIndex}>
                        P{p.epochIndex + 1} · {p.dateLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center justify-between gap-2 text-[9px] text-neutral-400">
                <span>
                  <span className="text-sky-300">Blue</span> = dimmer / left ·{' '}
                  <span className="text-amber-300">Orange</span> = brighter / arrived
                </span>
                {mjdDeltaDays !== null && (
                  <span className="shrink-0 font-mono text-neutral-300">
                    Δt {mjdDeltaDays >= 0 ? '+' : ''}
                    {Math.round(mjdDeltaDays)}d
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Wavelength-matched band selector (D1-D6) */}
          {observedBandIndices.length > 1 && (
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[9px] uppercase tracking-wide text-neutral-500">Band:</span>
              <div className="flex flex-wrap items-center gap-1">
                {observedBandIndices.map((bIdx) => {
                  const isSel = displayCell?.bandIndex === bIdx;
                  return (
                    <button
                      key={bIdx}
                      type="button"
                      onClick={() => setSelectedBandIdx(bIdx)}
                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50'
                          : 'bg-white/[0.04] text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {THUMBNAIL_BAND_IDS[bIdx]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {showApertureOverlay && section && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-neutral-400">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full border border-emerald-400 bg-emerald-500/30" />
            Star Aperture ({apertureRadiusPx.toFixed(1)} px)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full border border-dashed border-amber-400" />
            Sky Ring ({annulusInnerPx.toFixed(1)}–{annulusOuterPx.toFixed(1)} px)
          </span>
        </div>
      )}
    </div>
  );
};

export default CutoutProbeMinimap;
