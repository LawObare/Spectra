import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatSectionBytes, type InstalledSection } from '../lib/installedSections';
import {
  THUMBNAIL_BAND_IDS,
  getCachedDecodedTensor,
  getSectionTensorCacheKey,
  loadInstalledSectionThumbnailTensor,
  pickObservedCell,
  type DecodedSectionEntry,
} from '../lib/sectionTensorCache';

export type ComparatorColorPalette =
  | 'standard_rgb'
  | 'viridis'
  | 'cividis'
  | 'inverted_grayscale';

const CARDS_PER_BATCH = 24;

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

export function sampleThumbnailPaletteRgb(
  val: number,
  palette: ComparatorColorPalette
): [number, number, number] {
  const c = clamp01(val);
  if (palette === 'viridis') {
    const c1 = c * c;
    const c2 = c1 * c;
    const c3 = c2 * c;
    const r = clamp01(0.2777 - 0.1055 * c + 3.3044 * c1 - 4.6341 * c2 + 2.1582 * c3);
    const g = clamp01(0.0054 + 1.4046 * c - 1.1062 * c1 + 0.4435 * c2 + 0.2526 * c3);
    const b = clamp01(0.3340 + 1.3845 * c - 3.2504 * c1 + 4.3168 * c2 - 1.7850 * c3);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  if (palette === 'cividis') {
    const c1 = c * c;
    const c2 = c1 * c;
    const r = clamp01(-0.0189 + 0.7736 * c + 0.7107 * c1 - 0.4654 * c2);
    const g = clamp01(0.1345 + 0.4474 * c + 0.7077 * c1 - 0.2896 * c2);
    const b = clamp01(0.3013 + 0.6974 * c - 0.5054 * c1 + 0.5067 * c2);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  if (palette === 'inverted_grayscale') {
    const g = Math.round((1 - c) * 255);
    return [g, g, g];
  }
  const g = Math.round(c * 255);
  return [g, g, g];
}

export const InstalledSectionThumbnailCanvas: React.FC<{
  section: InstalledSection;
  colorPalette?: ComparatorColorPalette;
  className?: string;
  showReticle?: boolean;
  showOverlayBadge?: boolean;
}> = React.memo(
  ({
    section,
    colorPalette = 'standard_rgb',
    className = 'h-16 w-16',
    showReticle = true,
    showOverlayBadge = true,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cacheKey = getSectionTensorCacheKey(section);
    const [isVisible, setIsVisible] = useState<boolean>(
      () => Boolean(getCachedDecodedTensor(cacheKey)) || typeof IntersectionObserver === 'undefined'
    );
    const [entry, setEntry] = useState<DecodedSectionEntry | null>(
      () => getCachedDecodedTensor(cacheKey)
    );
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      if (isVisible) return;
      const node = containerRef.current;
      if (!node || typeof IntersectionObserver === 'undefined') {
        setIsVisible(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setIsVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: '120px' }
      );
      observer.observe(node);
      return () => observer.disconnect();
    }, [isVisible]);

    useEffect(() => {
      const syncHit = getCachedDecodedTensor(cacheKey);
      if (syncHit) {
        setEntry(syncHit);
        setFailed(false);
        return;
      }
      if (!isVisible) return;
      const abortController = new AbortController();
      let cancelled = false;
      setEntry(null);
      setFailed(false);
      loadInstalledSectionThumbnailTensor(section, abortController.signal)
        .then((res) => {
          if (cancelled) return;
          if (res) setEntry(res);
          else setFailed(true);
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setFailed(true);
        });
      return () => {
        cancelled = true;
        abortController.abort();
      };
    }, [cacheKey, section, isVisible]);

    const previewBandInfo = useMemo(() => {
      if (!entry) return null;
      const { parsed } = entry;
      const picked = pickObservedCell(parsed.nExpData, 4);
      const bandLabel = THUMBNAIL_BAND_IDS[picked.bandIndex] || 'D5';
      return { ...picked, bandLabel };
    }, [entry]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !entry || !previewBandInfo) return;
      const { parsed } = entry;
      const { width, height, epochs, fluxData, varData, nExpData } = parsed;
      if (width <= 0 || height <= 0) return;

      const total = width * height;
      const { epochIndex, bandIndex } = previewBandInfo;
      const coaddFlux = new Float32Array(total);
      const covered = new Uint8Array(total);
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

      const samples: number[] = [];
      let anyCovered = false;
      for (let i = 0; i < total; i++) {
        if (sumW[i] > 0) {
          const val = sumWFlux[i] / sumW[i];
          coaddFlux[i] = val;
          covered[i] = 1;
          anyCovered = true;
          if (Number.isFinite(val)) samples.push(val);
        }
      }

      if (!anyCovered) {
        const fallbackPlane = fluxData[epochIndex]?.[bandIndex];
        if (fallbackPlane) {
          for (let i = 0; i < total; i++) {
            const val = fallbackPlane[i];
            if (Number.isFinite(val)) {
              coaddFlux[i] = val;
              covered[i] = 1;
              samples.push(val);
            }
          }
        }
      }

      let low = 0;
      let high = 1;
      if (samples.length > 0) {
        samples.sort((a, b) => a - b);
        low = samples[Math.floor(samples.length * 0.05)];
        high = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.995))];
        if (high <= low) high = low + 1;
      }
      const span = Math.max(high - low, 1e-6);
      const safeA = 0.08;
      const asinhDenom = Math.asinh(1 / safeA);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imgData = ctx.createImageData(width, height);
      const data = imgData.data;

      for (let i = 0; i < total; i++) {
        const out = i * 4;
        if (!covered[i]) {
          data[out] = 8;
          data[out + 1] = 10;
          data[out + 2] = 15;
          data[out + 3] = 255;
          continue;
        }
        const norm = (coaddFlux[i] - low) / span;
        const stretched = clamp01(Math.asinh(norm / safeA) / asinhDenom);
        const [r, g, b] = sampleThumbnailPaletteRgb(stretched, colorPalette);
        data[out] = r;
        data[out + 1] = g;
        data[out + 2] = b;
        data[out + 3] = 255;
      }

      ctx.putImageData(imgData, 0, 0);
    }, [entry, previewBandInfo, colorPalette]);

    return (
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-lg border border-slate-700/80 bg-slate-950 ${className}`}
      >
        {entry ? (
          <canvas
            ref={canvasRef}
            width={entry.parsed.width}
            height={entry.parsed.height}
            className="block h-full w-full object-cover"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : failed ? (
          <div className="flex h-full w-full items-center justify-center font-mono text-[9px] text-slate-500">
            N/A
          </div>
        ) : (
          <div className="flex h-full w-full animate-pulse items-center justify-center bg-slate-900/90 font-mono text-[9px] text-slate-500">
            …
          </div>
        )}

        {showReticle && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 opacity-75">
            <span className="absolute left-0 top-0 h-1.5 w-1.5 border-l border-t border-cyan-300" />
            <span className="absolute right-0 top-0 h-1.5 w-1.5 border-r border-t border-cyan-300" />
            <span className="absolute bottom-0 left-0 h-1.5 w-1.5 border-b border-l border-cyan-300" />
            <span className="absolute bottom-0 right-0 h-1.5 w-1.5 border-b border-r border-cyan-300" />
          </div>
        )}

        {showOverlayBadge && previewBandInfo && (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[8px] leading-none text-cyan-300">
            {previewBandInfo.bandLabel}
          </span>
        )}
      </div>
    );
  }
);

export const InstalledSectionPreviewCard: React.FC<{
  section: InstalledSection;
  colorPalette: ComparatorColorPalette;
  isActive?: boolean;
  isCurrentComparator?: boolean;
  compact?: boolean;
  onSelect: (section: InstalledSection) => void;
}> = React.memo(
  ({
    section,
    colorPalette,
    isActive = false,
    isCurrentComparator = false,
    compact = false,
    onSelect,
  }) => {
    return (
      <button
        type="button"
        onClick={() => onSelect(section)}
        aria-pressed={isActive}
        className={`group flex w-full items-center gap-3 rounded-lg border text-left transition-colors cursor-pointer ${
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
        } ${
          isActive
            ? 'border-emerald-500/70 bg-emerald-950/35 ring-1 ring-emerald-500/30'
            : 'border-slate-800 bg-slate-900/80 hover:border-emerald-500/60 hover:bg-slate-800/80'
        }`}
      >
        <InstalledSectionThumbnailCanvas
          section={section}
          colorPalette={colorPalette}
          className={compact ? 'h-14 w-14 shrink-0' : 'h-16 w-16 sm:h-20 sm:w-20 shrink-0'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="truncate text-xs font-semibold text-white group-hover:text-emerald-200">
              {section.label}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isCurrentComparator && !isActive && (
                <span className="rounded border border-sky-400/50 bg-sky-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-sky-300">
                  Time-Domain
                </span>
              )}
              {isActive ? (
                <span className="rounded border border-emerald-400/50 bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-emerald-300">
                  Active
                </span>
              ) : (
                !compact && (
                  <span className="rounded border border-emerald-500/40 bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                    {formatSectionBytes(section.size_bytes)}
                  </span>
                )
              )}
            </div>
          </div>
          <div className="mt-1 font-mono text-[10px] text-slate-400">
            {compact
              ? `${section.ra.toFixed(2)}°, ${section.dec >= 0 ? '+' : ''}${section.dec.toFixed(2)}°`
              : `${section.ra.toFixed(4)}°, ${section.dec >= 0 ? '+' : ''}${section.dec.toFixed(4)}°`}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-500">
            {section.epochs} ep · {Math.round(section.fov_arcsec)}″
          </div>
        </div>
      </button>
    );
  }
);

export const UseCurrentSelectedButton: React.FC<{
  section: InstalledSection;
  isActive: boolean;
  colorPalette?: ComparatorColorPalette;
  onSelect: (section: InstalledSection) => void;
}> = React.memo(({ section, isActive, colorPalette = 'standard_rgb', onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(section)}
    title={`Use Time-Domain current selected cutout: ${section.label} (${section.ra.toFixed(4)}°, ${section.dec >= 0 ? '+' : ''}${section.dec.toFixed(4)}°)`}
    className={`inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-lg border pl-1 pr-2.5 text-xs font-medium transition-all cursor-pointer ${
      isActive
        ? 'border-emerald-400/60 bg-emerald-950/60 text-emerald-200 ring-1 ring-emerald-400/25'
        : 'border-sky-400/50 bg-sky-950/50 text-sky-100 hover:border-sky-400/80 hover:bg-sky-900/50'
    }`}
  >
    <InstalledSectionThumbnailCanvas
      section={section}
      colorPalette={colorPalette}
      showReticle={false}
      showOverlayBadge={false}
      className="h-5 w-5 shrink-0 rounded"
    />
    <span className="truncate">
      {isActive ? `Current: ${section.label}` : `Use Current: ${section.label}`}
    </span>
  </button>
));

export const InstalledCutoutsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  sections: InstalledSection[];
  activeSectionId: string | null;
  currentComparatorSectionId?: string | null;
  colorPalette: ComparatorColorPalette;
  subtitle?: string;
  onSelect: (section: InstalledSection) => void;
}> = React.memo(
  ({
    isOpen,
    onClose,
    sections,
    activeSectionId,
    currentComparatorSectionId = null,
    colorPalette,
    subtitle = 'Preview calibrated SPHEREx cutout stamps and select one to open.',
    onSelect,
  }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(CARDS_PER_BATCH);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!isOpen) return;
      setSearchQuery('');
      setVisibleCount(CARDS_PER_BATCH);
      const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.clearTimeout(focusTimer);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [isOpen, onClose]);

    useEffect(() => {
      setVisibleCount(CARDS_PER_BATCH);
    }, [searchQuery]);

    const filteredSections = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return sections;
      return sections.filter((sec) => {
        const raStr = sec.ra.toFixed(4);
        const decStr = `${sec.dec >= 0 ? '+' : ''}${sec.dec.toFixed(4)}`;
        return (
          sec.label.toLowerCase().includes(q) ||
          sec.section_id.toLowerCase().includes(q) ||
          sec.source_badge.toLowerCase().includes(q) ||
          raStr.includes(q) ||
          decStr.includes(q) ||
          sec.dec.toFixed(4).includes(q)
        );
      });
    }, [sections, searchQuery]);

    const visibleSections = useMemo(
      () => filteredSections.slice(0, visibleCount),
      [filteredSections, visibleCount]
    );
    const hasMore = visibleSections.length < filteredSections.length;

    useEffect(() => {
      if (!isOpen || !hasMore) return;
      const sentinel = loadMoreSentinelRef.current;
      if (!sentinel || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setVisibleCount((prev) => Math.min(filteredSections.length, prev + CARDS_PER_BATCH));
          }
        },
        { rootMargin: '160px' }
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [isOpen, hasMore, filteredSections.length]);

    if (!isOpen) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="installed-cutouts-modal-title"
        onClick={onClose}
      >
        <div
          className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-slate-950 text-slate-100 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950 px-5 py-3.5">
            <div>
              <h2 id="installed-cutouts-modal-title" className="text-sm font-semibold text-white">
                Browse Installed Cutouts ({sections.length})
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close installed cutouts browser"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-base text-slate-300 hover:border-neutral-700 hover:text-white cursor-pointer"
            >
              ×
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800/80 bg-slate-900/60 px-5 py-3">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search installed cutouts by name, ID, or RA/Dec…"
              aria-label="Search installed cutouts by name, ID, or RA/Dec"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 hover:text-white cursor-pointer"
              >
                Clear
              </button>
            )}
            <span className="font-mono text-[11px] text-slate-400">
              Showing {visibleSections.length} of {filteredSections.length}
              {filteredSections.length !== sections.length ? ` (${sections.length} total)` : ''}
            </span>
          </div>

          <div className="max-h-[65vh] overflow-y-auto p-4">
            {sections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                No cutout sections are installed yet. Use Sky Navigator or &ldquo;Install &amp; Load Section Here&rdquo; to install a region.
              </div>
            ) : filteredSections.length === 0 && !searchQuery.trim() ? (
              <div className="rounded-xl border border-dashed border-neutral-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                No cutouts in this filter yet — switch to &ldquo;All sources&rdquo; or install a sky region.
              </div>
            ) : filteredSections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                No installed cutouts matched &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {visibleSections.map((sec) => (
                    <InstalledSectionPreviewCard
                      key={sec.section_id}
                      section={sec}
                      colorPalette={colorPalette}
                      isActive={activeSectionId === sec.section_id}
                      isCurrentComparator={currentComparatorSectionId === sec.section_id}
                      onSelect={(selected) => {
                        onSelect(selected);
                        onClose();
                      }}
                    />
                  ))}
                </div>
                {hasMore && (
                  <div ref={loadMoreSentinelRef} className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleCount((prev) =>
                          Math.min(filteredSections.length, prev + CARDS_PER_BATCH)
                        )
                      }
                      className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:border-emerald-500/60 hover:text-white cursor-pointer"
                    >
                      Load more ({filteredSections.length - visibleSections.length} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);
