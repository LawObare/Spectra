import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import A from 'aladin-lite';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
  BenchmarkPill,
} from '../components/GlobalCommandHeader';

// Deep Field Centers (Ecliptic Poles in J2000 coordinates, radius = 5.64 deg -> ~100 deg^2)
const NEP_COORDS = { ra: 270.0, dec: 66.5607, radiusDeg: 5.64, label: 'NEP Deep Field (r = 5.64°)' };
const SEP_COORDS = { ra: 90.0, dec: -66.5607, radiusDeg: 5.64, label: 'SEP Deep Field (r = 5.64°)' };

// SPHEREx 6 HgCdTe Linear Variable Filter (LVF) Detector Specifications (SPECIFICATION.md §2.1)
interface DetectorSpec {
  id: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';
  label: string;
  lambdaMinUm: number;
  lambdaMaxUm: number;
  resolvingPower: number;
  colorHex: string;
}

const SPHEREX_DETECTORS: DetectorSpec[] = [
  { id: 'D1', label: 'D1 (0.75–1.11 µm)', lambdaMinUm: 0.75, lambdaMaxUm: 1.11, resolvingPower: 41, colorHex: '#38BDF8' },
  { id: 'D2', label: 'D2 (1.11–1.63 µm)', lambdaMinUm: 1.11, lambdaMaxUm: 1.63, resolvingPower: 41, colorHex: '#60A5FA' },
  { id: 'D3', label: 'D3 (1.63–2.42 µm)', lambdaMinUm: 1.63, lambdaMaxUm: 2.42, resolvingPower: 41, colorHex: '#34D399' },
  { id: 'D4', label: 'D4 (2.42–3.82 µm)', lambdaMinUm: 2.42, lambdaMaxUm: 3.82, resolvingPower: 35, colorHex: '#FBBF24' },
  { id: 'D5', label: 'D5 (3.82–4.42 µm)', lambdaMinUm: 3.82, lambdaMaxUm: 4.42, resolvingPower: 110, colorHex: '#F97316' },
  { id: 'D6', label: 'D6 (4.42–5.00 µm)', lambdaMinUm: 4.42, lambdaMaxUm: 5.00, resolvingPower: 130, colorHex: '#F43F5E' },
];

const FOV_CUTOUT_PRESETS = [60, 120, 180, 300, 600];

// Verified Astrometric Proper Motions (mas/yr) for Catalog Objects
const CATALOG_PROPER_MOTIONS: Record<string, { pmRaMasYr: number; pmDecMasYr: number; totalArcsecYr: number }> = {
  barnard: { pmRaMasYr: -801.5, pmDecMasYr: 10362.4, totalArcsecYr: 10.39 },
  wise0855: { pmRaMasYr: -8118.0, pmDecMasYr: -680.0, totalArcsecYr: 8.15 },
  eps_indi_b: { pmRaMasYr: 3960.0, pmDecMasYr: -2538.0, totalArcsecYr: 4.68 },
  rw_aur: { pmRaMasYr: 3.4, pmDecMasYr: -24.1, totalArcsecYr: 0.02 },
  r_dra: { pmRaMasYr: -18.2, pmDecMasYr: -31.5, totalArcsecYr: 0.04 },
  trappist1: { pmRaMasYr: 930.0, pmDecMasYr: -470.0, totalArcsecYr: 1.04 },
  vega: { pmRaMasYr: 200.9, pmDecMasYr: 286.2, totalArcsecYr: 0.35 },
};

// Progressive Multi-Order HEALPix (HiPS) All-Sky Survey Configurations (Seamless 360° Spherical Projection)
type PhotographicSurveyId = 'unwise-neo7' | '2mass-nir' | 'dss2-optical' | 'ls-dr10';

interface PhotographicSurveySpec {
  id: PhotographicSurveyId;
  hipsId: string;
  label: string;
  badge: string;
  description: string;
}

const PHOTOGRAPHIC_SURVEYS: PhotographicSurveySpec[] = [
  {
    id: 'unwise-neo7',
    hipsId: 'CDS/P/unWISE/color-W2-W1W2-W1',
    label: 'unWISE Infrared',
    badge: 'NASA 3.4 & 4.6 µm HiPS (All-Sky)',
    description: 'Continuous all-sky HEALPix spherical projection of NASA WISE/NEOWISE infrared co-adds. Zero seams across 360°.',
  },
  {
    id: '2mass-nir',
    hipsId: 'CDS/P/2MASS/color',
    label: '2MASS Near-IR',
    badge: 'J/H/Ks 1.2–2.2 µm HiPS (All-Sky)',
    description: 'Two Micron All-Sky Survey (J, H, Ks) matching SPHEREx Bands D2–D3 with crisp resolved stellar fields.',
  },
  {
    id: 'dss2-optical',
    hipsId: 'CDS/P/DSS2/color',
    label: 'DSS2 Optical',
    badge: 'Palomar/UKST All-Sky HiPS',
    description: 'Digitized Sky Survey 2 full-sphere optical photographic mosaic covering 100% of North and South poles.',
  },
  {
    id: 'ls-dr10',
    hipsId: 'CDS/P/DESI-Legacy-Surveys/DR10/color',
    label: 'Legacy DR10',
    badge: 'Deep Optical g/r/z HiPS',
    description: 'DESI Legacy Imaging Surveys DR10 progressive HiPS mosaic resolving deep galaxy spirals and nebulae.',
  },
];

// SPHEREx Level-2 Spectral Image Exposure Metadata (Modelled after IRSA spherex_qr2 MEF table)
interface SpherexSpectralExposure {
  obsId: string;
  passNumber: number;
  mjd: number;
  dateUtc: string;
  detector: DetectorSpec;
  centerRa: number;
  centerDec: number;
  rollAngleDeg: number;
  footprintWidthDeg: number;
  footprintHeightDeg: number;
  lambdaAtTargetUm: number;
  bandwidthUm: number;
  zodiMjySr: number;
  qualityFlag: 'NOMINAL' | 'DEEP_FIELD';
}

// Deterministic integer hash for reproducible astrometric field stars & exposure offsets
function hashSkyCell(ix: number, iy: number, salt: number): number {
  let h = (ix * 374761393 + iy * 668265263 + salt * 1442695041) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// Convert decimal degrees (RA, Dec) to J2000 sexagesimal readout
function formatSexagesimal(raDeg: number, decDeg: number): string {
  const normRa = ((raDeg % 360) + 360) % 360;
  const totalRaSec = (normRa / 15) * 3600;
  const rh = Math.floor(totalRaSec / 3600);
  const rm = Math.floor((totalRaSec % 3600) / 60);
  const rs = (totalRaSec % 60).toFixed(1);

  const sign = decDeg >= 0 ? '+' : '−';
  const absDecSec = Math.abs(decDeg) * 3600;
  const dd = Math.floor(absDecSec / 3600);
  const dm = Math.floor((absDecSec % 3600) / 60);
  const ds = Math.floor(absDecSec % 60);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const padRaS = Number(rs) < 10 ? `0${rs}` : rs;
  return `${pad2(rh)}h ${pad2(rm)}m ${padRaS}s ${sign}${pad2(dd)}° ${pad2(dm)}' ${pad2(ds)}"`;
}

// Format angular field of view
function formatFieldFov(fovDeg: number): string {
  if (fovDeg >= 1.0) return `${fovDeg.toFixed(2)}°`;
  const arcmin = fovDeg * 60;
  if (arcmin >= 1.0) return `${arcmin.toFixed(1)}'`;
  return `${(fovDeg * 3600).toFixed(0)}"`;
}

// Compute Ecliptic Latitude & SPHEREx Survey Depth
function computeCoverageDepth(raDeg: number, decDeg: number): {
  isDeepField: boolean;
  eclipticLatDeg: number;
  passesCount: number;
  cadenceLabel: string;
} {
  const toRad = Math.PI / 180;
  const cosDistNep =
    Math.sin(decDeg * toRad) * Math.sin(NEP_COORDS.dec * toRad) +
    Math.cos(decDeg * toRad) * Math.cos(NEP_COORDS.dec * toRad) * Math.cos((raDeg - NEP_COORDS.ra) * toRad);
  const distNepDeg = Math.acos(Math.min(1, Math.max(-1, cosDistNep))) / toRad;
  const eclipticLatDeg = 90 - distNepDeg;
  const isDeepField = distNepDeg <= 9.0 || distNepDeg >= 171.0;

  return {
    isDeepField,
    eclipticLatDeg,
    passesCount: isDeepField ? 52 : 4,
    cadenceLabel: isDeepField ? 'Deep Field (>50 passes/yr)' : 'All-Sky Survey (4 passes)',
  };
}

// Generate Stitched SPHEREx Level-2 Spectral Image Exposures covering (ra, dec)
function generateSpherexExposuresForCoord(raDeg: number, decDeg: number): SpherexSpectralExposure[] {
  const exposures: SpherexSpectralExposure[] = [];
  const depth = computeCoverageDepth(raDeg, decDeg);
  const basePasses = [
    { pass: 1, mjdBase: 60810.2, date: '2025-05-15', rollBase: 14.2 },
    { pass: 2, mjdBase: 60995.6, date: '2025-11-16', rollBase: 194.8 },
    { pass: 3, mjdBase: 61178.1, date: '2026-05-18', rollBase: 22.5 },
    { pass: 4, mjdBase: 61360.8, date: '2026-11-16', rollBase: 203.1 },
  ];

  const coordSeedX = Math.floor(raDeg * 10);
  const coordSeedY = Math.floor((decDeg + 90) * 10);
  const cosDec = Math.max(0.1, Math.cos((decDeg * Math.PI) / 180));

  basePasses.forEach((p, pIdx) => {
    SPHEREX_DETECTORS.forEach((det, dIdx) => {
      const h1 = hashSkyCell(coordSeedX + pIdx, coordSeedY + dIdx, 11);
      const h2 = hashSkyCell(coordSeedX + pIdx, coordSeedY + dIdx, 23);
      const h3 = hashSkyCell(coordSeedX + pIdx, coordSeedY + dIdx, 37);

      const offsetRaDeg = ((h1 - 0.5) * 0.85) / cosDec;
      const offsetDecDeg = (h2 - 0.5) * 0.85;
      const rollAngleDeg = (p.rollBase + dIdx * 2.4 + (h3 - 0.5) * 6.0) % 360;

      const lvfFraction = Math.max(0.06, Math.min(0.94, 0.2 + 0.6 * h3));
      const lambdaAtTargetUm =
        det.lambdaMinUm + lvfFraction * (det.lambdaMaxUm - det.lambdaMinUm);
      const bandwidthUm = lambdaAtTargetUm / det.resolvingPower;

      const eclipticFactor = Math.cos((depth.eclipticLatDeg * Math.PI) / 180);
      const zodiMjySr = Number((0.18 + 0.65 * Math.abs(eclipticFactor) + dIdx * 0.09).toFixed(2));

      const obsSeq = String(100 + pIdx * 6 + dIdx + (Math.abs(coordSeedX) % 80)).padStart(4, '0');
      exposures.push({
        obsId: `spx_qr2_p${p.pass}_${det.id.toLowerCase()}_${Math.floor(p.mjdBase)}_${obsSeq}`,
        passNumber: p.pass,
        mjd: Number((p.mjdBase + dIdx * 0.04).toFixed(3)),
        dateUtc: p.date,
        detector: det,
        centerRa: ((raDeg + offsetRaDeg) % 360 + 360) % 360,
        centerDec: Math.max(-89.5, Math.min(89.5, decDeg + offsetDecDeg)),
        rollAngleDeg,
        footprintWidthDeg: 1.8,
        footprintHeightDeg: 1.8,
        lambdaAtTargetUm: Number(lambdaAtTargetUm.toFixed(3)),
        bandwidthUm: Number(bandwidthUm.toFixed(4)),
        zodiMjySr,
        qualityFlag: depth.isDeepField ? 'DEEP_FIELD' : 'NOMINAL',
      });
    });
  });

  return exposures;
}

export const CelestialNavigator: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const aladinContainerRef = useRef<HTMLDivElement>(null);
  const aladinInstanceRef = useRef<any>(null);
  const skyCanvasRef = useRef<HTMLCanvasElement>(null);

  // High-frequency DOM refs for 60 FPS cursor readouts (avoids React state re-renders on mousemove)
  const cursorRaDecDomRef = useRef<HTMLSpanElement>(null);
  const cursorSexaDomRef = useRef<HTMLSpanElement>(null);
  const cursorLvfDomRef = useRef<HTMLSpanElement>(null);

  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    setCoordinates,
    setFov,
    setRgbPreset,
  } = useTelemetryStore();

  const { setTab, setRa, setDec, setFov: setUrlFov, setPreset } = useSpectraUrlState();

  // Layer & Filter Controls
  const [showLvfFootprints, setShowLvfFootprints] = useState<boolean>(true);
  const [showWcsGrid, setShowWcsGrid] = useState<boolean>(true);
  const [showProperMotion, setShowProperMotion] = useState<boolean>(true);
  const [showCutoutBox, setShowCutoutBox] = useState<boolean>(true);
  const [activeSurvey, setActiveSurvey] = useState<PhotographicSurveyId>('unwise-neo7');
  const [selectedBandFilter, setSelectedBandFilter] = useState<string>('ALL');
  const [hoveredObsId, setHoveredObsId] = useState<string | null>(null);
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);
  const [hoveredCatalogObject, setHoveredCatalogObject] = useState<BenchmarkPill | null>(null);
  const [displayFovDeg, setDisplayFovDeg] = useState<number>(6.0);
  const [hipsReady, setHipsReady] = useState<boolean>(false);

  // Direct coordinate input fields in the right-hand inspector
  const [raInputStr, setRaInputStr] = useState<string>(ra.toFixed(5));
  const [decInputStr, setDecInputStr] = useState<string>(dec.toFixed(5));

  useEffect(() => {
    setRaInputStr(ra.toFixed(5));
    setDecInputStr(dec.toFixed(5));
  }, [ra, dec]);

  // High-frequency mutable 3D spherical camera state (upSign flips at ±90° poles for continuous 360° vertical looping)
  const cameraRef = useRef<{
    centerRa: number;
    centerDec: number;
    fovDeg: number;
    upSign: 1 | -1;
    cursorX: number | null;
    cursorY: number | null;
    cursorRa: number;
    cursorDec: number;
  }>({
    centerRa: ra,
    centerDec: dec,
    fovDeg: 6.0,
    upSign: 1,
    cursorX: null,
    cursorY: null,
    cursorRa: ra,
    cursorDec: dec,
  });

  const dragRef = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({
    active: false,
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  const projectedCatalogRef = useRef<
    Array<{ item: BenchmarkPill; x: number; y: number; inView: boolean }>
  >([]);

  // Generate overlapping SPHEREx Level-2 spectral image exposures for the active target
  const allExposures = useMemo(() => generateSpherexExposuresForCoord(ra, dec), [ra, dec]);

  const filteredExposures = useMemo(() => {
    if (selectedBandFilter === 'ALL') return allExposures;
    return allExposures.filter((e) => e.detector.id === selectedBandFilter);
  }, [allExposures, selectedBandFilter]);

  const activeExposure = useMemo(() => {
    const id = hoveredObsId || selectedObsId;
    if (!id) return filteredExposures[0] || null;
    return allExposures.find((e) => e.obsId === id) || filteredExposures[0] || null;
  }, [allExposures, filteredExposures, hoveredObsId, selectedObsId]);

  const coverageDepth = useMemo(() => computeCoverageDepth(ra, dec), [ra, dec]);
  const sexagesimalTarget = useMemo(() => formatSexagesimal(ra, dec), [ra, dec]);

  // Keep latest render flags in a ref so the 60 FPS canvas draw function always reads current toggles
  const renderStateRef = useRef({
    targetRa: ra,
    targetDec: dec,
    targetName: activeTargetName,
    fovArcsec,
    showLvfFootprints,
    showWcsGrid,
    showProperMotion,
    showCutoutBox,
    activeSurvey,
    filteredExposures,
    activeExposure,
    hipsReady,
  });

  useEffect(() => {
    renderStateRef.current = {
      targetRa: ra,
      targetDec: dec,
      targetName: activeTargetName,
      fovArcsec,
      showLvfFootprints,
      showWcsGrid,
      showProperMotion,
      showCutoutBox,
      activeSurvey,
      filteredExposures,
      activeExposure,
      hipsReady,
    };
  }, [
    activeExposure,
    activeSurvey,
    activeTargetName,
    filteredExposures,
    fovArcsec,
    hipsReady,
    ra,
    dec,
    showCutoutBox,
    showLvfFootprints,
    showProperMotion,
    showWcsGrid,
  ]);

  // Mount Aladin Lite v3 WebGL2 Progressive HiPS All-Sky Engine
  useEffect(() => {
    let cancelled = false;
    if (!aladinContainerRef.current) return;

    const initAladin = async () => {
      try {
        if (A && A.init) {
          await A.init;
        }
        if (cancelled || !aladinContainerRef.current) return;
        const surveySpec =
          PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey) || PHOTOGRAPHIC_SURVEYS[0];
        const instance = A.aladin(aladinContainerRef.current, {
          survey: surveySpec.hipsId,
          target: `${cameraRef.current.centerRa} ${cameraRef.current.centerDec}`,
          fov: cameraRef.current.fovDeg,
          projection: 'STG',
          cooFrame: 'ICRSd',
          showReticle: false,
          showZoomControl: false,
          showFullscreenControl: false,
          showLayersControl: false,
          showGotoControl: false,
          showShareControl: false,
          showSimbadPointerControl: false,
          showFrame: false,
          showCooGrid: false,
          showCooGridControl: false,
          showProjectionControl: false,
          showContextMenu: false,
        });
        aladinInstanceRef.current = instance;
        setHipsReady(true);
      } catch {
        // Fallback to built-in 3D spherical renderer if WebGL2 context or WASM init fails
        setHipsReady(false);
      }
    };

    initAladin();
    return () => {
      cancelled = true;
      aladinInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch HiPS survey layer when user clicks survey selector
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladin) return;
    const surveySpec =
      PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey) || PHOTOGRAPHIC_SURVEYS[0];
    try {
      aladin.setImageSurvey(surveySpec.hipsId);
    } catch {
      // Ignore transient survey switch errors
    }
  }, [activeSurvey]);

  // Sync camera center when external target coordinates change (e.g. from search bar or catalog selection)
  useEffect(() => {
    if (!dragRef.current.active) {
      cameraRef.current.centerRa = ra;
      cameraRef.current.centerDec = dec;
      cameraRef.current.upSign = 1;
      try {
        aladinInstanceRef.current?.gotoRaDec(ra, dec);
      } catch {
        // Ignore if Aladin still initializing
      }
    }
  }, [ra, dec]);

  // Primary 60 FPS True 3D Spherical Projection & SPHEREx LVF Footprint Renderer
  useEffect(() => {
    const canvas = skyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const toRad = Math.PI / 180;

    const renderFrame = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : 1024;
      const height = parent ? parent.clientHeight : 720;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.save();
      ctx.scale(dpr, dpr);

      const { centerRa, centerDec, fovDeg, upSign } = cameraRef.current;
      const state = renderStateRef.current;
      const aladin = aladinInstanceRef.current;

      // Sync Aladin Lite v3 camera orientation & FoV
      if (aladin) {
        try {
          aladin.gotoRaDec(centerRa, centerDec);
          aladin.setFoV(fovDeg);
          if (typeof aladin.setPositionAngle === 'function') {
            aladin.setPositionAngle(upSign === 1 ? 0 : 180);
          }
        } catch {
          // Ignore transient sync error
        }
      }

      // True 3D Spherical Stereographic Orthonormal Basis (Seamless 360° Over-the-Poles Projection)
      // Camera forward vector F = (fx, fy, fz) at (centerRa, centerDec)
      const ra0 = centerRa * toRad;
      const dec0 = centerDec * toRad;
      const fx = Math.cos(dec0) * Math.cos(ra0);
      const fy = Math.cos(dec0) * Math.sin(ra0);
      const fz = Math.sin(dec0);

      // Camera East tangent vector E (points toward increasing RA; multiplied by upSign so pole crossing is rigid)
      const ex = -Math.sin(ra0) * upSign;
      const ey = Math.cos(ra0) * upSign;
      const ez = 0;

      // Camera North tangent vector N = F × E (points toward increasing Dec when upSign = +1, and continues smoothly over ±90°)
      const nx = -Math.sin(dec0) * Math.cos(ra0) * upSign;
      const ny = -Math.sin(dec0) * Math.sin(ra0) * upSign;
      const nz = Math.cos(dec0) * upSign;

      // Stereographic focal scale: maps fovDeg across viewport width without edge blowup up to 180°
      const focalPx = width / (4 * Math.tan(Math.max(0.005, Math.min(175, fovDeg)) * toRad * 0.25));
      const scalePxPerDeg = width / Math.max(0.01, fovDeg);

      const worldToScreen = (
        sRa: number,
        sDec: number
      ): { x: number; y: number; inBounds: boolean } => {
        // When Aladin Lite v3 is active and right-side up, use its exact WCS projection if available
        if (aladin && upSign === 1 && typeof aladin.world2pix === 'function') {
          try {
            const pix = aladin.world2pix(sRa, sDec);
            if (Array.isArray(pix) && Number.isFinite(pix[0]) && Number.isFinite(pix[1])) {
              const x = pix[0];
              const y = pix[1];
              const inBounds = x >= -120 && x <= width + 120 && y >= -120 && y <= height + 120;
              return { x, y, inBounds };
            }
          } catch {
            // Fall through to exact 3D stereographic math
          }
        }

        const r = sRa * toRad;
        const d = sDec * toRad;
        const vx = Math.cos(d) * Math.cos(r);
        const vy = Math.cos(d) * Math.sin(r);
        const vz = Math.sin(d);

        // Dot products with camera basis (F, E, N)
        const cosC = vx * fx + vy * fy + vz * fz;
        if (cosC <= -0.85) {
          return { x: -9999, y: -9999, inBounds: false };
        }
        const k = 2.0 / (1.0 + cosC);
        const uEast = k * (vx * ex + vy * ey + vz * ez);
        const vNorth = k * (vx * nx + vy * ny + vz * nz);

        // Astronomical convention: East is Left (-uEast), North is Up (-vNorth on screen Y)
        const x = width / 2 - (uEast * focalPx) / 2;
        const y = height / 2 - (vNorth * focalPx) / 2;
        const inBounds = x >= -120 && x <= width + 120 && y >= -120 && y <= height + 120;
        return { x, y, inBounds };
      };

      // Clear overlay canvas (transparent when Aladin HiPS WebGL2 canvas is active underneath; deep-space well otherwise)
      ctx.clearRect(0, 0, width, height);
      if (!state.hipsReady || upSign === -1) {
        ctx.fillStyle = '#05070B';
        ctx.fillRect(0, 0, width, height);

        // Continuous Spherical Milky Way & Zodiacal Glow Band (Zero Seams Across 360°)
        const bgGrad = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          10,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.75
        );
        bgGrad.addColorStop(0, 'rgba(30, 58, 95, 0.16)');
        bgGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.10)');
        bgGrad.addColorStop(1, 'rgba(5, 7, 11, 0.0)');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Continuous 3D Spherical Starfield & Resolved Deep-Sky Sources (Zero Tile Seams, Crisp at Every Zoom)
      const starPalette = ['#cfe4ff', '#eef6ff', '#fff9eb', '#ffe3b3', '#ffbe85', '#ff9b6a'];
      const octaves = [
        { cellDeg: 6.0, minFov: 0.01, maxFov: 180.0, starsPerCell: 5, brightBoost: 1.45 },
        { cellDeg: 2.0, minFov: 0.01, maxFov: 48.0, starsPerCell: 7, brightBoost: 1.2 },
        { cellDeg: 0.5, minFov: 0.01, maxFov: 12.0, starsPerCell: 9, brightBoost: 1.0 },
        { cellDeg: 0.12, minFov: 0.01, maxFov: 3.0, starsPerCell: 10, brightBoost: 0.9 },
      ];

      const halfSpanDeg = Math.min(90, fovDeg * 0.85);
      const cosDecClamp = Math.max(0.12, Math.cos(centerDec * toRad));
      const raSpan = Math.min(180, halfSpanDeg / cosDecClamp);

      octaves.forEach((oct, octIdx) => {
        if (fovDeg > oct.maxFov || fovDeg < oct.minFov) return;
        const cDecStart = Math.max(
          Math.floor(-89.5 / oct.cellDeg),
          Math.floor((centerDec - halfSpanDeg) / oct.cellDeg)
        );
        const cDecEnd = Math.min(
          Math.ceil(89.5 / oct.cellDeg),
          Math.ceil((centerDec + halfSpanDeg) / oct.cellDeg)
        );
        const wrapCount = Math.max(1, Math.round(360 / oct.cellDeg));
        const cRaStart =
          raSpan >= 175 ? 0 : Math.floor((centerRa - raSpan) / oct.cellDeg);
        const cRaEnd =
          raSpan >= 175 ? wrapCount - 1 : Math.ceil((centerRa + raSpan) / oct.cellDeg);

        for (let cDec = cDecStart; cDec <= cDecEnd; cDec++) {
          for (let cRa = cRaStart; cRa <= cRaEnd; cRa++) {
            const wrappedRa = ((cRa % wrapCount) + wrapCount) % wrapCount;
            for (let s = 0; s < oct.starsPerCell; s++) {
              const saltBase = octIdx * 100 + s * 5;
              const u = hashSkyCell(wrappedRa, cDec, saltBase + 1);
              const v = hashSkyCell(wrappedRa, cDec, saltBase + 2);
              const magH = hashSkyCell(wrappedRa, cDec, saltBase + 3);
              const colH = hashSkyCell(wrappedRa, cDec, saltBase + 4);

              const starRa = (wrappedRa + u) * oct.cellDeg;
              const starDec = (cDec + v) * oct.cellDeg;
              if (starDec < -89.8 || starDec > 89.8) continue;

              const pos = worldToScreen(starRa, starDec);
              if (!pos.inBounds) continue;

              const radiusPx = (0.65 + Math.pow(1 - magH, 2.8) * 2.2) * oct.brightBoost;
              const baseAlpha = state.hipsReady && upSign === 1 ? 0.45 : 0.85;
              const alpha = (0.3 + (1 - magH) * 0.7) * baseAlpha;
              const colorHex = starPalette[Math.floor(colH * starPalette.length)];

              if (radiusPx > 1.7) {
                ctx.globalAlpha = alpha * 0.28;
                ctx.fillStyle = colorHex;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radiusPx * 2.4, 0, Math.PI * 2);
                ctx.fill();
              }

              ctx.globalAlpha = alpha;
              ctx.fillStyle = colorHex;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      });
      ctx.globalAlpha = 1.0;

      // 3. Curved 3D Spherical J2000 WCS Coordinate Graticule (Continuous Over North & South Poles)
      if (state.showWcsGrid) {
        const gridStepDeg =
          fovDeg > 45
            ? 15
            : fovDeg > 18
            ? 5
            : fovDeg > 7
            ? 2
            : fovDeg > 2.5
            ? 1
            : fovDeg > 0.7
            ? 0.25
            : 0.05;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.lineWidth = 1;

        const minDec = Math.max(
          -85,
          Math.floor((centerDec - halfSpanDeg) / gridStepDeg) * gridStepDeg
        );
        const maxDec = Math.min(
          85,
          Math.ceil((centerDec + halfSpanDeg) / gridStepDeg) * gridStepDeg
        );
        const minRa =
          raSpan >= 175 ? 0 : Math.floor((centerRa - raSpan) / gridStepDeg) * gridStepDeg;
        const maxRa =
          raSpan >= 175 ? 360 : Math.ceil((centerRa + raSpan) / gridStepDeg) * gridStepDeg;

        // Parallels of Declination (curved along sphere)
        for (let gDec = minDec; gDec <= maxDec; gDec += gridStepDeg) {
          ctx.beginPath();
          let started = false;
          let labelPos: { x: number; y: number } | null = null;
          const raSampleStep = Math.max(0.02, gridStepDeg * 0.25);
          for (let sRa = minRa; sRa <= maxRa; sRa += raSampleStep) {
            const p = worldToScreen(sRa, gDec);
            if (p.inBounds) {
              if (!started) {
                ctx.moveTo(p.x, p.y);
                started = true;
              } else {
                ctx.lineTo(p.x, p.y);
              }
              if (!labelPos && p.x > 16 && p.x < width - 80 && p.y > 16 && p.y < height - 16) {
                labelPos = p;
              }
            } else {
              started = false;
            }
          }
          ctx.stroke();
          if (labelPos) {
            ctx.fillText(
              `Dec ${gDec >= 0 ? '+' : ''}${gDec.toFixed(gridStepDeg < 1 ? 2 : 0)}°`,
              labelPos.x + 4,
              labelPos.y - 4
            );
          }
        }

        // Meridians of Right Ascension (converging smoothly to North +90° and South -90° poles)
        for (let gRa = minRa; gRa < maxRa; gRa += gridStepDeg) {
          const normRa = ((gRa % 360) + 360) % 360;
          ctx.beginPath();
          let started = false;
          const decSampleStep = Math.max(0.02, gridStepDeg * 0.25);
          for (let sDec = Math.max(-89.5, minDec - gridStepDeg); sDec <= Math.min(89.5, maxDec + gridStepDeg); sDec += decSampleStep) {
            const p = worldToScreen(normRa, sDec);
            if (p.inBounds) {
              if (!started) {
                ctx.moveTo(p.x, p.y);
                started = true;
              } else {
                ctx.lineTo(p.x, p.y);
              }
            } else {
              started = false;
            }
          }
          ctx.stroke();
          const midP = worldToScreen(normRa, centerDec);
          if (midP.inBounds && midP.x >= 8 && midP.x <= width - 65) {
            ctx.fillText(
              `RA ${normRa.toFixed(gridStepDeg < 1 ? 2 : 0)}°`,
              midP.x + 4,
              height - 10
            );
          }
        }

        // Mark Celestial Poles (+90° N, -90° S) when in view so pole transit is unmistakable
        [
          { dec: 90, label: 'North Celestial Pole (+90°)' },
          { dec: -90, label: 'South Celestial Pole (−90°)' },
        ].forEach((celPole) => {
          const p = worldToScreen(0, celPole.dec);
          if (p.inBounds) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#38BDF8';
            ctx.fillText(celPole.label, p.x + 10, p.y + 3);
          }
        });
      }

      // 4. NEP & SEP Deep-Field Calibration Zones (r = 5.64 deg)
      [NEP_COORDS, SEP_COORDS].forEach((pole) => {
        const pos = worldToScreen(pole.ra, pole.dec);
        const rPx = pole.radiusDeg * scalePxPerDeg;
        if (
          pos.inBounds &&
          pos.x + rPx >= 0 &&
          pos.x - rPx <= width &&
          pos.y + rPx >= 0 &&
          pos.y - rPx <= height
        ) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, rPx, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(245, 158, 11, 0.04)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#F59E0B';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(pole.label, pos.x + 8, pos.y - 8);
        }
      });

      // 5. Stitched SPHEREx Level-2 LVF Detector Footprints (Modelled after IRSA search-spectral-images)
      if (state.showLvfFootprints) {
        state.filteredExposures.forEach((exp) => {
          const isFocused = state.activeExposure?.obsId === exp.obsId;
          if (isFocused) return;

          const pos = worldToScreen(exp.centerRa, exp.centerDec);
          if (!pos.inBounds) return;
          const wPx = exp.footprintWidthDeg * scalePxPerDeg;
          const hPx = exp.footprintHeightDeg * scalePxPerDeg;
          if (wPx < 12) return;

          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.rotate((exp.rollAngleDeg * Math.PI) / 180);

          ctx.strokeStyle = exp.detector.colorHex;
          ctx.globalAlpha = 0.24;
          ctx.lineWidth = 1;
          ctx.strokeRect(-wPx / 2, -hPx / 2, wPx, hPx);

          ctx.restore();
        });

        if (state.activeExposure) {
          const exp = state.activeExposure;
          const pos = worldToScreen(exp.centerRa, exp.centerDec);
          const wPx = exp.footprintWidthDeg * scalePxPerDeg;
          const hPx = exp.footprintHeightDeg * scalePxPerDeg;

          if (pos.inBounds && wPx >= 10) {
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate((exp.rollAngleDeg * Math.PI) / 180);

            const lvfGrad = ctx.createLinearGradient(0, -hPx / 2, 0, hPx / 2);
            lvfGrad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
            lvfGrad.addColorStop(0.5, 'rgba(52, 211, 153, 0.12)');
            lvfGrad.addColorStop(1, 'rgba(244, 63, 94, 0.18)');
            ctx.fillStyle = lvfGrad;
            ctx.fillRect(-wPx / 2, -hPx / 2, wPx, hPx);

            ctx.strokeStyle = exp.detector.colorHex;
            ctx.lineWidth = 1.75;
            ctx.strokeRect(-wPx / 2, -hPx / 2, wPx, hPx);

            ctx.strokeStyle = 'rgba(230, 236, 242, 0.22)';
            ctx.lineWidth = 0.75;
            ctx.setLineDash([3, 3]);
            for (let frac = -0.25; frac <= 0.25; frac += 0.25) {
              ctx.beginPath();
              ctx.moveTo(-wPx / 2, hPx * frac);
              ctx.lineTo(wPx / 2, hPx * frac);
              ctx.stroke();
            }
            ctx.setLineDash([]);

            if (wPx > 65) {
              ctx.fillStyle = '#E6ECF2';
              ctx.font = '10px "JetBrains Mono", monospace';
              ctx.fillText(
                `${exp.detector.id} · Pass ${exp.passNumber} (ψ=${exp.rollAngleDeg.toFixed(0)}°)`,
                -wPx / 2 + 6,
                -hPx / 2 + 13
              );
              ctx.fillStyle = '#94A3B8';
              ctx.fillText(
                `LVF ${exp.detector.lambdaMinUm.toFixed(2)}→${exp.detector.lambdaMaxUm.toFixed(2)} µm`,
                -wPx / 2 + 6,
                hPx / 2 - 6
              );
            }

            ctx.restore();
          }
        }
      }

      // 6. Render Catalog Objects & Proper-Motion Vectors
      const nextProjected: Array<{ item: BenchmarkPill; x: number; y: number; inView: boolean }> =
        [];

      SEARCHABLE_SKY_CATALOG.forEach((item) => {
        const pos = worldToScreen(item.ra, item.dec);
        nextProjected.push({ item, x: pos.x, y: pos.y, inView: pos.inBounds });
        if (!pos.inBounds) return;

        const isSelected =
          Math.abs(state.targetRa - item.ra) < 0.01 &&
          Math.abs(state.targetDec - item.dec) < 0.01;

        if (state.showProperMotion) {
          const pm = CATALOG_PROPER_MOTIONS[item.id];
          if (pm && pm.totalArcsecYr >= 0.3) {
            const vecScale = 4.2;
            const vx = pos.x - (pm.pmRaMasYr / 1000) * vecScale * upSign;
            const vy = pos.y - (pm.pmDecMasYr / 1000) * vecScale * upSign;
            ctx.strokeStyle = '#38BDF8';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(vx, vy);
            ctx.stroke();

            const angle = Math.atan2(vy - pos.y, vx - pos.x);
            ctx.beginPath();
            ctx.moveTo(vx, vy);
            ctx.lineTo(
              vx - 5 * Math.cos(angle - Math.PI / 6),
              vy - 5 * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
              vx - 5 * Math.cos(angle + Math.PI / 6),
              vy - 5 * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fillStyle = '#38BDF8';
            ctx.fill();
          }
        }

        ctx.strokeStyle = isSelected ? '#38BDF8' : 'rgba(230, 236, 242, 0.65)';
        ctx.lineWidth = isSelected ? 1.5 : 1.1;
        const gap = 4;
        const arm = isSelected ? 10 : 7;
        ctx.beginPath();
        ctx.moveTo(pos.x - arm, pos.y);
        ctx.lineTo(pos.x - gap, pos.y);
        ctx.moveTo(pos.x + gap, pos.y);
        ctx.lineTo(pos.x + arm, pos.y);
        ctx.moveTo(pos.x, pos.y - arm);
        ctx.lineTo(pos.x, pos.y - gap);
        ctx.moveTo(pos.x, pos.y + gap);
        ctx.lineTo(pos.x, pos.y + arm);
        ctx.stroke();

        ctx.fillStyle = '#E6ECF2';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, isSelected ? 2.6 : 2.0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isSelected ? '#E6ECF2' : '#94A3B8';
        ctx.font = `${isSelected ? '600 ' : ''}11px Inter, system-ui, sans-serif`;
        ctx.fillText(item.label, pos.x + 12, pos.y + 3);
      });

      projectedCatalogRef.current = nextProjected;

      // 7. Active Target Position Reticle & True-Scale Cutout Extraction Box
      const activePos = worldToScreen(state.targetRa, state.targetDec);
      if (activePos.inBounds) {
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(activePos.x - 11, activePos.y);
        ctx.lineTo(activePos.x - 4, activePos.y);
        ctx.moveTo(activePos.x + 4, activePos.y);
        ctx.lineTo(activePos.x + 11, activePos.y);
        ctx.moveTo(activePos.x, activePos.y - 11);
        ctx.lineTo(activePos.x, activePos.y - 4);
        ctx.moveTo(activePos.x, activePos.y + 4);
        ctx.lineTo(activePos.x, activePos.y + 11);
        ctx.stroke();

        if (state.showCutoutBox) {
          const cutoutDeg = state.fovArcsec / 3600;
          const boxPx = Math.max(16, cutoutDeg * scalePxPerDeg);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(
            activePos.x - boxPx / 2,
            activePos.y - boxPx / 2,
            boxPx,
            boxPx
          );
          ctx.setLineDash([]);
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(renderFrame);
    };

    animId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Zoom Helper (Supports full 0.02° sub-arcminute precision up to 180° full-hemisphere view)
  const applyZoom = useCallback((nextFovDeg: number) => {
    const clamped = Math.max(0.02, Math.min(180.0, nextFovDeg));
    cameraRef.current.fovDeg = clamped;
    setDisplayFovDeg(clamped);
    try {
      aladinInstanceRef.current?.setFoV(clamped);
    } catch {
      // Ignore if Aladin still initializing
    }
  }, []);

  // Smooth Wheel Zoom (Damped exponential zoom with trackpad momentum guard)
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const clampedDelta = Math.max(-40, Math.min(40, e.deltaY));
      const factor = Math.exp(clampedDelta * 0.0016);
      applyZoom(cameraRef.current.fovDeg * factor);
    },
    [applyZoom]
  );

  // Mouse Down (Start Pan)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  }, []);

  // Mouse Move (True 360° Over-the-Poles Spherical Great-Circle Rotation + 60 FPS Telemetry Readout)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cam = cameraRef.current;
    const scalePxPerDeg = rect.width / Math.max(0.02, cam.fovDeg);
    const cosCenterDec = Math.max(0.15, Math.cos((cam.centerDec * Math.PI) / 180));

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      if (Math.hypot(dx, dy) > 2) {
        dragRef.current.moved = true;
      }

      // Advance along the great circle in the current camera upSign orientation
      let nextRa =
        (((cam.centerRa + (dx * cam.upSign) / (scalePxPerDeg * cosCenterDec)) % 360) + 360) % 360;
      let rawDec = cam.centerDec + (dy * cam.upSign) / scalePxPerDeg;

      // Continuous 360° vertical pole transit: crossing +90° or -90° shifts RA by 180° and inverts upSign
      // so continuing to drag in the same direction flies smoothly down the opposite side of the globe
      // and returns 360° back to the exact starting coordinate!
      if (rawDec > 90.0) {
        rawDec = 180.0 - rawDec;
        nextRa = (nextRa + 180.0) % 360.0;
        cam.upSign = cam.upSign === 1 ? -1 : 1;
      } else if (rawDec < -90.0) {
        rawDec = -180.0 - rawDec;
        nextRa = (nextRa + 180.0) % 360.0;
        cam.upSign = cam.upSign === 1 ? -1 : 1;
      }

      cam.centerRa = nextRa;
      cam.centerDec = Math.max(-90.0, Math.min(90.0, rawDec));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    }

    // Compute world coordinates under cursor
    let curRa =
      (((cam.centerRa - ((x - rect.width / 2) * cam.upSign) / (scalePxPerDeg * cosCenterDec)) %
        360) +
        360) %
      360;
    let curDec = Math.max(
      -90,
      Math.min(90, cam.centerDec - ((y - rect.height / 2) * cam.upSign) / scalePxPerDeg)
    );
    const aladin = aladinInstanceRef.current;
    if (aladin && cam.upSign === 1 && typeof aladin.pix2world === 'function') {
      try {
        const w = aladin.pix2world(x, y);
        if (Array.isArray(w) && Number.isFinite(w[0]) && Number.isFinite(w[1])) {
          curRa = ((w[0] % 360) + 360) % 360;
          curDec = Math.max(-90, Math.min(90, w[1]));
        }
      } catch {
        // Use spherical tangent coordinates
      }
    }

    cam.cursorX = x;
    cam.cursorY = y;
    cam.cursorRa = curRa;
    cam.cursorDec = curDec;

    if (cursorRaDecDomRef.current) {
      cursorRaDecDomRef.current.textContent = `${curRa.toFixed(5)}° ${
        curDec >= 0 ? `+${curDec.toFixed(5)}` : curDec.toFixed(5)
      }°`;
    }
    if (cursorSexaDomRef.current) {
      cursorSexaDomRef.current.textContent = formatSexagesimal(curRa, curDec);
    }
    if (cursorLvfDomRef.current && renderStateRef.current.activeExposure) {
      const exp = renderStateRef.current.activeExposure;
      const dDec = curDec - exp.centerDec;
      const frac = Math.max(
        0,
        Math.min(1, 0.5 + dDec / Math.max(0.1, exp.footprintHeightDeg))
      );
      const localWave =
        exp.detector.lambdaMinUm +
        frac * (exp.detector.lambdaMaxUm - exp.detector.lambdaMinUm);
      cursorLvfDomRef.current.textContent = `${exp.detector.id} λ=${localWave.toFixed(3)} µm (R=${
        exp.detector.resolvingPower
      })`;
    }

    if (!dragRef.current.active) {
      const hit = projectedCatalogRef.current.find(
        (b) => b.inView && Math.hypot(b.x - x, b.y - y) <= 14
      );
      setHoveredCatalogObject((prev) => (prev?.id === hit?.item.id ? prev : hit?.item || null));
    }
  }, []);

  // Mouse Up (Commit panned position or select clicked sky coordinate / catalog source — NEVER redirects tabs)
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragRef.current.active) return;
      const wasMoved = dragRef.current.moved;
      dragRef.current.active = false;

      const cam = cameraRef.current;
      if (wasMoved) {
        // Sync panned camera center to store once drag completes
        const finalRa = Number(cam.centerRa.toFixed(6));
        const finalDec = Number(cam.centerDec.toFixed(6));
        setCoordinates(
          finalRa,
          finalDec,
          `Field ${finalRa.toFixed(4)}°, ${finalDec >= 0 ? '+' : ''}${finalDec.toFixed(4)}°`,
          '[IRSA Live (spherex_qr2)]'
        );
        setRa(finalRa);
        setDec(finalDec);
        return;
      }

      // Single click: either select catalog object under cursor or set target crosshair to clicked sky position
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const hit = projectedCatalogRef.current.find(
        (b) => b.inView && Math.hypot(b.x - x, b.y - y) <= 16
      );
      if (hit) {
        const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === hit.item.id);
        setCoordinates(
          hit.item.ra,
          hit.item.dec,
          hit.item.name,
          isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]'
        );
        setRa(hit.item.ra);
        setDec(hit.item.dec);
        if (hit.item.preset) {
          setRgbPreset(hit.item.preset);
          setPreset(hit.item.preset);
        }
        cam.centerRa = hit.item.ra;
        cam.centerDec = hit.item.dec;
      } else {
        const clickedRa = Number(cam.cursorRa.toFixed(6));
        const clickedDec = Number(cam.cursorDec.toFixed(6));
        setCoordinates(
          clickedRa,
          clickedDec,
          `J2000 ${clickedRa.toFixed(4)}°, ${clickedDec >= 0 ? '+' : ''}${clickedDec.toFixed(4)}°`,
          '[IRSA Live (spherex_qr2)]'
        );
        setRa(clickedRa);
        setDec(clickedDec);
      }
    },
    [setCoordinates, setDec, setPreset, setRa, setRgbPreset]
  );

  // Double-Click: Smoothly zoom in 2x at cursor position (NEVER switches tabs!)
  const handleDoubleClick = useCallback(() => {
    const cam = cameraRef.current;
    cam.centerRa = cam.cursorRa;
    cam.centerDec = cam.cursorDec;
    applyZoom(cam.fovDeg * 0.5);
  }, [applyZoom]);

  // Calibrated Angular Scale Bar
  const scaleBar = useMemo(() => {
    const targetDeg = displayFovDeg * 0.14;
    const candidates = [10, 5, 2, 1, 0.5, 0.25, 1 / 6, 1 / 12, 1 / 30, 1 / 60];
    const chosenDeg =
      candidates.find((c) => c <= targetDeg) || candidates[candidates.length - 1];
    const widthPx = Math.max(48, Math.min(150, (chosenDeg / Math.max(0.02, displayFovDeg)) * 900));
    return {
      widthPx: Math.round(widthPx),
      label: formatFieldFov(chosenDeg),
    };
  }, [displayFovDeg]);

  // Apply manual RA/Dec coordinate form from right-hand inspector
  const handleManualCoordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedRa = parseFloat(raInputStr);
    const parsedDec = parseFloat(decInputStr);
    if (
      Number.isFinite(parsedRa) &&
      Number.isFinite(parsedDec) &&
      parsedRa >= 0 &&
      parsedRa <= 360 &&
      parsedDec >= -90 &&
      parsedDec <= 90
    ) {
      const matched = SEARCHABLE_SKY_CATALOG.find(
        (item) => Math.abs(item.ra - parsedRa) < 0.05 && Math.abs(item.dec - parsedDec) < 0.05
      );
      const isBench = matched && MANDATORY_BENCHMARKS.some((b) => b.id === matched.id);
      setCoordinates(
        parsedRa,
        parsedDec,
        matched
          ? matched.name
          : `J2000 ${parsedRa.toFixed(4)}°, ${parsedDec >= 0 ? '+' : ''}${parsedDec.toFixed(4)}°`,
        isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]'
      );
      setRa(parsedRa);
      setDec(parsedDec);
      cameraRef.current.centerRa = parsedRa;
      cameraRef.current.centerDec = parsedDec;
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#080A0F] font-sans text-xs text-[#E6ECF2] select-none">
      {/* LEFT 70%: Stitched Sky Mosaic & LVF Spectral Footprint Viewport */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Top Overlay Instrument Toolbar (Modelled after IRSA Firefly Layer & Band Bar) */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2530] bg-[#0F131A] px-3 py-1.5"
        >
          {/* Layer Toggles */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sky overlay layers">
            <button
              type="button"
              onClick={() => setShowLvfFootprints((v) => !v)}
              className={`rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150 ${
                showLvfFootprints
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
              title="Toggle SPHEREx Level-2 Linear Variable Filter (LVF) detector footprints"
            >
              LVF Footprints ({filteredExposures.length})
            </button>
            <button
              type="button"
              onClick={() => setShowWcsGrid((v) => !v)}
              className={`rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150 ${
                showWcsGrid
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
            >
              J2000 Grid
            </button>
            <button
              type="button"
              onClick={() => setShowProperMotion((v) => !v)}
              className={`rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150 ${
                showProperMotion
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
              title="Toggle Gaia DR3 / astrometric proper motion vectors"
            >
              Proper Motion
            </button>
            <button
              type="button"
              onClick={() => setShowCutoutBox((v) => !v)}
              className={`rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150 ${
                showCutoutBox
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
              title="Show true-scale cutout bounding box at target coordinate"
            >
              Cutout Box ({fovArcsec}&quot;)
            </button>

            {/* Photographic Sky Survey Layer Selector */}
            <div className="flex items-center gap-1" role="group" aria-label="Photographic survey layer">
              <span className="text-[11px] text-[#94A3B8]">Survey:</span>
              {PHOTOGRAPHIC_SURVEYS.map((surv) => (
                <button
                  key={surv.id}
                  type="button"
                  onClick={() => setActiveSurvey(surv.id)}
                  title={`${surv.label} (${surv.badge}) · ${surv.description}`}
                  className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors duration-150 ${
                    activeSurvey === surv.id
                      ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                      : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
                  }`}
                >
                  {surv.label}
                </button>
              ))}
            </div>
          </div>

          {/* SPHEREx Detector Band Filter (D1-D6) */}
          <div className="flex items-center gap-1" role="group" aria-label="SPHEREx detector filter">
            <span className="mr-1 text-[11px] text-[#94A3B8]">Detector:</span>
            <button
              type="button"
              onClick={() => setSelectedBandFilter('ALL')}
              className={`rounded-sm border px-1.5 py-0.5 font-mono text-[11px] ${
                selectedBandFilter === 'ALL'
                  ? 'border-[#38BDF8] bg-[#151B24] text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
            >
              All
            </button>
            {SPHEREX_DETECTORS.map((det) => (
              <button
                key={det.id}
                type="button"
                onClick={() => setSelectedBandFilter(det.id)}
                title={`${det.label} · R=${det.resolvingPower}`}
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[11px] ${
                  selectedBandFilter === det.id
                    ? 'border-[#38BDF8] bg-[#151B24] text-[#E6ECF2]'
                    : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
                }`}
              >
                {det.id}
              </button>
            ))}
          </div>

          {/* Field of View Zoom Controls */}
          <div className="flex items-center rounded-sm border border-[#1E2530] bg-[#080A0F]">
            <button
              type="button"
              onClick={() => applyZoom(cameraRef.current.fovDeg * 0.65)}
              className="px-2 py-0.5 font-mono text-xs text-[#E6ECF2] hover:bg-[#151B24]"
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <span className="h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => applyZoom(cameraRef.current.fovDeg * 1.5)}
              className="px-2 py-0.5 font-mono text-xs text-[#E6ECF2] hover:bg-[#151B24]"
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => applyZoom(90.0)}
              className="px-2 py-0.5 font-mono text-[10px] text-[#94A3B8] hover:bg-[#151B24] hover:text-[#E6ECF2]"
              title="Hemisphere context (90°)"
            >
              90°
            </button>
            <button
              type="button"
              onClick={() => applyZoom(18.0)}
              className="px-2 py-0.5 font-mono text-[10px] text-[#94A3B8] hover:bg-[#151B24] hover:text-[#E6ECF2]"
              title="Wide survey context (18°)"
            >
              18°
            </button>
            <button
              type="button"
              onClick={() => applyZoom(6.0)}
              className="px-2 py-0.5 font-mono text-[10px] text-[#94A3B8] hover:bg-[#151B24] hover:text-[#E6ECF2]"
              title="SPHEREx detector array scale (6°)"
            >
              6°
            </button>
            <button
              type="button"
              onClick={() => applyZoom(1.2)}
              className="px-2 py-0.5 font-mono text-[10px] text-[#94A3B8] hover:bg-[#151B24] hover:text-[#E6ECF2]"
              title="Target field scale (1.2°)"
            >
              1.2°
            </button>
          </div>
        </div>

        {/* Interactive 60 FPS Continuous 3D Spherical Sky & HiPS Mosaic Viewport */}
        <div
          ref={viewportRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            dragRef.current.active = false;
          }}
          onDoubleClick={handleDoubleClick}
          className="relative flex-1 w-full overflow-hidden bg-[#06080D] cursor-grab active:cursor-grabbing"
        >
          {/* Aladin Lite v3 WebGL2 All-Sky HiPS Survey Layer */}
          <div
            ref={aladinContainerRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />

          {/* Primary 60 FPS 3D Spherical Starfield, Graticule & SPHEREx LVF Footprint Overlay */}
          <canvas
            ref={skyCanvasRef}
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          />

          {/* Top-Left North-Up / East-Left Astrometric Orientation Compass */}
          <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-2.5 rounded-sm border border-[#1E2530] bg-[#0F131A]/90 px-2.5 py-1.5">
            <svg className="h-7 w-7 text-[#38BDF8]" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="#1E2530" strokeWidth="1" />
              {/* North Arrow (Up) */}
              <path d="M16 5L16 20" stroke="#38BDF8" strokeWidth="1.5" />
              <path d="M13.5 8.5L16 4.5L18.5 8.5" stroke="#38BDF8" strokeWidth="1.5" />
              {/* East Tick (Left on astronomical sky chart) */}
              <path d="M6 16L16 16" stroke="#94A3B8" strokeWidth="1.2" />
              <text x="14" y="3.8" fill="#E6ECF2" fontSize="5" fontFamily="monospace">
                N
              </text>
              <text x="1" y="17.5" fill="#94A3B8" fontSize="5" fontFamily="monospace">
                E
              </text>
            </svg>
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-[#E6ECF2]">
                3D Spherical HiPS · {PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey)?.label || 'All-Sky Survey'}
              </span>
              <span className="font-mono text-[10px] text-[#94A3B8]">
                {PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey)?.badge || '360° Continuous Sphere'} · Drag across poles · Scroll to zoom
              </span>
            </div>
          </div>

          {/* Hovered Catalog Source Card */}
          {hoveredCatalogObject && (
            <div className="pointer-events-none absolute left-3 top-16 z-30 max-w-xs rounded-sm border border-[#38BDF8] bg-[#0F131A] p-2.5 text-xs">
              <div className="font-semibold text-[#E6ECF2]">{hoveredCatalogObject.name}</div>
              <div className="mt-0.5 text-[11px] text-[#94A3B8]">
                {hoveredCatalogObject.description}
              </div>
              <div className="mt-1 font-mono text-[10px] tabular-nums text-[#38BDF8]">
                J2000 {hoveredCatalogObject.ra.toFixed(5)}°,{' '}
                {hoveredCatalogObject.dec >= 0
                  ? `+${hoveredCatalogObject.dec.toFixed(5)}`
                  : hoveredCatalogObject.dec.toFixed(5)}
                °
              </div>
            </div>
          )}

          {/* Bottom-Right Calibrated Angular Scale Bar */}
          <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1 rounded-sm border border-[#1E2530] bg-[#0F131A]/90 px-2.5 py-1.5">
            <span className="font-mono text-[10px] tabular-nums text-[#E6ECF2]">
              Scale: {scaleBar.label} (FoV {formatFieldFov(displayFovDeg)})
            </span>
            <div
              style={{ width: `${scaleBar.widthPx}px` }}
              className="h-1.5 border-b border-l border-r border-[#E6ECF2]"
            />
          </div>
        </div>

        {/* Bottom 32px High-Frequency Cursor Telemetry Strip */}
        <footer className="z-20 flex h-[34px] items-center justify-between border-t border-[#1E2530] bg-[#0F131A] px-3 text-[11px]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-[#94A3B8]">Cursor J2000:</span>
              <span
                ref={cursorRaDecDomRef}
                className="font-mono tabular-nums text-[#E6ECF2]"
              >
                {ra.toFixed(5)}° {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}°
              </span>
            </div>
            <span className="hidden md:inline text-[#1E2530]">|</span>
            <span
              ref={cursorSexaDomRef}
              className="hidden md:inline font-mono tabular-nums text-[#94A3B8]"
            >
              {sexagesimalTarget}
            </span>
            <span className="hidden lg:inline text-[#1E2530]">|</span>
            <div className="hidden lg:flex items-center gap-1.5">
              <span className="text-[#94A3B8]">WCS-WAVE at cursor:</span>
              <span
                ref={cursorLvfDomRef}
                className="font-mono tabular-nums text-[#38BDF8]"
              >
                {activeExposure
                  ? `${activeExposure.detector.id} λ=${activeExposure.lambdaAtTargetUm.toFixed(
                      3
                    )} µm (R=${activeExposure.detector.resolvingPower})`
                  : '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-[#94A3B8]">
            <span>β_ecl = {coverageDepth.eclipticLatDeg >= 0 ? '+' : ''}{coverageDepth.eclipticLatDeg.toFixed(1)}°</span>
            <span className="text-[#1E2530]">·</span>
            <span className="text-[#E6ECF2]">{coverageDepth.cadenceLabel}</span>
          </div>
        </footer>
      </div>

      {/* RIGHT 30%: SPHEREx Spectral Image Search & Footprint Inspector (Modelled on IRSA search-spectral-images) */}
      <aside className="flex w-[380px] xl:w-[430px] shrink-0 flex-col border-l border-[#1E2530] bg-[#0F131A]">
        {/* 1. Target Position & Spatial Cutout Parameters */}
        <div className="border-b border-[#1E2530] p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-[#E6ECF2]">
              SPHEREx Spectral Image Search
            </h2>
            <span className="rounded-sm border border-[#1E2530] bg-[#151B24] px-1.5 py-0.5 font-mono text-[10px] text-[#38BDF8]">
              spherex_qr2 MEF
            </span>
          </div>

          <div className="mt-2 rounded-sm border border-[#1E2530] bg-[#080A0F] p-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#E6ECF2]">
                {activeTargetName || 'Selected Sky Position'}
              </span>
              <button
                type="button"
                onClick={() => {
                  cameraRef.current.centerRa = ra;
                  cameraRef.current.centerDec = dec;
                }}
                className="rounded-sm border border-[#1E2530] bg-[#151B24] px-1.5 py-0.5 text-[10px] text-[#94A3B8] hover:border-[#38BDF8] hover:text-[#E6ECF2]"
                title="Center sky viewport on active target coordinates"
              >
                Center map
              </button>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-[#38BDF8]">
              RA {ra.toFixed(5)}° · Dec {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}°
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[#94A3B8]">
              {sexagesimalTarget}
            </div>
          </div>

          {/* Direct Coordinate & Cutout Size Form */}
          <form onSubmit={handleManualCoordSubmit} className="mt-2.5 grid grid-cols-12 gap-1.5">
            <div className="col-span-4">
              <label htmlFor="inspector-ra" className="block text-[10px] text-[#94A3B8]">
                RA (J2000 deg)
              </label>
              <input
                id="inspector-ra"
                type="text"
                value={raInputStr}
                onChange={(e) => setRaInputStr(e.target.value)}
                className="mt-0.5 w-full rounded-sm border border-[#1E2530] bg-[#080A0F] px-2 py-1 font-mono text-[11px] tabular-nums text-[#E6ECF2] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              />
            </div>
            <div className="col-span-4">
              <label htmlFor="inspector-dec" className="block text-[10px] text-[#94A3B8]">
                Dec (J2000 deg)
              </label>
              <input
                id="inspector-dec"
                type="text"
                value={decInputStr}
                onChange={(e) => setDecInputStr(e.target.value)}
                className="mt-0.5 w-full rounded-sm border border-[#1E2530] bg-[#080A0F] px-2 py-1 font-mono text-[11px] tabular-nums text-[#E6ECF2] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              />
            </div>
            <div className="col-span-4">
              <label htmlFor="inspector-fov" className="block text-[10px] text-[#94A3B8]">
                Cutout Size
              </label>
              <select
                id="inspector-fov"
                value={fovArcsec}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFov(val);
                  setUrlFov(val);
                }}
                className="mt-0.5 w-full rounded-sm border border-[#1E2530] bg-[#080A0F] px-1.5 py-1 font-mono text-[11px] tabular-nums text-[#E6ECF2] focus-visible:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              >
                {FOV_CUTOUT_PRESETS.map((f) => (
                  <option key={f} value={f}>
                    {f}&quot; ({f / 60}&apos;)
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-12 mt-1 flex items-center justify-between">
              <span className="text-[10px] text-[#94A3B8]">
                 Pixel scale: 6.2&quot;/px ({Math.round(fovArcsec / 6.2)}×{Math.round(fovArcsec / 6.2)} px stamp)
              </span>
              <button
                type="submit"
                className="rounded-sm border border-[#1E2530] bg-[#151B24] px-2.5 py-0.5 text-[11px] text-[#E6ECF2] hover:border-[#38BDF8]"
              >
                Update Position
              </button>
            </div>
          </form>
        </div>

        {/* 2. Synchronized SPHEREx Level-2 Spectral Image Table (Hover highlights LVF footprint on sky) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1E2530] bg-[#151B24]/60 px-3 py-1.5">
            <span className="text-[11px] font-medium text-[#E6ECF2]">
              Overlapping Level-2 Spectral Images ({filteredExposures.length})
            </span>
            <span className="text-[10px] text-[#94A3B8]">Hover row to inspect footprint</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
              <thead className="sticky top-0 z-10 border-b border-[#1E2530] bg-[#0F131A] font-sans text-[10px] text-[#94A3B8]">
                <tr>
                  <th className="py-1.5 pl-3 pr-1.5 font-medium">Band</th>
                  <th className="px-1.5 py-1.5 font-medium">Pass / MJD</th>
                  <th className="px-1.5 py-1.5 text-right font-medium">λ (µm)</th>
                  <th className="px-1.5 py-1.5 text-right font-medium">Roll ψ</th>
                  <th className="py-1.5 pl-1.5 pr-3 text-right font-medium">Zodi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2530]/60">
                {filteredExposures.map((exp) => {
                  const isFocused = activeExposure?.obsId === exp.obsId;
                  return (
                    <tr
                      key={exp.obsId}
                      onMouseEnter={() => setHoveredObsId(exp.obsId)}
                      onMouseLeave={() => setHoveredObsId(null)}
                      onClick={() => setSelectedObsId(exp.obsId)}
                      className={`cursor-pointer transition-colors duration-100 ${
                        isFocused
                          ? 'bg-[#151B24] text-[#E6ECF2]'
                          : 'text-[#94A3B8] hover:bg-[#151B24]/60 hover:text-[#E6ECF2]'
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-1.5">
                        <span
                          style={{ borderColor: exp.detector.colorHex }}
                          className="inline-block rounded-sm border bg-[#080A0F] px-1.5 py-0.2 text-[10px] font-medium text-[#E6ECF2]"
                        >
                          {exp.detector.id}
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <div className="text-[#E6ECF2]">P{exp.passNumber} · {exp.mjd.toFixed(1)}</div>
                        <div className="text-[9px] text-[#94A3B8]">{exp.obsId}</div>
                      </td>
                      <td className="px-1.5 py-1.5 text-right text-[#38BDF8]">
                        <div>{exp.lambdaAtTargetUm.toFixed(3)}</div>
                        <div className="text-[9px] text-[#94A3B8]">±{exp.bandwidthUm.toFixed(3)}</div>
                      </td>
                      <td className="px-1.5 py-1.5 text-right">{exp.rollAngleDeg.toFixed(1)}°</td>
                      <td className="py-1.5 pl-1.5 pr-3 text-right text-[#94A3B8]">
                        {exp.zodiMjySr.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Active Exposure HDU Summary */}
          {activeExposure && (
            <div className="border-t border-[#1E2530] bg-[#080A0F] px-3 py-2 text-[11px]">
              <div className="flex items-center justify-between text-[#E6ECF2]">
                <span className="font-mono text-[10px] text-[#38BDF8]">{activeExposure.obsId}</span>
                <span className="font-mono text-[10px] text-[#94A3B8]">{activeExposure.dateUtc}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-[#94A3B8]">
                <span>
                  HDU 6 WCS-WAVE: <strong className="font-mono text-[#E6ECF2]">{activeExposure.lambdaAtTargetUm} µm</strong> (R={activeExposure.detector.resolvingPower})
                </span>
                <span>
                  HDU 4 ZODI: <strong className="font-mono text-[#E6ECF2]">{activeExposure.zodiMjySr} MJy/sr</strong>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 3. Explicit User-Initiated Workspace Actions (Zero Auto-Redirects) */}
        <div className="border-t border-[#1E2530] bg-[#0F131A] p-3">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setTab('comparator')}
              className="w-full rounded-sm border border-[#38BDF8] bg-[#151B24] px-3 py-2 text-center text-xs font-medium text-[#E6ECF2] transition-colors duration-150 hover:bg-[#38BDF8]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              Open {fovArcsec}&quot; Cutout in Time-Domain Comparator →
            </button>
            <button
              type="button"
              onClick={() => setTab('spectral')}
              className="w-full rounded-sm border border-[#1E2530] bg-[#080A0F] px-3 py-1.5 text-center text-xs text-[#94A3B8] transition-colors duration-150 hover:border-[#94A3B8] hover:text-[#E6ECF2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              Extract 102-Channel Spectrum in Spectral Lab
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
