import React from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { TrainingDynamics } from './TrainingDynamics';
import { ActivationInspector } from './ActivationInspector';
import { DecisionBoundaries } from './DecisionBoundaries';
import { Button, Badge } from '../components/ui';
import { cn } from '../lib/utils';

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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* MISSION CONTROL TOP BAR (SPECIFICATION.md §6.4) */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <h1 className="text-xs font-semibold tracking-wide text-foreground">
              Spectra mission control · Operations console
            </h1>
          </div>
          <Badge variant="sky" className="font-mono text-[10px]">
            Clearance: SEC
          </Badge>
          <Badge variant="amber" className="font-mono text-[10px]">
            Read-Only Demo Mode
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/explore?tab=navigator">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <span>←</span>
              <span>Return to sky view</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* SUB-NAVIGATION TABS BAR */}
      <nav className="flex items-center border-b border-border bg-secondary/40 px-4 gap-1 shrink-0 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <Link
              key={item.id}
              to={item.path}
              className={cn(
                'px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                isActive
                  ? 'border-primary text-foreground bg-primary/10'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
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
                <div className="max-w-md rounded-sm border border-border bg-card p-6 shadow-md">
                  <h3 className="text-sm font-semibold text-foreground">
                    Tab 4: Disagreement & Escalation Queue (/admin/triage)
                  </h3>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Hard-negative triage and raw FITS HDU 1–6 verification queue mounts here (Assigned to Role E6 / Issue #28).
                  </p>
                  <div className="mt-4">
                    <Link to="/admin/dynamics">
                      <Button variant="default" size="sm">
                        Return to Training Dynamics
                      </Button>
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
                <div className="max-w-md rounded-sm border border-border bg-card p-6 shadow-md">
                  <h3 className="text-sm font-semibold text-foreground">
                    Tab 5: Mission Data Product Hub (/admin/exports)
                  </h3>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Calibration pool manager and the 4 SPHEREx community data product exports mount here (Assigned to Role E6 / Issue #28).
                  </p>
                  <div className="mt-4">
                    <Link to="/admin/dynamics">
                      <Button variant="default" size="sm">
                        Return to Training Dynamics
                      </Button>
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
