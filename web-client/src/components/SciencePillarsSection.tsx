import React from 'react';

interface SciencePillarsSectionProps {
  onLaunchPillarWorkstation?: (pillar: 'inflation' | 'reionization' | 'ices') => void;
}

export const SciencePillarsSection: React.FC<SciencePillarsSectionProps> = ({
  onLaunchPillarWorkstation,
}) => {
  return (
    <section className="w-full py-16 px-6 lg:px-12 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-3xl mb-12">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold tracking-wider uppercase text-emerald-400">
              NASA Science Objectives
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            The Three Science Pillars of SPHEREx
          </h2>
          <p className="text-sm sm:text-base text-neutral-400 mt-2">
            SPHEREx addresses three foundational astrophysical questions by collecting 102 near-infrared colors across the entire celestial sphere.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Pillar 1: Cosmic Inflation */}
          <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-black/60 p-6 hover:border-neutral-700 transition-colors">
            <div>
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-500/10 text-blue-400 mb-4 font-mono font-bold text-sm">
                01
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Cosmic Inflation
              </h3>
              <p className="text-xs text-neutral-400 font-medium mb-3 uppercase tracking-wide">
                Origins of the Universe
              </p>
              <p className="text-sm text-neutral-300 leading-relaxed mb-4">
                In the first split-second after the Big Bang, the universe underwent rapid exponential expansion. SPHEREx maps the 3D distribution of over 450 million galaxies to measure primordial non-Gaussianity (f_NL &lt; 1) with unprecedented sensitivity, probing physics at energies unreachable by Earth-based particle colliders.
              </p>
            </div>
            {onLaunchPillarWorkstation && (
              <button
                type="button"
                onClick={() => onLaunchPillarWorkstation('inflation')}
                className="inline-flex items-center gap-2 text-xs font-semibold text-blue-400 hover:text-blue-300 pt-4 border-t border-neutral-900"
              >
                <span>Explore Galaxy Clustering in Tab 3</span>
                <span>→</span>
              </button>
            )}
          </div>

          {/* Pillar 2: Epoch of Reionization & Cosmic Infrared Background */}
          <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-black/60 p-6 hover:border-neutral-700 transition-colors">
            <div>
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-purple-500/10 text-purple-400 mb-4 font-mono font-bold text-sm">
                02
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Galaxy Evolution
              </h3>
              <p className="text-xs text-neutral-400 font-medium mb-3 uppercase tracking-wide">
                Epoch of Reionization & First Light
              </p>
              <p className="text-sm text-neutral-300 leading-relaxed mb-4">
                Hundreds of millions of years after the Big Bang, the first stars ignited and cleared the cosmic dark ages. SPHEREx measures the spatial fluctuations of the Cosmic Infrared Background (CIB) across 102 channels to separate the total light produced by the earliest stars and dwarf galaxies from local foreground emissions.
              </p>
            </div>
            {onLaunchPillarWorkstation && (
              <button
                type="button"
                onClick={() => onLaunchPillarWorkstation('reionization')}
                className="inline-flex items-center gap-2 text-xs font-semibold text-purple-400 hover:text-purple-300 pt-4 border-t border-neutral-900"
              >
                <span>Inspect Deep Fields in Tab 1</span>
                <span>→</span>
              </button>
            )}
          </div>

          {/* Pillar 3: Origins of Water & Interstellar Ice */}
          <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-black/60 p-6 hover:border-neutral-700 transition-colors">
            <div>
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-400 mb-4 font-mono font-bold text-sm">
                03
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Water & Biogenic Ices
              </h3>
              <p className="text-xs text-neutral-400 font-medium mb-3 uppercase tracking-wide">
                Origins of Water in Planetary Systems
              </p>
              <p className="text-sm text-neutral-300 leading-relaxed mb-4">
                Where does the water in oceans and planets originate? Water and prebiotic molecules form as cryogenic ice mantles on interstellar dust grains. SPHEREx measures absorption at 3.05 μm (H2O), 4.27 μm (CO2), and 4.67 μm (CO) along millions of lines of sight across the Milky Way to quantify the galactic ice reservoir.
              </p>
            </div>
            {onLaunchPillarWorkstation && (
              <button
                type="button"
                onClick={() => onLaunchPillarWorkstation('ices')}
                className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-400 hover:text-emerald-300 pt-4 border-t border-neutral-900"
              >
                <span>Calculate Ice Depth in Tab 4</span>
                <span>→</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
