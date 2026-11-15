import React from 'react';
import { MissionHero } from './MissionHero';
import { MajorDiscoveriesShowcase } from './MajorDiscoveriesShowcase';
import { SciencePillarsSection } from './SciencePillarsSection';
import { PatternPrimer } from './PatternPrimer';
import { MajorDiscovery } from './MajorDiscoveriesData';
import { NasaMeatballSvg } from './GlobalCommandHeader';

interface MissionLaunchpadProps {
  onLaunchWorkstation: (tab?: string) => void;
  onSelectDiscovery: (discovery: MajorDiscovery) => void;
  onStartGuidedTour?: () => void;
}

/**
 * Full-page background plate: ESO VLT (FORS) view of the grand-design spiral
 * galaxy NGC 1232. Public ESO release, licensed CC BY 4.0.
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

const LAUNCHPAD_STARS = buildStarfield(140);

export const MissionLaunchpad: React.FC<MissionLaunchpadProps> = ({
  onLaunchWorkstation,
  onSelectDiscovery,
  onStartGuidedTour,
}) => {
  return (
    <div className="relative isolate w-full min-h-screen bg-[#04050b] text-white font-sans overflow-y-auto">
      {/* Full-page deep-space background stack: rotating galaxy plate + starfield */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_65%_40%,#0a1230_0%,#05060f_55%,#000000_100%)]" />

        {/* Slowly rotating spiral galaxy (240 s per revolution) */}
        <div className="absolute left-[62%] top-[46%] -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-[95vmax] w-[95vmax]">
            <img
              src={GALAXY_BACKGROUND_SRC}
              alt=""
              aria-hidden="true"
              draggable={false}
              loading="eager"
              decoding="async"
              className="spx-galaxy-layer h-full w-full select-none object-cover opacity-85"
            />
          </div>
        </div>

        {/* Cool nebular veils drifting over the galactic core */}
        <div className="spx-nebula-veil absolute inset-0 bg-[radial-gradient(circle_at_78%_28%,rgba(40,139,255,0.20),transparent_58%)]" />
        <div className="spx-nebula-veil absolute inset-0 bg-[radial-gradient(circle_at_20%_88%,rgba(86,72,196,0.16),transparent_60%)]" />

        {/* Twinkling foreground starfield */}
        <div className="absolute inset-0">
          {LAUNCHPAD_STARS.map((star) => (
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

        {/* Readability scrim across the full landing page */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/25" />
      </div>

      <div className="relative z-10">
      {/* 1. Official NASA Mission Hero Banner */}
      <MissionHero
        onLaunchWorkstation={() => onLaunchWorkstation('navigator')}
        onStartGuidedTour={onStartGuidedTour}
      />

      {/* 2. Major Discoveries Library (Production Grade) */}
      <MajorDiscoveriesShowcase
        onSelectTarget={(discovery) => onSelectDiscovery(discovery)}
      />

      {/* 3. The 3 Science Pillars of SPHEREx */}
      <SciencePillarsSection
        onLaunchPillarWorkstation={(pillar) => {
          if (pillar === 'inflation') onLaunchWorkstation('spectral');
          else if (pillar === 'reionization') onLaunchWorkstation('navigator');
          else onLaunchWorkstation('ice');
        }}
      />

      {/* 4. Citizen Science Discovery Pattern Primer */}
      <PatternPrimer />

      {/* 5. Production NASA Footer */}
      <footer className="w-full py-12 px-6 lg:px-12 text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <NasaMeatballSvg className="h-8 w-9" />
            <div className="flex flex-col">
              <span className="font-semibold text-white tracking-wider text-xs">
                National Aeronautics and Space Administration
              </span>
              <span className="text-[11px] text-neutral-400">
                NASA Science Mission Directorate · Astrophysics Division
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-[11px]">
            <a
              href="https://science.nasa.gov/mission/spherex/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              NASA SPHEREx Mission
            </a>
            <a
              href="https://spherex.caltech.edu/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Caltech Science Center
            </a>
            <a
              href="https://irsa.ipac.caltech.edu/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              NASA/IPAC Infrared Science Archive (IRSA)
            </a>
            <button
              type="button"
              onClick={() => onLaunchWorkstation('navigator')}
              className="text-primary hover:underline font-medium"
            >
              Launch Sky Explorer →
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-neutral-900/80 text-center text-[10px] text-neutral-600">
          This portal provides access to NASA SPHEREx All-Sky Spectral Survey data products. Built for researchers, citizen scientists, and students worldwide.
        </div>
      </footer>
      </div>
    </div>
  );
};
