import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import './admin.css';
import {
  IconSliders,
  IconDatabase,
  IconScan,
  IconAlert,
  IconCompass,
  IconCpu,
  IconArrowLeft,
  IconMenu,
  IconX,
} from './components/AdminPrimitives';
import {
  bumpStudioDatasetRevision,
  studioFetchJson,
  updateStudioGlobalMeta,
  useStudioGlobalState,
} from './hooks/useStudioApi';
import { useWalkthroughStore } from '../store/useWalkthroughStore';

const TrainTestStudioPage = lazy(() =>
  import('./TrainingDynamics').then((m) => ({ default: m.TrainingDynamics }))
);
const ReviewLabelPage = lazy(() =>
  import('./HardNegativeTriage').then((m) => ({ default: m.HardNegativeTriage }))
);
const ExportHubPage = lazy(() =>
  import('./DataProductExports').then((m) => ({ default: m.DataProductExports }))
);

const ADMIN_STATIONS = [
  { id: 'studio', path: '/admin/studio', label: 'Train & Test Studio', Page: TrainTestStudioPage, icon: <IconSliders className="w-4 h-4" /> },
  { id: 'review', path: '/admin/review', label: 'Review & Label', Page: ReviewLabelPage, icon: <IconAlert className="w-4 h-4" /> },
  { id: 'exports', path: '/admin/exports', label: 'Export Data & Models', Page: ExportHubPage, icon: <IconDatabase className="w-4 h-4" /> },
] as const;

const LEGACY_REDIRECTS: Record<string, string> = {
  '/admin': '/admin/studio',
  '/admin/': '/admin/studio',
  '/admin/dynamics': '/admin/studio',
  '/admin/internals': '/admin/studio',
  '/admin/boundaries': '/admin/studio',
  '/admin/triage': '/admin/review',
};

export const AdminLayout: React.FC = () => {
  const location = useLocation();
  const currentPath = location.pathname;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [clearingDemo, setClearingDemo] = useState(false);

  const globalState = useStudioGlobalState();

  const refreshGlobalStatus = useCallback(async () => {
    try {
      const data = await studioFetchJson<{
        has_demo_data: boolean;
        demo_count: number;
        total_examples: number;
        mutations_enabled: boolean;
        requires_token: boolean;
      }>('/api/admin/dataset');
      updateStudioGlobalMeta({
        hasDemoData: Boolean(data.has_demo_data),
        demoCount: Number(data.demo_count || 0),
        totalExamples: Number(data.total_examples || 0),
        mutationsEnabled: Boolean(data.mutations_enabled),
        requiresToken: Boolean(data.requires_token),
        backendOnline: true,
      });
    } catch {
      updateStudioGlobalMeta({ backendOnline: false });
    }
  }, []);

  useEffect(() => {
    void refreshGlobalStatus();
  }, [refreshGlobalStatus, globalState.datasetRevision]);

  const handleClearDemo = async () => {
    setClearingDemo(true);
    try {
      await studioFetchJson('/api/admin/demo/clear', { method: 'POST' });
      bumpStudioDatasetRevision();
    } catch {
      // Handled via preview mode banner if locked
    } finally {
      setClearingDemo(false);
    }
  };

  const legacyTarget = LEGACY_REDIRECTS[currentPath];
  if (legacyTarget) {
    return <Navigate to={legacyTarget} replace />;
  }

  const activeStation = ADMIN_STATIONS.find((s) => s.path === currentPath);
  if (!activeStation) {
    return <Navigate to="/admin/studio" replace />;
  }

  const ActivePage = activeStation.Page;

  const utilityLinks = [
    { label: 'Sky Explorer', to: '/explore?tab=navigator', icon: <IconCompass className="w-4 h-4" /> },
    { label: '102-Band Spectrum', to: '/explore?tab=spectral', icon: <IconScan className="w-4 h-4" /> },
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between px-3.5 py-4">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between px-1.5">
          <Link to="/admin/studio" className="flex items-center gap-2.5 group">
            <img src="/favicon.svg" alt="Spectra" className="w-6 h-6 rounded-md shrink-0" />
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold tracking-tight text-foreground leading-none">
                Spectra AI Studio
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                6-Class Sky Classifier
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="hidden lg:inline-flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
              <path d="M15 10l-2 2 2 2" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            aria-label="Close navigation"
          >
            <IconX />
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          {utilityLinks.map((u) => (
            <Link
              key={u.to}
              to={u.to}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
            >
              <span className="text-muted-foreground/80">{u.icon}</span>
              <span>{u.label}</span>
            </Link>
          ))}
        </div>

        <div className="border-t border-white/[0.07]" />

        <nav data-tour="admin-sidebar-nav" className="flex flex-col gap-1" aria-label="AI Studio navigation">
          <div className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Workflow
          </div>
          {ADMIN_STATIONS.map((item, idx) => {
            const isActive = activeStation.id === item.id;
            return (
              <Link
                key={item.id}
                to={item.path}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all border',
                  isActive
                    ? 'bg-white/[0.07] border-white/[0.09] text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.035]'
                )}
              >
                <span className={cn(isActive ? 'text-primary' : 'text-muted-foreground/80')}>
                  {item.icon}
                </span>
                <span className="truncate">
                  {idx + 1}. {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-card p-3.5 flex flex-col gap-2.5 mt-4">
        <div className="flex items-center justify-between">
          <div className="w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-primary">
            <IconCpu className="w-4 h-4" />
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[10px] font-medium',
              globalState.backendOnline ? 'text-emerald-400' : 'text-amber-400'
            )}
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                globalState.backendOnline ? 'bg-emerald-400' : 'bg-amber-400'
              )}
            />
            {globalState.backendOnline ? 'PyTorch Online' : 'Offline'}
          </span>
        </div>
        <div>
          <div className="text-xs font-semibold text-foreground">Real 102-Band Classifier</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
            {globalState.totalExamples} labeled spectra in Postgres · weights saved permanently.
          </p>
        </div>
        <Link
          to="/explore?tab=navigator"
          className="inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.09] text-xs font-medium text-foreground transition-colors"
        >
          <IconArrowLeft />
          <span>Return to Sky View</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="admin-workstation flex h-dvh w-screen overflow-hidden bg-background font-sans text-foreground">
      <aside
        className={cn(
          'hidden lg:block shrink-0 bg-[#0B0C0E] transition-[width,opacity] duration-200 ease-out overflow-hidden',
          sidebarCollapsed
            ? 'w-0 opacity-0 border-r-0 pointer-events-none'
            : 'w-60 opacity-100 border-r border-white/[0.07]'
        )}
        aria-hidden={sidebarCollapsed}
      >
        <div className="w-60 h-full">{sidebarContent}</div>
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[85vw] bg-[#0B0C0E] border-r border-white/[0.08] h-full shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="h-[52px] shrink-0 border-b border-white/[0.07] bg-[#0B0C0E]/75 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 -ml-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
              aria-label="Open navigation"
            >
              <IconMenu />
            </button>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="hidden lg:inline-flex items-center justify-center p-1.5 -ml-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors cursor-pointer"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
                {sidebarCollapsed ? <path d="M13 10l2 2-2 2" /> : <path d="M15 10l-2 2 2 2" />}
              </svg>
            </button>
            <span className="text-muted-foreground">{activeStation.icon}</span>
            <span className="text-xs sm:text-[13px] font-medium text-foreground truncate">
              {activeStation.label}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {globalState.hasDemoData && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200">
                <span>Demo Data ({globalState.demoCount})</span>
                <button
                  type="button"
                  disabled={clearingDemo}
                  onClick={handleClearDemo}
                  className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/35 cursor-pointer disabled:opacity-50"
                >
                  {clearingDemo ? 'Clearing…' : 'Clear'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => useWalkthroughStore.getState().startChapterTour('admin')}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-xs font-medium text-sky-200 transition-colors cursor-pointer"
              title="Launch the step-by-step AI Studio walkthrough"
            >
              <span>? Tour</span>
            </button>

            <Link
              to="/explore?tab=navigator"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.07] text-xs font-medium text-foreground transition-colors"
            >
              <IconArrowLeft />
              <span className="hidden sm:inline">Sky Explorer</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <Suspense fallback={<AdminStationLoading />}>
            <ActivePage />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

const AdminStationLoading = () => (
  <div className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">
    Loading AI Studio…
  </div>
);

export default AdminLayout;
