import React from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { TrainingDynamics } from './TrainingDynamics';
import { ActivationInspector } from './ActivationInspector';
import { DecisionBoundaries } from './DecisionBoundaries';

/**
 * Spectra Administrative Mission Control Shell (/admin/*)
 * Specification Anchors: SPECIFICATION.md §6.4, §6.5
 * 
 * Enforces Zero-Auth Route Isolation:
 * - Direct URL access without login modal barrier
 * - Explicit [Read-Only Demo Mode] banner when mutations disabled
 * - Tabbed navigation across 5 Mission Control workstations:
 *   1. /admin/dynamics: Training Dynamics & Loss Studio
 *   2. /admin/internals: Parameter Updates & Activation Inspector
 *   3. /admin/boundaries: Decision Boundary Animator
 *   4. /admin/triage: Disagreement & Escalation Queue (Issue #28)
 *   5. /admin/exports: Calibration & Mission Data Product Hub (Issue #28)
 */
export const AdminLayout: React.FC = () => {
  const location = useLocation();
  const currentPath = location.pathname;

  // Determine active tab from URL path
  const getActiveTab = () => {
    if (currentPath.includes('/admin/internals')) return 'internals';
    if (currentPath.includes('/admin/boundaries')) return 'boundaries';
    if (currentPath.includes('/admin/triage')) return 'triage';
    if (currentPath.includes('/admin/exports')) return 'exports';
    return 'dynamics';
  };

  const activeTab = getActiveTab();

  const navItems = [
    { id: 'dynamics', label: '1. Training Dynamics', path: '/admin/dynamics' },
    { id: 'internals', label: '2. Parameter & Activations', path: '/admin/internals' },
    { id: 'boundaries', label: '3. Decision Boundaries', path: '/admin/boundaries' },
    { id: 'triage', label: '4. Disagreement Triage', path: '/admin/triage' },
    { id: 'exports', label: '5. Data Product Hub', path: '/admin/exports' },
  ];

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#080A0F] font-sans text-[#E6ECF2]">
      {/* MISSION CONTROL TOP BAR (SPECIFICATION.md §6.4) */}
      <header className="flex h-14 items-center justify-between border-b border-[#1E2530] bg-[#0B0F17] px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            <h1 className="text-xs font-bold tracking-wider uppercase text-[#E6ECF2]">
              SPECTRA MISSION CONTROL // Admin Operations Console
            </h1>
          </div>
          <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono text-[#38BDF8] border border-cyan-500/20">
            [Clearance: SEC]
          </span>
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-400 border border-amber-500/20">
            [Read-Only Demo Mode]
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/explore?tab=navigator"
            className="flex items-center gap-1.5 rounded border border-[#1E2530] bg-[#151B24] px-3 py-1.5 text-xs text-[#94A3B8] hover:text-[#E6ECF2] hover:border-[#38BDF8] transition"
          >
            <span>←</span>
            <span>Return to Sky View</span>
          </Link>
        </div>
      </header>

      {/* SUB-NAVIGATION TABS BAR */}
      <nav className="flex items-center border-b border-[#1E2530] bg-[#0D121B] px-4 gap-1 shrink-0 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <Link
              key={item.id}
              to={item.path}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-[#38BDF8] text-[#38BDF8] bg-[#38BDF8]/5'
                  : 'border-transparent text-[#94A3B8] hover:text-[#E6ECF2] hover:border-[#64748B]'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* WORKSPACE CONTENT ROUTER */}
      <main className="flex-1 overflow-hidden relative">
        <Routes>
          <Route path="/" element={<Navigate to="/admin/dynamics" replace />} />
          <Route path="/dynamics" element={<TrainingDynamics />} />
          <Route path="/internals" element={<ActivationInspector />} />
          <Route path="/boundaries" element={<DecisionBoundaries />} />
          <Route
            path="/triage"
            element={
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
                <div className="max-w-md rounded border border-[#1E2530] bg-[#0F131A] p-6">
                  <h3 className="text-sm font-semibold text-[#E6ECF2]">
                    Tab 4: Disagreement & Escalation Queue (/admin/triage)
                  </h3>
                  <p className="mt-2 text-xs text-[#94A3B8] leading-relaxed">
                    Hard-negative triage and raw FITS HDU 1–6 verification queue mounts here (Assigned to Role E6 / Issue #28).
                  </p>
                  <div className="mt-4">
                    <Link
                      to="/admin/dynamics"
                      className="rounded bg-[#38BDF8] px-3 py-1 text-xs font-medium text-[#080A0F]"
                    >
                      Return to Training Dynamics
                    </Link>
                  </div>
                </div>
              </div>
            }
          />
          <Route
            path="/exports"
            element={
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
                <div className="max-w-md rounded border border-[#1E2530] bg-[#0F131A] p-6">
                  <h3 className="text-sm font-semibold text-[#E6ECF2]">
                    Tab 5: Mission Data Product Hub (/admin/exports)
                  </h3>
                  <p className="mt-2 text-xs text-[#94A3B8] leading-relaxed">
                    Calibration pool manager and the 4 SPHEREx community data product exports mount here (Assigned to Role E6 / Issue #28).
                  </p>
                  <div className="mt-4">
                    <Link
                      to="/admin/dynamics"
                      className="rounded bg-[#38BDF8] px-3 py-1 text-xs font-medium text-[#080A0F]"
                    >
                      Return to Training Dynamics
                    </Link>
                  </div>
                </div>
              </div>
            }
          />
          <Route path="*" element={<Navigate to="/admin/dynamics" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default AdminLayout;
