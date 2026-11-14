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
}

export const MANDATORY_BENCHMARKS: BenchmarkPill[] = [
  {
    id: 'barnard',
    name: "Barnard's Star",
    label: "Barnard's Star",
    ra: 269.44639,
    dec: 4.76676,
    preset: 'true_nir',
    description: 'M4V high proper motion (+10.39"/yr North)',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    label: 'WISE 0855',
    ra: 133.73712,
    dec: -7.24038,
    preset: 'brown_dwarf',
    description: 'Y4 brown dwarf (8.15"/yr West, faint <3.5um)',
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi B',
    label: 'Epsilon Indi B',
    ra: 331.09566,
    dec: -56.80031,
    preset: 'brown_dwarf',
    description: 'T1+T6 unresolved binary (4.68"/yr SE, 1/cos(dec) corrected)',
  },
  {
    id: 'rw_aur',
    name: 'RW Aurigae',
    label: 'RW Aurigae',
    ra: 76.95647,
    dec: 30.40130,
    preset: 'comet_outgassing',
    description: 'T Tauri variable flashing monopole (>1.5 mag dimming)',
  },
  {
    id: 'r_dra',
    name: 'R Draconis',
    label: 'R Draconis',
    ra: 248.16773,
    dec: 66.75504,
    preset: 'water_ice',
    description: 'Mira AGB pulsing monopole (245d cycle, NEP deep field)',
  },
];

const FOV_PRESETS = [60, 120, 180, 300, 600];

const TABS = [
  { id: 'navigator', label: '1. Navigator' },
  { id: 'comparator', label: '2. Comparator' },
  { id: 'spectral', label: '3. Spectral Lab' },
  { id: 'ice', label: '4. Ice Studio' },
  { id: 'discussions', label: '5. Discussions', badge: 2 },
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
    /^(\d{1,2})[h:]\s*(\d{1,2})[m:]\s*(\d{1,2}(?:\.\d+)?)[s]?\s*([+-]?\d{1,2})[d:]\s*(\d{1,2})[m:]\s*(\d{1,2}(?:\.\d+)?)[s]?$/i;
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

    return { ra: parseFloat(raDeg.toFixed(6)), dec: parseFloat(decDeg.toFixed(6)) };
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
    setFov,
  } = useTelemetryStore();

  const { tab, setTab, setRa, setDec, setFov: setUrlFov } = useSpectraUrlState();

  const [searchInput, setSearchInput] = useState('');
  const [isBackendLive, setIsBackendLive] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Backend Health Ping (Checks /api/health/live)
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
  // Payload (MB) = N_epochs * 6 bands * (FoV / 6.2)^2 * 14 B / 10^6
  const payloadMb = useMemo(() => {
    const nEpochs = Math.max(1, totalEpochs || 3);
    const nPixelsPerBand = Math.pow(fovArcsec / 6.2, 2);
    const totalBytes = nEpochs * 6 * nPixelsPerBand * 14;
    return totalBytes / 1e6;
  }, [fovArcsec, totalEpochs]);

  // Handle Search Input Change with 350 ms Debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      if (!value.trim()) return;

      // 1. Try local coordinate parser first (<1 ms)
      const parsedCoords = parseCoordinateInput(value);
      if (parsedCoords) {
        setCoordinates(parsedCoords.ra, parsedCoords.dec, 'User Coordinate', '[User Coords]');
        setRa(parsedCoords.ra);
        setDec(parsedCoords.dec);
        return;
      }

      // 2. Check local benchmark lookup map
      const lower = value.toLowerCase().replace(/[-'\s]/g, '');
      const matchedBenchmark = MANDATORY_BENCHMARKS.find((b) =>
        b.name.toLowerCase().replace(/[-'\s]/g, '').includes(lower)
      );
      if (matchedBenchmark) {
        setCoordinates(
          matchedBenchmark.ra,
          matchedBenchmark.dec,
          matchedBenchmark.name,
          '[NASA Benchmark (Pre-cached)]'
        );
        setRa(matchedBenchmark.ra);
        setDec(matchedBenchmark.dec);
        return;
      }

      // 3. Fallback to GET /api/resolve (Backend Issue #7)
      try {
        const res = await fetch(`/api/resolve?q=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.ra !== undefined && data.dec !== undefined) {
            setCoordinates(
              data.ra,
              data.dec,
              data.target_name || value,
              data.source_badge || '[Resolved Target]'
            );
            setRa(data.ra);
            setDec(data.dec);
          }
        }
      } catch {
        // Backend not online or resolver failed; graceful fallback with zero crash
      }
    }, 350);
  };

  const handleBenchmarkSelect = useCallback(
    (benchmark: BenchmarkPill) => {
      setCoordinates(
        benchmark.ra,
        benchmark.dec,
        benchmark.name,
        '[NASA Benchmark (Pre-cached)]'
      );
      setRa(benchmark.ra);
      setDec(benchmark.dec);
      setSearchInput(`${benchmark.ra.toFixed(5)}, ${benchmark.dec.toFixed(5)}`);
    },
    [setCoordinates, setRa, setDec]
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
    <header className="fixed top-0 left-0 right-0 z-50 flex h-[56px] items-center justify-between border-b border-[#1E2530] bg-[#0F131A] px-4 font-sans text-xs text-[#E6ECF2] select-none">
      {/* 1. Brand & Institutional Source Attribution */}
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-[#E6ECF2]">Spectra</span>
          <span className="text-[11px] text-[#94A3B8]">SPHEREx QR2 · Community Product</span>
        </div>

        <span className="h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />

        {/* Backend Engine Status */}
        <div
          className="flex items-center gap-1.5 rounded-sm border border-[#1E2530] bg-[#151B24] px-2 py-0.5 text-[11px] text-[#94A3B8]"
          title={
            isBackendLive
              ? 'Unified FastAPI science engine connected (port 7860)'
              : 'Running from pre-cached benchmark tensors'
          }
        >
          <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
            <circle
              cx="4"
              cy="4"
              r="3.5"
              fill={isBackendLive ? '#22C55E' : '#F59E0B'}
            />
          </svg>
          <span>{isBackendLive ? 'Live API' : 'Local cache'}</span>
        </div>

        {/* Data Honesty Source Attribution */}
        <div
          className={`hidden xl:flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
            sourceBadge.includes('NASA Benchmark')
              ? 'border-[#38BDF8]/40 bg-[#151B24] text-[#E6ECF2]'
              : sourceBadge.includes('Synthetic')
              ? 'border-[#F59E0B]/40 bg-[#151B24] text-[#F59E0B]'
              : 'border-[#1E2530] bg-[#151B24] text-[#94A3B8]'
          }`}
        >
          {sourceBadge}
        </div>
      </div>

      {/* 2. Universal Coordinate / Target Input & Calibration Targets */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <label htmlFor="spectra-coord-search" className="sr-only">
            Search coordinates (decimal or sexagesimal) or target name
          </label>
          <input
            id="spectra-coord-search"
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={
              activeTargetName
                ? `${activeTargetName} (${ra.toFixed(4)}°, ${dec.toFixed(4)}°)`
                : 'RA/Dec or object name (e.g. WISE 0855)...'
            }
            className="w-[250px] rounded-sm border border-[#1E2530] bg-[#080A0F] py-1 pl-2.5 pr-10 font-mono text-xs tabular-nums text-[#E6ECF2] placeholder-[#94A3B8] transition-colors duration-150 focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#38BDF8]"
          />
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="absolute right-1.5 rounded-sm border border-[#1E2530] bg-[#151B24] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8] transition-colors duration-150 hover:border-[#38BDF8] hover:text-[#E6ECF2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            title="Open command palette (⌘K / Ctrl+K)"
            aria-label="Open command palette"
          >
            ⌘&nbsp;K
          </button>
        </div>

        {/* 3. 5 Mandatory NASA Benchmark Calibration Targets */}
        <div className="hidden lg:flex items-center gap-1" role="group" aria-label="NASA benchmark targets">
          {MANDATORY_BENCHMARKS.map((b) => {
            const isSelected =
              Math.abs(ra - b.ra) < 0.005 && Math.abs(dec - b.dec) < 0.005;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleBenchmarkSelect(b)}
                onMouseEnter={() => prefetchBenchmark(b.name)}
                title={`${b.name} — ${b.description}`}
                className={`rounded-sm border px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                  isSelected
                    ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                    : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:border-[#94A3B8]/50 hover:text-[#E6ECF2]'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. FoV Selector & 14 B/px Payload Readout */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <label htmlFor="spectra-fov-select" className="text-[11px] text-[#94A3B8]">
            Cutout FoV
          </label>
          <select
            id="spectra-fov-select"
            value={fovArcsec}
            onChange={(e) => {
              const val = Number(e.target.value);
              setFov(val);
              setUrlFov(val);
            }}
            className="rounded-sm border border-[#1E2530] bg-[#080A0F] px-1.5 py-1 font-mono text-xs tabular-nums text-[#E6ECF2] transition-colors duration-150 focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
          >
            {FOV_PRESETS.map((f) => (
              <option key={f} value={f}>
                {f}&quot; ({f / 60}&apos;)
              </option>
            ))}
          </select>
        </div>

        {/* 14 B/px Tensor Payload Readout */}
        <div
          className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] tabular-nums ${
            payloadMb >= 2.0
              ? 'border-[#F59E0B] bg-[#151B24] text-[#F59E0B]'
              : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8]'
          }`}
          title={`Uncompressed tensor: ${totalEpochs || 3} epochs × 6 bands × ${(
            fovArcsec / 6.2
          ).toFixed(1)}² px × 14 B/px`}
        >
          <span>{payloadMb.toFixed(2)}&nbsp;MB</span>
          {payloadMb >= 2.0 && <span className="font-sans text-[10px]">High payload</span>}
        </div>
      </div>

      {/* 5. 5 Workspace Tab Switcher */}
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
              {t.badge && (
                <span className="ml-1.5 rounded-sm border border-[#1E2530] bg-[#0F131A] px-1 font-mono text-[10px] tabular-nums text-[#94A3B8]">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 6. Share & Embed Exporter Dropdown */}
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
    </header>
  );
};
