import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InstalledSection } from '../lib/installedSections';
import {
  THUMBNAIL_BAND_IDS,
  getCachedDecodedTensor,
  getSectionTensorCacheKey,
  loadInstalledSectionThumbnailTensor,
  pickObservedCell,
  type DecodedSectionEntry,
} from '../lib/sectionTensorCache';
import {
  sampleThumbnailPaletteRgb,
  type ComparatorColorPalette,
} from './InstalledCutoutsModal';

export interface CutoutProbeMinimapProps {
  section: InstalledSection | null;
  epochIndex?: number | null;
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
  showApertureOverlay?: boolean;
  apertureRadiusPx?: number;
  annulusInnerPx?: number;
  annulusOuterPx?: number;
  caption?: string;
}

export const CutoutProbeMinimap: React.FC<CutoutProbeMinimapProps> = ({
  section,
  epochIndex = null,
  colorPalette = 'standard_rgb',
  probePixel,
  fallbackRa,
  fallbackDec,
  fallbackFovArcsec = 300,
  onSelectPixel,
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

  useEffect(() => {
    if (!section || !cacheKey) {
      setEntry(null);
      setLoading(false);
      return;
    }
    const cached = getCachedDecodedTensor(cacheKey);
    if (cached) {
      setEntry(cached);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setEntry(null);
    setLoading(true);
    loadInstalledSectionThumbnailTensor(section, controller.signal)
      .then((res) => {
        if (!cancelled) {
          setEntry(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [section, cacheKey]);

  const displayCell = useMemo(() => {
    if (!entry) return null;
    const { parsed } = entry;
    const picked = pickObservedCell(parsed.nExpData, 4);
    const chosenEpoch =
      epochIndex !== null &&
      epochIndex >= 0 &&
      epochIndex < parsed.epochs &&
      parsed.fluxData[epochIndex]?.[picked.bandIndex]
        ? epochIndex
        : picked.epochIndex;
    return {
      epochIndex: chosenEpoch,
      bandIndex: picked.bandIndex,
      bandLabel: THUMBNAIL_BAND_IDS[picked.bandIndex] || 'D5',
    };
  }, [entry, epochIndex]);

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

    if (epochIndex !== null && epochIndex >= 0 && epochIndex < epochs) {
      const fPlane = fluxData[epochIndex]?.[bandIndex];
      const nPlane = nExpData[epochIndex]?.[bandIndex];
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
  }, [entry, displayCell, epochIndex, colorPalette]);

  const width = entry?.parsed.width ?? section?.width ?? 48;
  const height = entry?.parsed.height ?? section?.height ?? 48;
  const cx = Math.max(0, Math.min(width - 1, probePixel.x));
  const cy = Math.max(0, Math.min(height - 1, probePixel.y));

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const fracX = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
      const fracY = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / rect.height));
      const px = Math.floor(fracX * width);
      const py = Math.floor(fracY * height);

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
      onSelectPixel(px, py, { ra: raOut, dec: decOut });
    },
    [entry, section, width, height, fallbackRa, fallbackDec, fallbackFovArcsec, onSelectPixel]
  );

  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-200">
            Interactive Sky Cutout
          </div>
          <div className="text-[10px] text-neutral-400">
            {caption || 'Click any star or pixel to sample its spectrum'}
          </div>
        </div>
        <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
          {displayCell?.bandLabel || 'D5'} · ({cx},{cy})
        </span>
      </div>

      {section ? (
        <div
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') onSelectPixel(Math.max(0, cx - 1), cy, { ra: section.ra, dec: section.dec });
            if (e.key === 'ArrowRight') onSelectPixel(Math.min(width - 1, cx + 1), cy, { ra: section.ra, dec: section.dec });
            if (e.key === 'ArrowUp') onSelectPixel(cx, Math.max(0, cy - 1), { ra: section.ra, dec: section.dec });
            if (e.key === 'ArrowDown') onSelectPixel(cx, Math.min(height - 1, cy + 1), { ra: section.ra, dec: section.dec });
          }}
          aria-label="Interactive sky cutout pixel selector"
          className="relative aspect-square w-full max-w-[260px] mx-auto cursor-crosshair overflow-hidden rounded-lg border border-white/15 bg-black"
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
