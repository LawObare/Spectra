import React, { useState, useMemo } from 'react';
import { MAJOR_DISCOVERIES, MajorDiscovery } from './MajorDiscoveriesData';

interface MajorDiscoveriesShowcaseProps {
  onSelectTarget: (discovery: MajorDiscovery) => void;
}

type CategoryFilter = 'all' | 'nearby_worlds' | 'water_ices' | 'deep_fields' | 'galaxies' | 'variables';

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

        {/* Category Pill Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-8 border-b border-neutral-900 pb-4">
          {categories.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
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

        {/* Discoveries Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDiscoveries.map((discovery) => (
            <div
              key={discovery.id}
              className="group relative flex flex-col justify-between rounded-xl border border-neutral-800/80 bg-neutral-950 p-5 transition-all duration-200 hover:border-neutral-700 hover:shadow-xl hover:shadow-black/50"
            >
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
          ))}
        </div>
      </div>
    </section>
  );
};
