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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-space-950 font-mono text-gray-100">
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
      <main className="relative flex-1 overflow-hidden">
        {tab === 'navigator' && <CelestialNavigator />}

        {tab === 'comparator' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-space-950 p-6 text-center">
            <div className="max-w-md rounded-lg border border-space-800 bg-space-900/80 p-6 backdrop-blur">
              <span className="text-xs uppercase tracking-widest text-telemetry-cyan font-bold">
                Tab 2 // Time-Domain Comparator
              </span>
              <p className="mt-3 text-sm text-gray-400">
                Awaiting E3 WebGL2 Float32 multi-epoch shader pipeline integration (#17, #18).
              </p>
              <div className="mt-5 flex justify-center">
                <a
                  href="/explore?tab=navigator"
                  className="rounded border border-telemetry-cyan/40 bg-telemetry-cyan/10 px-3 py-1.5 text-xs text-telemetry-cyan hover:bg-telemetry-cyan/20 transition-colors"
                >
                  ← Return to 3D Navigator
                </a>
              </div>
            </div>
          </div>
        )}

        {tab === 'spectral' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-space-950 p-6 text-center">
            <div className="max-w-md rounded-lg border border-space-800 bg-space-900/80 p-6 backdrop-blur">
              <span className="text-xs uppercase tracking-widest text-telemetry-amber font-bold">
                Tab 3 // Spectrophotometric Lab
              </span>
              <p className="mt-3 text-sm text-gray-400">
                Awaiting E5 uPlot 102-channel spectrophotometry integration (#20, #21).
              </p>
              <div className="mt-5 flex justify-center">
                <a
                  href="/explore?tab=navigator"
                  className="rounded border border-space-700 bg-space-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
                >
                  ← Return to 3D Navigator
                </a>
              </div>
            </div>
          </div>
        )}

        {tab === 'ice' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-space-950 p-6 text-center">
            <div className="max-w-md rounded-lg border border-space-800 bg-space-900/80 p-6 backdrop-blur">
              <span className="text-xs uppercase tracking-widest text-telemetry-cyan font-bold">
                Tab 4 // Molecular & Ice Studio
              </span>
              <p className="mt-3 text-sm text-gray-400">
                Awaiting E5 SPLICES point-source ice column density integration (#25).
              </p>
              <div className="mt-5 flex justify-center">
                <a
                  href="/explore?tab=navigator"
                  className="rounded border border-space-700 bg-space-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
                >
                  ← Return to 3D Navigator
                </a>
              </div>
            </div>
          </div>
        )}

        {tab === 'discussions' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-space-950 p-6 text-center">
            <div className="max-w-md rounded-lg border border-space-800 bg-space-900/80 p-6 backdrop-blur">
              <span className="text-xs uppercase tracking-widest text-purple-400 font-bold">
                Tab 5 // Observation Discussions
              </span>
              <p className="mt-3 text-sm text-gray-400">
                Phase 2 Community Intelligence Hub (Gated behind Phase 1 Milestone Gate 1, #23).
              </p>
              <div className="mt-5 flex justify-center">
                <a
                  href="/explore?tab=navigator"
                  className="rounded border border-space-700 bg-space-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
                >
                  ← Return to 3D Navigator
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
    <div className="flex min-h-screen items-center justify-center bg-[#090C10] font-mono text-amber-400">
      INITIALIZING SPECTRA ADMIN MISSION CONTROL...
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
              <div className="flex min-h-screen items-center justify-center bg-[#090C10] font-mono text-[#00F0FF]">
                INITIALIZING SPECTRA WORKBENCH...
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
