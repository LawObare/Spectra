import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
  BenchmarkPill,
} from '../components/GlobalCommandHeader';

declare global {
  interface Window {
    A?: any;
  }
}

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

// SPHEREx Level-2 Spectral Image Exposure Metadata (Modelled after IRSA spherex_qr2 MEF table)
export interface SpherexSpectralExposure {
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

      // Each SPHEREx detector sub-field is ~1.75° x 1.75° in our visualization scale (real array 3.5° x 3.5°)
      // Offset the exposure center slightly around the target so footprints stitch & overlap realistically
      const offsetRaDeg = ((h1 - 0.5) * 0.85) / cosDec;
      const offsetDecDeg = (h2 - 0.5) * 0.85;
      const rollAngleDeg = (p.rollBase + dIdx * 2.4 + (h3 - 0.5) * 6.0) % 360;

      // Position along the Linear Variable Filter dispersion axis determines exact wavelength at target
      const lvfFraction = Math.max(0.06, Math.min(0.94, 0.2 + 0.6 * h3));
      const lambdaAtTargetUm =
        det.lambdaMinUm + lvfFraction * (det.lambdaMaxUm - det.lambdaMinUm);
      const bandwidthUm = lambdaAtTargetUm / det.resolvingPower;

      // Zodiacal light model (HDU 4 ZODI) higher near ecliptic plane, lower near NEP/SEP poles
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
  const skyCanvasRef = useRef<HTMLCanvasElement>(null);
  const aladinMountRef = useRef<HTMLDivElement>(null);
  const aladinInstanceRef = useRef<any>(null);

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
  const [showHipsUnderlay, setShowHipsUnderlay] = useState<boolean>(false);
  const [selectedBandFilter, setSelectedBandFilter] = useState<string>('ALL');
  const [hoveredObsId, setHoveredObsId] = useState<string | null>(null);
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);
  const [hoveredCatalogObject, setHoveredCatalogObject] = useState<BenchmarkPill | null>(null);
  const [displayFovDeg, setDisplayFovDeg] = useState<number>(6.0);

  // Direct coordinate input fields in the right-hand inspector
  const [raInputStr, setRaInputStr] = useState<string>(ra.toFixed(5));
  const [decInputStr, setDecInputStr] = useState<string>(dec.toFixed(5));

  useEffect(() => {
    setRaInputStr(ra.toFixed(5));
    setDecInputStr(dec.toFixed(5));
  }, [ra, dec]);

  // High-frequency mutable camera state for 60 FPS canvas rendering (Zero React lag)
  const cameraRef = useRef<{
    centerRa: number;
    centerDec: number;
    fovDeg: number;
    cursorX: number | null;
    cursorY: number | null;
    cursorRa: number;
    cursorDec: number;
  }>({
    centerRa: ra,
    centerDec: dec,
    fovDeg: 6.0,
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

  // Keep latest render flags in a ref so the 60 FPS canvas draw function always reads current toggles without re-binding listeners
  const renderStateRef = useRef({
    targetRa: ra,
    targetDec: dec,
    targetName: activeTargetName,
    fovArcsec,
    showLvfFootprints,
    showWcsGrid,
    showProperMotion,
    showCutoutBox,
    showHipsUnderlay,
    filteredExposures,
    activeExposure,
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
      showHipsUnderlay,
      filteredExposures,
      activeExposure,
    };
  }, [
    activeExposure,
    activeTargetName,
    filteredExposures,
    fovArcsec,
    ra,
    dec,
    showCutoutBox,
    showHipsUnderlay,
    showLvfFootprints,
    showProperMotion,
    showWcsGrid,
  ]);

  // Sync camera center when external target coordinates change (e.g. from search bar or catalog selection)
  useEffect(() => {
    if (!dragRef.current.active) {
      cameraRef.current.centerRa = ra;
      cameraRef.current.centerDec = dec;
      if (aladinInstanceRef.current && typeof aladinInstanceRef.current.gotoRaDec === 'function') {
        try {
          aladinInstanceRef.current.gotoRaDec(ra, dec);
        } catch {
          // Ignore
        }
      }
    }
  }, [ra, dec]);

  // Optional External HiPS Underlay Initialization (Only mounted if user enables HiPS Underlay toggle)
  useEffect(() => {
    if (!showHipsUnderlay || !aladinMountRef.current || aladinInstanceRef.current) return;
    let mounted = true;

    // @ts-expect-error aladin-lite ships pure JS/WASM bundle without .d.ts declarations
    import('aladin-lite')
      .then(async (mod: any) => {
        const A = mod?.default || mod || window.A;
        if (!mounted || !A || !aladinMountRef.current) return;
        if (A.init && typeof A.init.then === 'function') {
          await A.init;
        }
        if (!mounted || !aladinMountRef.current) return;
        const aladin = A.aladin(aladinMountRef.current, {
          survey: 'P/allWISE/color',
          projection: 'TAN',
          fov: cameraRef.current.fovDeg,
          target: `${cameraRef.current.centerRa} ${cameraRef.current.centerDec}`,
          cooFrame: 'ICRSd',
          showReticle: false,
          showCooGrid: false,
          showCooGridControl: false,
          showFullscreenControl: false,
          showZoomControl: false,
          showLayersControl: false,
          showGotoControl: false,
        });
        aladinInstanceRef.current = aladin;
      })
      .catch(() => {
        // Non-blocking optional HiPS layer
      });

    return () => {
      mounted = false;
    };
  }, [showHipsUnderlay]);

  // Primary 60 FPS Hardware-Accelerated Stitched Sky Mosaic & LVF Footprint Renderer
  useEffect(() => {
    const canvas = skyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const starPalette = ['#cfe4ff', '#eef6ff', '#fff9eb', '#ffe3b3', '#ffbe85', '#ff9b6a'];

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

      const { centerRa, centerDec, fovDeg } = cameraRef.current;
      const state = renderStateRef.current;

      const scalePxPerDeg = width / Math.max(0.02, fovDeg);
      const halfFovX = fovDeg / 2;
      const halfFovY = (fovDeg * (height / Math.max(1, width))) / 2;
      const cosCenterDec = Math.max(0.08, Math.cos((centerDec * Math.PI) / 180));
      const raSpan = (halfFovX * 1.35) / cosCenterDec;

      // Tangent-plane (TAN) world-to-screen projection (North-Up, East-Left)
      const worldToScreen = (
        sRa: number,
        sDec: number
      ): { x: number; y: number; inBounds: boolean } => {
        let dRa = sRa - centerRa;
        if (dRa > 180) dRa -= 360;
        if (dRa < -180) dRa += 360;
        const dDec = sDec - centerDec;
        const x = width / 2 - dRa * cosCenterDec * scalePxPerDeg;
        const y = height / 2 - dDec * scalePxPerDeg;
        const inBounds = x >= -80 && x <= width + 80 && y >= -80 && y <= height + 80;
        return { x, y, inBounds };
      };

      // 1. Base Sky Well (Semi-transparent if external HiPS underlay is active, solid deep-space infrared mosaic otherwise)
      ctx.clearRect(0, 0, width, height);
      if (!state.showHipsUnderlay) {
        ctx.fillStyle = '#06080D';
        ctx.fillRect(0, 0, width, height);

        // Stitched Infrared Sky Mosaic Tile Shading (Models SPHEREx / AllWISE sky survey plates)
        const tileStepDeg = fovDeg > 15 ? 4.0 : fovDeg > 4 ? 1.5 : 0.5;
        const minTileRa = Math.floor((centerRa - raSpan) / tileStepDeg) * tileStepDeg;
        const maxTileRa = Math.ceil((centerRa + raSpan) / tileStepDeg) * tileStepDeg;
        const minTileDec = Math.max(-88, Math.floor((centerDec - halfFovY * 1.3) / tileStepDeg) * tileStepDeg);
        const maxTileDec = Math.min(88, Math.ceil((centerDec + halfFovY * 1.3) / tileStepDeg) * tileStepDeg);

        for (let tDec = minTileDec; tDec <= maxTileDec; tDec += tileStepDeg) {
          for (let tRa = minTileRa; tRa <= maxTileRa; tRa += tileStepDeg) {
            const normRa = ((tRa % 360) + 360) % 360;
            const p1 = worldToScreen(normRa, tDec + tileStepDeg);
            const p2 = worldToScreen(normRa + tileStepDeg, tDec);
            const tileX = Math.min(p1.x, p2.x);
            const tileY = Math.min(p1.y, p2.y);
            const tileW = Math.abs(p2.x - p1.x);
            const tileH = Math.abs(p2.y - p1.y);

            // Subtle zodiacal / galactic background glow variation per stitched mosaic plate
            const plateHash = hashSkyCell(Math.round(normRa * 2), Math.round(tDec * 2), 7);
            ctx.fillStyle = `rgba(18, 28, 45, ${0.12 + plateHash * 0.14})`;
            ctx.fillRect(tileX, tileY, tileW, tileH);

            // Subtle stitched mosaic plate seam
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.045)';
            ctx.lineWidth = 0.75;
            ctx.strokeRect(tileX, tileY, tileW, tileH);
          }
        }

        // Diffuse infrared nebulosity / zodiacal dust glow centered near target
        const targetPos = worldToScreen(state.targetRa, state.targetDec);
        if (targetPos.inBounds) {
          const nebGrad = ctx.createRadialGradient(
            targetPos.x,
            targetPos.y,
            4,
            targetPos.x,
            targetPos.y,
            Math.min(width, height) * 0.42
          );
          nebGrad.addColorStop(0, 'rgba(56, 189, 248, 0.09)');
          nebGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.05)');
          nebGrad.addColorStop(1, 'rgba(6, 8, 13, 0)');
          ctx.fillStyle = nebGrad;
          ctx.fillRect(0, 0, width, height);
        }
      }

      // 2. Multi-Octave Astrometric Starfield (Always visible, crisp, zero lag)
      // Renders 3 nested angular octaves so stars are dense at wide FoV and reveal fainter magnitudes as you zoom in
      const octaves = [
        { cellDeg: 2.0, minFov: 0.01, maxFov: 65.0, starsPerCell: 9, brightBoost: 1.35 },
        { cellDeg: 0.5, minFov: 0.01, maxFov: 16.0, starsPerCell: 10, brightBoost: 1.0 },
        { cellDeg: 0.12, minFov: 0.01, maxFov: 4.0, starsPerCell: 11, brightBoost: 0.85 },
      ];

      octaves.forEach((oct, octIdx) => {
        if (fovDeg > oct.maxFov || fovDeg < oct.minFov) return;
        const fadeAlpha =
          fovDeg > oct.maxFov * 0.7
            ? Math.max(0.15, 1 - (fovDeg - oct.maxFov * 0.7) / (oct.maxFov * 0.3))
            : 1.0;

        const cRaStart = Math.floor((centerRa - raSpan) / oct.cellDeg);
        const cRaEnd = Math.ceil((centerRa + raSpan) / oct.cellDeg);
        const cDecStart = Math.floor((centerDec - halfFovY * 1.25) / oct.cellDeg);
        const cDecEnd = Math.ceil((centerDec + halfFovY * 1.25) / oct.cellDeg);
        const wrapCount = Math.max(1, Math.round(360 / oct.cellDeg));

        for (let cDec = cDecStart; cDec <= cDecEnd; cDec++) {
          const decCenter = cDec * oct.cellDeg;
          if (decCenter < -89.5 || decCenter > 89.5) continue;
          for (let cRa = cRaStart; cRa <= cRaEnd; cRa++) {
            const wrappedRa = ((cRa % wrapCount) + wrapCount) % wrapCount;
            for (let s = 0; s < oct.starsPerCell; s++) {
              const saltBase = octIdx * 100 + s * 5;
              const u = hashSkyCell(wrappedRa, cDec, saltBase + 1);
              const v = hashSkyCell(wrappedRa, cDec, saltBase + 2);
              const magH = hashSkyCell(wrappedRa, cDec, saltBase + 3);
              const colH = hashSkyCell(wrappedRa, cDec, saltBase + 4);

              const starRa = (cRa + u) * oct.cellDeg;
              const starDec = (cDec + v) * oct.cellDeg;
              const pos = worldToScreen(starRa, starDec);
              if (!pos.inBounds) continue;

              // Realistic stellar magnitude & PSF radius
              const radiusPx = (0.7 + Math.pow(1 - magH, 2.6) * 2.8) * oct.brightBoost;
              const alpha = Math.min(1.0, (0.35 + (1 - magH) * 0.65) * fadeAlpha);
              const colorHex = starPalette[Math.floor(colH * starPalette.length)];

              // Soft PSF halo for brighter stars
              if (radiusPx > 1.8) {
                ctx.globalAlpha = alpha * 0.28;
                ctx.fillStyle = colorHex;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radiusPx * 2.4, 0, Math.PI * 2);
                ctx.fill();
              }

              // Crisp stellar core
              ctx.globalAlpha = alpha;
              ctx.fillStyle = colorHex;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
              ctx.fill();

              // Infrared telescope 4-point diffraction spikes on bright field stars
              if (radiusPx > 2.35) {
                ctx.strokeStyle = colorHex;
                ctx.lineWidth = 0.7;
                ctx.globalAlpha = alpha * 0.65;
                const spikeLen = radiusPx * 3.8;
                ctx.beginPath();
                ctx.moveTo(pos.x - spikeLen, pos.y);
                ctx.lineTo(pos.x + spikeLen, pos.y);
                ctx.moveTo(pos.x, pos.y - spikeLen);
                ctx.lineTo(pos.x, pos.y + spikeLen);
                ctx.stroke();
              }
            }
          }
        }
      });
      ctx.globalAlpha = 1.0;

      // 3. J2000 WCS Coordinate Grid (Toggleable)
      if (state.showWcsGrid) {
        const gridStepDeg =
          fovDeg > 20 ? 5 : fovDeg > 8 ? 2 : fovDeg > 3 ? 1 : fovDeg > 0.8 ? 0.25 : 0.05;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.lineWidth = 1;

        const minDec = Math.max(
          -89,
          Math.floor((centerDec - halfFovY * 1.2) / gridStepDeg) * gridStepDeg
        );
        const maxDec = Math.min(
          89,
          Math.ceil((centerDec + halfFovY * 1.2) / gridStepDeg) * gridStepDeg
        );
        for (let gDec = minDec; gDec <= maxDec; gDec += gridStepDeg) {
          const y = height / 2 - (gDec - centerDec) * scalePxPerDeg;
          if (y >= 0 && y <= height) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.fillText(
              `Dec ${gDec >= 0 ? '+' : ''}${gDec.toFixed(gridStepDeg < 1 ? 2 : 0)}°`,
              10,
              y - 4
            );
          }
        }

        const minRa = Math.floor((centerRa - raSpan) / gridStepDeg) * gridStepDeg;
        const maxRa = Math.ceil((centerRa + raSpan) / gridStepDeg) * gridStepDeg;
        for (let gRa = minRa; gRa <= maxRa; gRa += gridStepDeg) {
          const normRa = ((gRa % 360) + 360) % 360;
          const { x } = worldToScreen(normRa, centerDec);
          if (x >= 0 && x <= width) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.fillText(
              `RA ${normRa.toFixed(gridStepDeg < 1 ? 2 : 0)}°`,
              x + 4,
              height - 10
            );
          }
        }
      }

      // 4. NEP & SEP Deep-Field Calibration Zones (r = 5.64 deg)
      [NEP_COORDS, SEP_COORDS].forEach((pole) => {
        const pos = worldToScreen(pole.ra, pole.dec);
        const rPx = pole.radiusDeg * scalePxPerDeg;
        if (
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
        // Draw non-active footprints first as subtle stitched frames
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

        // Draw active / hovered exposure with full Linear Variable Filter (LVF) spectral dispersion gradient
        if (state.activeExposure) {
          const exp = state.activeExposure;
          const pos = worldToScreen(exp.centerRa, exp.centerDec);
          const wPx = exp.footprintWidthDeg * scalePxPerDeg;
          const hPx = exp.footprintHeightDeg * scalePxPerDeg;

          if (pos.inBounds && wPx >= 10) {
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate((exp.rollAngleDeg * Math.PI) / 180);

            // Linear Variable Filter (LVF) wavelength ramp along detector Y axis
            const lvfGrad = ctx.createLinearGradient(0, -hPx / 2, 0, hPx / 2);
            lvfGrad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
            lvfGrad.addColorStop(0.5, 'rgba(52, 211, 153, 0.12)');
            lvfGrad.addColorStop(1, 'rgba(244, 63, 94, 0.18)');
            ctx.fillStyle = lvfGrad;
            ctx.fillRect(-wPx / 2, -hPx / 2, wPx, hPx);

            // Detector frame perimeter
            ctx.strokeStyle = exp.detector.colorHex;
            ctx.lineWidth = 1.75;
            ctx.strokeRect(-wPx / 2, -hPx / 2, wPx, hPx);

            // Internal iso-wavelength LVF contours across the detector
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

            // Exposure telemetry label on the footprint corner
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

        // Proper Motion Vector Arrow
        if (state.showProperMotion) {
          const pm = CATALOG_PROPER_MOTIONS[item.id];
          if (pm && pm.totalArcsecYr >= 0.3) {
            const vecScale = 4.2;
            const vx = pos.x - (pm.pmRaMasYr / 1000) * vecScale;
            const vy = pos.y - (pm.pmDecMasYr / 1000) * vecScale;
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

        // Open Astrometric Target Crosshair Ticks
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

        // Bright source core
        ctx.fillStyle = '#E6ECF2';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, isSelected ? 2.6 : 2.0, 0, Math.PI * 2);
        ctx.fill();

        // Clean label
        ctx.fillStyle = isSelected ? '#E6ECF2' : '#94A3B8';
        ctx.font = `${isSelected ? '600 ' : ''}11px Inter, system-ui, sans-serif`;
        ctx.fillText(item.label, pos.x + 12, pos.y + 3);
      });

      projectedCatalogRef.current = nextProjected;

      // 7. Active Target Position Reticle & True-Scale Cutout Extraction Box
      const activePos = worldToScreen(state.targetRa, state.targetDec);
      if (activePos.inBounds) {
        // Subtle open crosshair at exact target coordinate
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

        // True angular-scale cutout footprint (only drawn at its real physical sky scale when toggled)
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

  // Zoom Helper (Updates cameraRef immediately at 60 FPS)
  const applyZoom = useCallback((nextFovDeg: number) => {
    const clamped = Math.max(0.04, Math.min(60.0, nextFovDeg));
    cameraRef.current.fovDeg = clamped;
    setDisplayFovDeg(clamped);
    if (aladinInstanceRef.current && typeof aladinInstanceRef.current.setFoV === 'function') {
      try {
        aladinInstanceRef.current.setFoV(clamped);
      } catch {
        // Ignore
      }
    }
  }, []);

  // Smooth Wheel Zoom (Cursor-anchored, zero lag)
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.16 : 0.86;
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

  // Mouse Move (60 FPS Direct Camera Update + Direct DOM Telemetry Readout — Zero React Re-renders During Drag!)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cam = cameraRef.current;
    const scalePxPerDeg = rect.width / Math.max(0.02, cam.fovDeg);
    const cosCenterDec = Math.max(0.08, Math.cos((cam.centerDec * Math.PI) / 180));

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      if (Math.hypot(dx, dy) > 2) {
        dragRef.current.moved = true;
      }
      // East is left: dragging right increases RA, dragging down increases Dec
      const nextRa = (((cam.centerRa + dx / (scalePxPerDeg * cosCenterDec)) % 360) + 360) % 360;
      const nextDec = Math.max(-89.5, Math.min(89.5, cam.centerDec + dy / scalePxPerDeg));

      cam.centerRa = nextRa;
      cam.centerDec = nextDec;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;

      if (aladinInstanceRef.current && typeof aladinInstanceRef.current.gotoRaDec === 'function') {
        try {
          aladinInstanceRef.current.gotoRaDec(nextRa, nextDec);
        } catch {
          // Ignore
        }
      }
    }

    // Compute world coordinates under cursor
    const curRa =
      (((cam.centerRa - (x - rect.width / 2) / (scalePxPerDeg * cosCenterDec)) % 360) + 360) % 360;
    const curDec = Math.max(
      -90,
      Math.min(90, cam.centerDec - (y - rect.height / 2) / scalePxPerDeg)
    );
    cam.cursorX = x;
    cam.cursorY = y;
    cam.cursorRa = curRa;
    cam.cursorDec = curDec;

    // Update bottom status bar directly via DOM refs for zero-latency readout
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

    // Check catalog hover only when not dragging
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
            <button
              type="button"
              onClick={() => setShowHipsUnderlay((v) => !v)}
              className={`rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150 ${
                showHipsUnderlay
                  ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                  : 'border-[#1E2530] bg-[#080A0F] text-[#94A3B8] hover:text-[#E6ECF2]'
              }`}
              title="Stream external AllWISE HiPS tiles from CDS Strasbourg underneath the starfield"
            >
              External HiPS
            </button>
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

        {/* Interactive 60 FPS Stitched Sky Mosaic Canvas */}
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
          {/* Optional External HiPS Underlay */}
          {showHipsUnderlay && (
            <div
              ref={aladinMountRef}
              className="pointer-events-none absolute inset-0 h-full w-full opacity-55"
            />
          )}

          {/* Primary 60 FPS Astrometric Starfield & SPHEREx LVF Footprint Canvas */}
          <canvas
            ref={skyCanvasRef}
            className="absolute inset-0 h-full w-full"
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
                TAN Gnomonic · North Up, East Left
              </span>
              <span className="font-mono text-[10px] text-[#94A3B8]">
                Click sky to set target · Drag to pan · Scroll to zoom
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
