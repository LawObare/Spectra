import React, { useState, useEffect, useRef } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
  parseCoordinateInput,
} from './GlobalCommandHeader';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaletteAction {
  id: string;
  category: 'Sky Catalog' | 'Workspaces' | 'Render Modes' | 'Viewer Controls';
  label: string;
  shortcut?: string;
  perform: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isResolvingSesame, setIsResolvingSesame] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    setCoordinates,
    setRenderMode,
    setRgbPreset,
    toggleInvertGrayscale,
    togglePlayback,
    resetView,
  } = useTelemetryStore();

  const { setTab, setRa, setDec, setPreset } = useSpectraUrlState();

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
    // 1. Searchable Sky Catalog Targets
    ...SEARCHABLE_SKY_CATALOG.map((item) => {
      const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === item.id);
      return {
        id: `catalog-${item.id}`,
        category: 'Sky Catalog' as const,
        label: `${item.name} — ${item.description}`,
        shortcut: `${item.ra.toFixed(2)}°, ${item.dec >= 0 ? '+' : ''}${item.dec.toFixed(2)}°`,
        perform: () => {
          setCoordinates(
            item.ra,
            item.dec,
            item.name,
            isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]'
          );
          setRa(item.ra);
          setDec(item.dec);
          if (item.preset) {
            setRgbPreset(item.preset);
            setPreset(item.preset);
          }
          onClose();
        },
      };
    }),

    // 2. Workspace Tabs
    {
      id: 'tab-navigator',
      category: 'Workspaces',
      label: 'Open Tab 1: Sky & spectral image search (stitched LVF footprints)',
      perform: () => {
        setTab('navigator');
        onClose();
      },
    },
    {
      id: 'tab-comparator',
      category: 'Workspaces',
      label: 'Open Tab 2: Time-domain comparator (multi-epoch Float32 blinker)',
      perform: () => {
        setTab('comparator');
        onClose();
      },
    },
    {
      id: 'tab-spectral',
      category: 'Workspaces',
      label: 'Open Tab 3: Spectrophotometric lab (102-channel WCS-WAVE)',
      perform: () => {
        setTab('spectral');
        onClose();
      },
    },
    {
      id: 'tab-ice',
      category: 'Workspaces',
      label: 'Open Tab 4: Molecular and ice studio (laboratory A-values)',
      perform: () => {
        setTab('ice');
        onClose();
      },
    },
    {
      id: 'tab-discussions',
      category: 'Workspaces',
      label: 'Open Tab 5: Observation discussions and archive cross-match',
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

  // Check if query is a direct coordinate string
  const parsedCoords = parseCoordinateInput(query);

  // Filter actions based on search query
  const filteredActions = actions.filter((action) => {
    if (!query.trim()) return true;
    const lowerQ = query.toLowerCase();
    return (
      action.label.toLowerCase().includes(lowerQ) ||
      action.category.toLowerCase().includes(lowerQ) ||
      (action.shortcut && action.shortcut.toLowerCase().includes(lowerQ))
    );
  });

  // Resolve arbitrary astronomical object via CDS Sesame (SIMBAD/NED)
  const handleResolveArbitraryObject = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (parsedCoords) {
      setCoordinates(
        parsedCoords.ra,
        parsedCoords.dec,
        `J2000 ${parsedCoords.ra.toFixed(4)}°, ${parsedCoords.dec >= 0 ? '+' : ''}${parsedCoords.dec.toFixed(4)}°`,
        '[IRSA Live (spherex_qr2)]'
      );
      setRa(parsedCoords.ra);
      setDec(parsedCoords.dec);
      onClose();
      return;
    }

    setIsResolvingSesame(true);
    try {
      const sesameUrl = `https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV?${encodeURIComponent(
        trimmed
      )}`;
      const res = await fetch(sesameUrl);
      if (res.ok) {
        const xml = await res.text();
        const jradegMatch = xml.match(/<jradeg>([+-]?\d+(?:\.\d+)?)<\/jradeg>/i);
        const jdedegMatch = xml.match(/<jdedeg>([+-]?\d+(?:\.\d+)?)<\/jdedeg>/i);
        const onameMatch = xml.match(/<oname>([^<]+)<\/oname>/i);
        if (jradegMatch && jdedegMatch) {
          const resolvedRa = parseFloat(jradegMatch[1]);
          const resolvedDec = parseFloat(jdedegMatch[1]);
          const resolvedName = onameMatch ? onameMatch[1].trim() : trimmed;
          if (Number.isFinite(resolvedRa) && Number.isFinite(resolvedDec)) {
            setCoordinates(
              resolvedRa,
              resolvedDec,
              resolvedName,
              '[SIMBAD / IRSA Resolved]'
            );
            setRa(resolvedRa);
            setDec(resolvedDec);
            onClose();
          }
        }
      }
    } catch {
      // Non-fatal network error
    } finally {
      setIsResolvingSesame(false);
    }
  };

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
        prev > 0 ? prev - 1 : Math.max(0, filteredActions.length - 1)
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (parsedCoords) {
        handleResolveArbitraryObject();
      } else if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].perform();
      } else if (query.trim().length > 1) {
        handleResolveArbitraryObject();
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
            Search coordinates, SIMBAD object names, workspaces, and viewer commands
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
            placeholder="Enter RA/Dec, SIMBAD object name, workspace, or command..."
            className="w-full bg-transparent py-2.5 text-xs text-[#E6ECF2] placeholder-[#94A3B8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#38BDF8]"
          />
          <kbd className="rounded-sm border border-[#1E2530] bg-[#0F131A] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8]">
            Esc
          </kbd>
        </div>

        {/* Action List */}
        <div className="max-h-[360px] overflow-y-auto p-1.5" role="listbox">
          {parsedCoords && (
            <button
              type="button"
              onClick={handleResolveArbitraryObject}
              className="mb-1 flex w-full items-center justify-between rounded-sm border border-[#38BDF8] bg-[#151B24] px-2.5 py-2 text-left text-xs text-[#E6ECF2]"
            >
              <span>Center sky on J2000 coordinates</span>
              <span className="font-mono text-[#38BDF8]">
                RA {parsedCoords.ra.toFixed(5)}°, Dec {parsedCoords.dec.toFixed(5)}°
              </span>
            </button>
          )}

          {filteredActions.map((action, idx) => {
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
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <span className="w-28 shrink-0 text-[11px] text-[#94A3B8]">
                    {action.category}
                  </span>
                  <span className="truncate text-[#E6ECF2]">{action.label}</span>
                </div>
                {action.shortcut && (
                  <kbd className="shrink-0 rounded-sm border border-[#1E2530] bg-[#080A0F] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[#94A3B8]">
                    {action.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}

          {query.trim().length > 1 && !parsedCoords && (
            <button
              type="button"
              onClick={handleResolveArbitraryObject}
              className="mt-1 flex w-full items-center justify-between rounded-sm border border-[#1E2530] bg-[#151B24] px-2.5 py-2 text-left text-xs text-[#E6ECF2] hover:border-[#38BDF8]"
            >
              <span>
                {isResolvingSesame
                  ? `Resolving "${query.trim()}" via CDS Sesame...`
                  : `Query SIMBAD / NED / IRSA Sesame resolver for "${query.trim()}"`}
              </span>
              <span className="font-mono text-[10px] text-[#38BDF8]">Resolve ↵</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-[#1E2530] bg-[#080A0F] px-3 py-1.5 text-[11px] text-[#94A3B8]">
          <span>Up/Down to select · Enter to execute or resolve · Esc to close</span>
          <span>Spectra Universal Resolver</span>
        </div>
      </div>
    </div>
  );
};
