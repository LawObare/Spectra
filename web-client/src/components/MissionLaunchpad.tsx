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

export const MissionLaunchpad: React.FC<MissionLaunchpadProps> = ({
  onLaunchWorkstation,
  onSelectDiscovery,
  onStartGuidedTour,
}) => {
  return (
    <div className="w-full min-h-screen bg-black text-white font-sans overflow-y-auto">
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
      <footer className="w-full bg-black py-12 px-6 lg:px-12 border-t border-neutral-900 text-xs text-neutral-500">
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

        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-neutral-900 text-center text-[10px] text-neutral-600">
          This portal provides access to NASA SPHEREx All-Sky Spectral Survey data products. Built for researchers, citizen scientists, and students worldwide.
        </div>
      </footer>
    </div>
  );
};
