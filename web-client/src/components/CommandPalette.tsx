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
      label: 'Open Tab 1: Celestial navigator (sky survey view)',
      perform: () => {
        setTab('navigator');
        onClose();
      },
    },
    {
      id: 'tab-comparator',
      category: 'Workspaces',
      label: 'Open Tab 2: Time-domain comparator (multi-epoch blinker)',
      perform: () => {
        setTab('comparator');
        onClose();
      },
    },
    {
      id: 'tab-spectral',
      category: 'Workspaces',
      label: 'Open Tab 3: Spectrophotometric lab (102-band)',
      perform: () => {
        setTab('spectral');
        onClose();
      },
    },
    {
      id: 'tab-ice',
      category: 'Workspaces',
      label: 'Open Tab 4: Molecular and ice studio (lab A-values)',
      perform: () => {
        setTab('ice');
        onClose();
      },
    },
    {
      id: 'tab-discussions',
      category: 'Workspaces',
      label: 'Open Tab 5: Observation discussions and candidate feed',
      perform: () => {
        setTab('discussions');
        onClose();
      },
    },

    // 3. Render Modes
    {
      id: 'mode-blink',
      category: 'Render Modes',
      label: 'Set comparator to blink mode',
      shortcut: '1',
      perform: () => {
        setRenderMode('blink');
        onClose();
      },
    },
    {
      id: 'mode-diff',
      category: 'Render Modes',
      label: 'Set comparator to wavelength-matched difference mode',
      shortcut: '2',
      perform: () => {
        setRenderMode('difference');
        onClose();
      },
    },
    {
      id: 'mode-coadd',
      category: 'Render Modes',
      label: 'Set comparator to inverse-variance co-add stack',
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
      label: 'Toggle epoch pass playback (play / pause)',
      shortcut: 'Space',
      perform: () => {
        togglePlayback();
        onClose();
      },
    },
    {
      id: 'ctrl-invert-grayscale',
      category: 'Viewer Controls',
      label: 'Toggle inverted grayscale colormap',
      shortcut: 'I',
      perform: () => {
        toggleInvertGrayscale();
        onClose();
      },
    },
    {
      id: 'ctrl-reset-view',
      category: 'Viewer Controls',
      label: 'Reset zoom, pan, and crosshairs to field center',
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
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#080A0F]/80 pt-[14dvh] select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-sm border border-[#1E2530] bg-[#0F131A] font-sans text-xs text-[#E6ECF2]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Command Search Input */}
        <div className="flex items-center border-b border-[#1E2530] bg-[#151B24] px-3">
          <svg
            className="mr-2.5 h-3.5 w-3.5 shrink-0 text-[#94A3B8]"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <label htmlFor="spectra-cmdk-input" className="sr-only">
            Filter targets, workspaces, and viewer commands
          </label>
          <input
            id="spectra-cmdk-input"
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Filter targets, workspaces, or viewer actions..."
            className="w-full bg-transparent py-2.5 text-xs text-[#E6ECF2] placeholder-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#38BDF8]"
          />
          <kbd className="rounded-sm border border-[#1E2530] bg-[#0F131A] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8]">
            Esc
          </kbd>
        </div>

        {/* Action List */}
        <div className="max-h-[340px] overflow-y-auto p-1.5" role="listbox">
          {filteredActions.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#94A3B8]">
              No matching targets or commands. Clear the filter or enter decimal/sexagesimal coordinates in the header search bar.
            </div>
          ) : (
            filteredActions.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={action.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={action.perform}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-left text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                    isSelected
                      ? 'border border-[#38BDF8] bg-[#151B24] text-[#E6ECF2]'
                      : 'border border-transparent text-[#94A3B8] hover:bg-[#151B24]/60 hover:text-[#E6ECF2]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 text-[11px] text-[#94A3B8]">
                      {action.category}
                    </span>
                    <span className="text-[#E6ECF2]">{action.label}</span>
                  </div>
                  {action.shortcut && (
                    <kbd className="rounded-sm border border-[#1E2530] bg-[#080A0F] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[#94A3B8]">
                      {action.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-[#1E2530] bg-[#080A0F] px-3 py-1.5 text-[11px] text-[#94A3B8]">
          <span>Up/Down to select · Enter to run · Esc to close</span>
          <span>Spectra command palette</span>
        </div>
      </div>
    </div>
  );
};
