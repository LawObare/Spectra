import React from 'react';
import { NasaMeatballSvg } from './GlobalCommandHeader';

interface MissionHeroProps {
  onLaunchWorkstation: () => void;
  onStartGuidedTour?: () => void;
  onSelectDiscovery?: (discoveryId: string) => void;
}

export const MissionHero: React.FC<MissionHeroProps> = ({
  onLaunchWorkstation,
  onStartGuidedTour,
}) => {
  return (
    <section
      id="mission-hero"
      className="relative w-full min-h-[calc(100svh-56px)] flex items-center text-white select-none"
    >
      <div className="relative z-20 w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-16 xl:px-20 py-20 sm:py-24 lg:py-28 flex flex-col justify-between gap-14 lg:gap-20">
        <div>
          {/* Top Federal & Agency Badging Strip */}
          <div className="flex flex-wrap items-center gap-3 mb-10 text-xs text-neutral-400">
            <div className="flex items-center gap-2">
              <NasaMeatballSvg className="h-7 w-8" />
              <span className="font-semibold text-white tracking-wide uppercase text-[11px]">
                NASA Science
              </span>
            </div>
            <span className="text-neutral-700">|</span>
            <span className="text-[11px] text-neutral-300 font-medium">
              Jet Propulsion Laboratory / Caltech
            </span>
            <span className="text-neutral-700">|</span>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Active Mission · Launched March 11, 2025</span>
            </div>
          </div>

          {/* Hero Title Block */}
          <div className="max-w-5xl">
            <h1 className="text-6xl sm:text-7xl md:text-8xl font-extrabold tracking-tight text-white mb-6 leading-[1.02] drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
              SPHEREx
            </h1>
            <p className="text-xl sm:text-2xl font-normal text-neutral-100 leading-relaxed mb-6 drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
              Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer
            </p>
            <p className="text-base sm:text-lg text-neutral-300 leading-relaxed font-light max-w-4xl drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
              NASA’s all-sky infrared space observatory mapping more than 450 million galaxies and 100 million stars every six months in 102 colors of near-infrared light. Discover nearby moving worlds, cosmic water ice reservoirs, and the birth of the universe.
            </p>

            {/* Primary Action Button (NASA Signature Arrow-Circle CTA) */}
            <div className="mt-12 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onLaunchWorkstation}
                className="group inline-flex items-center gap-3.5 rounded-full bg-primary hover:bg-primary/90 text-white px-7 py-4 text-sm font-semibold transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 cursor-pointer"
              >
                <span>Launch Interactive Sky Explorer</span>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-white/20 group-hover:bg-white text-white group-hover:text-primary transition-all">
                  <svg className="h-3.5 w-3.5 transform group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 8h9m0 0l-3.5-3.5m3.5 3.5l-3.5 3.5" />
                  </svg>
                </span>
              </button>

              {onStartGuidedTour && (
                <button
                  type="button"
                  onClick={onStartGuidedTour}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 px-6 py-4 text-sm font-medium transition-colors cursor-pointer"
                >
                  <span>Take Guided Tour</span>
                </button>
              )}

              <a
                href="#discoveries"
                className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/60 backdrop-blur-sm hover:bg-neutral-800 text-neutral-200 px-6 py-4 text-sm font-medium transition-colors"
              >
                <span>Explore Major Discoveries</span>
                <svg className="h-3.5 w-3.5 text-neutral-400" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 3.5v9m0 0l3.5-3.5M8 12.5l-3.5-3.5" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* 4-Stat Fast-Facts Bento Deck (NASA mission-single-meta standard) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 p-6 rounded-xl border border-neutral-800 bg-black/60 backdrop-blur-md">
          <div className="flex flex-col border-r border-neutral-800/80 pr-4 last:border-r-0">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-500 mb-1">
              Mission Type
            </span>
            <span className="text-base sm:text-lg font-bold text-white leading-tight">
              Space Observatory
            </span>
            <span className="text-[11px] text-neutral-400 mt-1">
              Sun-Synchronous Orbit (650 km)
            </span>
          </div>

          <div className="flex flex-col border-r border-neutral-800/80 pr-4 last:border-r-0">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-500 mb-1">
              Survey Cadence
            </span>
            <span className="text-base sm:text-lg font-bold text-white leading-tight">
              Full Sky Every 6 Mo.
            </span>
            <span className="text-[11px] text-neutral-400 mt-1">
              4 Continuous Discrete Passes
            </span>
          </div>

          <div className="flex flex-col border-r border-neutral-800/80 pr-4 last:border-r-0">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-500 mb-1">
              Spectral Coverage
            </span>
            <span className="text-base sm:text-lg font-bold text-white leading-tight">
              102 Infrared Bands
            </span>
            <span className="text-[11px] text-neutral-400 mt-1">
              0.75 – 5.00 μm (R = 41–135)
            </span>
          </div>

          <div className="flex flex-col pr-4">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-neutral-500 mb-1">
              Target Census
            </span>
            <span className="text-base sm:text-lg font-bold text-white leading-tight">
              450M Galaxies + 100M Stars
            </span>
            <span className="text-[11px] text-neutral-400 mt-1">
              Milky Way & Interstellar Ices
            </span>
          </div>
        </div>

        {/* Background plate credit (institutional attribution) */}
        <div className="mt-4 text-right text-[10px] font-mono text-neutral-600">
          Background plate: Spiral galaxy NGC 1232 — ESO/P. Grosbøl (CC BY 4.0)
        </div>
      </div>
    </section>
  );
};
