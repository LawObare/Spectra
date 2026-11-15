import React from 'react';

export const PatternPrimer: React.FC = () => {
  return (
    <section className="w-full py-16 px-6 lg:px-12 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-3xl mb-12">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="text-xs font-semibold tracking-wider uppercase text-amber-400">
              Citizen Science Pattern Primer
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            How to Hunt the Infrared Sky
          </h2>
          <p className="text-sm sm:text-base text-neutral-400 mt-2">
            SPHEREx captures images of the entire sky every six months. Learn how to distinguish true cosmic movers from variable stars and false artifacts using our time-domain difference subtraction.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Moving Dipole */}
          <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950 p-6">
            <div>
              <div className="h-32 w-full rounded-lg bg-neutral-900/80 border border-neutral-800/80 mb-5 relative flex items-center justify-center overflow-hidden">
                {/* Visual Representation of Dipole: White Dot next to Black Dot */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_42%_50%,rgba(255,255,255,0.9)_0%,transparent_18%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_50%,rgba(0,0,0,1)_0%,transparent_18%)]" />
                <div className="absolute bottom-2 left-3 text-[10px] font-mono text-neutral-400">
                  Signed Diff (Epoch N − Epoch 0)
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold uppercase tracking-wider mb-2">
                Discovery Target
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                1. Moving Dipole (Movers)
              </h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                When an asteroid or nearby brown dwarf shifts between passes, subtracting the baseline image leaves a pair of adjacent bright and dark spots called a <strong>dipole</strong>. Stationary background stars vanish completely.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-neutral-900 text-[11px] text-neutral-400">
              Targets: Asteroids, Comets, Nearby Stars, Brown Dwarfs
            </div>
          </div>

          {/* Card 2: Pulsing Monopole */}
          <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950 p-6">
            <div>
              <div className="h-32 w-full rounded-lg bg-neutral-900/80 border border-neutral-800/80 mb-5 relative flex items-center justify-center overflow-hidden">
                {/* Visual Representation of Pulsing Monopole: Concentric White Glow without position shift */}
                <div className="h-8 w-8 rounded-full bg-white/90 shadow-[0_0_24px_rgba(255,255,255,0.8)] animate-pulse" />
                <div className="absolute bottom-2 left-3 text-[10px] font-mono text-neutral-400">
                  Stationary Monopole
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-semibold uppercase tracking-wider mb-2">
                Astrophysical Variable
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                2. Pulsing Monopole (Variables)
              </h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                A single stationary bright or dark spot without a partner. The star does not move in space, but pulsates or dims due to stellar evolution, occulting dust clouds, or accretion flares (e.g. RW Aurigae, Mira giants).
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-neutral-900 text-[11px] text-neutral-400">
              Targets: Cepheids, Mira AGBs, T Tauri infant stars, Supernovae
            </div>
          </div>

          {/* Card 3: False Positives */}
          <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950 p-6">
            <div>
              <div className="h-32 w-full rounded-lg bg-neutral-900/80 border border-neutral-800/80 mb-5 relative flex items-center justify-center overflow-hidden">
                {/* Visual Representation of Diffraction Cross & Glitch */}
                <svg className="h-16 w-16 stroke-amber-500/70" viewBox="0 0 100 100" fill="none">
                  <line x1="50" y1="10" x2="50" y2="90" strokeWidth="1.5" />
                  <line x1="10" y1="50" x2="90" y2="50" strokeWidth="1.5" />
                  <circle cx="50" cy="50" r="10" strokeWidth="1" strokeDasharray="3,3" />
                </svg>
                <div className="absolute bottom-2 left-3 text-[10px] font-mono text-neutral-400">
                  Optical Artifact / Glitch
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-semibold uppercase tracking-wider mb-2">
                Artifact Filter
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                3. Glitches & False Positives
              </h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                Over-saturated bright stars create cross-shaped diffraction spikes, optical ghost reflections, or charge bleeding. Check the 32-bit FLAGS mask and multi-band confirmation to reject cosmic ray hits.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-neutral-900 text-[11px] text-neutral-400">
              Signs: Multi-pixel spikes, unphysical shapes, single-band hits
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
