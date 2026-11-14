import React, { useState, useEffect, useRef } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { MANDATORY_BENCHMARKS } from './GlobalCommandHeader';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaletteAction {
  id: string;
  category: 'Benchmarks' | 'Workspaces' | 'Render Modes' | 'Viewer Controls';
  label: string;
  shortcut?: string;
  perform: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    setCoordinates,
    setRenderMode,
    toggleInvertGrayscale,
    togglePlayback,
    resetView,
  } = useTelemetryStore();

  const { setTab, setRa, setDec } = useSpectraUrlState();

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build Palette Actions
  const actions: PaletteAction[] = [
    // 1. Mandatory Benchmark Targets
    ...MANDATORY_BENCHMARKS.map((b) => ({
      id: `benchmark-${b.id}`,
      category: 'Benchmarks' as const,
      label: `Jump to ${b.name} (${b.description})`,
      perform: () => {
        setCoordinates(b.ra, b.dec, b.name, '[NASA Benchmark (Pre-cached)]');
        setRa(b.ra);
        setDec(b.dec);
        onClose();
      },
    })),

    // 2. Workspace Tabs
    {
      id: 'tab-navigator',
      category: 'Workspaces',
      label: 'Switch to Tab 1: Celestial Navigator (3D Dome)',
      perform: () => {
        setTab('navigator');
        onClose();
      },
    },
    {
      id: 'tab-comparator',
      category: 'Workspaces',
      label: 'Switch to Tab 2: Time-Domain Comparator (Blinker)',
      perform: () => {
        setTab('comparator');
        onClose();
      },
    },
    {
      id: 'tab-spectral',
      category: 'Workspaces',
      label: 'Switch to Tab 3: Spectrophotometric Lab (102-Band)',
      perform: () => {
        setTab('spectral');
        onClose();
      },
    },
    {
      id: 'tab-ice',
      category: 'Workspaces',
      label: 'Switch to Tab 4: Molecular & Ice Studio (A-Values)',
      perform: () => {
        setTab('ice');
        onClose();
      },
    },
    {
      id: 'tab-discussions',
      category: 'Workspaces',
      label: 'Switch to Tab 5: Observation Discussions & Community Feed',
      perform: () => {
        setTab('discussions');
        onClose();
      },
    },

    // 3. Render Modes
    {
      id: 'mode-blink',
      category: 'Render Modes',
      label: 'Switch to Blink Mode',
      shortcut: '1',
      perform: () => {
        setRenderMode('blink');
        onClose();
      },
    },
    {
      id: 'mode-diff',
      category: 'Render Modes',
      label: 'Switch to Pairwise Signed Difference Mode',
      shortcut: '2',
      perform: () => {
        setRenderMode('difference');
        onClose();
      },
    },
    {
      id: 'mode-coadd',
      category: 'Render Modes',
      label: 'Switch to Inverse-Variance Co-Add Stack Mode',
      shortcut: '3',
      perform: () => {
        setRenderMode('coadd');
        onClose();
      },
    },

    // 4. Viewer Controls
    {
      id: 'ctrl-play-pause',
      category: 'Viewer Controls',
      label: 'Toggle Pass Playback (Play / Pause)',
      shortcut: 'Space',
      perform: () => {
        togglePlayback();
        onClose();
      },
    },
    {
      id: 'ctrl-invert-grayscale',
      category: 'Viewer Controls',
      label: 'Toggle Inverted Grayscale Colormap',
      shortcut: 'I',
      perform: () => {
        toggleInvertGrayscale();
        onClose();
      },
    },
    {
      id: 'ctrl-reset-view',
      category: 'Viewer Controls',
      label: 'Reset Zoom, Pan & Crosshairs to Center',
      shortcut: 'R',
      perform: () => {
        resetView();
        onClose();
      },
    },
  ];

  // Filter actions based on search query
  const filteredActions = actions.filter((action) => {
    if (!query.trim()) return true;
    const lowerQ = query.toLowerCase();
    return (
      action.label.toLowerCase().includes(lowerQ) ||
      action.category.toLowerCase().includes(lowerQ)
    );
  });

  // Handle keyboard navigation within the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredActions.length - 1 ? prev + 1 : 0
      );
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredActions.length - 1
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].perform();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[#1E2633] bg-[#090C10] shadow-2xl font-mono text-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Command Search Input */}
        <div className="flex items-center border-b border-[#1E2633] px-3">
          <span className="text-slate-400 mr-2 text-xs">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a target, workspace tab, or shortcut..."
            className="w-full bg-transparent py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400">
            ESC
          </kbd>
        </div>

        {/* Action List */}
        <div className="max-h-[360px] overflow-y-auto p-2">
          {filteredActions.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              No matching commands or benchmarks found.
            </div>
          ) : (
            filteredActions.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={action.id}
                  onClick={action.perform}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex cursor-pointer items-center justify-between rounded px-3 py-2 text-xs transition-colors ${
                    isSelected
                      ? 'bg-cyan-950/70 text-[#00F0FF] border border-cyan-500/30'
                      : 'text-slate-300 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      [{action.category}]
                    </span>
                    <span>{action.label}</span>
                  </div>
                  {action.shortcut && (
                    <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {action.shortcut}
                    </kbd>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#1E2633] px-3 py-1.5 text-[10px] text-slate-500 flex justify-between">
          <span>↑↓ to navigate • ↵ to select • ESC to close</span>
          <span>SPECTRA COMMAND PALETTE</span>
        </div>
      </div>
    </div>
  );
};
