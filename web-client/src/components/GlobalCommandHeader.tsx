import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { queryClient } from '../App';

export interface BenchmarkPill {
  id: string;
  name: string;
  label: string;
  ra: number;
  dec: number;
  preset?: 'brown_dwarf' | 'true_nir' | 'water_ice' | 'comet_outgassing' | 'custom';
  description: string;
  category?: 'SPHEREx Verification' | 'Deep Field' | 'Galactic / Nebular' | 'Extragalactic';
}

/**
 * Reference Calibration Targets (SPECIFICATION.md §1.1, §4.0)
 * Exported for search resolution and calibration verification across workspaces.
 */
export const MANDATORY_BENCHMARKS: BenchmarkPill[] = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    label: "Barnard's Star",
    ra: 269.44639,
    dec: 4.76676,
    preset: 'true_nir',
    description: 'M4V high proper motion (+10.39"/yr North, 1.68 px/yr)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    label: 'WISE 0855',
    ra: 133.73712,
    dec: -7.24038,
    preset: 'brown_dwarf',
    description: 'Y4 sub-brown dwarf (8.15"/yr West, thermal peak in D5/D6)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi B',
    label: 'Epsilon Indi B',
    ra: 331.09566,
    dec: -56.80031,
    preset: 'brown_dwarf',
    description: 'T1+T6 binary (4.68"/yr SE, 1/cos(dec) astrometric test)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'rw_aur',
    name: 'RW Aurigae',
    label: 'RW Aurigae',
    ra: 76.95647,
    dec: 30.4013,
    preset: 'comet_outgassing',
    description: 'T Tauri variable (>1.5 mag optical/NIR occultation dimming)',
    category: 'SPHEREx Verification',
  },
  {
    id: 'r_dra',
    name: 'R Draconis',
    label: 'R Draconis',
    ra: 248.16773,
    dec: 66.75504,
    preset: 'water_ice',
    description: 'Mira AGB variable (245d pulsation cycle, NEP deep field)',
    category: 'SPHEREx Verification',
  },
];

/**
 * Extended Astronomical Catalog for Instant Local Name Resolution
 * Complements CDS Sesame (SIMBAD/NED/VizieR) and backend /api/resolve.
 */
export const SEARCHABLE_SKY_CATALOG: BenchmarkPill[] = [
  ...MANDATORY_BENCHMARKS,
  {
    id: 'nep_tdf',
    name: 'SPHEREx / JWST NEP Deep Field',
    label: 'NEP Deep Field',
    ra: 260.7,
    dec: 65.8,
    preset: 'true_nir',
    description: 'North Ecliptic Pole calibration zone (>50 SPHEREx passes/yr)',
    category: 'Deep Field',
  },
  {
    id: 'sep_df',
    name: 'SPHEREx SEP Deep Field (LMC Adjacent)',
    label: 'SEP Deep Field',
    ra: 90.0,
    dec: -66.5607,
    preset: 'water_ice',
    description: 'South Ecliptic Pole deep coverage zone (~100 deg²)',
    category: 'Deep Field',
  },
  {
    id: 'm42_orion',
    name: 'Orion Nebula (M42 / Trapezium)',
    label: 'M42 Orion',
    ra: 83.82208,
    dec: -5.39111,
    preset: 'water_ice',
    description: 'Massive star-forming region; strong H2O/CO2 3.0–4.27 µm ice absorption',
    category: 'Galactic / Nebular',
  },
  {
    id: 'trappist1',
    name: 'TRAPPIST-1 (2MASS J23062928-0502285)',
    label: 'TRAPPIST-1',
    ra: 346.62233,
    dec: -5.04144,
    preset: 'brown_dwarf',
    description: 'M8V ultra-cool dwarf exoplanet host (1.10"/yr proper motion)',
    category: 'Galactic / Nebular',
  },
  {
    id: 'm31_core',
    name: 'Andromeda Galaxy (M31 / NGC 224)',
    label: 'M31 Andromeda',
    ra: 10.68471,
    dec: 41.26875,
    preset: 'true_nir',
    description: 'Local Group giant spiral; 220,000 ly disk with dust lanes and satellite dwarf galaxies',
    category: 'Extragalactic',
  },
  {
    id: 'm51_whirlpool',
    name: 'Whirlpool Galaxy (M51 / NGC 5194)',
    label: 'M51 Whirlpool',
    ra: 202.46958,
    dec: 47.19528,
    preset: 'true_nir',
    description: 'Grand-design face-on spiral galaxy interacting with dwarf galaxy NGC 5195',
    category: 'Extragalactic',
  },
  {
    id: 'm82_cigar',
    name: 'Cigar Galaxy (M82 / NGC 3034)',
    label: 'M82 Cigar',
    ra: 148.96846,
    dec: 69.6797,
    preset: 'water_ice',
    description: 'Prototypical starburst galaxy; superwind bipolar outflows and intense infrared PAH emission',
    category: 'Extragalactic',
  },
  {
    id: 'm87_virgo',
    name: 'Virgo A (M87 / NGC 4486)',
    label: 'M87 Virgo A',
    ra: 187.70593,
    dec: 12.39112,
    preset: 'true_nir',
    description: 'Supergiant elliptical galaxy in Virgo cluster; host of 6.5B M☉ supermassive black hole and relativistic jet',
    category: 'Extragalactic',
  },
  {
    id: 'ngc253_sculptor',
    name: 'Sculptor Galaxy (NGC 253 / Silver Coin)',
    label: 'NGC 253 Sculptor',
    ra: 11.88806,
    dec: -25.28822,
    preset: 'water_ice',
    description: 'Nearby starburst intermediate spiral; heavy interstellar dust lanes and nuclear star cluster',
    category: 'Extragalactic',
  },
  {
    id: 'm101_pinwheel',
    name: 'Pinwheel Galaxy (M101 / NGC 5457)',
    label: 'M101 Pinwheel',
    ra: 210.80227,
    dec: 54.34895,
    preset: 'true_nir',
    description: 'Face-on grand spiral galaxy; prominent HII starburst regions and pristine spiral structure',
    category: 'Extragalactic',
  },
  {
    id: 'cdfs',
    name: 'Chandra Deep Field South (GOODS-S)',
    label: 'CDFS / GOODS-S',
    ra: 53.1225,
    dec: -27.805,
    preset: 'true_nir',
    description: 'Extragalactic deep survey field (z = 0.5–4.0 galaxy spectrophotometry)',
    category: 'Extragalactic',
  },
  {
    id: 'vega',
    name: 'Vega (Alpha Lyrae / CALSPEC Standard)',
    label: 'Vega',
    ra: 279.23473,
    dec: 38.78369,
    preset: 'true_nir',
    description: 'A0V primary spectrophotometric zero-point standard',
    category: 'Galactic / Nebular',
  },
];

const TABS = [
  { id: 'navigator', label: '1. Sky & Spectral Search' },
  { id: 'comparator', label: '2. Time-Domain' },
  { id: 'spectral', label: '3. Spectral Lab' },
  { id: 'ice', label: '4. Ice Studio' },
  { id: 'discussions', label: '5. Discussions' },
];

/**
 * Client-Side Coordinate & Sexagesimal Parser
 * Handles:
 * - Decimal: "133.73712, -7.24038" or "133.73712 -7.24038"
 * - Sexagesimal: "08h54m56.91s -07d14m25.4s" or "08:54:56.91 -07:14:25.4"
 */
export function parseCoordinateInput(input: string): { ra: number; dec: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern 1: Sexagesimal (e.g. 08h54m56.91s -07d14m25.4s or 08:54:56.91 -07:14:25.4)
  const sexaRegex =
    /^(\d{1,2})[h:\s]\s*(\d{1,2})[m:\s]\s*(\d{1,2}(?:\.\d+)?)[s]?\s*([+-]?\d{1,2})[d°:\s]\s*(\d{1,2})[m':\s]\s*(\d{1,2}(?:\.\d+)?)[s"]?$/i;
  const sexaMatch = trimmed.match(sexaRegex);
  if (sexaMatch) {
    const rh = parseFloat(sexaMatch[1]);
    const rm = parseFloat(sexaMatch[2]);
    const rs = parseFloat(sexaMatch[3]);
    const raDeg = (rh + rm / 60 + rs / 3600) * 15;

    const decSign = sexaMatch[4].startsWith('-') ? -1 : 1;
    const dd = Math.abs(parseFloat(sexaMatch[4]));
    const dm = parseFloat(sexaMatch[5]);
    const ds = parseFloat(sexaMatch[6]);
    const decDeg = decSign * (dd + dm / 60 + ds / 3600);

    if (raDeg >= 0 && raDeg <= 360 && decDeg >= -90 && decDeg <= 90) {
      return { ra: parseFloat(raDeg.toFixed(6)), dec: parseFloat(decDeg.toFixed(6)) };
    }
  }

  // Pattern 2: Decimal (e.g. 133.73712, -7.24038 or 133.73712 -7.24038)
  const decimalRegex = /^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/;
  const decMatch = trimmed.match(decimalRegex);
  if (decMatch) {
    const ra = parseFloat(decMatch[1]);
    const dec = parseFloat(decMatch[2]);
    if (ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90) {
      return { ra: parseFloat(ra.toFixed(6)), dec: parseFloat(dec.toFixed(6)) };
    }
  }

  return null;
}

interface GlobalCommandHeaderProps {
  onOpenCommandPalette?: () => void;
}

export const GlobalCommandHeader: React.FC<GlobalCommandHeaderProps> = ({
  onOpenCommandPalette,
}) => {
  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    sourceBadge,
    totalEpochs,
    setCoordinates,
    setRgbPreset,
  } = useTelemetryStore();

  const { tab, setTab, setRa, setDec, setPreset } = useSpectraUrlState();

  const [searchInput, setSearchInput] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isBackendLive, setIsBackendLive] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Backend Health Ping (/api/health/live)
  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health/live', { method: 'GET' });
        if (active) setIsBackendLive(res.ok);
      } catch {
        if (active) setIsBackendLive(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Compute 14 Bytes/Pixel Payload Gauge (SPECIFICATION.md §6.2.4)
  const payloadMb = useMemo(() => {
    const nEpochs = Math.max(1, totalEpochs || 4);
    const nPixelsPerBand = Math.pow(fovArcsec / 6.2, 2);
    const totalBytes = nEpochs * 6 * nPixelsPerBand * 14;
    return totalBytes / 1e6;
  }, [fovArcsec, totalEpochs]);

  // Filter local catalog suggestions as user types
  const filteredCatalog = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return SEARCHABLE_SKY_CATALOG;
    const normQ = q.replace(/[-'\s]/g, '');
    return SEARCHABLE_SKY_CATALOG.filter(
      (item) =>
        item.name.toLowerCase().replace(/[-'\s]/g, '').includes(normQ) ||
        item.description.toLowerCase().includes(q) ||
        `${item.ra.toFixed(4)} ${item.dec.toFixed(4)}`.includes(q)
    );
  }, [searchInput]);

  const applyResolvedTarget = useCallback(
    (
      targetRa: number,
      targetDec: number,
      name: string,
      badge: string,
      preset?: BenchmarkPill['preset']
    ) => {
      setCoordinates(targetRa, targetDec, name, badge);
      setRa(targetRa);
      setDec(targetDec);
      if (preset) {
        setRgbPreset(preset);
        setPreset(preset);
      }
      setSearchInput('');
      setIsSearchFocused(false);
    },
    [setCoordinates, setDec, setPreset, setRa, setRgbPreset]
  );

  // Execute Universal Coordinate or Name Resolution (ICRS Decimal, Sexagesimal, Local Catalog, Backend /api/resolve, CDS Sesame SIMBAD/NED)
  const executeSearchResolution = useCallback(
    async (rawQuery: string) => {
      const value = rawQuery.trim();
      if (!value) return;

      // 1. Direct Coordinate Parse (<1 ms)
      const parsedCoords = parseCoordinateInput(value);
      if (parsedCoords) {
        const matched = MANDATORY_BENCHMARKS.find(
          (b) =>
            Math.abs(b.ra - parsedCoords.ra) < 0.05 &&
            Math.abs(b.dec - parsedCoords.dec) < 0.05
        );
        applyResolvedTarget(
          parsedCoords.ra,
          parsedCoords.dec,
          matched ? matched.name : `J2000 ${parsedCoords.ra.toFixed(4)}°, ${parsedCoords.dec >= 0 ? '+' : ''}${parsedCoords.dec.toFixed(4)}°`,
          matched ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]',
          matched?.preset
        );
        return;
      }

      // 2. Local Catalog Match
      const norm = value.toLowerCase().replace(/[-'\s]/g, '');
      const catalogHit = SEARCHABLE_SKY_CATALOG.find(
        (item) =>
          item.name.toLowerCase().replace(/[-'\s]/g, '').includes(norm) ||
          item.label.toLowerCase().replace(/[-'\s]/g, '').includes(norm)
      );
      if (catalogHit) {
        const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === catalogHit.id);
        applyResolvedTarget(
          catalogHit.ra,
          catalogHit.dec,
          catalogHit.name,
          isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]',
          catalogHit.preset
        );
        return;
      }

      setIsResolving(true);
      try {
        // 3. Try Backend /api/resolve
        try {
          const res = await fetch(`/api/resolve?q=${encodeURIComponent(value)}`);
          if (res.ok) {
            const data = await res.json();
            if (typeof data.ra === 'number' && typeof data.dec === 'number') {
              applyResolvedTarget(
                data.ra,
                data.dec,
                data.target_name || value,
                data.source_badge || '[IRSA Live (spherex_qr2)]'
              );
              setIsResolving(false);
              return;
            }
          }
        } catch {
          // Proceed to CDS Sesame resolver
        }

        // 4. Try CDS Sesame (SIMBAD / NED / VizieR) Universal Astronomical Name Resolver
        const sesameUrl = `https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV?${encodeURIComponent(
          value
        )}`;
        const sesameRes = await fetch(sesameUrl);
        if (sesameRes.ok) {
          const xmlText = await sesameRes.text();
          const jradegMatch = xmlText.match(/<jradeg>([+-]?\d+(?:\.\d+)?)<\/jradeg>/i);
          const jdedegMatch = xmlText.match(/<jdedeg>([+-]?\d+(?:\.\d+)?)<\/jdedeg>/i);
          const onameMatch = xmlText.match(/<oname>([^<]+)<\/oname>/i);
          if (jradegMatch && jdedegMatch) {
            const resolvedRa = parseFloat(jradegMatch[1]);
            const resolvedDec = parseFloat(jdedegMatch[1]);
            const resolvedName = onameMatch ? onameMatch[1].trim() : value;
            if (Number.isFinite(resolvedRa) && Number.isFinite(resolvedDec)) {
              applyResolvedTarget(
                resolvedRa,
                resolvedDec,
                resolvedName,
                '[SIMBAD / IRSA Resolved]'
              );
            }
          }
        }
      } catch {
        // Graceful fallback
      } finally {
        setIsResolving(false);
      }
    },
    [applyResolvedTarget]
  );

  const prefetchBenchmark = useCallback((name: string) => {
    queryClient.prefetchQuery({
      queryKey: ['benchmark_cache', name],
      queryFn: async () => {
        try {
          const res = await fetch(`/benchmarks/${encodeURIComponent(name)}.json`);
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      },
      staleTime: 1000 * 60 * 60,
    });
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShareFeedback('Deep link copied to clipboard!');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  const handleCopyIframe = () => {
    const embedUrl = new URL(window.location.href);
    embedUrl.searchParams.set('embed', '1');
    const iframeCode = `<iframe src="${embedUrl.toString()}" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(iframeCode);
    setShareFeedback('iFrame embed snippet copied!');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-[56px] items-center justify-between gap-3 border-b border-[#1E2530] bg-[#0F131A] px-4 font-sans text-xs text-[#E6ECF2] select-none">
      {/* 1. Brand & Archive Status */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-[#E6ECF2]">Spectra</span>
          <span className="hidden sm:inline text-[11px] text-[#94A3B8]">
            SPHEREx Spectral Archive
          </span>
        </div>

        <span className="h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />

        {/* Archive Connection Badge */}
        <div
          className="flex items-center gap-1.5 rounded-sm border border-[#1E2530] bg-[#151B24] px-2 py-0.5 text-[11px] text-[#94A3B8]"
          title={
            isBackendLive
              ? 'FastAPI science engine online (port 7860)'
              : 'Archive local tensor & catalog engine active'
          }
        >
          <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
            <circle
              cx="4"
              cy="4"
              r="3.5"
              fill={isBackendLive ? '#22C55E' : '#38BDF8'}
            />
          </svg>
          <span>{isBackendLive ? 'Live API' : 'Archive Ready'}</span>
        </div>

        {/* Data Provenance Badge */}
        <div
          className="hidden 2xl:flex items-center rounded-sm border border-[#1E2530] bg-[#151B24] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[#94A3B8]"
          title="Active dataset provenance"
        >
          {sourceBadge}
        </div>
      </div>

      {/* 2. Universal Coordinate & Object Name Resolver (SIMBAD / NED / ICRS / Catalog) */}
      <div ref={searchContainerRef} className="relative flex-1 max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSearchResolution(searchInput);
          }}
          className="relative flex items-center"
        >
          <label htmlFor="spectra-coord-search" className="sr-only">
            Search sky coordinates (J2000 decimal or sexagesimal) or astronomical object name
          </label>
          <svg
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#94A3B8]"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <input
            id="spectra-coord-search"
            type="text"
            value={searchInput}
            onFocus={() => setIsSearchFocused(true)}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setIsSearchFocused(true);
            }}
            placeholder={
              activeTargetName
                ? `${activeTargetName} (${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°) — Search RA/Dec or object...`
                : 'Search RA/Dec, HMS/DMS, or object name (SIMBAD/IRSA)...'
            }
            className="w-full rounded-sm border border-[#1E2530] bg-[#080A0F] py-1.5 pl-8 pr-16 font-mono text-xs tabular-nums text-[#E6ECF2] placeholder-[#94A3B8] transition-colors duration-150 focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#38BDF8]"
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            {isResolving && (
              <span className="px-1 font-sans text-[10px] text-[#38BDF8]">Resolving…</span>
            )}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="rounded-sm border border-[#1E2530] bg-[#151B24] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8] transition-colors duration-150 hover:border-[#38BDF8] hover:text-[#E6ECF2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              title="Open command palette (⌘K / Ctrl+K)"
              aria-label="Open command palette"
            >
              ⌘&nbsp;K
            </button>
          </div>
        </form>

        {/* Search Resolver Autocomplete & Coordinate Format Helper Popover */}
        {isSearchFocused && (
          <div className="absolute left-0 right-0 top-9 z-50 max-h-80 overflow-y-auto rounded-sm border border-[#1E2530] bg-[#0F131A] p-1.5">
            <div className="flex items-center justify-between border-b border-[#1E2530] px-2 py-1 text-[10px] text-[#94A3B8]">
              <span>Enter J2000 decimal, sexagesimal (HH:MM:SS ±DD:MM:SS), or SIMBAD object name</span>
              <span className="font-mono">↵ Enter</span>
            </div>

            {parseCoordinateInput(searchInput) && (
              <button
                type="button"
                onClick={() => executeSearchResolution(searchInput)}
                className="mt-1 flex w-full items-center justify-between rounded-sm border border-[#38BDF8]/50 bg-[#151B24] px-2.5 py-1.5 text-left text-xs text-[#E6ECF2] hover:bg-[#38BDF8]/15"
              >
                <span>Go to J2000 coordinates</span>
                <span className="font-mono text-[#38BDF8]">
                  {parseCoordinateInput(searchInput)?.ra.toFixed(5)}°,{' '}
                  {parseCoordinateInput(searchInput)?.dec.toFixed(5)}°
                </span>
              </button>
            )}

            <div className="mt-1 flex flex-col gap-0.5">
              {filteredCatalog.map((item) => {
                const isCurrent =
                  Math.abs(ra - item.ra) < 0.01 && Math.abs(dec - item.dec) < 0.01;
                const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => {
                      if (isBench) prefetchBenchmark(item.name);
                    }}
                    onClick={() =>
                      applyResolvedTarget(
                        item.ra,
                        item.dec,
                        item.name,
                        isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]',
                        item.preset
                      )
                    }
                    className={`flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors duration-150 ${
                      isCurrent
                        ? 'bg-[#151B24] text-[#E6ECF2]'
                        : 'text-[#94A3B8] hover:bg-[#151B24] hover:text-[#E6ECF2]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-[#E6ECF2]">{item.name}</span>
                        {item.category && (
                          <span className="rounded-sm border border-[#1E2530] bg-[#080A0F] px-1 py-0.2 text-[10px] text-[#94A3B8]">
                            {item.category}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-[#94A3B8]">
                        {item.description}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#38BDF8]">
                      {item.ra.toFixed(3)}° {item.dec >= 0 ? `+${item.dec.toFixed(3)}` : item.dec.toFixed(3)}°
                    </span>
                  </button>
                );
              })}

              {searchInput.trim().length > 1 && !parseCoordinateInput(searchInput) && (
                <button
                  type="button"
                  onClick={() => executeSearchResolution(searchInput)}
                  className="mt-1 flex w-full items-center justify-between rounded-sm border border-[#1E2530] bg-[#151B24] px-2.5 py-1.5 text-left text-xs text-[#E6ECF2] hover:border-[#38BDF8]"
                >
                  <span>
                    Query SIMBAD / NED / IRSA resolver for &ldquo;{searchInput.trim()}&rdquo;
                  </span>
                  <span className="font-mono text-[11px] text-[#38BDF8]">Resolve ↵</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Workspace Tab Switcher & Share */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Compact Tensor Memory Readout */}
        <div
          className={`hidden xl:flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] tabular-nums ${
            payloadMb >= 2.0
              ? 'border-[#F59E0B] bg-[#151B24] text-[#F59E0B]'
              : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8]'
          }`}
          title={`Cutout FoV: ${fovArcsec}" · Uncompressed float32 tensor payload (${
            totalEpochs || 4
          } passes × 6 bands × 14 B/px)`}
        >
          <span>{fovArcsec}&quot;</span>
          <span className="text-[#1E2530]">|</span>
          <span>{payloadMb.toFixed(2)}&nbsp;MB</span>
        </div>

        <nav
          aria-label="Workspaces"
          className="flex items-center gap-0.5 rounded-sm border border-[#1E2530] bg-[#080A0F] p-0.5"
        >
          {TABS.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative rounded-sm px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                  isActive
                    ? 'border border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                    : 'border border-transparent text-[#94A3B8] hover:text-[#E6ECF2]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Share & Embed Exporter Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsShareOpen(!isShareOpen)}
            aria-expanded={isShareOpen}
            className="rounded-sm border border-[#1E2530] bg-[#151B24] px-2.5 py-1 text-xs text-[#E6ECF2] transition-colors duration-150 hover:border-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
          >
            Share
          </button>

          {isShareOpen && (
            <div className="absolute right-0 top-9 z-50 w-64 rounded-sm border border-[#1E2530] bg-[#151B24] p-3">
              <div className="mb-2 text-xs font-medium text-[#E6ECF2]">
                Share current view state
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full rounded-sm border border-[#1E2530] bg-[#0F131A] px-2.5 py-1.5 text-left text-xs text-[#E6ECF2] transition-colors duration-150 hover:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                >
                  Copy deep link URL
                </button>
                <button
                  type="button"
                  onClick={handleCopyIframe}
                  className="w-full rounded-sm border border-[#1E2530] bg-[#0F131A] px-2.5 py-1.5 text-left text-xs text-[#E6ECF2] transition-colors duration-150 hover:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                >
                  Copy iframe embed (?embed=1)
                </button>
              </div>
              {shareFeedback && (
                <div role="status" aria-live="polite" className="mt-2 text-[11px] text-[#22C55E]">
                  {shareFeedback}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
