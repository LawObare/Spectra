import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { WALKTHROUGH_CHAPTERS } from '../config/walkthroughSteps';
import { useWalkthroughStore } from '../store/useWalkthroughStore';

interface RectBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function isElementVisible(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

function findVisibleTarget(selector: string): HTMLElement | null {
  const matches = document.querySelectorAll(selector);
  for (let i = 0; i < matches.length; i += 1) {
    const el = matches[i] as HTMLElement;
    if (isElementVisible(el)) return el;
  }
  return null;
}

function sameRect(a: RectBox | null, b: RectBox | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(val, min), max);
}

export const WalkthroughOverlay: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    isOpen,
    mode,
    steps,
    stepIndex,
    nextStep,
    prevStep,
    skipToNextChapter,
    jumpToChapter,
    dismissTour,
  } = useWalkthroughStore();

  const currentStep = steps[stepIndex];
  const isLastStep = stepIndex >= steps.length - 1;
  const cardRef = useRef<HTMLDivElement>(null);
  const scrolledStepRef = useRef<string | null>(null);

  const [targetRect, setTargetRect] = useState<RectBox | null>(null);
  const [isWaitingForAnchor, setIsWaitingForAnchor] = useState(false);
  const [cardDims, setCardDims] = useState<{ width: number; height: number }>({
    width: 372,
    height: 270,
  });
  const [viewport, setViewport] = useState<{ vw: number; vh: number }>(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1440,
    vh: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  // Load comforting yet professional Plus Jakarta Sans font once for accessible reading
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const linkId = 'spx-guide-font-link';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  // Guard: never display inside ?embed=1 iframe embeds
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const embedVal = params.get('embed');
    if (isOpen && (embedVal === '1' || embedVal === 'true')) {
      dismissTour();
    }
  }, [isOpen, location.search, dismissTour]);

  // Synchronize browser route & Explore tab with the current walkthrough card
  useEffect(() => {
    if (!isOpen || !currentStep) return;

    if (currentStep.routePrefix === '/explore') {
      const params = new URLSearchParams(location.search);
      const currentTab = params.get('tab') || 'navigator';
      const needsExplorePath = !location.pathname.startsWith('/explore');
      const needsTabSwitch = Boolean(currentStep.tab && currentTab !== currentStep.tab);

      if (needsExplorePath || needsTabSwitch) {
        if (currentStep.tab) {
          params.set('tab', currentStep.tab);
        } else if (!params.get('tab')) {
          params.set('tab', 'navigator');
        }
        params.delete('tour');
        navigate(`/explore?${params.toString()}`);
      }
      return;
    }

    if (currentStep.routePrefix === '/admin') {
      const targetRoute = currentStep.routePath || '/admin/studio';
      if (location.pathname !== targetRoute) {
        navigate(targetRoute);
      }
    }
  }, [isOpen, currentStep, location.pathname, location.search, navigate]);

  // Locate and continuously track [data-tour="..."] element across lazy renders, scroll, and resize
  const measureAnchor = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setViewport((prev) => (prev.vw === vw && prev.vh === vh ? prev : { vw, vh }));

    if (!currentStep?.targetSelector) {
      setTargetRect((prev) => (prev === null ? prev : null));
      setIsWaitingForAnchor(false);
      return true;
    }

    const el = findVisibleTarget(currentStep.targetSelector);
    if (!el) {
      return false;
    }

    if (scrolledStepRef.current !== currentStep.id) {
      scrolledStepRef.current = currentStep.id;
      const pre = el.getBoundingClientRect();
      const outOfView = pre.top < 12 || pre.bottom > vh - 12 || pre.left < 0 || pre.right > vw;
      if (outOfView) {
        try {
          el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        } catch {
          // Ignore older browsers without scrollIntoView options
        }
      }
    }

    const r = el.getBoundingClientRect();
    const nextRect: RectBox = {
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
    setTargetRect((prev) => (sameRect(prev, nextRect) ? prev : nextRect));
    setIsWaitingForAnchor(false);
    return true;
  }, [currentStep]);

  useEffect(() => {
    if (!isOpen || !currentStep) return;

    scrolledStepRef.current = null;
    setTargetRect(null);

    if (!currentStep.targetSelector) {
      setIsWaitingForAnchor(false);
      return;
    }

    setIsWaitingForAnchor(true);
    let settled = measureAnchor();

    let resizeObserver: ResizeObserver | null = null;
    const attachResizeObserver = () => {
      if (typeof ResizeObserver === 'undefined' || !currentStep.targetSelector) return;
      const el = findVisibleTarget(currentStep.targetSelector);
      if (el) {
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
          measureAnchor();
        });
        resizeObserver.observe(el);
      }
    };
    if (settled) attachResizeObserver();

    let mutationObserver: MutationObserver | null = null;
    if (!settled) {
      mutationObserver = new MutationObserver(() => {
        if (measureAnchor()) {
          settled = true;
          attachResizeObserver();
          mutationObserver?.disconnect();
        }
      });
      // Only watch childList (never attributes) while waiting for a lazy tab/drawer to mount
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    // Track brief layout settles (e.g. sidebar drawer slide-in) without spinning forever
    let rafId = 0;
    let frameCount = 0;
    const tick = () => {
      if (measureAnchor() && !settled) {
        settled = true;
        attachResizeObserver();
        mutationObserver?.disconnect();
      }
      frameCount += 1;
      if (frameCount < 20) {
        rafId = window.requestAnimationFrame(tick);
      }
    };
    rafId = window.requestAnimationFrame(tick);

    const fallbackTimer = window.setTimeout(() => {
      if (!settled && !measureAnchor()) {
        setIsWaitingForAnchor(false);
        setTargetRect(null);
        mutationObserver?.disconnect();
      }
    }, 1800);

    let scrollRaf = 0;
    const handleScrollOrResize = () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        measureAnchor();
      });
    };
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });

    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(rafId);
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, currentStep, measureAnchor]);

  // Measure actual card height/width once rendered to clamp cleanly inside viewport
  useLayoutEffect(() => {
    if (!isOpen || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setCardDims({ width: r.width, height: r.height });
    }
  }, [isOpen, stepIndex, currentStep?.id, viewport.vw, viewport.vh]);

  const handleAdvance = useCallback(() => {
    if (isLastStep && mode === 'full') {
      nextStep();
      navigate('/explore?tab=navigator');
      return;
    }
    nextStep();
  }, [isLastStep, mode, nextStep, navigate]);

  // Keyboard navigation while tour is open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);

      if (event.key === 'Escape') {
        event.preventDefault();
        dismissTour();
        return;
      }

      if (isTyping) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleAdvance();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, handleAdvance, prevStep, dismissTour]);

  const cardStyle = useMemo<React.CSSProperties>(() => {
    const { vw, vh } = viewport;
    const margin = 12;
    const gap = 14;
    const width = Math.min(416, Math.max(272, vw - margin * 2));
    const estH = cardDims.height || 300;
    const fontFamily = '"Plus Jakarta Sans", "IBM Plex Sans", system-ui, -apple-system, sans-serif';

    // Centered mode (explicit center step, missing anchor, or waiting)
    if (!targetRect || currentStep?.placement === 'center') {
      return {
        width,
        fontFamily,
        left: clamp((vw - width) / 2, margin, vw - width - margin),
        top: clamp((vh - estH) / 2, margin, vh - estH - margin),
      };
    }

    const isMobile = vw < 640;
    if (isMobile) {
      const putTop = targetRect.bottom > vh * 0.56;
      return {
        width,
        fontFamily,
        left: margin,
        top: putTop ? margin : clamp(vh - estH - margin, margin, vh - estH - margin),
      };
    }

    const candidates: Array<'bottom' | 'top' | 'right' | 'left'> = (() => {
      switch (currentStep?.placement) {
        case 'top':
          return ['top', 'bottom', 'right', 'left'];
        case 'left':
          return ['left', 'right', 'bottom', 'top'];
        case 'right':
          return ['right', 'left', 'bottom', 'top'];
        case 'bottom':
        default:
          return ['bottom', 'top', 'right', 'left'];
      }
    })();

    const computeCoords = (dir: 'bottom' | 'top' | 'right' | 'left') => {
      const cx = targetRect.left + targetRect.width / 2;
      const cy = targetRect.top + targetRect.height / 2;
      if (dir === 'bottom') {
        return {
          left: clamp(cx - width / 2, margin, vw - width - margin),
          top: targetRect.bottom + gap,
          fits: targetRect.bottom + gap + estH <= vh - margin,
        };
      }
      if (dir === 'top') {
        return {
          left: clamp(cx - width / 2, margin, vw - width - margin),
          top: targetRect.top - gap - estH,
          fits: targetRect.top - gap - estH >= margin,
        };
      }
      if (dir === 'right') {
        return {
          left: targetRect.right + gap,
          top: clamp(cy - estH / 2, margin, vh - estH - margin),
          fits: targetRect.right + gap + width <= vw - margin,
        };
      }
      return {
        left: targetRect.left - gap - width,
        top: clamp(cy - estH / 2, margin, vh - estH - margin),
        fits: targetRect.left - gap - width >= margin,
      };
    };

    for (const dir of candidates) {
      const c = computeCoords(dir);
      if (c.fits) {
        return {
          width,
          fontFamily,
          left: clamp(c.left, margin, vw - width - margin),
          top: clamp(c.top, margin, vh - estH - margin),
        };
      }
    }

    // Fallback when target fills most of the screen: anchor neatly opposite target center
    const preferTop = targetRect.bottom > vh - estH - margin * 2;
    return {
      width,
      fontFamily,
      left: clamp(targetRect.left + targetRect.width / 2 - width / 2, margin, vw - width - margin),
      top: preferTop
        ? margin
        : clamp(vh - estH - margin, margin, vh - estH - margin),
    };
  }, [viewport, targetRect, currentStep?.placement, cardDims.height]);

  if (!isOpen || !currentStep) return null;

  const pad = 8;
  const { vw, vh } = viewport;
  const cutLeft = targetRect ? Math.max(0, targetRect.left - pad) : 0;
  const cutTop = targetRect ? Math.max(0, targetRect.top - pad) : 0;
  const cutRight = targetRect ? Math.min(vw, targetRect.right + pad) : 0;
  const cutBottom = targetRect ? Math.min(vh, targetRect.bottom + pad) : 0;
  const cutW = Math.max(0, cutRight - cutLeft);
  const cutH = Math.max(0, cutBottom - cutTop);

  const chapterSteps = steps.filter((s) => s.chapterId === currentStep.chapterId);
  const chapterStepPos = Math.max(
    1,
    chapterSteps.findIndex((s) => s.id === currentStep.id) + 1
  );
  const hasMoreChapters =
    mode === 'full' &&
    steps.some((s, idx) => idx > stepIndex && s.chapterId !== currentStep.chapterId);

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-none"
      role="dialog"
      aria-modal="false"
      aria-label={`Guided walkthrough: ${currentStep.title}`}
    >
      {/* Interactive 4-quadrant scrim so spotlight interior remains clickable */}
      {targetRect && cutW > 0 && cutH > 0 ? (
        <>
          <div
            className="pointer-events-auto fixed left-0 right-0 top-0 bg-black/65"
            style={{ height: cutTop }}
          />
          <div
            className="pointer-events-auto fixed left-0 bg-black/65"
            style={{ top: cutTop, width: cutLeft, height: cutH }}
          />
          <div
            className="pointer-events-auto fixed right-0 bg-black/65"
            style={{ top: cutTop, left: cutRight, height: cutH }}
          />
          <div
            className="pointer-events-auto fixed bottom-0 left-0 right-0 bg-black/65"
            style={{ top: cutBottom }}
          />
          <div
            className="pointer-events-none fixed rounded-xl border-2 border-sky-400/90 shadow-[0_0_24px_rgba(56,189,248,0.45)]"
            style={{
              top: cutTop,
              left: cutLeft,
              width: cutW,
              height: cutH,
            }}
          />
        </>
      ) : (
        <div className="pointer-events-auto fixed inset-0 bg-black/70 backdrop-blur-[1px]" />
      )}

      {/* Walkthrough Floating Feature Card */}
      <div
        ref={cardRef}
        style={{ ...cardStyle, maxHeight: `${Math.max(240, vh - 24)}px` }}
        className="pointer-events-auto fixed z-[71] overflow-y-auto rounded-2xl border border-sky-400/40 bg-neutral-950/95 p-4 sm:p-5 text-white shadow-[0_24px_64px_rgba(0,0,0,0.88)] backdrop-blur-xl transition-[top,left] duration-150"
      >
        {/* Top Row: Chapter Badge & Dismiss */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center rounded-md border border-sky-400/35 bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-sky-200">
              {mode === 'full'
                ? `Ch ${currentStep.chapterNumber}/7 · ${currentStep.chapterLabel}`
                : currentStep.chapterLabel}
            </span>
            <span className="text-[11px] font-medium text-neutral-300 tabular-nums">
              Card {chapterStepPos} of {chapterSteps.length}
            </span>
          </div>

          <button
            type="button"
            onClick={dismissTour}
            aria-label="Close walkthrough"
            title="Close guide (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm text-neutral-300 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Full Tour Chapter Map Dots (Clickable Section Jumps) */}
        {mode === 'full' && (
          <div className="mt-2.5 flex items-center gap-1.5" aria-label="Walkthrough sections">
            {WALKTHROUGH_CHAPTERS.map((ch) => {
              const isCurrent = ch.id === currentStep.chapterId;
              const isPast = ch.number < currentStep.chapterNumber;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => jumpToChapter(ch.id)}
                  title={`Jump to Chapter ${ch.number}: ${ch.label}`}
                  className={`h-1.5 flex-1 rounded-full transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    isCurrent
                      ? 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]'
                      : isPast
                        ? 'bg-emerald-500/65 hover:bg-emerald-400'
                        : 'bg-white/15 hover:bg-white/30'
                  }`}
                />
              );
            })}
          </div>
        )}

        {/* Title & Explanation */}
        <h3 className="mt-3 text-base sm:text-[17px] font-bold leading-snug tracking-tight text-white">
          {currentStep.title}
        </h3>
        <p className="mt-2 text-[13.5px] sm:text-sm font-normal leading-[1.6] text-neutral-100">
          {currentStep.description}
        </p>

        {currentStep.tryHint && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] sm:text-[13px] leading-relaxed text-emerald-100">
            <strong className="font-semibold text-emerald-300">Why it helps:</strong> {currentStep.tryHint}
          </div>
        )}

        {isWaitingForAnchor && (
          <div className="mt-2 text-[11px] font-medium text-sky-300">
            Focusing control…
          </div>
        )}

        {/* Controls Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prevStep}
              disabled={stepIndex === 0}
              title="Go back to the previous card (Left Arrow)"
              className="min-h-[34px] rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs sm:text-[13px] font-medium text-neutral-100 hover:bg-white/[0.12] disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 transition-colors cursor-pointer"
            >
              ← Back
            </button>
            {currentStep.secondaryFinishLabel ? (
              <button
                type="button"
                onClick={dismissTour}
                title="Close the guide and stay on Explore"
                className="min-h-[34px] rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs sm:text-[13px] font-medium text-neutral-200 hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 transition-colors cursor-pointer"
              >
                {currentStep.secondaryFinishLabel}
              </button>
            ) : hasMoreChapters ? (
              <button
                type="button"
                onClick={skipToNextChapter}
                title="Jump ahead to the next workspace section"
                className="min-h-[34px] rounded-lg px-2.5 py-1.5 text-xs sm:text-[13px] font-medium text-neutral-300 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 transition-colors cursor-pointer"
              >
                Next Section ↷
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleAdvance}
            title={
              isLastStep && mode === 'full'
                ? 'Finish walkthrough and return to Explore Navigator'
                : isLastStep
                  ? 'Close guide and save progress'
                  : 'Go to the next card (Right Arrow)'
            }
            className="min-h-[34px] rounded-lg bg-primary hover:bg-primary/90 px-3.5 py-1.5 text-xs sm:text-[13px] font-semibold text-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 transition-all cursor-pointer"
          >
            {currentStep.ctaNextLabel
              ? currentStep.ctaNextLabel
              : isLastStep
                ? 'Finish Tour ✓'
                : `Next (${stepIndex + 1}/${steps.length}) →`}
          </button>
        </div>
      </div>
    </div>
  );
};
