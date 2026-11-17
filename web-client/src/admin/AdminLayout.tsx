import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useWalkthroughStore } from '../store/useWalkthroughStore';
import './admin.css';
import {
  IconSliders,
  IconDatabase,
  IconScan,
  IconNetwork,
  IconAlert,
  IconCompass,
  IconCpu,
  IconArrowLeft,
  IconMenu,
  IconX,
} from './components/AdminPrimitives';

const ADMIN_STATIONS = [
  { id: 'dynamics', path: '/admin/dynamics', Page: lazy(() => import('./TrainingDynamics').then((m) => ({ default: m.TrainingDynamics }))) },
  { id: 'internals', path: '/admin/internals', Page: lazy(() => import('./ActivationInspector').then((m) => ({ default: m.ActivationInspector }))) },
  { id: 'boundaries', path: '/admin/boundaries', Page: lazy(() => import('./DecisionBoundaries').then((m) => ({ default: m.DecisionBoundaries }))) },
  { id: 'triage', path: '/admin/triage', Page: lazy(() => import('./HardNegativeTriage').then((m) => ({ default: m.HardNegativeTriage }))) },
  { id: 'exports', path: '/admin/exports', Page: lazy(() => import('./DataProductExports').then((m) => ({ default: m.DataProductExports }))) },
] as const;
type AdminTabId = (typeof ADMIN_STATIONS)[number]['id'];

/**
 * Spectra Administrative Mission Control Shell (/admin/*)
 * Specification Anchors: SPECIFICATION.md §6.4, §6.5
 *
 * Enforces Zero-Auth Route Isolation:
 * - Direct URL access without login modal barrier
 * - Left sidebar + slim breadcrumb shell modeled for clean production workflows
 */
export const AdminLayout: React.FC = () => {
  const location = useLocation();
  const currentPath = location.pathname;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeStation = ADMIN_STATIONS.find((station) => station.path === currentPath);
  const activeTab: AdminTabId = activeStation?.id ?? 'dynamics';
  const [mountedTabs, setMountedTabs] = useState<Set<AdminTabId>>(() => new Set([activeTab]));

  useEffect(() => {
    setMountedTabs((previous) => new Set(previous).add(activeTab));
  }, [activeTab]);

  const utilityLinks = [
    { label: 'Sky Explorer', to: '/explore?tab=navigator', icon: <IconCompass className="w-4 h-4" /> },
    { label: 'Spectra Lab', to: '/explore?tab=spectral', icon: <IconScan className="w-4 h-4" /> },
  ];

  const navItems = [
    { id: 'dynamics', label: 'Fine-Tuning Studio', path: '/admin/dynamics', icon: <IconSliders className="w-4 h-4" /> },
    { id: 'exports', label: 'Datasets & Buckets', path: '/admin/exports', icon: <IconDatabase className="w-4 h-4" /> },
    { id: 'internals', label: 'Live Identification', path: '/admin/internals', icon: <IconScan className="w-4 h-4" /> },
    { id: 'boundaries', label: 'Embedding Space', path: '/admin/boundaries', icon: <IconNetwork className="w-4 h-4" /> },
    { id: 'triage', label: 'Hard-Negative Triage', path: '/admin/triage', icon: <IconAlert className="w-4 h-4" /> },
  ];

  const activeNavItem = navItems.find((item) => item.id === activeTab) || navItems[0];

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between px-3.5 py-4">
      <div className="flex flex-col gap-5">
        {/* BRAND HEADER */}
        <div className="flex items-center justify-between px-1.5">
          <Link to="/admin/dynamics" className="flex items-center gap-2.5 group">
            <img
              src="/favicon.svg"
              alt="Spectra"
              className="w-6 h-6 rounded-md shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold tracking-tight text-foreground leading-none">
                Spectra AI
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                Mission Control
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            aria-label="Close navigation"
          >
            <IconX />
          </button>
          <span className="hidden lg:inline-flex items-center justify-center w-7 h-7 rounded-full border border-white/[0.1] bg-white/[0.04] text-[10px] font-semibold text-foreground/80">
            SPX
          </span>
        </div>

        {/* PUBLIC PORTAL QUICK LINKS */}
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

        {/* PRIMARY ADMIN WORKSPACE NAVIGATION */}
        <nav className="flex flex-col gap-1" aria-label="Admin workstation">
          <div className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Workstations
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
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
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* BOTTOM RUNTIME CARD (mirrors Dash1 sidebar anchor card) */}
      <div className="rounded-xl border border-white/[0.08] bg-card p-3.5 flex flex-col gap-2.5 mt-4">
        <div className="flex items-center justify-between">
          <div className="w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-primary">
            <IconCpu className="w-4 h-4" />
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Ready
          </span>
        </div>
        <div>
          <div className="text-xs font-semibold text-foreground">CPU LoRA Engine</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
            Local PyTorch SFT, checkpoint promotion &amp; 102-band inference at $0 GPU cost.
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
      {/* DESKTOP SIDEBAR */}
      <aside
        data-tour="admin-sidebar-nav"
        className="hidden lg:block w-60 shrink-0 border-r border-white/[0.07] bg-[#0B0C0E]"
      >
        {sidebarContent}
      </aside>

      {/* MOBILE DRAWER */}
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

      {/* MAIN CONTENT SHELL */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* SLIM TOP BREADCRUMB HEADER */}
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
            <span className="text-muted-foreground">{activeNavItem.icon}</span>
            <span className="text-xs sm:text-[13px] font-medium text-foreground truncate">
              {activeNavItem.label}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              PyTorch SFT Active
            </span>
            <button
              type="button"
              onClick={() => useWalkthroughStore.getState().startChapterTour('admin')}
              title="Launch interactive guide for all 5 /admin Mission Control stations"
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-sky-400/35 bg-sky-500/10 hover:bg-sky-500/20 text-xs font-medium text-sky-200 transition-colors cursor-pointer"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/20 font-mono text-[10px] font-bold text-sky-300">
                ?
              </span>
              <span className="hidden sm:inline">Admin Guide</span>
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

        {/* WORKSPACE CONTENT ROUTER */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {!activeStation ? (
            <Navigate to="/admin/dynamics" replace />
          ) : (
            <div className="min-h-full">
              {ADMIN_STATIONS.filter(({ id }) => mountedTabs.has(id) || activeTab === id).map(({ id, Page }) => (
                <section key={id} hidden={activeTab !== id} aria-hidden={activeTab !== id}>
                  <Suspense fallback={<AdminStationLoading />}><Page /></Suspense>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

const AdminStationLoading = () => (
  <div className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">
    Loading workstation…
  </div>
);

export default AdminLayout;
