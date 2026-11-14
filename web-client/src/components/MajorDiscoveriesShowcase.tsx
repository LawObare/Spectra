import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAJOR_DISCOVERIES, MajorDiscovery } from './MajorDiscoveriesData';

interface MajorDiscoveriesShowcaseProps {
  onSelectTarget: (discovery: MajorDiscovery) => void;
}

type CategoryFilter = 'all' | 'nearby_worlds' | 'water_ices' | 'deep_fields' | 'galaxies' | 'variables';

const CAROUSEL_GAP_PX = 24;

export const MajorDiscoveriesShowcase: React.FC<MajorDiscoveriesShowcaseProps> = ({
  onSelectTarget,
}) => {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredDiscoveries = useMemo(() => {
    return MAJOR_DISCOVERIES.filter((item) => {
      const matchesCategory =
        activeCategory === 'all' || item.category === activeCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        (item.codename && item.codename.toLowerCase().includes(q)) ||
        item.narrative.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, searchQuery]);

  /* ------------------------------------------------------------------ */
  /* Swipeable carousel state — native horizontal scroll + snap          */
  /* ------------------------------------------------------------------ */
  const viewportRef = useRef<HTMLDivElement>(null);
  const firstCardRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ x: number; scrollLeft: number; pointerId: number; moved: boolean } | null>(
    null,
  );
  const suppressClickRef = useRef(false);

  const [cardStep, setCardStep] = useState(0);
  const [perView, setPerView] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const maxIndex = Math.max(0, filteredDiscoveries.length - perView);

  /* Measure one card + gap so paging works at every breakpoint. */
  useEffect(() => {
    const measure = () => {
      const card = firstCardRef.current;
      const viewport = viewportRef.current;
      if (!card || !viewport) return;
      const step = card.getBoundingClientRect().width + CAROUSEL_GAP_PX;
      const visible = viewport.getBoundingClientRect().width;
      setCardStep(step);
      setPerView(Math.max(1, Math.round(visible / step)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [filteredDiscoveries.length]);

  /** Move the native scroller to an absolute card index. */
  const goTo = useCallback(
    (nextIndex: number, behavior: ScrollBehavior = 'smooth') => {
      const viewport = viewportRef.current;
      const clamped = Math.min(Math.max(nextIndex, 0), maxIndex);
      setActiveIndex(clamped);
      if (viewport && cardStep > 0) {
        viewport.scrollTo({ left: clamped * cardStep, behavior });
      }
    },
    [cardStep, maxIndex],
  );

  /* Keep the index in range when filters/search change the result set. */
  useEffect(() => {
    setActiveIndex((current) => {
      const clamped = Math.min(current, maxIndex);
      if (viewportRef.current && cardStep > 0) {
        viewportRef.current.scrollTo({ left: clamped * cardStep, behavior: 'auto' });
      }
      return clamped;
    });
  }, [maxIndex, cardStep]);

  /** Keep the counter/progress in sync with real scroll position. */
  const syncIndexFromScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || cardStep <= 0) return;
    const next = Math.round(viewport.scrollLeft / cardStep);
    setActiveIndex(Math.min(Math.max(next, 0), maxIndex));
  }, [cardStep, maxIndex]);

  /**
   * Horizontal wheel / trackpad two-finger swipe pages exactly one card.
   * Native wheel scrolling gets snapped back by scroll-snap-mandatory for
   * small deltas, so we intercept horizontal gestures and drive goTo().
   * Vertical wheel is never intercepted — page scrolling keeps working.
   */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let lockUntil = 0;

    const onWheel = (event: WheelEvent) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) return;
      event.preventDefault();
      const delta = horizontal ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 2) return;
      const now = Date.now();
      if (now < lockUntil) return;
      lockUntil = now + 420;
      goTo(activeIndex + (delta > 0 ? 1 : -1));
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [activeIndex, goTo]);

  /* Mouse-only drag-to-scroll (touch/trackpad use the native scroller). */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragStateRef.current = {
      x: event.clientX,
      scrollLeft: viewport.scrollLeft,
      pointerId: event.pointerId,
      moved: false,
    };
    setIsDragging(true);
    viewport.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    viewport.scrollLeft = drag.scrollLeft - dx;
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport) return;
    dragStateRef.current = null;
    setIsDragging(false);

    if (viewport.hasPointerCapture(drag.pointerId)) {
      viewport.releasePointerCapture(drag.pointerId);
    }

    if (drag.moved) {
      // Swallow the click that would otherwise fire on the card CTA.
      suppressClickRef.current = true;
      const snapped = Math.round(viewport.scrollLeft / (cardStep || 1));
      goTo(snapped);
    }
  };

  const handleCardClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    }
  };

  const categories: Array<{ id: CategoryFilter; label: string; count: number }> = [
    { id: 'all', label: 'All Major Discoveries', count: MAJOR_DISCOVERIES.length },
    {
      id: 'nearby_worlds',
      label: 'Nearby Worlds (Motion)',
      count: MAJOR_DISCOVERIES.filter((d) => d.category === 'nearby_worlds').length,
    },
    {
      id: 'water_ices',
      label: 'Water & Biogenic Ices',
      count: MAJOR_DISCOVERIES.filter((d) => d.category === 'water_ices').length,
    },
    {
      id: 'deep_fields',
      label: 'Cosmic Inflation & Deep Fields',
      count: MAJOR_DISCOVERIES.filter((d) => d.category === 'deep_fields').length,
    },
    {
      id: 'galaxies',
      label: 'Galaxies & Structures',
      count: MAJOR_DISCOVERIES.filter((d) => d.category === 'galaxies').length,
    },
    {
      id: 'variables',
      label: 'Stellar Variables',
      count: MAJOR_DISCOVERIES.filter((d) => d.category === 'variables').length,
    },
  ];

  const progress = maxIndex === 0 ? 100 : ((activeIndex + 1) / (maxIndex + 1)) * 100;
  const pageLabel = String(activeIndex + 1).padStart(2, '0');
  const totalLabel = String(maxIndex + 1).padStart(2, '0');

  return (
    <section id="discoveries" className="w-full bg-black py-16 px-6 lg:px-12 text-white border-b border-neutral-900">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="text-xs font-semibold tracking-wider uppercase text-primary">
                Scientific Exploration Library
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Major Astronomical Discoveries
            </h2>
            <p className="text-sm sm:text-base text-neutral-400 mt-2 max-w-2xl">
              Explore key benchmark systems, nearby cold sub-stellar worlds, interstellar ice reservoirs, and deep cosmological structures observed across SPHEREx’s 102 infrared bands.
            </p>
          </div>

          {/* Local Filter Search Input */}
          <div className="w-full md:w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name, object, or property..."
              className="w-full rounded-full border border-neutral-800 bg-neutral-950 px-4 py-2 text-xs text-white placeholder-neutral-500 focus:border-primary focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Category Pill Filters + Carousel Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8 border-b border-neutral-900 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setActiveIndex(0);
                  }}
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-white text-black font-semibold shadow-sm'
                      : 'border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-white hover:border-neutral-700'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                      isActive ? 'bg-neutral-200 text-black' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 self-end md:self-auto">
            <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
              {pageLabel} / {totalLabel}
            </span>
            <button
              type="button"
              aria-label="Previous discovery"
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:border-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 3.5L5.5 8l4.5 4.5" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Next discovery"
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex >= maxIndex}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-300 transition-colors hover:border-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.5L10.5 8 6 12.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Swipeable Carousel */}
        {filteredDiscoveries.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-10 text-center text-sm text-neutral-400">
            No discoveries match this filter. Try another category or clear the search.
          </div>
        ) : (
          <div
            ref={viewportRef}
            role="region"
            aria-roledescription="carousel"
            aria-label="Major astronomical discoveries"
            tabIndex={0}
            onScroll={syncIndexFromScroll}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                goTo(activeIndex + 1);
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                goTo(activeIndex - 1);
              }
            }}
            className="spx-carousel-viewport flex select-none overflow-x-auto overflow-y-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 cursor-grab active:cursor-grabbing"
            style={{ gap: `${CAROUSEL_GAP_PX}px`, scrollSnapType: isDragging ? 'none' : 'x mandatory' }}
            onClickCapture={handleCardClickCapture}
          >
              {filteredDiscoveries.map((discovery, cardIndex) => (
                <div
                  key={discovery.id}
                  ref={cardIndex === 0 ? firstCardRef : undefined}
                  className="flex-shrink-0 snap-start basis-full sm:basis-[calc(50%-12px)] lg:basis-[calc(33.333%-16px)]"
                >
                  <div className="group relative flex h-full flex-col rounded-xl border border-neutral-800/80 bg-neutral-950 transition-all duration-200 hover:border-neutral-700 hover:shadow-xl hover:shadow-black/50 overflow-hidden">
                    {/* Card Hero Image */}
                    <div className="relative h-40 w-full overflow-hidden bg-neutral-900">
                      <img
                        src={discovery.imageSrc}
                        alt={`${discovery.name} — ${discovery.title}`}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="h-full w-full select-none object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/25 to-transparent" />
                      <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] font-mono text-white/45">
                        {discovery.imageCredit}
                      </span>
                    </div>

                    {/* Card Body */}
                    <div className="flex flex-1 flex-col justify-between p-5">
                    {/* Top Meta Strip */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="inline-flex items-center rounded-full bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase text-neutral-300">
                          {discovery.categoryLabel}
                        </span>
                        {discovery.isMandatoryBenchmark && (
                          <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                            NASA Benchmark
                          </span>
                        )}
                      </div>

                      {/* Target Name & Narrative Title */}
                      <h3 className="text-lg font-bold text-white group-hover:text-primary transition-colors flex items-baseline gap-2">
                        <span>{discovery.name}</span>
                        {discovery.codename && (
                          <span className="text-[11px] font-mono font-normal text-neutral-500">
                            ({discovery.codename})
                          </span>
                        )}
                      </h3>
                      <div className="text-xs font-medium text-primary/90 mt-0.5 mb-2">
                        {discovery.title}
                      </div>

                      {/* Narrative Hook */}
                      <p className="text-xs text-neutral-300 line-clamp-3 leading-relaxed mb-4">
                        {discovery.narrative}
                      </p>

                      {/* Astrophysics Metric Chips */}
                      <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-neutral-900/60 border border-neutral-800/60 text-[11px] mb-4">
                        {discovery.distanceLightYears && (
                          <div>
                            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">
                              Distance
                            </span>
                            <span className="font-mono text-white text-[11px] font-medium">
                              {discovery.distanceLightYears}
                            </span>
                          </div>
                        )}
                        {discovery.spectralType && (
                          <div>
                            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">
                              Spectral Type
                            </span>
                            <span className="text-neutral-200 text-[11px] truncate block font-medium">
                              {discovery.spectralType}
                            </span>
                          </div>
                        )}
                        {discovery.motionRate && (
                          <div className="col-span-2">
                            <span className="text-neutral-500 block text-[10px] uppercase font-semibold">
                              Astrometric Motion
                            </span>
                            <span className="font-mono text-emerald-400 text-[11px]">
                              {discovery.motionRate}
                            </span>
                          </div>
                        )}
                        <div className="col-span-2">
                          <span className="text-neutral-500 block text-[10px] uppercase font-semibold">
                            SPHEREx Coverage
                          </span>
                          <span className="text-neutral-300 text-[11px]">
                            {discovery.spectralBands}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action Button */}
                    <div className="pt-2 border-t border-neutral-900 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-neutral-500">
                        {discovery.ra.toFixed(2)}°, {discovery.dec >= 0 ? '+' : ''}{discovery.dec.toFixed(2)}°
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectTarget(discovery)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 hover:bg-primary border border-neutral-700 hover:border-primary px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:text-white transition-all cursor-pointer"
                      >
                        <span>{discovery.launchLabel}</span>
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 8h9m0 0l-3.5-3.5m3.5 3.5l-3.5 3.5" />
                        </svg>
                      </button>
                    </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Swipe affordance + progress rail */}
        {filteredDiscoveries.length > 0 && (
          <div className="mt-6 flex items-center gap-4">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-neutral-900">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-neutral-500">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 3.5L6 8l4.5 4.5" />
              </svg>
              Swipe to explore
              <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 3.5L10 8l-4.5 4.5" />
              </svg>
            </span>
          </div>
        )}
      </div>
    </section>
  );
};
