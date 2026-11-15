import React from 'react';
import { NasaMeatballSvg } from './GlobalCommandHeader';

interface MissionHeroProps {
  onLaunchWorkstation: () => void;
  onStartGuidedTour?: () => void;
  onSelectDiscovery?: (discoveryId: string) => void;
}

/**
 * Hero background plate: ESO VLT (FORS) view of the grand-design spiral
 * galaxy NGC 1232. Public ESO release, licensed CC BY 4.0.
 * Swap the file at `web-client/public/images/hero-galaxy.jpg` to change it.
 */
const GALAXY_BACKGROUND_SRC = '/images/hero-galaxy.jpg';

interface TwinkleStar {
  id: number;
  top: string;
  left: string;
  size: number;
  duration: number;
  delay: number;
  minOpacity: number;
  tint: string;
}

const STAR_TINTS = ['255, 255, 255', '198, 225, 255', '255, 238, 208', '216, 206, 255'];

/** Deterministic mulberry32 PRNG so the starfield is identical on every render. */
function buildStarfield(count: number, seed = 20250311): TwinkleStar[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: count }, (_, index) => ({
    id: index,
    top: `${(random() * 100).toFixed(2)}%`,
    left: `${(random() * 100).toFixed(2)}%`,
    size: 1 + random() * 2.2,
    duration: 2.6 + random() * 4.8,
    delay: random() * 6,
    minOpacity: 0.08 + random() * 0.28,
    tint: STAR_TINTS[Math.floor(random() * STAR_TINTS.length)],
  }));
}

const HERO_STARS = buildStarfield(120);

export const MissionHero: React.FC<MissionHeroProps> = ({
  onLaunchWorkstation,
  onStartGuidedTour,
}) => {
  return (
    <section
      id="mission-hero"
      className="relative isolate w-full overflow-hidden bg-[#04050b] text-white select-none border-b border-neutral-900"
    >
      {/* ----------------------------------------------------------------- */}
      {/* Deep-space background stack: rotating galaxy plate + starfield     */}
      {/* ----------------------------------------------------------------- */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Base void wash so no pure-black plate edges ever read as a box */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_65%_40%,#0a1230_0%,#05060f_55%,#000000_100%)]" />

        {/* Slowly rotating spiral galaxy (240 s per revolution) */}
        <div className="absolute left-[68%] top-[42%] -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-[78vmax] w-[78vmax]">
            <img
              src={GALAXY_BACKGROUND_SRC}
              alt=""
              aria-hidden="true"
              draggable={false}
              loading="eager"
              decoding="async"
              className="spx-galaxy-layer h-full w-full select-none object-cover opacity-90"
            />
          </div>
        </div>

        {/* Cool nebular veils drifting over the galactic core */}
        <div className="spx-nebula-veil absolute inset-0 bg-[radial-gradient(circle_at_78%_28%,rgba(40,139,255,0.20),transparent_58%)]" />
        <div className="spx-nebula-veil absolute inset-0 bg-[radial-gradient(circle_at_20%_88%,rgba(86,72,196,0.16),transparent_60%)]" />

        {/* Twinkling foreground starfield */}
        <div className="absolute inset-0">
          {HERO_STARS.map((star) => (
            <span
              key={star.id}
              className="spx-star"
              style={
                {
                  top: star.top,
                  left: star.left,
                  width: `${star.size}px`,
                  height: `${star.size}px`,
                  backgroundColor: `rgb(${star.tint})`,
                  boxShadow: `0 0 6px 1px rgba(${star.tint}, 0.7)`,
                  animationDuration: `${star.duration.toFixed(2)}s`,
                  animationDelay: `-${star.delay.toFixed(2)}s`,
                  '--spx-twinkle-min': star.minOpacity,
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        {/* Left readability scrim (keeps hero copy institutional and legible) */}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
        {/* Bottom fade into the discoveries carousel below */}
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="relative z-20 max-w-7xl mx-auto px-6 lg:px-12 pt-14 pb-12">
        {/* Top Federal & Agency Badging Strip */}
        <div className="flex flex-wrap items-center gap-3 mb-6 text-xs text-neutral-400">
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
        <div className="max-w-3xl mb-10">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white mb-4 leading-[1.05] drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
            SPHEREx
          </h1>
          <p className="text-lg sm:text-xl font-normal text-neutral-200 leading-relaxed mb-4 drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
            Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer
          </p>
          <p className="text-sm sm:text-base text-neutral-300 leading-relaxed font-light drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
            NASA’s all-sky infrared space observatory mapping more than 450 million galaxies and 100 million stars every six months in 102 colors of near-infrared light. Discover nearby moving worlds, cosmic water ice reservoirs, and the birth of the universe.
          </p>

          {/* Primary Action Button (NASA Signature Arrow-Circle CTA) */}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onLaunchWorkstation}
              className="group inline-flex items-center gap-3.5 rounded-full bg-primary hover:bg-primary/90 text-white px-6 py-3.5 text-sm font-semibold transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 cursor-pointer"
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
                className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 px-5 py-3.5 text-sm font-medium transition-colors cursor-pointer"
              >
                <span>Take Guided Tour</span>
              </button>
            )}

            <a
              href="#discoveries"
              className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/60 backdrop-blur-sm hover:bg-neutral-800 text-neutral-200 px-5 py-3.5 text-sm font-medium transition-colors"
            >
              <span>Explore Major Discoveries</span>
              <svg className="h-3.5 w-3.5 text-neutral-400" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3.5v9m0 0l3.5-3.5M8 12.5l-3.5-3.5" />
              </svg>
            </a>
          </div>
        </div>

        {/* 4-Stat Fast-Facts Bento Deck (NASA mission-single-meta standard) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-5 rounded-xl border border-neutral-800 bg-black/60 backdrop-blur-md">
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
