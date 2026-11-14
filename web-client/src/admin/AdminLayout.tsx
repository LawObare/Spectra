import React from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { TrainingDynamics } from './TrainingDynamics';
import { ActivationInspector } from './ActivationInspector';
import { DecisionBoundaries } from './DecisionBoundaries';
import { HardNegativeTriage } from './HardNegativeTriage';
import { DataProductExports } from './DataProductExports';
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
    if (currentPath.includes('/admin/boundaries')) return 'boundaries';
    if (currentPath.includes('/admin/internals')) return 'internals';
    if (currentPath.includes('/admin/exports') || currentPath.includes('/admin/triage')) return 'exports';
    return 'dynamics';
  };

  const activeTab = getActiveTab();

  const navItems = [
    { id: 'dynamics', label: '1. SFT & LoRA Training Studio', path: '/admin/dynamics' },
    { id: 'boundaries', label: '2. AI Knowledge & Relationship Graph', path: '/admin/boundaries' },
    { id: 'internals', label: '3. Live AI Identification Co-Pilot', path: '/admin/internals' },
    { id: 'exports', label: '4. TRL Dataset & Export Hub', path: '/admin/exports' },
  ];

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* MISSION CONTROL TOP BAR */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <h1 className="text-xs font-semibold tracking-wide text-foreground">
              Spectra AI Lab · SFTTrainer & Mission Control
            </h1>
          </div>
          <Badge variant="sky" className="font-mono text-[10px]">
            PyTorch + HF TRL
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
          <Route path="/triage" element={<HardNegativeTriage />} />
          <Route path="/exports" element={<DataProductExports />} />
          <Route path="*" element={<Navigate to="/admin/dynamics" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default AdminLayout;
