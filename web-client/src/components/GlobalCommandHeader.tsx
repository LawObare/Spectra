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
    <header className="fixed top-0 left-0 right-0 z-50 flex h-[56px] items-center justify-between border-b border-[#1E2633] bg-[#090C10] px-4 font-mono text-sm text-slate-200 select-none">
      {/* 1. Brand & Telemetry Status Indicator */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-wider text-[#00F0FF]">SPECTRA</span>
          <span className="text-xs text-slate-500">//</span>
          <span className="text-xs font-semibold text-slate-400">QR2</span>
        </div>

        {/* Live Backend Indicator Dot */}
        <div
          className="flex items-center gap-1.5 rounded bg-slate-900/80 px-2 py-0.5 text-[11px]"
          title={
            isBackendLive
              ? 'Unified FastAPI Engine Connected (Port 7860)'
              : 'Offline / Local Static Benchmark Cache Mode'
          }
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isBackendLive ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400'
            }`}
          />
          <span className="text-[10px] text-slate-400">
            {isBackendLive ? 'LIVE' : 'CACHE'}
          </span>
        </div>

        {/* Data Honesty Source Badge */}
        <div
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-tight ${
            sourceBadge.includes('NASA Benchmark')
              ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
              : sourceBadge.includes('Synthetic')
              ? 'border-purple-500/40 bg-purple-950/40 text-purple-300'
              : 'border-slate-700 bg-slate-900 text-slate-300'
          }`}
        >
          {sourceBadge}
        </div>
      </div>

      {/* 2. Universal Coordinate / Target Input */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={
              activeTargetName
                ? `${activeTargetName} (${ra.toFixed(4)}, ${dec.toFixed(4)})`
                : 'RA/Dec or Target (e.g. WISE 0855)...'
            }
            className="w-[260px] rounded border border-[#1E2633] bg-[#0c1017] px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-[#00F0FF] focus:outline-none focus:ring-1 focus:ring-[#00F0FF]"
          />
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="absolute right-1.5 rounded bg-slate-800/80 px-1 py-0.5 text-[9px] text-slate-400 hover:text-cyan-300"
            title="Open Command Palette (Cmd+K / Ctrl+K)"
          >
            ⌘K
          </button>
        </div>

        {/* 3. 5 Mandatory NASA Benchmark Quick-Launch Pills */}
        <div className="flex items-center gap-1">
          {MANDATORY_BENCHMARKS.map((b) => {
            const isSelected =
              Math.abs(ra - b.ra) < 0.005 && Math.abs(dec - b.dec) < 0.005;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleBenchmarkSelect(b)}
                onMouseEnter={() => prefetchBenchmark(b.name)}
                title={`${b.name}: ${b.description}`}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  isSelected
                    ? 'border border-cyan-400 bg-cyan-950/60 font-semibold text-cyan-300 shadow-[0_0_8px_rgba(0,240,255,0.25)]'
                    : 'border border-transparent bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. FoV Selector & 14 B/px Payload Gauge */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">FoV:</span>
          <select
            value={fovArcsec}
            onChange={(e) => {
              const val = Number(e.target.value);
              setFov(val);
              setUrlFov(val);
            }}
            className="rounded border border-[#1E2633] bg-[#0c1017] px-1.5 py-0.5 text-xs text-slate-300 focus:border-[#00F0FF] focus:outline-none"
          >
            {FOV_PRESETS.map((f) => (
              <option key={f} value={f}>
                {f}&quot; ({f / 60}&apos;)
              </option>
            ))}
          </select>
        </div>

        {/* 14 B/px Payload Indicator */}
        <div
          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${
            payloadMb >= 2.0
              ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
              : 'border-slate-800 bg-slate-900/60 text-slate-400'
          }`}
          title={`Computed tensor payload: ${totalEpochs || 3} epochs × 6 bands × ${(
            fovArcsec / 6.2
          ).toFixed(1)}² px × 14 B`}
        >
          <span>{payloadMb.toFixed(2)} MB</span>
          {payloadMb >= 2.0 && <span className="text-amber-400 font-bold">⚠️</span>}
        </div>
      </div>

      {/* 5. 5 Workspace Tab Switcher */}
      <nav className="flex items-center gap-0.5 rounded border border-[#1E2633] bg-[#0c1017] p-0.5">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-cyan-950/80 text-[#00F0FF] shadow-[0_0_6px_rgba(0,240,255,0.2)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
              {t.badge && (
                <span className="ml-1.5 rounded-full bg-cyan-500/20 px-1 text-[9px] font-bold text-cyan-300">
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
          className="rounded border border-[#1E2633] bg-[#0c1017] px-2.5 py-1 text-xs text-slate-300 hover:border-slate-700 hover:text-white"
        >
          Share ▾
        </button>

        {isShareOpen && (
          <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-[#1E2633] bg-[#090C10] p-3 shadow-xl">
            <div className="mb-2 text-xs font-semibold text-slate-200">
              Share Workspace View
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-left text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
              >
                🔗 Copy Deep Link
              </button>
              <button
                type="button"
                onClick={handleCopyIframe}
                className="w-full rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-left text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
              >
                &lt;/&gt; Copy iFrame Embed (?embed=1)
              </button>
            </div>
            {shareFeedback && (
              <div className="mt-2 text-[10px] text-emerald-400 animate-pulse">
                ✓ {shareFeedback}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
