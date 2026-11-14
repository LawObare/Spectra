import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { useSpectraUrlState } from './hooks/useSpectraUrlState';
import { useKeyboardTelemetry } from './hooks/useKeyboardTelemetry';
import { useTelemetryStore } from './store/useTelemetryStore';
import { GlobalCommandHeader, MANDATORY_BENCHMARKS } from './components/GlobalCommandHeader';
import { CommandPalette } from './components/CommandPalette';
import { CelestialNavigator } from './tabs/CelestialNavigator';
import { TimeDomainComparator } from './tabs/TimeDomainComparator';

/**
 * Spectra Root Application Component
 * Specification Anchor: SPECIFICATION.md §6.1.1
 * Enforces Zero-Auth Route Isolation between /explore/* and /admin/*
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 30, // 30 minutes cache for astronomy cutouts
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Public Citizen Science Explorer Portal
 * Specification Anchor: SPECIFICATION.md §6.1.1, §6.3
 * Mounts Global Header (56px), Command Palette (Cmd+K), and Tab Workspaces (1–5).
 */
export const PublicExplorerPortal: React.FC = () => {
  const {
    tab,
    ra: urlRa,
    dec: urlDec,
    fov: urlFov,
    cadence: urlCadence,
    mode: urlMode,
    preset: urlPreset,
    z: urlZ,
    probeX: urlPx,
    probeY: urlPy,
    isEmbed,
  } = useSpectraUrlState();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Hydrate Zustand TelemetryStore from URL query parameters on deep-link load / URL navigation
  useEffect(() => {
    const store = useTelemetryStore.getState();
    const matchedBenchmark = MANDATORY_BENCHMARKS.find(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );

    if (
      Math.abs(store.ra - urlRa) > 1e-5 ||
      Math.abs(store.dec - urlDec) > 1e-5 ||
      (matchedBenchmark && store.activeTargetName !== matchedBenchmark.name)
    ) {
      store.setCoordinates(
        urlRa,
        urlDec,
        matchedBenchmark ? matchedBenchmark.name : store.activeTargetName || `RA ${urlRa.toFixed(4)}°, Dec ${urlDec.toFixed(4)}°`,
        matchedBenchmark ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]'
      );
    }

    if (urlFov && store.fovArcsec !== urlFov) {
      store.setFov(urlFov);
    }
    if (urlCadence === 'survey_6month' || urlCadence === 'short_subexposure') {
      if (store.cadence !== urlCadence) store.setCadence(urlCadence);
    }
    if (urlMode === 'blink' || urlMode === 'difference' || urlMode === 'coadd') {
      if (store.renderMode !== urlMode) store.setRenderMode(urlMode);
    }
    if (
      urlPreset === 'true_nir' ||
      urlPreset === 'brown_dwarf' ||
      urlPreset === 'water_ice' ||
      urlPreset === 'comet_outgassing' ||
      urlPreset === 'custom'
    ) {
      if (store.activeRgbPreset !== urlPreset) store.setRgbPreset(urlPreset);
    }
    if (typeof urlZ === 'number' && store.manualRedshiftZ !== urlZ) {
      store.setManualRedshiftZ(urlZ);
    }
    if (
      typeof urlPx === 'number' &&
      typeof urlPy === 'number' &&
      (store.probedPixel?.x !== urlPx || store.probedPixel?.y !== urlPy)
    ) {
      store.setProbedPixel({ x: urlPx, y: urlPy });
    }
  }, [urlRa, urlDec, urlFov, urlCadence, urlMode, urlPreset, urlZ, urlPx, urlPy]);

  // Wire global keyboard shortcuts (Cmd+K, Space, 1/2/3, Arrows, etc.)
  useKeyboardTelemetry({
    onToggleCommandPalette: () => setCommandPaletteOpen((prev) => !prev),
  });

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#080A0F] font-sans text-[#E6ECF2]">
      {/* Fixed Global Command Header (56px) - hidden when embedded */}
      {!isEmbed && (
        <GlobalCommandHeader
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
      )}

      {/* Universal Command Palette Modal (Cmd+K / Ctrl+K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* Active Tab Workspace */}
      <main className={`relative flex-1 overflow-hidden ${!isEmbed ? 'pt-[56px]' : ''}`}>
        {tab === 'navigator' && <CelestialNavigator />}

        {tab === 'comparator' && <TimeDomainComparator />}

        {tab === 'spectral' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-[#080A0F] p-6">
            <div className="w-full max-w-md rounded-sm border border-[#1E2530] bg-[#0F131A] p-6 text-left">
              <h2 className="text-sm font-semibold text-[#E6ECF2]">
                Spectrophotometric lab
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">
                102-channel WCS-WAVE spectral extraction and uPlot canvas for <span className="font-mono tabular-nums text-[#E6ECF2]">{urlRa.toFixed(5)}°, {urlDec.toFixed(5)}°</span> mounts here (Issues #20, #21).
              </p>
              <div className="mt-5">
                <a
                  href="/explore?tab=navigator"
                  className="inline-block rounded-sm border border-[#1E2530] bg-[#151B24] px-3 py-1.5 text-xs font-medium text-[#E6ECF2] transition-colors duration-150 hover:border-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                >
                  Return to sky view
                </a>
              </div>
            </div>
          </div>
        )}

        {tab === 'ice' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-[#080A0F] p-6">
            <div className="w-full max-w-md rounded-sm border border-[#1E2530] bg-[#0F131A] p-6 text-left">
              <h2 className="text-sm font-semibold text-[#E6ECF2]">
                Molecular and ice studio
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">
                SPLICES point-source optical depth and laboratory A-value column density integrator for <span className="font-mono tabular-nums text-[#E6ECF2]">{urlRa.toFixed(5)}°, {urlDec.toFixed(5)}°</span> mounts here (Issue #25).
              </p>
              <div className="mt-5">
                <a
                  href="/explore?tab=navigator"
                  className="inline-block rounded-sm border border-[#1E2530] bg-[#151B24] px-3 py-1.5 text-xs font-medium text-[#E6ECF2] transition-colors duration-150 hover:border-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                >
                  Return to sky view
                </a>
              </div>
            </div>
          </div>
        )}

        {tab === 'discussions' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-[#080A0F] p-6">
            <div className="w-full max-w-md rounded-sm border border-[#1E2530] bg-[#0F131A] p-6 text-left">
              <h2 className="text-sm font-semibold text-[#E6ECF2]">
                Observation discussions
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">
                Real-time SSE community feed and external archive cross-match deck (Phase 2, Issue #23).
              </p>
              <div className="mt-5">
                <a
                  href="/explore?tab=navigator"
                  className="inline-block rounded-sm border border-[#1E2530] bg-[#151B24] px-3 py-1.5 text-xs font-medium text-[#E6ECF2] transition-colors duration-150 hover:border-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                >
                  Return to sky view
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

// Lazy-loaded administrative route chunk (SPECIFICATION.md §6.1.1: Physical chunk isolation)
const AdminMissionControl = lazy(async () => ({
  default: () => (
    <div className="flex min-h-dvh items-center justify-center bg-[#080A0F] font-sans text-xs text-[#94A3B8]">
      Loading administrative mission control...
    </div>
  ),
}));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center bg-[#080A0F] font-sans text-xs text-[#94A3B8]">
                Loading Spectra workbench...
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate to="/explore" replace />} />
              <Route path="/explore/*" element={<PublicExplorerPortal />} />
              {/* Zero-Auth Route-Isolated Admin Suite (No blocking login screens) */}
              <Route path="/admin/*" element={<AdminMissionControl />} />
              <Route path="*" element={<Navigate to="/explore" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
