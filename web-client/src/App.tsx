import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { useSpectraUrlState } from './hooks/useSpectraUrlState';
import { useKeyboardTelemetry } from './hooks/useKeyboardTelemetry';
import { useTelemetryStore } from './store/useTelemetryStore';
import {
  GlobalCommandHeader,
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
} from './components/GlobalCommandHeader';
import { CommandPalette } from './components/CommandPalette';
import { MissionLaunchpad } from './components/MissionLaunchpad';
import { MajorDiscovery } from './components/MajorDiscoveriesData';
import { CandidateCatalogDrawer, CatalogTarget } from './components/CandidateCatalogDrawer';

const CelestialNavigator = lazy(() =>
  import('./tabs/CelestialNavigator').then((module) => ({ default: module.CelestialNavigator }))
);
const TimeDomainComparator = lazy(() =>
  import('./tabs/TimeDomainComparator').then((module) => ({ default: module.TimeDomainComparator }))
);
const SpectrophotometricLab = lazy(() =>
  import('./tabs/SpectrophotometricLab').then((module) => ({ default: module.SpectrophotometricLab }))
);
const MolecularIceStudio = lazy(() =>
  import('./tabs/MolecularIceStudio').then((module) => ({ default: module.MolecularIceStudio }))
);
const ObservationDiscussions = lazy(() =>
  import('./tabs/ObservationDiscussions').then((module) => ({ default: module.ObservationDiscussions }))
);

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
    setTab,
    ra: urlRa,
    setRa,
    dec: urlDec,
    setDec,
    fov: urlFov,
    cadence: urlCadence,
    mode: urlMode,
    preset: urlPreset,
    setPreset,
    z: urlZ,
    probeX: urlPx,
    probeY: urlPy,
    isEmbed,
  } = useSpectraUrlState();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isMissionBriefingActive, setIsMissionBriefingActive] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  const handleLaunchWorkstationFromBriefing = (targetTab: string = 'comparator') => {
    setTab(targetTab as any);
    setIsMissionBriefingActive(false);
  };

  const handleSelectDiscoveryFromBriefing = (discovery: MajorDiscovery) => {
    const store = useTelemetryStore.getState();
    store.setCoordinates(discovery.ra, discovery.dec, discovery.name, discovery.badge);
    setRa(discovery.ra);
    setDec(discovery.dec);
    if (discovery.preset) {
      store.setRgbPreset(discovery.preset);
      setPreset(discovery.preset);
    }
    setTab(discovery.launchTab);
    setIsMissionBriefingActive(false);
  };

  const handleSelectCatalogTarget = (target: CatalogTarget) => {
    const store = useTelemetryStore.getState();
    store.setCoordinates(target.ra, target.dec, target.name, target.status);
    setRa(target.ra);
    setDec(target.dec);
    if (target.preset) {
      store.setRgbPreset(target.preset);
      setPreset(target.preset);
    }
    setTab(target.launchTab);
    setIsCatalogOpen(false);
  };

  // Hydrate Zustand TelemetryStore from URL query parameters on deep-link load / URL navigation
  useEffect(() => {
    const store = useTelemetryStore.getState();
    const matchedCatalog = SEARCHABLE_SKY_CATALOG.find(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );
    const isBench =
      matchedCatalog && MANDATORY_BENCHMARKS.some((b) => b.id === matchedCatalog.id);

    if (
      Math.abs(store.ra - urlRa) > 1e-5 ||
      Math.abs(store.dec - urlDec) > 1e-5 ||
      (matchedCatalog && store.activeTargetName !== matchedCatalog.name)
    ) {
      store.setCoordinates(
        urlRa,
        urlDec,
        matchedCatalog
          ? matchedCatalog.name
          : store.activeTargetName ||
            `J2000 ${urlRa.toFixed(4)}°, ${urlDec >= 0 ? '+' : ''}${urlDec.toFixed(4)}°`,
        isBench ? '[Benchmark Model (Simulated)]' : '[Simulated Fallback (Offline)]'
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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* Fixed Global Command Header (56px) - hidden when embedded */}
      {!isEmbed && (
        <GlobalCommandHeader
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onToggleMissionBriefing={() => setIsMissionBriefingActive((prev) => !prev)}
          isMissionBriefingActive={isMissionBriefingActive}
          onOpenCatalog={() => setIsCatalogOpen(true)}
        />
      )}

      {/* Universal Command Palette Modal (Cmd+K / Ctrl+K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* Authoritative SPHEREx Source Catalog Drawer (Synchronized with Canvas) */}
      <CandidateCatalogDrawer
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectTarget={handleSelectCatalogTarget}
        activeRa={urlRa}
        activeDec={urlDec}
      />

      {/* Main Content: Option A Mission Launchpad or Active Workstation */}
      <main className={`relative flex-1 overflow-hidden ${!isEmbed ? 'pt-[56px]' : ''}`}>
        {isMissionBriefingActive ? (
          <MissionLaunchpad
            onLaunchWorkstation={handleLaunchWorkstationFromBriefing}
            onSelectDiscovery={handleSelectDiscoveryFromBriefing}
          />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                Loading selected science view…
              </div>
            }
          >
            <>
              {tab === 'navigator' && <CelestialNavigator />}
              {tab === 'comparator' && (
                <TimeDomainComparator onOpenCatalog={() => setIsCatalogOpen(true)} />
              )}
              {tab === 'spectral' && <SpectrophotometricLab />}
              {tab === 'ice' && <MolecularIceStudio />}
              {tab === 'discussions' && <ObservationDiscussions />}
            </>
          </Suspense>
        )}
      </main>
    </div>
  );
};

/**
 * Root Landing Page: Option A NASA SPHEREx Mission Launchpad
 */
const LandingMissionPage: React.FC = () => {
  const navigate = useNavigate();
  const { setCoordinates, setRgbPreset } = useTelemetryStore();

  const handleLaunchWorkstation = (targetTab: string = 'comparator') => {
    navigate(`/explore?tab=${targetTab}`);
  };

  const handleSelectDiscovery = (discovery: MajorDiscovery) => {
    setCoordinates(discovery.ra, discovery.dec, discovery.name, discovery.badge);
    if (discovery.preset) setRgbPreset(discovery.preset);
    navigate(
      `/explore?tab=${discovery.launchTab}&ra=${discovery.ra}&dec=${discovery.dec}&preset=${discovery.preset}`
    );
  };

  return (
    <MissionLaunchpad
      onLaunchWorkstation={handleLaunchWorkstation}
      onSelectDiscovery={handleSelectDiscovery}
    />
  );
};

// Lazy-loaded administrative route chunk (SPECIFICATION.md §6.1.1: Physical chunk isolation)
const AdminMissionControl = lazy(() => import('./admin/AdminLayout'));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center bg-background font-sans text-xs text-muted-foreground">
                Loading Spectra workbench...
              </div>
            }
          >
            <Routes>
              {/* Option A: Authentic NASA SPHEREx Mission Launchpad at Root */}
              <Route path="/" element={<LandingMissionPage />} />
              <Route path="/1" element={<Navigate to="/explore?tab=navigator" replace />} />
              <Route path="/explore/*" element={<PublicExplorerPortal />} />
              {/* Zero-Auth Route-Isolated Admin Suite (No blocking login screens) */}
              <Route path="/admin/*" element={<AdminMissionControl />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
