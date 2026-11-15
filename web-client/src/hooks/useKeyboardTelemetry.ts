import { useEffect } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useWalkthroughStore } from '../store/useWalkthroughStore';

interface KeyboardTelemetryOptions {
  onToggleCommandPalette?: () => void;
}

/**
 * Global Keyboard Shortcuts for Scientific Telemetry Control
 * Specification Anchor: SPECIFICATION.md §6.1.4
 *
 * Shortcuts:
 * - Cmd+K / Ctrl+K: Toggle universal command palette
 * - Spacebar: Play/Pause temporal pass playback
 * - Left/Right Arrow: Step backward/forward by discrete survey pass
 * - 1: Blink mode
 * - 2: Signed Difference mode
 * - 3: Co-Add Stack mode
 * - R: Reset pan/zoom and view parameters
 * - I: Invert grayscale colormap
 */
export function useKeyboardTelemetry(options: KeyboardTelemetryOptions = {}) {
  const { onToggleCommandPalette } = options;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Cmd+K / Ctrl+K works even inside or outside inputs to toggle search
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onToggleCommandPalette?.();
        return;
      }

      // Do not capture other navigation shortcuts when the user is typing into text fields
      // or navigating the interactive walkthrough overlay
      if (isInput || useWalkthroughStore.getState().isOpen) return;

      const store = useTelemetryStore.getState();

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          store.togglePlayback();
          break;

        case 'ArrowLeft':
          event.preventDefault();
          store.stepEpoch(-1);
          break;

        case 'ArrowRight':
          event.preventDefault();
          store.stepEpoch(1);
          break;

        case 'Digit1':
          store.setRenderMode('blink');
          break;

        case 'Digit2':
          store.setRenderMode('difference');
          break;

        case 'Digit3':
          store.setRenderMode('coadd');
          break;

        case 'KeyR':
          store.resetView();
          break;

        case 'KeyI':
          store.toggleInvertGrayscale();
          break;

        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onToggleCommandPalette]);
}
