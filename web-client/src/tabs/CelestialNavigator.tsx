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

// Progressive Multi-Order HEALPix (HiPS) All-Sky Survey Configurations (Aladin Lite v3 Native WebGL2)
type PhotographicSurveyId = 'unwise-neo7' | '2mass-color' | 'ls-dr10' | 'dss2-color';

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
    badge: 'NASA 3.4 & 4.6 µm (All-Sky)',
    description: 'Continuous all-sky progressive WebGL2 HiPS pyramid of NASA WISE/NEOWISE infrared co-adds. Matches SPHEREx infrared regime.',
  },
  {
    id: '2mass-color',
    hipsId: 'CDS/P/2MASS/color',
    label: '2MASS Near-IR',
    badge: 'J/H/Ks (All-Sky)',
    description: 'Two Micron All-Sky Survey (J, H, Ks) resolving crisp stellar populations and Galactic structure.',
  },
  {
    id: 'ls-dr10',
    hipsId: 'CDS/P/DESI-Legacy-Surveys/DR10/color',
    label: 'Legacy Survey DR10',
    badge: 'Optical (Resolved Galaxies)',
    description: 'DESI Legacy Imaging Surveys DR10 (g, r, z). Resolves galaxy spiral arms, stellar bulges, and star-forming regions.',
  },
  {
    id: 'dss2-color',
    hipsId: 'CDS/P/DSS2/color',
    label: 'DSS2 Optical',
    badge: 'Palomar/UKST (All-Sky)',
    description: 'Digitized Sky Survey 2 full-sphere optical photographic mosaic covering 100% of both hemispheres.',
  },
];

// Calculate SPHEREx detector footprint 4 corners in (RA, Dec) degrees
function getFootprintCorners(
  centerRa: number,
  centerDec: number,
  widthDeg: number,
  heightDeg: number,
  rollAngleDeg: number
): [number, number][] {
  const toRad = Math.PI / 180;
  const hw = widthDeg / 2;
  const hh = heightDeg / 2;
  const rollRad = rollAngleDeg * toRad;
  const cosRoll = Math.cos(rollRad);
  const sinRoll = Math.sin(rollRad);
  const cosDec = Math.max(0.05, Math.cos(centerDec * toRad));

  const localCorners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  return localCorners.map(([dx, dy]) => {
    const rx = dx * cosRoll - dy * sinRoll;
    const ry = dx * sinRoll + dy * cosRoll;
    const cRa = (((centerRa + rx / cosDec) % 360) + 360) % 360;
    const cDec = Math.max(-89.9, Math.min(89.9, centerDec + ry));
    return [cRa, cDec];
  });
}

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
  const aladinContainerRef = useRef<HTMLDivElement>(null);
  const aladinInstanceRef = useRef<any>(null);
  const footprintOverlayRef = useRef<any>(null);
  const cutoutOverlayRef = useRef<any>(null);
  const catalogOverlayRef = useRef<any>(null);
  const deepFieldOverlayRef = useRef<any>(null);

  // High-frequency DOM refs for real-time cursor readouts
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
  const [showCutoutBox, setShowCutoutBox] = useState<boolean>(true);
  const [activeSurvey, setActiveSurvey] = useState<PhotographicSurveyId>('unwise-neo7');
  const [selectedBandFilter, setSelectedBandFilter] = useState<string>('ALL');
  const [hoveredObsId, setHoveredObsId] = useState<string | null>(null);
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);
  const [displayFovDeg, setDisplayFovDeg] = useState<number>(6.0);
  const [hipsReady, setHipsReady] = useState<boolean>(false);

  // Direct coordinate input fields in the right-hand inspector
  const [raInputStr, setRaInputStr] = useState<string>(ra.toFixed(5));
  const [decInputStr, setDecInputStr] = useState<string>(dec.toFixed(5));

  useEffect(() => {
    setRaInputStr(ra.toFixed(5));
    setDecInputStr(dec.toFixed(5));
  }, [ra, dec]);

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

  // Mount Aladin Lite v3 WebGL2 Progressive HiPS All-Sky Engine (100% Native, No Fake Canvases)
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
          target: `${ra} ${dec}`,
          fov: fovArcsec > 0 ? Math.max(0.01, fovArcsec / 3600) : 6.0,
          projection: 'SIN',
          cooFrame: 'ICRSd',
          showReticle: true,
          showZoomControl: false,
          showFullscreenControl: false,
          showLayersControl: false,
          showGotoControl: false,
          showShareControl: false,
          showSimbadPointerControl: false,
          showFrame: false,
          showCooGrid: showWcsGrid,
          showCooGridControl: false,
          showProjectionControl: false,
          showContextMenu: false,
        });

        aladinInstanceRef.current = instance;

        // Native Vector Overlay for SPHEREx LVF Footprints
        try {
          if (typeof A.graphicOverlay === 'function') {
            const lvfOverlay = A.graphicOverlay({
              name: 'SPHEREx Footprints',
              color: '#38BDF8',
              lineWidth: 1.5,
            });
            instance.addOverlay(lvfOverlay);
            footprintOverlayRef.current = lvfOverlay;
          }
        } catch (e) {
          console.warn('Aladin graphicOverlay init:', e);
        }

        // Native Vector Overlay for Cutout Stamp Bounding Box
        try {
          if (typeof A.graphicOverlay === 'function') {
            const cutoutOverlay = A.graphicOverlay({
              name: 'Cutout Box',
              color: '#38BDF8',
              lineWidth: 1.5,
            });
            instance.addOverlay(cutoutOverlay);
            cutoutOverlayRef.current = cutoutOverlay;
          }
        } catch (e) {
          console.warn('Aladin cutoutOverlay init:', e);
        }

        // Native Vector Overlay for NEP & SEP Deep Field Circles
        try {
          if (typeof A.graphicOverlay === 'function') {
            const deepOverlay = A.graphicOverlay({
              name: 'Deep Fields',
              color: '#F59E0B',
              lineWidth: 1.5,
            });
            instance.addOverlay(deepOverlay);
            deepFieldOverlayRef.current = deepOverlay;

            if (typeof A.circle === 'function') {
              [NEP_COORDS, SEP_COORDS].forEach((p) => {
                const c = A.circle(p.ra, p.dec, p.radiusDeg, {
                  color: '#F59E0B',
                  lineWidth: 1.5,
                });
                deepOverlay.add(c);
              });
            }
          }
        } catch (e) {
          console.warn('Aladin deepFieldOverlay init:', e);
        }

        // Native Astronomical Target Catalog Overlay (NASA Benchmarks + Searchable Catalog)
        try {
          if (typeof A.catalog === 'function') {
            const cat = A.catalog({
              name: 'SPHEREx Targets',
              sourceSize: 18,
              color: '#38BDF8',
              shape: 'circle',
            });
            instance.addCatalog(cat);
            catalogOverlayRef.current = cat;

            if (typeof A.source === 'function') {
              SEARCHABLE_SKY_CATALOG.forEach((item) => {
                const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === item.id);
                const src = A.source(item.ra, item.dec, {
                  name: item.name,
                  description: item.description,
                  isBench,
                  item,
                });
                cat.addSources([src]);
              });
            }
          }
        } catch (e) {
          console.warn('Aladin catalog init:', e);
        }

        // Sync telemetry when user drags or pans the sky
        instance.on('positionChanged', (data: any) => {
          if (!data) return;
          const newRa = typeof data.ra === 'number' ? data.ra : Number(data.ra);
          const newDec = typeof data.dec === 'number' ? data.dec : Number(data.dec);
          if (Number.isFinite(newRa) && Number.isFinite(newDec)) {
            const normRa = Number((((newRa % 360) + 360) % 360).toFixed(6));
            const normDec = Number(Math.max(-90, Math.min(90, newDec)).toFixed(6));
            setCoordinates(
              normRa,
              normDec,
              `Field ${normRa.toFixed(4)}°, ${normDec >= 0 ? '+' : ''}${normDec.toFixed(4)}°`,
              '[IRSA Live (spherex_qr2)]'
            );
            setRa(normRa);
            setDec(normDec);
          }
        });

        // Sync field of view when user zooms in or out
        instance.on('zoomChanged', (fovDeg: number) => {
          if (Number.isFinite(fovDeg)) {
            setDisplayFovDeg(fovDeg);
            const arcsec = Math.round(fovDeg * 3600);
            setFov(arcsec);
            setUrlFov(arcsec);
          }
        });

        // Real-time cursor coordinates readout
        instance.on('mouseMove', (data: any) => {
          if (!data) return;
          const cRa = typeof data.ra === 'number' ? data.ra : Number(data.ra);
          const cDec = typeof data.dec === 'number' ? data.dec : Number(data.dec);
          if (!Number.isFinite(cRa) || !Number.isFinite(cDec)) return;
          if (cursorRaDecDomRef.current) {
            cursorRaDecDomRef.current.textContent = `${cRa.toFixed(5)}° ${
              cDec >= 0 ? `+${cDec.toFixed(5)}` : cDec.toFixed(5)
            }°`;
          }
          if (cursorSexaDomRef.current) {
            cursorSexaDomRef.current.textContent = formatSexagesimal(cRa, cDec);
          }
        });

        // Click on catalog target
        instance.on('objectClicked', (obj: any) => {
          if (obj && obj.data && obj.data.item) {
            const item = obj.data.item;
            const isBench = MANDATORY_BENCHMARKS.some((b) => b.id === item.id);
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
          }
        });

        setHipsReady(true);
      } catch (err) {
        console.error('Failed to initialize Aladin Lite v3:', err);
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
    } catch (e) {
      console.warn('Error switching HiPS survey:', e);
    }
  }, [activeSurvey]);

  // Sync camera center when external target coordinates change (e.g. from search bar or catalog selection)
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladin) return;
    try {
      aladin.gotoRaDec(ra, dec);
    } catch (e) {
      console.warn('Error gotoRaDec:', e);
    }
  }, [ra, dec]);

  // Toggle native WCS Coordinate Grid
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladin) return;
    try {
      if (typeof aladin.showCooGrid === 'function') {
        aladin.showCooGrid(showWcsGrid);
      }
    } catch (e) {
      console.warn('Error toggling WCS grid:', e);
    }
  }, [showWcsGrid]);

  // Synchronize SPHEREx LVF Footprints Overlay
  useEffect(() => {
    const overlay = footprintOverlayRef.current;
    if (!overlay) return;
    try {
      overlay.removeAll();
      if (showLvfFootprints && typeof A.polygon === 'function') {
        filteredExposures.forEach((exp) => {
          const corners = getFootprintCorners(
            exp.centerRa,
            exp.centerDec,
            exp.footprintWidthDeg,
            exp.footprintHeightDeg,
            exp.rollAngleDeg
          );
          const poly = A.polygon(corners, {
            color: exp.detector.colorHex,
            lineWidth: 1.5,
          });
          overlay.add(poly);
        });
      }
    } catch (e) {
      console.warn('Error updating footprints overlay:', e);
    }
  }, [showLvfFootprints, filteredExposures]);

  // Synchronize Cutout Bounding Box Overlay
  useEffect(() => {
    const overlay = cutoutOverlayRef.current;
    if (!overlay) return;
    try {
      overlay.removeAll();
      if (showCutoutBox && typeof A.polygon === 'function') {
        const sizeDeg = fovArcsec / 3600;
        const corners = getFootprintCorners(ra, dec, sizeDeg, sizeDeg, 0);
        const poly = A.polygon(corners, {
          color: '#38BDF8',
          lineWidth: 1.5,
        });
        overlay.add(poly);
      }
    } catch (e) {
      console.warn('Error updating cutout box overlay:', e);
    }
  }, [showCutoutBox, fovArcsec, ra, dec]);

  // Direct Zoom Preset Handler
  const applyZoom = useCallback((nextFovDeg: number) => {
    const clamped = Math.max(0.005, Math.min(180.0, nextFovDeg));
    setDisplayFovDeg(clamped);
    try {
      aladinInstanceRef.current?.setFoV(clamped);
    } catch (e) {
      console.warn('Error setFoV:', e);
    }
  }, []);

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
      try {
        aladinInstanceRef.current?.gotoRaDec(parsedRa, parsedDec);
      } catch (err) {
        console.warn('Error gotoRaDec:', err);
      }
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#080A0F] font-sans text-xs text-[#E6ECF2] select-none">
      {/* LEFT 70%: Native Aladin Lite v3 WebGL2 Sky Viewport */}
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
              onClick={() => applyZoom(displayFovDeg * 0.65)}
              className="px-2 py-0.5 font-mono text-xs text-[#E6ECF2] hover:bg-[#151B24]"
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <span className="h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => applyZoom(displayFovDeg * 1.5)}
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

        {/* 100% Native Aladin Lite v3 WebGL2 All-Sky HiPS Viewport */}
        <div
          className="relative flex-1 w-full overflow-hidden bg-[#06080D]"
        >
          {/* Aladin Lite v3 Canvas Container (Receives all drag, scroll, touch, and click events directly) */}
          <div
            ref={aladinContainerRef}
            className="absolute inset-0 h-full w-full"
          />

          {/* Top-Left Astrometric Compass / Status */}
          <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-2.5 rounded-sm border border-[#1E2530] bg-[#0F131A]/90 px-2.5 py-1.5">
            <svg className="h-7 w-7 text-[#38BDF8]" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="13" stroke="#1E2530" strokeWidth="1" />
              <path d="M16 5L16 20" stroke="#38BDF8" strokeWidth="1.5" />
              <path d="M13.5 8.5L16 4.5L18.5 8.5" stroke="#38BDF8" strokeWidth="1.5" />
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
                Aladin Lite v3 WebGL2 · {PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey)?.label || 'All-Sky Survey'}
              </span>
              <span className="font-mono text-[10px] text-[#94A3B8]">
                {PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey)?.badge || 'Multi-Resolution HiPS Pyramid'} · Drag to pan · Scroll to zoom
              </span>
            </div>
          </div>

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
                  aladinInstanceRef.current?.gotoRaDec(ra, dec);
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
