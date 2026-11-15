import React from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';

export type InvestigationLens = 'comparator' | 'spectral' | 'ice';

interface ActiveCaseBannerProps {
  activeLens: InvestigationLens;
  sectionLabel?: string | null;
  rightSlot?: React.ReactNode;
}

export const ActiveCaseBanner: React.FC<ActiveCaseBannerProps> = ({
  activeLens,
  sectionLabel,
  rightSlot,
}) => {
  const {
    ra,
    dec,
    activeTargetName,
    probedPixel,
    probeSkyPosition,
    activeEpochIndex,
    caseFindings,
  } = useTelemetryStore();
  const { setTab } = useSpectraUrlState();

  const targetDisplay = sectionLabel || activeTargetName || 'Custom Sky Field';
  const focusCoord = probeSkyPosition ?? { ra, dec };
  const pxLabel = probedPixel ? `px (${probedPixel.x}, ${probedPixel.y})` : 'center px';

  const trackSteps: Array<{
    id: InvestigationLens;
    badge: string;
    title: string;
    summary: string | null;
    tone: 'sky' | 'emerald';
  }> = [
    {
      id: 'comparator',
      badge: '1',
      title: 'Time-Domain',
      summary: caseFindings.timeDomainSummary || `Epoch ${activeEpochIndex} · ${pxLabel}`,
      tone: 'sky',
    },
    {
      id: 'spectral',
      badge: '2',
      title: '102-Band Spectrum',
      summary: caseFindings.spectralSummary || 'Confirm what object moved',
      tone: 'emerald',
    },
  ];

  const iceStep = {
    id: 'ice' as InvestigationLens,
    title: 'Ice Studio',
    summary: caseFindings.iceSummary || 'Separate track: cloud ice test',
  };

  const handleSwitchLens = (lens: InvestigationLens) => {
    setTab(lens);
  };

  return (
    <div
      className="border-b border-white/10 bg-neutral-950/95 px-3 sm:px-4 py-2"
      aria-label="Active sky investigation workflow"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Active Case
          </span>
          <span className="truncate text-xs font-semibold text-white max-w-[220px]">
            {targetDisplay}
          </span>
          <span className="hidden sm:inline font-mono text-[11px] text-neutral-400 tabular-nums">
            {focusCoord.ra.toFixed(4)}°, {focusCoord.dec >= 0 ? '+' : ''}
            {focusCoord.dec.toFixed(4)}° · {pxLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {trackSteps.map((step, idx) => {
            const isActive = activeLens === step.id;
            const activeClass =
              step.tone === 'emerald'
                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
                : 'border-sky-400/60 bg-sky-500/15 text-sky-100';
            return (
              <React.Fragment key={step.id}>
                {idx > 0 && (
                  <span className="hidden md:inline text-[11px] text-neutral-500 select-none" aria-hidden="true">
                    →
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleSwitchLens(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1 text-left transition-all cursor-pointer ${
                    isActive
                      ? activeClass
                      : 'border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/25 hover:bg-white/[0.07]'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-neutral-400 group-hover:text-white'
                    }`}
                  >
                    {step.badge}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[11px] font-semibold truncate">
                      {step.title}
                    </span>
                    <span className="hidden xl:block max-w-[175px] truncate text-[10px] text-neutral-400">
                      {step.summary}
                    </span>
                  </span>
                </button>
              </React.Fragment>
            );
          })}

          <span className="hidden md:inline mx-0.5 text-neutral-700 select-none" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            onClick={() => handleSwitchLens(iceStep.id)}
            aria-current={activeLens === iceStep.id ? 'step' : undefined}
            title="Independent track: map frozen water & CO₂ inside dark molecular clouds using background stars"
            className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1 text-left transition-all cursor-pointer ${
              activeLens === iceStep.id
                ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100'
                : 'border-white/10 bg-white/[0.03] text-neutral-300 hover:border-cyan-400/40 hover:bg-cyan-950/30'
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                activeLens === iceStep.id
                  ? 'bg-cyan-400/25 text-cyan-100'
                  : 'bg-white/10 text-cyan-300/80 group-hover:text-cyan-200'
              }`}
            >
              ❄
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[11px] font-semibold truncate">
                {iceStep.title}
              </span>
              <span className="hidden xl:block max-w-[175px] truncate text-[10px] text-neutral-400">
                {iceStep.summary}
              </span>
            </span>
          </button>
          {rightSlot}
        </div>
      </div>
    </div>
  );
};

export default ActiveCaseBanner;
