import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { WebGLComparatorCanvas, HoverPixelInfo } from '../components/WebGLComparatorCanvas';
import { MANDATORY_BENCHMARKS } from '../components/GlobalCommandHeader';
import type { TensorHeader, TensorWorkerResponse } from '../workers/tensorWorker';
import {
  fetchInstalledSections,
  findMatchingSection,
  formatSectionBytes,
  startSectionInstall,
  useDownloadingSections,
  useDownloadingSummary,
  useInstalledSectionState,
  type InstalledSection,
} from '../lib/installedSections';

function pixelToSky(
  x: number,
  y: number,
  wcs: { crval: [number, number]; cdelt: [number, number]; crpix: [number, number] }
): { ra: number; dec: number } {
  const toRad = Math.PI / 180;
  const ra0 = wcs.crval[0] * toRad;
  const dec0 = wcs.crval[1] * toRad;
  const xi = (x + 1 - wcs.crpix[0]) * wcs.cdelt[0] * toRad;
  const eta = (y + 1 - wcs.crpix[1]) * wcs.cdelt[1] * toRad;
  const denominator = Math.cos(dec0) - eta * Math.sin(dec0);
  const ra = ((ra0 + Math.atan2(xi, denominator)) / toRad + 360) % 360;
  const dec = Math.atan2(
    Math.sin(dec0) + eta * Math.cos(dec0),
    Math.hypot(denominator, xi)
  ) / toRad;
  return { ra, dec };
}

/**
 * Spectra Tab 2: Time-Domain Comparator (<TimeDomainComparator />)
 * Specification Anchor: SPECIFICATION.md §6.1.6, §6.1.7, §6.3.2, §7.1; DESIGN.md
 * Role: E3 (role:E3-webgl)
 *
 * Capabilities:
 * - 65% Left Canvas Deck: WebGL2 Float32 comparator canvas, discrete MJD scrubber,
 *   Frame-0 cyan border indicator, sub-pixel Gaia DR3 centroid reticle, and hover HUD.
 * - 35% Right Analysis Deck:
 *   - Render Mode Switcher: Blink, Signed Difference, Inverse-Variance Co-Add
 *   - Asinh non-linearity parameter slider (a in [0.001, 1.0])
 *   - (Epoch x Band) Coverage Matrix with strict Wavelength-Matched Differencing Guard
 *   - Honest [Not Detected at Pass Depth] states (WISE 0855 in D1-D3)
 *   - 6-Detector False-Color RGB Super-Band Mixer
 *   - Forced 3x3 Aperture Multi-Band Light Curve (D1 vs D5)
 *   - Interactive 2-click Proper Motion Vector Calculator (Delta alpha, Delta delta, PA)
 *   - Triage classification form linking to Tab 5 Discussions
 */

// Discrete survey passes derived from IRSA SIA2 exposure MJD clustering (backend/config/survey_passes.json)
interface SurveyPass {
  passIndex: number;
  label: string;
  mjd: number;
  mjdRange: [number, number];
  dateStr: string;
  rollAngleDeg: number;
}

interface MarkedObject {
  id: number;
  x: number;
  y: number;
  radiusPx: number;
  ra: number;
  dec: number;
  epochIndex: number;
  passLabel: string;
  mjd: number;
  bandId: string;
  flux: number;
  snr: number;
  classification: string;
  confidence: number;
}

const PIXEL_SCALE_ARCSEC = 6.2;

function fallbackPixelToSky(
  px: number,
  py: number,
  width: number,
  height: number,
  centerRa: number,
  centerDec: number
): { ra: number; dec: number } {
  const cosDec = Math.max(0.1, Math.cos((centerDec * Math.PI) / 180));
  const dxArcsec = (px - (width - 1) / 2) * PIXEL_SCALE_ARCSEC;
  const dyArcsec = -(py - (height - 1) / 2) * PIXEL_SCALE_ARCSEC;
  const ra = (centerRa + dxArcsec / (3600 * cosDec) + 360) % 360;
  const dec = Math.max(-90, Math.min(90, centerDec + dyArcsec / 3600));
  return { ra, dec };
}

const DISCRETE_SURVEY_PASSES: SurveyPass[] = [
  { passIndex: 0, label: 'Pass 1', mjd: 60810.4, mjdRange: [60789.9, 61053.4], dateStr: '2025-05-15', rollAngleDeg: 12.4 },
  { passIndex: 1, label: 'Pass 2', mjd: 60995.2, mjdRange: [61091.7, 61237.9], dateStr: '2025-11-16', rollAngleDeg: 34.8 },
  { passIndex: 2, label: 'Pass 3', mjd: 61178.6, mjdRange: [61178.6, 61360.2], dateStr: '2026-05-18', rollAngleDeg: 58.2 },
];

const BANDS = [
  { id: 'D1', name: 'D1 (0.9 µm)', wavelengthUm: 0.93, resPower: 41 },
  { id: 'D2', name: 'D2 (1.3 µm)', wavelengthUm: 1.37, resPower: 45 },
  { id: 'D3', name: 'D3 (2.0 µm)', wavelengthUm: 2.02, resPower: 57 },
  { id: 'D4', name: 'D4 (3.1 µm)', wavelengthUm: 3.12, resPower: 80 },
  { id: 'D5', name: 'D5 (4.1 µm)', wavelengthUm: 4.12, resPower: 110 },
  { id: 'D6', name: 'D6 (4.7 µm)', wavelengthUm: 4.71, resPower: 130 },
];

function getPlaneMaxNExp(plane: Uint16Array | null | undefined): number {
  if (!plane || plane.length === 0) return 0;
  let max = 0;
  for (let i = 0; i < plane.length; i++) {
    if (plane[i] > max) max = plane[i];
  }
  return max;
}

function pickObservedCell(
  nExpData: Uint16Array[][],
  preferredBandIndex: number
): { epochIndex: number; bandIndex: number } {
  const epochs = nExpData.length;
  const bands = nExpData[0]?.length ?? 6;
  // 1. Keep preferred band if epoch 0 or any epoch has real coverage
  for (let e = 0; e < epochs; e++) {
    if (getPlaneMaxNExp(nExpData[e]?.[preferredBandIndex]) > 0) {
      return { epochIndex: e, bandIndex: preferredBandIndex };
    }
  }
  // 2. Otherwise prefer thermal/longer bands first (D5, D6, D4, D3, D2, D1)
  for (const b of [4, 5, 3, 2, 1, 0]) {
    if (b >= bands) continue;
    for (let e = 0; e < epochs; e++) {
      if (getPlaneMaxNExp(nExpData[e]?.[b]) > 0) {
        return { epochIndex: e, bandIndex: b };
      }
    }
  }
  return { epochIndex: 0, bandIndex: preferredBandIndex };
}

const CANVAS_PIXEL_DIM = 29; // Standard 29x29 cutout stamp (~180" FoV at 6.2"/px)

export interface DecodedSectionTensor {
  fluxData: Float32Array[][];
  varData: Float32Array[][];
  flagsData: Uint32Array[][];
  nExpData: Uint16Array[][];
  width: number;
  height: number;
  epochs: number;
  isSimulated: boolean;
  sourceBadge: string;
  wcs?: { crval: [number, number]; cdelt: [number, number]; crpix: [number, number] };
  mjdRanges?: number[][][];
  exposureIds?: string[][] | string[];
}

const MAX_DECODED_TENSOR_CACHE = 8;
const DECODED_TENSOR_LRU = new Map<string, { parsed: DecodedSectionTensor; sourceBadge: string }>();

function getSectionTensorCacheKey(section: InstalledSection): string {
  return `${section.section_id}:${section.updated_at || section.size_bytes}`;
}

function getCachedDecodedTensor(
  key: string
): { parsed: DecodedSectionTensor; sourceBadge: string } | null {
  const hit = DECODED_TENSOR_LRU.get(key);
  if (!hit) return null;
  DECODED_TENSOR_LRU.delete(key);
  DECODED_TENSOR_LRU.set(key, hit);
  return hit;
}

function setCachedDecodedTensor(
  key: string,
  value: { parsed: DecodedSectionTensor; sourceBadge: string }
): void {
  if (DECODED_TENSOR_LRU.has(key)) {
    DECODED_TENSOR_LRU.delete(key);
  } else if (DECODED_TENSOR_LRU.size >= MAX_DECODED_TENSOR_CACHE) {
    const oldestKey = DECODED_TENSOR_LRU.keys().next().value;
    if (oldestKey !== undefined) {
      DECODED_TENSOR_LRU.delete(oldestKey);
    }
  }
  DECODED_TENSOR_LRU.set(key, value);
}

const ComparatorHoverHud: React.FC<{
  setterRef: React.MutableRefObject<((info: HoverPixelInfo | null) => void) | null>;
}> = React.memo(({ setterRef }) => {
  const [hoverPixel, setHoverPixel] = useState<HoverPixelInfo | null>(null);

  useEffect(() => {
    setterRef.current = setHoverPixel;
    return () => {
      if (setterRef.current === setHoverPixel) {
        setterRef.current = null;
      }
    };
  }, [setterRef]);

  return (
    <div>
      {hoverPixel ? (
        <span>
          Cursor: <span className="text-white">[{hoverPixel.x}, {hoverPixel.y}]</span> |{' '}
          Flux: <span className="text-sky-400">{hoverPixel.flux.toFixed(2)} MJy/sr</span> |{' '}
          SNR: <span className="text-emerald-400">{hoverPixel.snr.toFixed(1)}</span> |{' '}
          FLAGS:{' '}
          <span className={hoverPixel.flags ? 'text-amber-400' : 'text-neutral-400'}>
            0x{hoverPixel.flags.toString(16).padStart(3, '0')} ({hoverPixel.flagNames.join(', ')})
          </span>
        </span>
      ) : (
        <span>Hover over canvas to inspect pixel flux, SNR, and HDU 2 flags.</span>
      )}
    </div>
  );
});

export interface TimeDomainComparatorProps {
  onOpenCatalog?: () => void;
}

const ComparatorDownloadProgress: React.FC<{
  ra: number;
  dec: number;
  fovArcsec: number;
  fallbackProgress: number;
  fallbackMessage: string;
}> = React.memo(({ ra, dec, fovArcsec, fallbackProgress, fallbackMessage }) => {
  const downloadingSections = useDownloadingSections();
  const activeDownload = downloadingSections.find(
    (d) =>
      Math.abs(d.ra - ra) < 0.002 &&
      Math.abs(d.dec - dec) < 0.002 &&
      Math.abs(d.fov_arcsec - Math.round(fovArcsec || 300)) <= 1
  );
  const displayProgress = activeDownload ? activeDownload.progress : fallbackProgress;
  const displayMessage = activeDownload ? activeDownload.message : fallbackMessage;
  const isOrange = Boolean(activeDownload);

  return (
    <>
      <p className="mt-4 text-sm leading-6 text-slate-300" role="status">
        {displayMessage}
      </p>
      <div
        className="mt-6 h-1 overflow-hidden rounded bg-slate-800"
        role="progressbar"
        aria-label="SPHEREx data loading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayProgress * 100)}
      >
        <div
          className={`h-full rounded transition-[width] duration-300 ease-out ${isOrange ? 'bg-orange-500' : 'bg-cyan-400'}`}
          style={{ width: `${Math.max(1, displayProgress * 100)}%` }}
        />
      </div>
      <p className={`mt-1 text-right font-mono text-[10px] ${isOrange ? 'text-orange-300' : 'text-slate-500'}`}>
        {Math.round(displayProgress * 100)}%
      </p>
    </>
  );
});

export const TimeDomainComparator: React.FC<TimeDomainComparatorProps> = ({ onOpenCatalog }) => {
  const {
    ra: urlRa,
    dec: urlDec,
    fov: urlFov,
    setRa: setUrlRa,
    setDec: setUrlDec,
    setFov: setUrlFov,
    mode: urlMode,
    setMode: setUrlMode,
    probeX: urlPx,
    probeY: urlPy,
    setProbeX: setUrlProbeX,
    setProbeY: setUrlProbeY,
    setTab,
  } = useSpectraUrlState();

  const store = useTelemetryStore();
  const {
    renderMode,
    setRenderMode,
    activeEpochIndex,
    setEpochIndex,
    isPlaying,
    setPlayback,
    togglePlayback,
    playbackSpeedMs,
    loopMode,
    asinhParamA,
    setAsinhParams,
    colorPalette,
    setColorPalette,
    rawVsRectified,
    setRawVsRectified,
    activeRgbPreset,
    setRgbPreset,
    setProbedPixel,
    setProbeSkyPosition,
  } = store;

  const [activeBandIndex, setActiveBandIndex] = useState<number>(4); // Default to Band D5 (index 4)
  const activeBandRef = useRef<number>(activeBandIndex);
  activeBandRef.current = activeBandIndex;
  const hoverHudSetterRef = useRef<((info: HoverPixelInfo | null) => void) | null>(null);
  const handlePixelHover = useCallback((info: HoverPixelInfo | null) => {
    hoverHudSetterRef.current?.(info);
  }, []);
  const [measuringMotion, setMeasuringMotion] = useState<boolean>(false);
  const [motionPoints, setMotionPoints] = useState<Array<{ x: number; y: number; epoch: number }>>([]);
  const [motionResult, setMotionResult] = useState<{
    deltaAlphaArcsec: number;
    deltaDeltaArcsec: number;
    totalMotionArcsecYr: number;
    positionAngleDeg: number;
  } | null>(null);
  const [lastMotionVector, setLastMotionVector] = useState<{
    p0: { x: number; y: number; epoch: number };
    p1: { x: number; y: number; epoch: number };
  } | null>(null);
  const [markedObjects, setMarkedObjects] = useState<MarkedObject[]>([]);
  const [selectedMarkId, setSelectedMarkId] = useState<number | null>(null);
  const nextMarkIdRef = useRef<number>(1);
  const [snapToPeak, setSnapToPeak] = useState<boolean>(true);

  const selectedMark = useMemo(
    () => markedObjects.find((m) => m.id === selectedMarkId) ?? null,
    [markedObjects, selectedMarkId]
  );

  // Triage state
  const [triageClass, setTriageClass] = useState<string>('moving_brown_dwarf');
  const [triageConfidence, setTriageConfidence] = useState<number>(85);
  const [triageSubmitted, setTriageSubmitted] = useState<boolean>(false);
  const [isSubmittingClassification, setIsSubmittingClassification] = useState<boolean>(false);
  const [loadedTensor, setLoadedTensor] = useState<DecodedSectionTensor | null>(null);
  const [dataStatus, setDataStatus] = useState<'loading' | 'error' | 'ready' | 'uninstalled'>('loading');
  const [dataMessage, setDataMessage] = useState('Checking installed cutout sections…');
  const [dataProgress, setDataProgress] = useState(0);
  const [loadedCutoutCount, setLoadedCutoutCount] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { installedSections } = useInstalledSectionState();
  const installedSectionsRef = useRef(installedSections);
  installedSectionsRef.current = installedSections;
  const { downloadingMeta } = useDownloadingSummary();
  const [activeInstalledSection, setActiveInstalledSection] = useState<InstalledSection | null>(null);
  const [forceLiveCoordKey, setForceLiveCoordKey] = useState<string | null>(null);
  const prevMatchingDownloadRef = useRef<boolean>(false);
  const [canvasZoom, setCanvasZoom] = useState<'fit' | '1x' | '2x' | '4x'>('fit');
  const [isSmoothRendering, setIsSmoothRendering] = useState(true);

  const currentCoordKey = `${urlRa.toFixed(5)},${urlDec.toFixed(5)},${Math.round(urlFov || 300)}`;

  useEffect(() => {
    setMarkedObjects([]);
    setSelectedMarkId(null);
    nextMarkIdRef.current = 1;
    setMotionPoints([]);
    setMotionResult(null);
    setLastMotionVector(null);
    setTriageSubmitted(false);
  }, [currentCoordKey]);

  const handleSelectMark = useCallback(
    (mark: MarkedObject) => {
      setSelectedMarkId(mark.id);
      setTriageClass(mark.classification);
      setTriageConfidence(mark.confidence);
      setTriageSubmitted(false);
      setProbedPixel({ x: mark.x, y: mark.y });
      setProbeSkyPosition({ ra: mark.ra, dec: mark.dec });
      setUrlProbeX(mark.x);
      setUrlProbeY(mark.y);
    },
    [setProbedPixel, setProbeSkyPosition, setUrlProbeX, setUrlProbeY]
  );

  const handleRemoveMark = useCallback(
    (markId: number) => {
      setMarkedObjects((prev) => {
        const next = prev.filter((m) => m.id !== markId);
        if (selectedMarkId === markId) {
          const fallback = next[next.length - 1] ?? null;
          setSelectedMarkId(fallback ? fallback.id : null);
          if (fallback) {
            setTriageClass(fallback.classification);
            setTriageConfidence(fallback.confidence);
            setProbedPixel({ x: fallback.x, y: fallback.y });
            setProbeSkyPosition({ ra: fallback.ra, dec: fallback.dec });
            setUrlProbeX(fallback.x);
            setUrlProbeY(fallback.y);
          } else {
            setProbedPixel(null);
            setProbeSkyPosition(null);
          }
        }
        return next;
      });
    },
    [selectedMarkId, setProbedPixel, setProbeSkyPosition, setUrlProbeX, setUrlProbeY]
  );

  const handleClearMarks = useCallback(() => {
    setMarkedObjects([]);
    setSelectedMarkId(null);
    nextMarkIdRef.current = 1;
    setProbedPixel(null);
    setProbeSkyPosition(null);
  }, [setProbedPixel, setProbeSkyPosition]);

  const syncSelectedMarkTriage = useCallback(
    (nextClass: string, nextConfidence: number) => {
      if (selectedMarkId === null) return;
      setMarkedObjects((prev) =>
        prev.map((m) =>
          m.id === selectedMarkId
            ? { ...m, classification: nextClass, confidence: nextConfidence }
            : m
        )
      );
    },
    [selectedMarkId]
  );
  const readyInstalledSections = useMemo(
    () => installedSections.filter((s) => s.status === 'ready'),
    [installedSections]
  );

  const matchingDownloadingSection = useMemo(
    () =>
      downloadingMeta.find(
        (d) =>
          Math.abs(d.ra - urlRa) < 0.002 &&
          Math.abs(d.dec - urlDec) < 0.002 &&
          Math.abs(d.fov_arcsec - Math.round(urlFov || 300)) <= 1
      ) || null,
    [downloadingMeta, urlRa, urlDec, urlFov]
  );

  const isInstallingHere = Boolean(matchingDownloadingSection);

  useEffect(() => {
    if (prevMatchingDownloadRef.current && !isInstallingHere && !loadedTensor) {
      setLoadAttempt((a) => a + 1);
    }
    prevMatchingDownloadRef.current = isInstallingHere;
  }, [isInstallingHere, loadedTensor]);

  const handleSelectInstalledSection = useCallback(
    (section: InstalledSection) => {
      setForceLiveCoordKey(null);
      setUrlRa(Number(section.ra.toFixed(5)));
      setUrlDec(Number(section.dec.toFixed(5)));
      setUrlFov(Math.round(section.fov_arcsec || 300));
      useTelemetryStore.setState({
        ra: section.ra,
        dec: section.dec,
        activeTargetName: section.label,
      });
    },
    [setUrlRa, setUrlDec, setUrlFov]
  );

  const handleInstallSectionHere = useCallback(() => {
    const label =
      store.activeTargetName ||
      `Field (${urlRa.toFixed(4)}°, ${urlDec >= 0 ? '+' : ''}${urlDec.toFixed(4)}°)`;
    void startSectionInstall({
      ra: urlRa,
      dec: urlDec,
      fovArcsec: Math.round(urlFov || 300),
      label,
    });
  }, [store.activeTargetName, urlDec, urlFov, urlRa]);

  const handleSubmitClassification = async () => {
    setIsSubmittingClassification(true);
    setTriageSubmitted(true);
    try {
      let id = localStorage.getItem('spx_observer_id');
      let key = localStorage.getItem('spx_observer_key');
      if (!id && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
        localStorage.setItem('spx_observer_id', id);
      } else if (!id) {
        id = '00000000-0000-4000-8000-000000007f3a';
        localStorage.setItem('spx_observer_id', id);
      }
      if (!key && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('spx_observer_key', key);
      } else if (!key) {
        key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
        localStorage.setItem('spx_observer_key', key);
      }

      const updatedMarks = markedObjects.map((m) =>
        m.id === selectedMarkId
          ? { ...m, classification: triageClass, confidence: triageConfidence }
          : m
      );
      const activeMarkPayload =
        updatedMarks.find((m) => m.id === selectedMarkId) ?? null;

      const subjectId = activeBenchmark?.id || `subj-${urlRa.toFixed(4)}-${urlDec.toFixed(4)}`;
      await fetch('/api/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Observer-ID': id,
          'X-Observer-Key': key,
        },
        body: JSON.stringify({
          subject_id: subjectId,
          tab_workflow: 'comparator',
          primary_class: triageClass,
          confidence: triageConfidence / 100,
          motion_telemetry: {
            ra: activeMarkPayload?.ra ?? urlRa,
            dec: activeMarkPayload?.dec ?? urlDec,
            renderMode,
            epochIndex: activeMarkPayload?.epochIndex ?? activeEpochIndex,
            targetName: activeBenchmark?.name || store.activeTargetName,
            selected_mark: activeMarkPayload,
            marked_objects: updatedMarks,
          },
        }),
      });
    } catch {
      // Optimistic local fallback preserved when backend is offline
    } finally {
      setIsSubmittingClassification(false);
    }
  };

  const handleNextCandidate = async () => {
    setTriageSubmitted(false);
    try {
      const res = await fetch('/api/queue/next');
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.ra === 'number' && typeof data.dec === 'number') {
          store.setCoordinates(
            data.ra,
            data.dec,
            data.name || data.subject_id || `Candidate ${data.ra.toFixed(4)}, ${data.dec.toFixed(4)}`,
            '[Active Learning Queue]'
          );
          return;
        }
      }
    } catch {
      // Graceful fallback to next catalog target
    }
    // Fallback: cycle to next mandatory NASA benchmark
    const currentIdx = MANDATORY_BENCHMARKS.findIndex(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );
    const nextBenchmark = MANDATORY_BENCHMARKS[(currentIdx + 1) % MANDATORY_BENCHMARKS.length];
    if (nextBenchmark) {
      store.setCoordinates(
        nextBenchmark.ra,
        nextBenchmark.dec,
        nextBenchmark.name,
        '[IRSA query pending]'
      );
    }
  };

  // 1. Identify active benchmark if coordinates match (Epoch 2025.5 or J2000 / WISE 2010.5 discovery epoch)
  const activeBenchmark = useMemo(() => {
    const direct = MANDATORY_BENCHMARKS.find(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );
    if (direct) return direct;
    // Also match WISE 0855 at WISE discovery (2010.5: 133.7862, -7.2443) or J2000 (133.7951, -7.2452)
    if (Math.abs(133.79 - urlRa) < 0.07 && Math.abs(-7.244 - urlDec) < 0.05) {
      return MANDATORY_BENCHMARKS.find((b) => b.id === 'wise0855');
    }
    return undefined;
  }, [urlRa, urlDec]);

  const surveyPasses = useMemo<SurveyPass[]>(() => {
    if (!loadedTensor) return DISCRETE_SURVEY_PASSES;
    return Array.from({ length: loadedTensor.epochs }, (_, passIndex) => {
      const ranges = (loadedTensor.mjdRanges?.[passIndex] || []).filter(
        (range): range is number[] =>
          Array.isArray(range) && range.length >= 2 && range.every(Number.isFinite) && range[0] > 0 && range[1] > 0
      );
      const mjdStart = ranges.length ? Math.min(...ranges.map((range) => range[0])) : 0;
      const mjdEnd = ranges.length ? Math.max(...ranges.map((range) => range[1])) : mjdStart;
      const mjd = (mjdStart + mjdEnd) / 2;
      const dateStr = mjd > 0 ? new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10) : 'Date unavailable';
      return {
        passIndex,
        label: `Pass ${passIndex + 1}`,
        mjd,
        mjdRange: [mjdStart, mjdEnd] as [number, number],
        dateStr,
        rollAngleDeg: 0,
      };
    });
  }, [loadedTensor]);

  // Synchronize renderMode with URL
  useEffect(() => {
    if (urlMode === 'blink' || urlMode === 'difference' || urlMode === 'coadd') {
      if (renderMode !== urlMode) setRenderMode(urlMode);
    }
  }, [urlMode, renderMode, setRenderMode]);

  // 2. Playback animation timer
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setEpochIndex((activeEpochIndex + 1) % Math.max(surveyPasses.length, 1));
    }, playbackSpeedMs);
    return () => clearInterval(interval);
  }, [isPlaying, activeEpochIndex, playbackSpeedMs, setEpochIndex, surveyPasses.length]);

  // Legacy procedural generator removed from mount path because live view requires a decoded tensor.
  const scienceTensors = useMemo(
    () => ({
      fluxData: [] as Float32Array[][],
      varData: [] as Float32Array[][],
      flagsData: [] as Uint32Array[][],
      nExpData: [] as Uint16Array[][],
      isSimulated: true,
    }),
    []
  );

  // Load binary tensor from pre-cached .f32 bundle OR live backend /api/cutout pipeline
  useEffect(() => {
    let cancelled = false;
    let decoderWorker: Worker | null = null;
    const requestController = new AbortController();
    let requestTimedOut = false;
    const requestTimeout = window.setTimeout(() => {
      requestTimedOut = true;
      requestController.abort();
    }, 480_000);

    const decodeBinaryTensorBuffer = (buf: ArrayBuffer, worker: Worker): Promise<TensorWorkerResponse> =>
      new Promise((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<TensorWorkerResponse>) => {
          if (event.data.success) resolve(event.data);
          else reject(new Error(event.data.error || 'Unable to decode the archive tensor.'));
        };
        worker.onerror = (event) => reject(new Error(event.message || 'Tensor worker failed.'));
        worker.postMessage({ buffer: buf }, [buf]);
      });

    const getDecoderWorker = () => {
      if (!decoderWorker) {
        decoderWorker = new Worker(new URL('../workers/tensorWorker.ts', import.meta.url), { type: 'module' });
      }
      return decoderWorker;
    };

    const mapDecodedTensor = (decoded: TensorWorkerResponse) => {
      const hdr: TensorHeader = decoded.header;
      const [epochs, bands, h, w] = hdr.shape;
      const planePixels = h * w;
      const totalPixels = decoded.totalPixels;
      const payload = decoded.payloadBuffer;
      const allFlux = new Float32Array(payload, 0, totalPixels);
      const varianceOffset = totalPixels * 4;
      const flagsOffset = totalPixels * 8;
      const nExpOffset = totalPixels * 12;
      const allVar = new Float32Array(payload, varianceOffset, totalPixels);
      const allFlags = new Uint32Array(payload, flagsOffset, totalPixels);
      const allNExp = new Uint16Array(payload, nExpOffset, totalPixels);

      const fluxData: Float32Array[][] = [];
      const varData: Float32Array[][] = [];
      const flagsData: Uint32Array[][] = [];
      const nExpData: Uint16Array[][] = [];

      for (let e = 0; e < epochs; e++) {
        fluxData[e] = [];
        varData[e] = [];
        flagsData[e] = [];
        nExpData[e] = [];
        for (let b = 0; b < bands; b++) {
          const startIdx = (e * bands + b) * planePixels;
          fluxData[e][b] = allFlux.subarray(startIdx, startIdx + planePixels);
          varData[e][b] = allVar.subarray(startIdx, startIdx + planePixels);
          flagsData[e][b] = allFlags.subarray(startIdx, startIdx + planePixels);
          nExpData[e][b] = allNExp.subarray(startIdx, startIdx + planePixels);
        }
      }

      const isSim = hdr.is_simulated !== false;
      const badge = isSim
        ? activeBenchmark
          ? '[Benchmark Model (Simulated)]'
          : '[Simulated Fallback (Offline)]'
        : hdr.source_badge || `[IRSA Live (${hdr.release || 'release unavailable'})]`;

      return {
        fluxData,
        varData,
        flagsData,
        nExpData,
        width: w,
        height: h,
        epochs,
        isSimulated: isSim,
        sourceBadge: badge,
        wcs: Array.isArray(hdr.crval) && Array.isArray(hdr.cdelt) && Array.isArray(hdr.crpix)
          ? { crval: hdr.crval, cdelt: hdr.cdelt, crpix: hdr.crpix }
          : undefined,
        mjdRanges: hdr.mjd_ranges,
        exposureIds: hdr.exposure_ids,
      };
    };

    const loadCutoutTensor = async () => {
      const applyLoadedTensor = (
        parsed: DecodedSectionTensor,
        badge: string
      ) => {
        if (cancelled) return;
        const firstCell = pickObservedCell(parsed.nExpData, activeBandRef.current);
        useTelemetryStore.setState({
          sourceBadge: badge,
          totalEpochs: Math.max(1, parsed.epochs),
        });
        setLoadedTensor(parsed);
        setDataStatus('ready');
        setDataProgress(1);
        setDataMessage(badge);
        setActiveBandIndex(firstCell.bandIndex);
        setEpochIndex(firstCell.epochIndex);
      };

      const quickMatch = findMatchingSection(installedSectionsRef.current, urlRa, urlDec, urlFov || 300);
      const quickCacheKey = quickMatch ? getSectionTensorCacheKey(quickMatch) : null;
      const quickCached = quickCacheKey ? getCachedDecodedTensor(quickCacheKey) : null;
      if (quickMatch && quickCached) {
        setActiveInstalledSection(quickMatch);
        applyLoadedTensor(quickCached.parsed, quickCached.sourceBadge);
      } else {
        setDataStatus('loading');
        setDataProgress(0);
        setLoadedCutoutCount(0);
        setDataMessage('Checking installed cutout sections…');
        setLoadedTensor(null);
        setEpochIndex(0);
      }

      try {
        // 1. Check installed sections first so tabs never re-query IRSA unnecessarily
        let sections: InstalledSection[] = [];
        let fetchedSectionsOk = false;
        try {
          sections = await fetchInstalledSections(requestController.signal);
          fetchedSectionsOk = true;
        } catch {
          // If backend list is unreachable, preserve an already-cached view or fall back cleanly
        }
        if (cancelled) return;
        if (quickMatch && quickCached && !fetchedSectionsOk) {
          return;
        }

        let matchedSection = findMatchingSection(sections, urlRa, urlDec, urlFov || 300);

        // If backend is actively seeding/installing this coordinate in the background, wait & auto-load when ready
        if (!matchedSection && forceLiveCoordKey !== currentCoordKey) {
          const installingSection = sections.find(
            (s) =>
              s.status === 'installing' &&
              Math.abs(s.ra - urlRa) < 0.002 &&
              Math.abs(s.dec - urlDec) < 0.002 &&
              Math.abs((s.fov_arcsec || 300) - Math.round(urlFov || 300)) <= 5
          );
          if (installingSection) {
            setDataStatus('loading');
            setDataProgress(0.25);
            setDataMessage(`Installing "${installingSection.label}" from live IRSA SPHEREx archives…`);
            while (!cancelled && !matchedSection) {
              await new Promise((resolve) => window.setTimeout(resolve, 3500));
              if (cancelled) return;
              try {
                const latest = await fetchInstalledSections(requestController.signal);
                matchedSection = findMatchingSection(latest, urlRa, urlDec, urlFov || 300);
                if (matchedSection) break;
                const latestRow = latest.find((s) => s.section_id === installingSection.section_id);
                if (latestRow && latestRow.status !== 'installing') {
                  break;
                }
              } catch {
                // Retry polling on transient backend hiccup
              }
            }
            if (cancelled) return;
          }
        }

        if (matchedSection) {
          setActiveInstalledSection(matchedSection);
          const sectionCacheKey = getSectionTensorCacheKey(matchedSection);
          if (quickCached && quickCacheKey === sectionCacheKey) {
            return;
          }
          const memHit = getCachedDecodedTensor(sectionCacheKey);
          if (memHit) {
            applyLoadedTensor(memHit.parsed, memHit.sourceBadge);
            return;
          }
          setDataMessage(`Loading installed section "${matchedSection.label}"…`);
          setDataProgress(0.4);
          const versionParam = encodeURIComponent(String(matchedSection.updated_at || matchedSection.size_bytes));
          let secRes: Response | null = null;
          try {
            const candidate = await fetch(
              `/api/sections/${matchedSection.section_id}/tensor?v=${versionParam}`,
              { signal: requestController.signal }
            );
            const contentType = (candidate.headers.get('content-type') || '').toLowerCase();
            if (candidate.ok && !contentType.includes('text/html')) {
              secRes = candidate;
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
          }
          if (!secRes) {
            const staticCandidate = await fetch(
              `/benchmarks/${matchedSection.section_id}.f32?v=${versionParam}`,
              { signal: requestController.signal }
            );
            const staticType = (staticCandidate.headers.get('content-type') || '').toLowerCase();
            if (staticCandidate.ok && !staticType.includes('text/html')) {
              secRes = staticCandidate;
            }
          }
          if (secRes) {
            const decoded = await decodeBinaryTensorBuffer(await secRes.arrayBuffer(), getDecoderWorker());
            decoderWorker?.terminate();
            decoderWorker = null;
            const parsed = mapDecodedTensor(decoded);
            const installedBadge = parsed.sourceBadge.startsWith('[Installed]')
              ? parsed.sourceBadge
              : `[Installed] ${parsed.sourceBadge}`;
            parsed.sourceBadge = installedBadge;
            setCachedDecodedTensor(sectionCacheKey, { parsed, sourceBadge: installedBadge });
            applyLoadedTensor(parsed, installedBadge);
            return;
          }
        } else if (!cancelled) {
          setActiveInstalledSection(null);
          setLoadedTensor(null);
        }

        // 2. Do NOT auto-query IRSA on tab switch unless the user explicitly clicked Query Live
        if (forceLiveCoordKey !== currentCoordKey) {
          if (!cancelled) {
            setDataStatus('uninstalled');
            setDataProgress(0);
            setDataMessage(
              sections.some((s) => s.status === 'ready')
                ? 'No cutout section is installed at this sky coordinate yet. Choose an installed section below or install this region once.'
                : 'No cutout sections are installed yet. Select a region in the Sky Navigator or install this coordinate below.'
            );
            useTelemetryStore.setState({ sourceBadge: '[Not Installed]' });
          }
          return;
        }

        setDataMessage('Querying IRSA for real SPHEREx exposures…');
        const postRes = await fetch('/api/cutout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: requestController.signal,
          body: JSON.stringify({
            ra: urlRa,
            dec: urlDec,
            fov_arcsec: Math.round(urlFov || 300),
            adaptive_window: true,
          }),
        });
        if (!postRes.ok) {
          const body = await postRes.json().catch(() => ({}));
          throw new Error(body.detail || `IRSA request failed (${postRes.status})`);
        }
        const postData = await postRes.json();
        const task_id = postData.task_id;
        if (postData.status === 'complete') {
          // Instant completion (e.g. pre-cached NASA Benchmark or in-memory LRU hit)
          const tensorRes = await fetch(`/api/cutout/${task_id}/tensor`, { signal: requestController.signal });
          if (tensorRes.ok) {
            const decoded = await decodeBinaryTensorBuffer(await tensorRes.arrayBuffer(), getDecoderWorker());
            decoderWorker?.terminate();
            decoderWorker = null;
            const parsed = mapDecodedTensor(decoded);
            applyLoadedTensor(parsed, parsed.sourceBadge);
            return;
          }
        }
        const progressRes = await fetch(`/api/cutout/progress/${task_id}?stream=1`, {
          headers: { Accept: 'text/event-stream' },
          signal: requestController.signal,
        });
        if (!progressRes.ok) throw new Error(`IRSA task status failed (${progressRes.status})`);
        if (!progressRes.body) throw new Error('IRSA progress stream is unavailable in this browser.');
        const progressReader = progressRes.body.getReader();
        const progressDecoder = new TextDecoder();
        let pendingEvents = '';
        let taskComplete = false;
        let seenPartialRevision = 0;
        let hasRenderedPartial = false;
        while (!cancelled && !taskComplete) {
          const { value, done } = await progressReader.read();
          if (done) break;
          pendingEvents += progressDecoder.decode(value, { stream: true });
          const events = pendingEvents.split(/\r?\n\r?\n/);
          pendingEvents = events.pop() || '';
          for (const eventText of events) {
            const dataLine = eventText.split(/\r?\n/).find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            const progress = JSON.parse(dataLine.slice(5).trim());
            const partialRevision = Number(progress.partial_revision || 0);
            if (partialRevision > seenPartialRevision) {
              const partialRes = await fetch(`/api/cutout/${task_id}/partial-tensor`, {
                signal: requestController.signal,
              });
              if (partialRes.ok) {
                const partialDecoded = await decodeBinaryTensorBuffer(
                  await partialRes.arrayBuffer(),
                  getDecoderWorker(),
                );
                const partialTensor = mapDecodedTensor(partialDecoded);
                if (!partialTensor.isSimulated && !cancelled) {
                  setLoadedTensor(partialTensor);
                  useTelemetryStore.setState({ sourceBadge: partialTensor.sourceBadge });
                  setLoadedCutoutCount(Number(progress.partial_exposure_count || 1));
                  if (!hasRenderedPartial) {
                    const firstObservedCell = partialTensor.nExpData
                      .flatMap((epochPlanes, epochIndex) =>
                        epochPlanes.map((plane, bandIndex) => ({ plane, epochIndex, bandIndex })),
                      )
                      .find(({ plane }) => plane.some((count) => count > 0));
                    if (firstObservedCell) {
                      setEpochIndex(firstObservedCell.epochIndex);
                      setActiveBandIndex(firstObservedCell.bandIndex);
                    }
                    hasRenderedPartial = true;
                  }
                  setDataMessage(
                    `Showing ${Number(progress.partial_exposure_count || 1)} matched cutouts; fetching the remaining observations.`,
                  );
                  seenPartialRevision = partialRevision;
                }
              } else if (partialRes.status !== 202) {
                throw new Error(`Partial cutout request failed (${partialRes.status})`);
              }
            }
            if (progress.status === 'error') {
              throw new Error(progress.message || 'IRSA could not return usable exposures.');
            }
            if (progress.status === 'complete') {
              taskComplete = true;
              setDataProgress(1);
              break;
            }
            if (typeof progress.progress === 'number' && Number.isFinite(progress.progress)) {
              setDataProgress(Math.max(0, Math.min(1, progress.progress)));
            }
            setDataMessage(progress.message || 'Waiting for IRSA cutouts…');
          }
        }
        if (taskComplete) await progressReader.cancel();
        if (cancelled) return;
        if (!taskComplete) throw new Error('IRSA progress stream ended before the task completed.');
        const tensorRes = await fetch(`/api/cutout/${task_id}/tensor`, { signal: requestController.signal });
        if (!tensorRes.ok) throw new Error(`IRSA tensor request failed (${tensorRes.status})`);
        const decoded = await decodeBinaryTensorBuffer(await tensorRes.arrayBuffer(), getDecoderWorker());
        decoderWorker?.terminate();
        decoderWorker = null;
        const parsed = mapDecodedTensor(decoded);
        if (parsed.isSimulated && !activeBenchmark && !parsed.sourceBadge.includes('Benchmark')) {
          throw new Error('The archive returned no verified real-data tensor. No synthetic preview is shown.');
        }
        if (!cancelled) {
          applyLoadedTensor(parsed, parsed.sourceBadge);
        }
      } catch (error) {
        decoderWorker?.terminate();
        decoderWorker = null;
        if (!cancelled) {
          setDataMessage(requestTimedOut
            ? 'IRSA request timed out before returning exposure data.'
            : error instanceof Error ? error.message : 'IRSA data request failed.');
          setDataStatus('error');
          useTelemetryStore.setState({ sourceBadge: '[IRSA data unavailable]' });
        }
      } finally {
        window.clearTimeout(requestTimeout);
      }
    };

    loadCutoutTensor();
    return () => {
      cancelled = true;
      requestController.abort();
      window.clearTimeout(requestTimeout);
      decoderWorker?.terminate();
    };
  }, [activeBenchmark, urlRa, urlDec, urlFov, loadAttempt, forceLiveCoordKey, currentCoordKey, setEpochIndex]);

  const activeTensors = loadedTensor || scienceTensors;
  const isSimulatedDisplay = loadedTensor ? loadedTensor.isSimulated : true;
  const currentWidth = loadedTensor ? loadedTensor.width : CANVAS_PIXEL_DIM;
  const currentHeight = loadedTensor ? loadedTensor.height : CANVAS_PIXEL_DIM;
  const totalEpochsCount = loadedTensor ? loadedTensor.epochs : surveyPasses.length;

  // Active planes for current selection
  const safeEpochIndex = activeEpochIndex % totalEpochsCount;
  const referenceEpochIndex = useMemo(() => {
    for (let e = 0; e < totalEpochsCount; e++) {
      if (getPlaneMaxNExp(activeTensors.nExpData?.[e]?.[activeBandIndex]) > 0) {
        return e;
      }
    }
    return 0;
  }, [activeTensors, totalEpochsCount, activeBandIndex]);

  const currentFluxPlane = activeTensors.fluxData[safeEpochIndex]?.[activeBandIndex] || null;
  const referenceFluxPlane = activeTensors.fluxData[referenceEpochIndex]?.[activeBandIndex] || null;
  const currentVarPlane = activeTensors.varData[safeEpochIndex]?.[activeBandIndex] || null;
  const referenceVarPlane = activeTensors.varData[referenceEpochIndex]?.[activeBandIndex] || null;
  const currentFlagsPlane = activeTensors.flagsData[safeEpochIndex]?.[activeBandIndex] || null;

  // 3-Band RGB False-Color Planes (D5 = Red, D3 = Green, D1 = Blue)
  const rgbPlanes = useMemo(() => {
    const totalPx = currentWidth * currentHeight;
    return {
      r: activeTensors.fluxData[safeEpochIndex]?.[4] || new Float32Array(totalPx),
      g: activeTensors.fluxData[safeEpochIndex]?.[2] || new Float32Array(totalPx),
      b: activeTensors.fluxData[safeEpochIndex]?.[0] || new Float32Array(totalPx),
    };
  }, [activeTensors, safeEpochIndex, currentWidth, currentHeight]);

  // Gaia DR3 Centroid Reticle Calculation (SPECIFICATION.md §6.1.7 Item 2)
  const gaiaReticle = useMemo(() => {
    if (!activeBenchmark) return null;
    const epochMjd = surveyPasses[safeEpochIndex]?.mjd ?? 0;
    const deltaYears = (epochMjd - (surveyPasses[0]?.mjd ?? epochMjd)) / 365.25;
    const center = currentWidth / 2;

    if (activeBenchmark.id === 'barnard') {
      const dy = -(10.39 * deltaYears) / 6.2;
      return {
        subpixelX: center,
        subpixelY: center + dy,
        label: `Barnard's Star (μ = 10.39"/yr N, Δy = ${dy.toFixed(2)} px)`,
      };
    }
    if (activeBenchmark.id === 'wise0855') {
      const dx = -(8.15 * deltaYears) / 6.2;
      return {
        subpixelX: center + dx,
        subpixelY: center,
        label: `WISE 0855 (μ = 8.15"/yr W, Δx = ${dx.toFixed(2)} px)`,
      };
    }
    if (activeBenchmark.id === 'eps_indi_b') {
      const dx = (3.96 * deltaYears) / 6.2;
      const dy = -( -2.54 * deltaYears) / 6.2;
      return {
        subpixelX: center + dx,
        subpixelY: center + dy,
        label: `Epsilon Indi Ba+Bb (0.76 px/yr SE, unmix blended)`,
      };
    }
    return {
      subpixelX: center,
      subpixelY: center,
      label: `${activeBenchmark.name} (stationary <0.3 px)`,
    };
  }, [activeBenchmark, safeEpochIndex, currentWidth, surveyPasses]);

  const benchmarkReticle = gaiaReticle;

  // Handle pixel clicks & dragged circle marks (SPECIFICATION.md §4.2, docs/audits/QA_AUDIT.md §9.4)
  const handlePixelClick = useCallback(
    (info: HoverPixelInfo) => {
      let clickX = info.x;
      let clickY = info.y;
      const isDragCircle = typeof info.radiusPx === 'number' && info.radiusPx >= 1.0;

      if (measuringMotion && currentFluxPlane) {
        // 5x5 centroid peak snapping for precise 2-click proper motion vectors
        let maxFlux = -Infinity;
        const radius = 2;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.max(0, Math.min(currentWidth - 1, info.x + dx));
            const py = Math.max(0, Math.min(currentHeight - 1, info.y + dy));
            const f = currentFluxPlane[py * currentWidth + px];
            if (Number.isFinite(f) && f > maxFlux) {
              maxFlux = f;
              clickX = px;
              clickY = py;
            }
          }
        }
      } else if (snapToPeak && !isDragCircle && currentFluxPlane) {
        // 3x3 flux-peak snap for single-click object circling
        let maxFlux = -Infinity;
        const radius = 1;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.max(0, Math.min(currentWidth - 1, info.x + dx));
            const py = Math.max(0, Math.min(currentHeight - 1, info.y + dy));
            const f = currentFluxPlane[py * currentWidth + px];
            if (Number.isFinite(f) && f > maxFlux) {
              maxFlux = f;
              clickX = px;
              clickY = py;
            }
          }
        }
      }

      const skyPos =
        loadedTensor && !loadedTensor.isSimulated && loadedTensor.wcs
          ? pixelToSky(clickX, clickY, loadedTensor.wcs)
          : fallbackPixelToSky(clickX, clickY, currentWidth, currentHeight, urlRa, urlDec);

      setProbedPixel({ x: clickX, y: clickY });
      setProbeSkyPosition(skyPos);
      setUrlProbeX(clickX);
      setUrlProbeY(clickY);

      if (measuringMotion) {
        setMotionPoints((prev) => {
          const next = [...prev, { x: clickX, y: clickY, epoch: safeEpochIndex }];
          if (next.length === 2) {
            const p0 = next[0];
            const p1 = next[1];
            const dxPx = p1.x - p0.x;
            const dyPx = p1.y - p0.y;
            const dtYears =
              Math.abs((surveyPasses[p1.epoch]?.mjd ?? 0) - (surveyPasses[p0.epoch]?.mjd ?? 0)) /
                365.25 || 0.5;

            const deltaAlphaArcsec = dxPx * PIXEL_SCALE_ARCSEC;
            const deltaDeltaArcsec = -dyPx * PIXEL_SCALE_ARCSEC;
            const totalMotionArcsec = Math.sqrt(deltaAlphaArcsec ** 2 + deltaDeltaArcsec ** 2);
            const totalMotionArcsecYr = totalMotionArcsec / dtYears;
            const paRad = Math.atan2(deltaAlphaArcsec, deltaDeltaArcsec);
            const positionAngleDeg = ((paRad * 180) / Math.PI + 360) % 360;

            setLastMotionVector({ p0, p1 });
            setMotionResult({
              deltaAlphaArcsec,
              deltaDeltaArcsec,
              totalMotionArcsecYr,
              positionAngleDeg,
            });
            setMeasuringMotion(false);
            return [];
          }
          return next;
        });
        return;
      }

      const pxIdx = clickY * currentWidth + clickX;
      const fluxVal =
        currentFluxPlane && pxIdx < currentFluxPlane.length ? currentFluxPlane[pxIdx] : info.flux;
      const varVal =
        currentVarPlane && pxIdx < currentVarPlane.length ? currentVarPlane[pxIdx] : info.variance;
      const snrVal =
        varVal > 0 && Number.isFinite(fluxVal) ? fluxVal / Math.sqrt(varVal) : info.snr;
      const passMeta = surveyPasses[safeEpochIndex] || surveyPasses[0];
      const bandMeta = BANDS[activeBandIndex] || BANDS[0];

      const newMark: MarkedObject = {
        id: nextMarkIdRef.current++,
        x: clickX,
        y: clickY,
        radiusPx: info.radiusPx ?? 1.8,
        ra: skyPos.ra,
        dec: skyPos.dec,
        epochIndex: safeEpochIndex,
        passLabel: passMeta?.label || `Pass ${safeEpochIndex + 1}`,
        mjd: passMeta?.mjd ?? 0,
        bandId: bandMeta.id,
        flux: Number.isFinite(fluxVal) ? fluxVal : 0,
        snr: Number.isFinite(snrVal) ? snrVal : 0,
        classification: triageClass,
        confidence: triageConfidence,
      };

      setMarkedObjects((prev) => [...prev, newMark]);
      setSelectedMarkId(newMark.id);
      setTriageSubmitted(false);
    },
    [
      measuringMotion,
      snapToPeak,
      currentFluxPlane,
      currentVarPlane,
      currentWidth,
      currentHeight,
      loadedTensor,
      urlRa,
      urlDec,
      safeEpochIndex,
      activeBandIndex,
      surveyPasses,
      triageClass,
      triageConfidence,
      setProbedPixel,
      setProbeSkyPosition,
      setUrlProbeX,
      setUrlProbeY,
    ]
  );

  // Forced Aperture Light Curve Data across epochs (D1 vs D5), bound to circled object or center
  const lightCurveData = useMemo(() => {
    const cx = selectedMark ? selectedMark.x : Math.floor(currentWidth / 2);
    const cy = selectedMark ? selectedMark.y : Math.floor(currentHeight / 2);
    const customRadius = selectedMark
      ? Math.max(1, Math.min(4, Math.round(selectedMark.radiusPx)))
      : null;

    const sampleFiniteMean = (plane: Float32Array | undefined): number => {
      if (!plane) return 0;
      const radii = customRadius !== null ? [customRadius] : [1, 2];
      for (const radius of radii) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (customRadius !== null && dx * dx + dy * dy > radius * radius) continue;
            const px = cx + dx;
            const py = cy + dy;
            if (px >= 0 && px < currentWidth && py >= 0 && py < currentHeight) {
              const v = plane[py * currentWidth + px];
              if (Number.isFinite(v)) {
                sum += v;
                cnt++;
              }
            }
          }
        }
        if (cnt > 0) return sum / cnt;
      }
      return 0;
    };

    return surveyPasses.map((pass, eIdx) => {
      const ep = eIdx % totalEpochsCount;
      return {
        epoch: pass.label,
        mjd: pass.mjd,
        fluxD1: sampleFiniteMean(activeTensors.fluxData[ep]?.[0]),
        fluxD5: sampleFiniteMean(activeTensors.fluxData[ep]?.[4]),
      };
    });
  }, [activeTensors, surveyPasses, totalEpochsCount, currentWidth, currentHeight, selectedMark]);

  const activePass = surveyPasses[safeEpochIndex];
  const activeBand = BANDS[activeBandIndex];

  if (!loadedTensor) {
    const activeDownload = matchingDownloadingSection;
    const isShowingProgress = dataStatus === 'loading' || Boolean(activeDownload);
    return (
      <main className="min-h-[70vh] bg-slate-950 px-6 py-12 text-slate-100">
        <section className="mx-auto max-w-3xl rounded-2xl border border-cyan-900/60 bg-slate-900/80 p-8">
          <p className={`font-mono text-xs uppercase tracking-[0.22em] ${activeDownload ? 'text-orange-300' : 'text-cyan-300'}`}>
            {activeDownload
              ? 'Installing section in background'
              : dataStatus === 'loading'
                ? 'Loading cutout section'
                : dataStatus === 'uninstalled'
                  ? 'Installed section workflow'
                  : 'Real data unavailable'}
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Time-domain observations</h1>
          <p className="mt-2 font-mono text-xs text-slate-400">
            Active target: RA {urlRa.toFixed(5)}°, Dec {urlDec >= 0 ? '+' : ''}{urlDec.toFixed(5)}° · FOV {Math.round(urlFov || 300)}″
          </p>
          {isShowingProgress ? (
            <ComparatorDownloadProgress
              ra={urlRa}
              dec={urlDec}
              fovArcsec={urlFov || 300}
              fallbackProgress={dataProgress}
              fallbackMessage={dataMessage}
            />
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-300" role="alert">
              {dataMessage}
            </p>
          )}
          {!isShowingProgress && (
            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={isInstallingHere}
                  onClick={handleInstallSectionHere}
                  className="rounded-lg border border-emerald-600/70 bg-emerald-950/60 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
                >
                  {isInstallingHere ? 'Installing section…' : 'Install & Load Section Here'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForceLiveCoordKey(currentCoordKey);
                    setLoadAttempt((attempt) => attempt + 1);
                  }}
                  className="rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-950"
                >
                  {dataStatus === 'error' ? 'Retry live IRSA query' : 'Query IRSA Live (Temporary)'}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('navigator')}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Select in Sky Navigator
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Installed Sections ({readyInstalledSections.length})
                  </h2>
                  <span className="text-[11px] text-slate-500">
                    Instant reuse across Time-Domain, Spectrum &amp; Ice Studio
                  </span>
                </div>
                {readyInstalledSections.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">
                    No sections installed yet. Use Sky Navigator to browse footprints and click &ldquo;Install Cutout Section&rdquo;, or install this coordinate above.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {readyInstalledSections.map((sec) => (
                      <button
                        key={sec.section_id}
                        type="button"
                        onClick={() => handleSelectInstalledSection(sec)}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2.5 text-left transition-colors hover:border-emerald-500/60 hover:bg-slate-800/80"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate text-xs font-semibold text-white">{sec.label}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                            {sec.ra.toFixed(4)}°, {sec.dec >= 0 ? '+' : ''}{sec.dec.toFixed(4)}° · {Math.round(sec.fov_arcsec)}″ · {sec.epochs} ep
                          </div>
                        </div>
                        <span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-950/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                          {formatSectionBytes(sec.size_bytes)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <p className="mt-6 text-xs text-slate-500">
            Installed cutout sections stay saved locally on disk so switching tabs never re-queries IRSA unnecessarily.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="flex h-full w-full flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-black font-sans text-white">
      {/* ========================================================================= */}
      {/* LEFT PANEL (65%): Multi-Epoch Playback Canvas & Transport Deck            */}
      {/* ========================================================================= */}
      <div className="flex w-full lg:w-[62%] xl:w-[65%] shrink-0 lg:shrink lg:min-h-0 flex-col border-b lg:border-b-0 lg:border-r border-neutral-800 bg-black">
        {/* Top Control Header */}
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-white">
              {activeBenchmark ? activeBenchmark.name : `Field at RA ${urlRa.toFixed(4)}°, Dec ${urlDec.toFixed(4)}°`}
            </span>
            {onOpenCatalog && (
              <button
                type="button"
                onClick={onOpenCatalog}
                className="rounded-full border border-neutral-800 bg-neutral-900/90 hover:bg-neutral-800 hover:border-neutral-700 px-2.5 py-0.5 text-[11px] font-medium text-neutral-300 hover:text-white transition-all flex items-center space-x-1 shadow-sm"
                title="Browse all 24 calibrated targets in the source catalog"
              >
                <span>Switch Target (24)</span>
                <svg className="h-3 w-3 text-primary inline-block" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {readyInstalledSections.length > 0 && (
              <select
                aria-label="Switch installed section"
                value={activeInstalledSection?.section_id || ''}
                onChange={(e) => {
                  const chosen = readyInstalledSections.find((s) => s.section_id === e.target.value);
                  if (chosen) handleSelectInstalledSection(chosen);
                }}
                className="max-w-[200px] rounded-full border border-emerald-600/50 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200 focus:outline-none"
                title="Switch directly to any installed cutout section without querying IRSA"
              >
                {!activeInstalledSection && (
                  <option value="">Installed ({readyInstalledSections.length})</option>
                )}
                {readyInstalledSections.map((sec) => (
                  <option key={sec.section_id} value={sec.section_id}>
                    {sec.label} ({sec.epochs} ep)
                  </option>
                ))}
              </select>
            )}
            <span className="rounded-full bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 font-mono text-[10px] text-neutral-400">
              {store.sourceBadge}
            </span>
            {activeBenchmark?.id === 'barnard' && activeBandIndex <= 1 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-400">
                OVERFLOW (Saturated NIR)
              </span>
            )}
            {activeBenchmark?.id === 'wise0855' && activeBandIndex <= 2 && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">
                Not Detected at Pass Depth (&gt;17 mag)
              </span>
            )}
          </div>

          {/* Controls: Marking, Canvas Zoom/Smoothing + Raw vs. Rectified Toggle */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center space-x-1 sm:border-r sm:border-neutral-800 sm:pr-3">
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                  measuringMotion
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                    : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {measuringMotion ? 'Motion Vector Mode' : 'Circle / Mark Mode'}
              </span>
              <button
                type="button"
                onClick={() => setSnapToPeak((prev) => !prev)}
                title="Snap single clicks to brightest nearby flux peak in a 3x3 pixel window"
                className={`rounded px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                  snapToPeak
                    ? 'border-primary/60 bg-primary/15 text-sky-300'
                    : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white'
                }`}
              >
                {snapToPeak ? 'Peak Snap: ON' : 'Peak Snap: OFF'}
              </button>
              {markedObjects.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearMarks}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  Clear Marks ({markedObjects.length})
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1 sm:border-r sm:border-neutral-800 sm:pr-3">
              <span className="text-neutral-400 text-[11px] mr-1">Scale:</span>
              {(['fit', '1x', '2x', '4x'] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setCanvasZoom(z)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
                    canvasZoom === z
                      ? 'border border-primary bg-primary/20 text-white font-bold'
                      : 'border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white'
                  }`}
                >
                  {z.toUpperCase()}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsSmoothRendering(!isSmoothRendering)}
                title="Toggle between pixelated (crisp) and bilinear (smooth) interpolation"
                className={`ml-1.5 rounded px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                  isSmoothRendering
                    ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                    : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-white'
                }`}
              >
                {isSmoothRendering ? 'Smooth' : 'Crisp'}
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-neutral-400">Sensor:</span>
              <button
                type="button"
                onClick={() => setRawVsRectified(rawVsRectified === 'rectified' ? 'raw_sensor' : 'rectified')}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  rawVsRectified === 'raw_sensor'
                    ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                    : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:text-white'
                }`}
              >
                {rawVsRectified === 'raw_sensor' ? `Raw (θ = ${activePass.rollAngleDeg}°)` : 'Rectified North-Up'}
              </button>
            </div>
          </div>
        </div>

        {dataStatus !== 'ready' && (
          <div
            className={`border-b px-4 py-2 ${dataStatus === 'error' ? 'border-amber-900 bg-amber-950/60' : 'border-cyan-950 bg-slate-950'}`}
            role={dataStatus === 'error' ? 'alert' : 'status'}
          >
            <div className="mb-1 flex items-center justify-between gap-4 text-[11px]">
              <span className={dataStatus === 'error' ? 'text-amber-200' : 'text-cyan-200'}>
                {dataStatus === 'loading'
                  ? `${loadedCutoutCount} cutouts displayed · remaining observations loading`
                  : 'Showing partial observations · archive load did not finish'}
              </span>
              <span className="shrink-0 font-mono text-neutral-400">{Math.round(dataProgress * 100)}%</span>
            </div>
            <div
              className="h-1 overflow-hidden rounded bg-slate-800"
              role="progressbar"
              aria-label="Remaining SPHEREx cutouts loading"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(dataProgress * 100)}
            >
              <div
                className="h-full rounded bg-cyan-400 transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(1, dataProgress * 100)}%` }}
              />
            </div>
            {dataStatus === 'error' && (
              <div className="mt-1 flex items-center justify-between gap-4 text-[10px]">
                <span className="truncate text-amber-300">{dataMessage}</span>
                <button
                  type="button"
                  className="shrink-0 text-amber-100 underline"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}

        {/* Central WebGL2 Canvas Viewport (Expansive & Fluid) */}
        <div className="relative flex flex-1 min-h-[300px] sm:min-h-[380px] lg:min-h-0 items-center justify-center overflow-auto bg-black p-3 sm:p-4">
          <div
            className={`relative rounded-xl border border-neutral-800 bg-black shadow-2xl overflow-hidden flex items-center justify-center transition-all ${
              canvasZoom === 'fit'
                ? 'h-full w-full max-h-[55vh] sm:max-h-[65vh] lg:max-h-[calc(100vh-220px)] max-w-[min(100%,55vh)] sm:max-w-[min(100%,65vh)] lg:max-w-[calc(100vh-220px)] aspect-square'
                : canvasZoom === '1x'
                ? 'w-[240px] h-[240px]'
                : canvasZoom === '2x'
                ? 'w-[420px] h-[420px]'
                : 'w-[600px] h-[600px]'
            }`}
          >
            <WebGLComparatorCanvas
              fluxData={currentFluxPlane}
              refFluxData={referenceFluxPlane}
              varianceData={currentVarPlane}
              refVarianceData={referenceVarPlane}
              flagsData={currentFlagsPlane}
              width={currentWidth}
              height={currentHeight}
              renderMode={renderMode}
              asinhParamA={asinhParamA}
              diffScale={0.8}
              colorPalette={colorPalette}
              rgbBandsData={activeRgbPreset === 'custom' ? null : null}
              isFrameZero={safeEpochIndex === referenceEpochIndex}
              gaiaPin={gaiaReticle}
              onPixelHover={handlePixelHover}
              onPixelClick={handlePixelClick}
              smooth={isSmoothRendering}
              className="h-full w-full"
            />

            {/* Persistent Canvas Watermark when displaying Simulated / Calibrated Model Data */}
            {isSimulatedDisplay && (
              <div
                data-testid="simulated-canvas-watermark"
                className="pointer-events-none absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between rounded-lg border border-amber-500/40 bg-black/85 px-3 py-1.5 font-mono text-[10px] text-amber-300 shadow-lg backdrop-blur-sm"
              >
                <span className="font-semibold tracking-wider uppercase">
                  SIMULATED DATA — CALIBRATED MODEL (NOT LIVE TELESCOPE PIXELS)
                </span>
                <span className="text-neutral-400">
                  {activeBenchmark ? `Ephemeris: ${activeBenchmark.name}` : 'Offline Fallback'}
                </span>
              </div>
            )}

            {/* Circled Object Identifications Overlay */}
            {markedObjects.map((mark) => {
              const isSelected = mark.id === selectedMarkId;
              return (
                <div
                  key={mark.id}
                  className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${((mark.x + 0.5) / currentWidth) * 100}%`,
                    top: `${((mark.y + 0.5) / currentHeight) * 100}%`,
                    width: `${((mark.radiusPx * 2) / currentWidth) * 100}%`,
                    height: `${((mark.radiusPx * 2) / currentHeight) * 100}%`,
                    minWidth: '22px',
                    minHeight: '22px',
                  }}
                >
                  <div
                    className={`relative h-full w-full rounded-full transition-all ${
                      isSelected
                        ? 'border-2 border-emerald-400 bg-emerald-400/10 shadow-[0_0_14px_rgba(52,211,153,0.55)]'
                        : 'border border-amber-400/85 bg-amber-400/5 hover:border-amber-300'
                    }`}
                  >
                    <span
                      className={`absolute left-1/2 top-0 h-1.5 w-[1px] -translate-x-1/2 -translate-y-1/2 ${
                        isSelected ? 'bg-emerald-300' : 'bg-amber-300'
                      }`}
                    />
                    <span
                      className={`absolute left-1/2 bottom-0 h-1.5 w-[1px] -translate-x-1/2 translate-y-1/2 ${
                        isSelected ? 'bg-emerald-300' : 'bg-amber-300'
                      }`}
                    />
                    <span
                      className={`absolute top-1/2 left-0 h-[1px] w-1.5 -translate-x-1/2 -translate-y-1/2 ${
                        isSelected ? 'bg-emerald-300' : 'bg-amber-300'
                      }`}
                    />
                    <span
                      className={`absolute top-1/2 right-0 h-[1px] w-1.5 translate-x-1/2 -translate-y-1/2 ${
                        isSelected ? 'bg-emerald-300' : 'bg-amber-300'
                      }`}
                    />
                  </div>
                  <div className="pointer-events-auto absolute bottom-full left-1/2 mb-1 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded border bg-black/90 px-1.5 py-0.5 font-mono text-[9px] shadow-md backdrop-blur-sm border-neutral-700">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectMark(mark);
                      }}
                      className={`hover:underline ${
                        isSelected ? 'font-bold text-emerald-300' : 'text-amber-300'
                      }`}
                      title={`Select circled object #${mark.id} (${mark.ra.toFixed(4)}°, ${mark.dec.toFixed(4)}°)`}
                    >
                      #{mark.id} · {mark.passLabel}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMark(mark.id);
                      }}
                      aria-label={`Remove circled object #${mark.id}`}
                      className="ml-0.5 text-neutral-400 hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Proper Motion Measurement Points & Vector Overlay */}
            {(motionPoints.length > 0 || lastMotionVector) && (
              <svg
                className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                viewBox={`0 0 ${currentWidth} ${currentHeight}`}
                preserveAspectRatio="none"
              >
                {lastMotionVector && (
                  <g>
                    <line
                      x1={lastMotionVector.p0.x + 0.5}
                      y1={lastMotionVector.p0.y + 0.5}
                      x2={lastMotionVector.p1.x + 0.5}
                      y2={lastMotionVector.p1.y + 0.5}
                      stroke="#38BDF8"
                      strokeWidth="0.35"
                      strokeDasharray="0.8 0.5"
                    />
                    <circle
                      cx={lastMotionVector.p0.x + 0.5}
                      cy={lastMotionVector.p0.y + 0.5}
                      r="0.7"
                      fill="none"
                      stroke="#38BDF8"
                      strokeWidth="0.35"
                    />
                    <circle
                      cx={lastMotionVector.p1.x + 0.5}
                      cy={lastMotionVector.p1.y + 0.5}
                      r="0.7"
                      fill="#38BDF8"
                      fillOpacity="0.35"
                      stroke="#38BDF8"
                      strokeWidth="0.35"
                    />
                  </g>
                )}
                {motionPoints.map((pt, idx) => (
                  <circle
                    key={idx}
                    cx={pt.x + 0.5}
                    cy={pt.y + 0.5}
                    r="0.8"
                    fill="none"
                    stroke="#22D3EE"
                    strokeWidth="0.4"
                  />
                ))}
              </svg>
            )}

            {/* NASA Eyes Corner Target Reticle [ ] tracking active target */}
            {benchmarkReticle && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                style={{
                  left: `${(benchmarkReticle.subpixelX / currentWidth) * 100}%`,
                  top: `${(benchmarkReticle.subpixelY / currentHeight) * 100}%`,
                }}
              >
                <div className="relative h-10 w-10">
                  <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-primary" />
                  <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-primary" />
                  <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-primary" />
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-primary" />
                </div>
                <div className="absolute left-12 top-0 whitespace-nowrap rounded bg-black/85 px-2 py-0.5 font-mono text-[10px] text-primary border border-primary/40 shadow-lg backdrop-blur-sm">
                  {benchmarkReticle.label}
                </div>
              </div>
            )}

            {/* Interactive Circle Prompt when no objects marked yet */}
            {markedObjects.length === 0 && !measuringMotion && (
              <div className="pointer-events-none absolute right-2.5 top-2.5 z-10 rounded border border-emerald-500/40 bg-black/80 px-2 py-1 font-mono text-[10px] text-emerald-300 shadow backdrop-blur-sm">
                Click or drag to circle an object
              </div>
            )}

            {/* Raw Sensor Mode LVF Smile Curvature Overlay */}
            {rawVsRectified === 'raw_sensor' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
                <div className="rounded-sm bg-black/80 p-1.5 font-mono text-[10px] text-amber-400 border border-amber-500/30">
                  Raw H2RG 2040x2040 // Spacecraft Roll θ = {activePass.rollAngleDeg}°
                  <br />
                  Linear Variable Filter (LVF) Smile Curvature active
                </div>
                {/* Curved isoline visual aid */}
                <svg className="absolute inset-0 h-full w-full stroke-amber-500/30" viewBox="0 0 100 100" fill="none">
                  <path d="M 5 25 Q 50 35 95 25" strokeWidth="0.7" strokeDasharray="2,2" />
                  <path d="M 5 50 Q 50 60 95 50" strokeWidth="0.7" strokeDasharray="2,2" />
                  <path d="M 5 75 Q 50 85 95 75" strokeWidth="0.7" strokeDasharray="2,2" />
                </svg>
              </div>
            )}

            {/* Active Measure Proper Motion Reticle Helper */}
            {measuringMotion && (
              <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-primary/50 bg-black/90 backdrop-blur-md px-3 py-1.5 font-mono text-xs text-primary shadow-xl">
                {motionPoints.length === 0
                  ? 'Click Point 1 on Target (Epoch 0)'
                  : 'Click Point 2 on Target (Epoch N)'}
              </div>
            )}
          </div>
        </div>

        {/* Discrete Survey Epoch Scrubber Bar */}
        <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Play / Step Transport */}
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => setEpochIndex(0)}
                title="First Pass (Frame 0)"
                aria-label="First Pass (Start)"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="19 20 9 12 19 4 19 20" />
                  <line x1="5" x2="5" y1="19" y2="5" />
                </svg>
                <span className="sr-only">Start</span>
              </button>
              <button
                type="button"
                onClick={() => setEpochIndex((activeEpochIndex + surveyPasses.length - 1) % surveyPasses.length)}
                title="Previous Pass (ArrowLeft)"
                aria-label="Previous Pass"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
                <span className="sr-only">Prev</span>
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                title="Play/Pause (Space)"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className={`inline-flex h-7 w-9 items-center justify-center rounded-full border text-xs font-semibold transition-all ${
                  isPlaying
                    ? 'border-primary bg-primary text-white shadow-sm'
                    : 'border-neutral-700 bg-neutral-900 text-white hover:border-primary'
                }`}
              >
                {isPlaying ? (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                )}
                <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
              <button
                type="button"
                onClick={() => setEpochIndex((activeEpochIndex + 1) % surveyPasses.length)}
                title="Next Pass (ArrowRight)"
                aria-label="Next Pass"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className="sr-only">Next</span>
              </button>
            </div>

            {/* Discrete Pass Pills with Human Dates */}
            <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
              {surveyPasses.map((pass, idx) => {
                const humanDate = pass.dateStr;
                return (
                  <button
                    key={pass.passIndex}
                    type="button"
                    onClick={() => setEpochIndex(idx)}
                    className={`flex flex-col items-center rounded-lg border px-3 py-1 text-left transition-colors ${
                      activeEpochIndex === idx
                        ? 'border-primary bg-primary/15 text-white font-medium shadow-sm'
                        : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    <span className="font-sans text-[11px] font-medium leading-none">{pass.label}</span>
                    <span className="text-[10px] text-neutral-300 mt-0.5">{humanDate}</span>
                    <span className="font-mono tabular-nums text-[8px] text-neutral-500">MJD {pass.mjd}</span>
                  </button>
                );
              })}
            </div>

            {/* Playback speed slider */}
            <div className="flex items-center space-x-2 text-xs text-neutral-400">
              <span className="text-[11px]">Blink Speed:</span>
              <input
                type="range"
                min={150}
                max={1000}
                step={50}
                value={playbackSpeedMs}
                onChange={(e) => useTelemetryStore.setState({ playbackSpeedMs: Number(e.target.value) })}
                className="h-1 w-20 cursor-pointer accent-primary"
              />
              <span className="font-mono tabular-nums text-white text-[11px]">{playbackSpeedMs}ms</span>
            </div>
          </div>

          {/* Live Hover HUD Strip */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800/80 pt-2 font-mono tabular-nums text-xs text-neutral-400">
            <ComparatorHoverHud setterRef={hoverHudSetterRef} />

            <div className="text-[11px] text-neutral-500">
              Pixel scale: <span className="text-white">6.2&quot;/px</span> | Native TAN North-Up
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* RIGHT PANEL (35%): Analysis Deck & Wavelength-Matched Matrix              */}
      {/* ========================================================================= */}
      <div className="flex w-full lg:w-[38%] xl:w-[35%] shrink-0 lg:shrink lg:min-h-0 flex-col lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-neutral-800 bg-neutral-950 p-3 sm:p-4 text-xs space-y-4">
        {/* Render Mode Switcher */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Render Mode</h3>
            <span className="font-mono text-[10px] text-neutral-500">WebGL2 Float32 Pipeline</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'blink', title: 'Temporal Blink', subtitle: 'Cycle 6-mo passes', keyHint: '1' },
              { id: 'difference', title: 'Motion Diff', subtitle: 'Signed diff (t_N - t_0)', keyHint: '2' },
              { id: 'coadd', title: 'Deep Co-Add', subtitle: 'Stack 1/σ² passes', keyHint: '3' },
            ].map((m) => {
              const active = renderMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setRenderMode(m.id as any);
                    setUrlMode(m.id);
                  }}
                  className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition-all ${
                    active
                      ? 'border-primary bg-primary/15 text-white shadow-sm ring-1 ring-primary/40'
                      : 'border-neutral-800/80 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-sans font-semibold text-xs text-white">{m.title}</span>
                    <span className={`font-mono text-[9px] ${active ? 'text-primary' : 'text-neutral-500'}`}>[{m.keyHint}]</span>
                  </div>
                  <span className="mt-1 text-[10px] leading-tight text-neutral-400">{m.subtitle}</span>
                </button>
              );
            })}
          </div>

          {/* Faint Target Contrast Boost (Asinh) */}
          <div className="mt-4 pt-3 border-t border-neutral-800/80">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium">Faint Contrast Boost (Asinh):</span>
              <span className="font-mono tabular-nums text-white text-[11px] bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                a = {asinhParamA.toFixed(3)}
              </span>
            </div>
            <div className="mt-2 flex items-center space-x-2">
              <span className="text-[10px] text-neutral-500">Linear</span>
              <input
                type="range"
                min={0.001}
                max={0.5}
                step={0.005}
                value={asinhParamA}
                onChange={(e) => setAsinhParams({ a: Number(e.target.value) })}
                className="h-1 flex-1 cursor-pointer accent-primary"
              />
              <span className="text-[10px] text-neutral-500">Max Boost</span>
            </div>
          </div>

          {/* Colormap Selector */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
            <span className="text-neutral-300">Colormap:</span>
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'standard_rgb', label: 'Grayscale' },
                { id: 'viridis', label: 'Viridis' },
                { id: 'cividis', label: 'Cividis' },
                { id: 'inverted_grayscale', label: 'Inverted' },
              ].map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  onClick={() => setColorPalette(pal.id as any)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    colorPalette === pal.id
                      ? 'border-primary bg-primary/20 text-white font-medium'
                      : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-white hover:border-neutral-700'
                  }`}
                >
                  {pal.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* (Epoch x Band) Coverage Matrix & Wavelength-Matched Differencing Guard */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Coverage Matrix</h3>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Band-Match Guard Active
            </span>
          </div>
          <p className="mb-3 text-[11px] text-neutral-400 leading-relaxed">
            Differencing is strictly confined to exposures within the same wavelength band window. Click any cell to switch epoch and spectral band.
          </p>

          <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950/80">
            <table className="w-full border-collapse font-mono text-[10px]">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400 bg-neutral-900/60">
                  <th className="p-2 text-left font-sans font-medium text-[11px]">Pass</th>
                  {BANDS.map((b, bIdx) => (
                    <th
                      key={b.id}
                      className={`p-2 text-center cursor-pointer transition-colors ${
                        activeBandIndex === bIdx ? 'text-primary font-bold' : 'hover:text-white'
                      }`}
                      onClick={() => setActiveBandIndex(bIdx)}
                    >
                      {b.id}
                      <span className="block text-[8px] font-normal text-neutral-500">{b.wavelengthUm}μm</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {surveyPasses.map((pass, pIdx) => (
                  <tr
                    key={pass.passIndex}
                    className={`border-b border-neutral-800/50 transition-colors ${
                      activeEpochIndex === pIdx ? 'bg-primary/10' : 'hover:bg-neutral-900/40'
                    }`}
                  >
                    <td className="p-2 font-sans text-neutral-300 font-medium">
                      {pass.label}
                      <span className="block text-[8px] font-mono text-neutral-500">
                        MJD {pass.mjdRange[0].toFixed(0)}–{pass.mjdRange[1].toFixed(0)}
                      </span>
                    </td>
                    {BANDS.map((band, bIdx) => {
                      const epIdx = pIdx % totalEpochsCount;
                      const nExpCount = getPlaneMaxNExp(activeTensors.nExpData?.[epIdx]?.[bIdx]);
                      const isUnobserved = nExpCount === 0;
                      const isWiseFaint = activeBenchmark?.id === 'wise0855' && bIdx <= 2;
                      const isSelected = safeEpochIndex === pIdx && activeBandIndex === bIdx;
                      return (
                        <td
                          key={band.id}
                          onClick={() => {
                            setEpochIndex(pIdx);
                            setActiveBandIndex(bIdx);
                          }}
                          className={`p-2 text-center cursor-pointer border-l border-neutral-800/50 transition-all ${
                            isSelected
                              ? 'bg-primary font-bold text-white shadow-inner'
                              : isUnobserved
                              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                              : isWiseFaint
                              ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                              : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                          }`}
                          title={
                            isUnobserved
                              ? `No exposures in ${pass.label} for ${band.id}`
                              : isWiseFaint
                              ? `${band.id} (${nExpCount}x coverage; cold Y4 brown dwarf is faint >17 mag in NIR)`
                              : `${band.id} (${nExpCount} wavelength-matched exposures co-added, R=${band.resPower})`
                          }
                        >
                          {isUnobserved ? 'Undet.' : `${nExpCount}x`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Forced Aperture Photometry Light Curve */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Forced Aperture Light Curve</h3>
            <span className="font-mono text-[10px] text-emerald-400">
              {selectedMark
                ? `Target #${selectedMark.id} ([${selectedMark.x}, ${selectedMark.y}])`
                : '3×3 px Center Aperture'}
            </span>
          </div>
          <p className="mb-2 text-[11px] text-neutral-400">
            {selectedMark
              ? `Calibrated flux across ${totalEpochsCount} passes inside r=${Math.max(1, Math.min(4, Math.round(selectedMark.radiusPx)))} px around circled object #${selectedMark.id}.`
              : `Evolution of calibrated flux across all ${totalEpochsCount} survey passes in Optical/NIR (D1) versus Thermal Infrared (D5).`}
          </p>

          <div className="h-28 w-full rounded-lg border border-neutral-800 bg-black/60 p-2">
            {(() => {
              const peakLcFlux = Math.max(
                0.5,
                ...lightCurveData.flatMap((d) => [Math.max(0, d.fluxD1), Math.max(0, d.fluxD5)])
              );
              const xForIdx = (i: number) =>
                lightCurveData.length <= 1
                  ? 105
                  : 24 + (i / (lightCurveData.length - 1)) * 162;
              const yForFlux = (val: number) =>
                70 - Math.min(58, (Math.max(0, val) / peakLcFlux) * 56);
              return (
                <svg className="h-full w-full" viewBox="0 0 200 80">
                  {/* Gridlines */}
                  <line x1="20" y1="10" x2="190" y2="10" stroke="#262626" strokeWidth="0.5" />
                  <line x1="20" y1="40" x2="190" y2="40" stroke="#262626" strokeWidth="0.5" />
                  <line x1="20" y1="70" x2="190" y2="70" stroke="#262626" strokeWidth="0.5" />

                  {/* D1 Light curve stroke (NASA Blue) */}
                  <polyline
                    fill="none"
                    stroke="#288BFF"
                    strokeWidth="1.5"
                    points={lightCurveData
                      .map((d, i) => `${xForIdx(i)},${yForFlux(d.fluxD1)}`)
                      .join(' ')}
                  />
                  {/* D5 Light curve stroke (NASA Amber) */}
                  <polyline
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="1.5"
                    points={lightCurveData
                      .map((d, i) => `${xForIdx(i)},${yForFlux(d.fluxD5)}`)
                      .join(' ')}
                  />

                  {/* Data points */}
                  {lightCurveData.map((d, i) => (
                    <g key={i}>
                      <circle cx={xForIdx(i)} cy={yForFlux(d.fluxD1)} r="2.5" fill="#288BFF" />
                      <circle cx={xForIdx(i)} cy={yForFlux(d.fluxD5)} r="2.5" fill="#F59E0B" />
                    </g>
                  ))}
                </svg>
              );
            })()}
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] font-sans">
            <span className="flex items-center gap-1.5 text-sky-400">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Band D1 (0.9 µm NIR)</span>
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span>Band D5 (4.1 µm Thermal)</span>
            </span>
            {activeBenchmark?.id === 'rw_aur' && (
              <span className="text-emerald-400 font-medium">Dimming: &gt;1.5 mag</span>
            )}
          </div>
        </section>

        {/* 2-Click Proper Motion Calculator */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Proper Motion Calculator</h3>
            <button
              type="button"
              onClick={() => {
                if (!measuringMotion) {
                  setLastMotionVector(null);
                  setMotionResult(null);
                }
                setMeasuringMotion(!measuringMotion);
                setMotionPoints([]);
              }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
                measuringMotion
                  ? 'border-primary bg-primary text-white shadow-sm'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white hover:border-neutral-600'
              }`}
            >
              {measuringMotion ? 'Cancel Measure' : 'Measure 2-Click Vector'}
            </button>
          </div>

          {measuringMotion && motionPoints.length < 2 && (
            <div className="mb-2 rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-[11px] text-neutral-200">
              <div className="font-medium text-white mb-0.5">
                {motionPoints.length === 0 ? 'Step 1: Click target in Pass 1' : 'Step 2: Switch pass and click target in Pass 4'}
              </div>
              <p className="text-neutral-400 text-[10px]">
                5×5 sub-pixel auto-centroid snapping is active. Clicking snaps directly to local flux peak.
              </p>
            </div>
          )}

          {motionResult ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 font-mono text-[11px] text-emerald-300">
              <div className="font-sans font-semibold text-emerald-400 mb-1">Kinematic Motion Calculated:</div>
              <div>Total Motion: <strong className="text-white">{motionResult.totalMotionArcsecYr.toFixed(2)}&quot;/yr</strong></div>
              <div>Velocity: <strong className="text-white">{(motionResult.totalMotionArcsecYr / 6.2).toFixed(2)} px/yr</strong></div>
              <div>Position Angle: <strong className="text-white">{motionResult.positionAngleDeg.toFixed(1)}° E of N</strong></div>
            </div>
          ) : (
            !measuringMotion && (
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Click two points across different survey passes on the canvas to measure kinematic proper motion and position angle.
              </p>
            )
          )}
        </section>

        {/* Classification Triage Form & In-situ Confirmation Banner */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm backdrop-blur space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-white text-xs tracking-wide uppercase">Candidate Triage &amp; Escalation</h3>
            {markedObjects.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  {markedObjects.length} circled
                </span>
                <button
                  type="button"
                  onClick={handleClearMarks}
                  className="text-[10px] font-mono text-neutral-400 hover:text-amber-300"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {markedObjects.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Circled Identifications
              </div>
              <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                {markedObjects.map((mark) => {
                  const isSelected = mark.id === selectedMarkId;
                  return (
                    <div
                      key={mark.id}
                      onClick={() => handleSelectMark(mark)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectMark(mark);
                        }
                      }}
                      className={`flex cursor-pointer items-start justify-between gap-2 rounded-lg border p-2 text-left transition-colors ${
                        isSelected
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                          : 'border-neutral-800 bg-neutral-950/70 text-neutral-300 hover:border-neutral-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                          <span
                            className={`rounded px-1.5 py-0.5 font-bold ${
                              isSelected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            #{mark.id}
                          </span>
                          <span className="text-white">
                            [{mark.x}, {mark.y}]
                          </span>
                          <span className="text-neutral-400">
                            r={(mark.radiusPx * PIXEL_SCALE_ARCSEC).toFixed(1)}&quot;
                          </span>
                          <span className="text-sky-300">
                            {mark.passLabel} · {mark.bandId}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-neutral-400">
                          RA {mark.ra.toFixed(4)}°, Dec {mark.dec >= 0 ? '+' : ''}
                          {mark.dec.toFixed(4)}° · SNR {mark.snr.toFixed(1)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMark(mark.id);
                        }}
                        aria-label={`Delete circled object #${mark.id}`}
                        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-xs text-neutral-500 hover:bg-red-500/15 hover:text-red-300"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-950/60 p-2.5 text-[11px] text-neutral-400 leading-relaxed">
              Click or drag on the flipbook canvas to circle an object of interest. Its coordinates, aperture light curve, and spectrum will bind here for classification.
            </div>
          )}

          {selectedMark && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-2 text-[11px]">
              <div className="min-w-0 font-mono text-[10px] text-emerald-200">
                Classifying <strong className="text-white">#{selectedMark.id}</strong> ({selectedMark.ra.toFixed(4)}°,{' '}
                {selectedMark.dec >= 0 ? '+' : ''}
                {selectedMark.dec.toFixed(4)}°)
              </div>
              <button
                type="button"
                onClick={() => {
                  setProbedPixel({ x: selectedMark.x, y: selectedMark.y });
                  setProbeSkyPosition({ ra: selectedMark.ra, dec: selectedMark.dec });
                  setUrlProbeX(selectedMark.x);
                  setUrlProbeY(selectedMark.y);
                  setTab('lab');
                }}
                className="shrink-0 font-sans text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
              >
                Inspect in Spectral Lab →
              </button>
            </div>
          )}

          {triageSubmitted ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-emerald-300 animate-fadeIn">
              <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-sans font-semibold text-xs text-white">Classification Logged to Catalog</span>
              </div>
              <p className="mt-2 font-sans text-[11px] text-neutral-300 leading-relaxed">
                Candidate recorded as <strong className="text-white capitalize">{triageClass.replace(/_/g, ' ')}</strong> at{' '}
                <strong className="text-white">{triageConfidence}% confidence</strong>.
                {selectedMark
                  ? ` Marked #${selectedMark.id} at [${selectedMark.x}, ${selectedMark.y}] (RA ${selectedMark.ra.toFixed(4)}°, Dec ${selectedMark.dec >= 0 ? '+' : ''}${selectedMark.dec.toFixed(4)}°).`
                  : ' Telemetry metadata registered in the SPHEREx community catalog.'}
              </p>
              <div className="mt-3.5 flex flex-wrap items-center gap-3 font-sans">
                <button
                  type="button"
                  onClick={() => setTab('discussions')}
                  className="rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors shadow-sm"
                >
                  View in Community Discussions →
                </button>
                <button
                  type="button"
                  onClick={handleNextCandidate}
                  className="text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Classify another object
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-neutral-300">Object Classification:</label>
                <select
                  value={triageClass}
                  onChange={(e) => {
                    const nextClass = e.target.value;
                    setTriageClass(nextClass);
                    syncSelectedMarkTriage(nextClass, triageConfidence);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="moving_brown_dwarf">High-Proper-Motion Brown Dwarf (Cold Y/T Dwarf)</option>
                  <option value="dipole_mover">Dipole / Moving Object (Planet 9 / Substellar Mover)</option>
                  <option value="variable_star">Variable Stellar Object (T Tauri / Mira Pulsar)</option>
                  <option value="transient_glitch">Cosmic Ray Glitch / False Positive Artifact</option>
                  <option value="asteroid">Fast-Moving Solar System Asteroid</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-neutral-300">
                  <span className="font-medium">Observer Confidence:</span>
                  <span className="font-mono text-white font-semibold">{triageConfidence}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={triageConfidence}
                  onChange={(e) => {
                    const nextConfidence = Number(e.target.value);
                    setTriageConfidence(nextConfidence);
                    syncSelectedMarkTriage(triageClass, nextConfidence);
                  }}
                  className="mt-1.5 h-1 w-full cursor-pointer accent-primary"
                />
              </div>

              <button
                type="button"
                onClick={handleSubmitClassification}
                disabled={isSubmittingClassification}
                className="mt-2 w-full rounded-lg border border-primary bg-primary py-2 font-sans text-xs font-semibold text-white transition-all hover:bg-primary/90 disabled:opacity-50 shadow-sm"
              >
                {isSubmittingClassification
                  ? 'Submitting to Catalog...'
                  : selectedMark
                    ? `Submit Classification for #${selectedMark.id}`
                    : 'Submit Classification'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
