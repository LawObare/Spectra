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

  const steps: Array<{
    id: InvestigationLens;
    stepNum: string;
    title: string;
    subtitle: string;
    summary: string | null;
    tone: 'sky' | 'emerald' | 'cyan';
  }> = [
    {
      id: 'comparator',
      stepNum: '1',
      title: 'Time-Domain',
      subtitle: 'Motion & changes',
      summary: caseFindings.timeDomainSummary || `Epoch ${activeEpochIndex} · ${pxLabel}`,
      tone: 'sky',
    },
    {
      id: 'spectral',
      stepNum: '2',
      title: '102-Band Spectrum',
      subtitle: 'What is it?',
      summary: caseFindings.spectralSummary || 'Inspect object fingerprint',
      tone: 'emerald',
    },
    {
      id: 'ice',
      stepNum: '3',
      title: 'Ice Studio',
      subtitle: 'Frozen H₂O / CO₂',
      summary: caseFindings.iceSummary || 'Measure cloud ice depth',
      tone: 'cyan',
    },
  ];

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
          {steps.map((step, idx) => {
            const isActive = activeLens === step.id;
            const activeClass =
              step.tone === 'emerald'
                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
                : step.tone === 'cyan'
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100'
                  : 'border-sky-400/60 bg-sky-500/15 text-sky-100';
            return (
              <React.Fragment key={step.id}>
                {idx > 0 && (
                  <span className="hidden md:inline text-[11px] text-neutral-600 select-none">
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
                    {step.stepNum}
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
          {rightSlot}
        </div>
      </div>
    </div>
  );
};

export default ActiveCaseBanner;
