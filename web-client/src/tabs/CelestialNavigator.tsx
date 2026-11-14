import React, { startTransition, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import A from 'aladin-lite';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import {
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
  BenchmarkPill,
} from '../components/GlobalCommandHeader';
import { Button, Badge, Input, Select } from '../components/ui';
import {
  DownloadingSection,
  DownloadingSectionMeta,
  InstalledSection,
  findMatchingSection,
  formatSectionBytes,
  useDownloadingSections,
  useDownloadingSummary,
  useInstalledSectionState,
} from '../lib/installedSections';

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
const DEFAULT_SKY_FOV_DEG = 18;
const MIN_SKY_FOV_DEG = 0.08;
const MAX_SKY_FOV_DEG = 60;
const DETAIL_FITS_FOV_DEG = 0.14;
const DETAIL_FITS_MAX_DIMENSION = 500;
const DETAIL_FITS_LAYER_PREFIX = '2MASS Ks FITS detail';
const SIMULATED_PREVIEW_BADGE = '[Synthetic Injection Mode]';

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
type PhotographicSurveyId =
  | 'legacy-dr10'
  | 'allwise-color'
  | 'sdss-color'
  | '2mass-color'
  | 'dss2-color'
  | 'spitzer-color';

interface PhotographicSurveySpec {
  id: PhotographicSurveyId;
  hipsUrl: string;
  maxOrder?: number;
  imgFormat?: 'jpeg' | 'png';
  tileSize?: number;
  label: string;
  badge: string;
  description: string;
}

const PHOTOGRAPHIC_SURVEYS: PhotographicSurveySpec[] = [
  {
    id: 'legacy-dr10',
    hipsUrl: 'https://alaskybis.cds.unistra.fr/DESI-legacy-surveys/DR10/CDS_P_DESI-Legacy-Surveys_DR10_color',
    label: 'DESI Legacy Survey DR10',
    badge: 'Optical g/r/i/z · resolved galaxies · partial sky',
    description: 'DESI Legacy Survey DR10 calibrated color imagery for resolving extended galaxies where the survey has coverage.',
  },
  {
    id: 'allwise-color',
    hipsUrl: 'https://skies.esac.esa.int/AllWISEColor',
    maxOrder: 8,
    imgFormat: 'jpeg',
    tileSize: 512,
    label: 'AllWISE Infrared',
    badge: 'WISE 3.4 & 4.6 µm (All-Sky)',
    description: 'All-sky WISE infrared HiPS. Its 6–12 arcsec source resolution can blend point sources at a 6° field on typical displays.',
  },
  {
    id: 'sdss-color',
    hipsUrl: 'https://skies.esac.esa.int/SDSS9Color',
    label: 'SDSS Optical (High-Res)',
    badge: 'SDSS DR9 · 0.4″/px · JPEG · ~36% sky',
    description: 'High-resolution SDSS DR9 color imagery (about 0.4 arcsec/pixel); coverage is limited to about 36% of the sky and tiles use JPEG.',
  },
  {
    id: '2mass-color',
    hipsUrl: 'https://skies.esac.esa.int/2MASSColor',
    label: '2MASS Near-IR',
    badge: 'J/H/Ks (All-Sky, Order 9)',
    description: 'Two Micron All-Sky Survey (J, H, Ks) resolving crisp stellar populations and Galactic structure.',
  },
  {
    id: 'dss2-color',
    hipsUrl: 'https://skies.esac.esa.int/DSSColor',
    label: 'DSS2 Optical',
    badge: 'Palomar/UKST (All-Sky, Order 9)',
    description: 'Digitized Sky Survey full-sphere optical photographic mosaic covering 100% of both hemispheres.',
  },
  {
    id: 'spitzer-color',
    hipsUrl: 'https://skies.esac.esa.int/Spitzer/IRAC1_bright_ISM',
    label: 'Spitzer 3.6 µm',
    badge: 'IRAC Ch 1 (Deep IR, Order 10 PNG)',
    description: 'Spitzer Space Telescope high-sensitivity infrared array camera mapping Galactic dust and star formation regions in lossless PNG tiles.',
  },
];

interface IrsaExposure {
  obsId: string;
  collection?: string;
  detector: string;
  mjd: string;
  wavelength: string;
  accessUrl: string;
  sRegion: string;
}

function parseIrsaSiaResponse(payload: unknown): IrsaExposure[] {
  if (!payload || typeof payload !== 'object') throw new Error('Coverage API returned an invalid response.');
  const exposures = (payload as { exposures?: unknown }).exposures;
  if (!Array.isArray(exposures)) throw new Error('Coverage API response is missing its exposure list.');

  return exposures.flatMap((exposure, index) => {
    if (!exposure || typeof exposure !== 'object') return [];
    const values = Object.fromEntries(
      Object.entries(exposure).map(([key, value]) => [key.toLowerCase(), value])
    );
    const sRegion = String(values.s_region || '');
    if (!sRegion) return [];
    const accessUrl = String(values.access_url || 'https://irsa.ipac.caltech.edu/Missions/spherex.html');
    return [{
      obsId: String(values.obs_id || `IRSA-${index + 1}`),
      collection: values.collection ? String(values.collection) : undefined,
      detector: String(values.instrument_name || values.energy_bandpassname || 'SPHEREx'),
      mjd: String(values.t_min || ''),
      wavelength: String(values.energy_bandpassname || ''),
      accessUrl,
      sRegion,
    }];
  });
}

function parseStcsPolygon(sRegion: string): { ra: number[]; dec: number[] } | null {
  if (!/^\s*POLYGON\s+ICRS\b/i.test(sRegion)) return null;
  const values = sRegion.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number);
  if (!values || values.length < 6 || values.length % 2 !== 0) return null;
  const ra = values.filter((_, index) => index % 2 === 0);
  const dec = values.filter((_, index) => index % 2 === 1);
  if (ra.some((value) => !Number.isFinite(value)) || dec.some((value) => !Number.isFinite(value))) return null;
  return { ra, dec };
}

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

function mergeDownloadingSectionsWithLibrary(
  downloadingSections: DownloadingSection[],
  installedSections: InstalledSection[]
): DownloadingSection[] {
  const merged: DownloadingSection[] = [...downloadingSections];
  installedSections.forEach((sec) => {
    if (sec.status !== 'installing') return;
    const alreadyTracked = merged.some(
      (d) =>
        (d.section_id && d.section_id === sec.section_id) ||
        (Math.abs(d.ra - sec.ra) < 0.002 &&
          Math.abs(d.dec - sec.dec) < 0.002 &&
          Math.abs(d.fov_arcsec - sec.fov_arcsec) <= 1)
    );
    if (!alreadyTracked) {
      merged.push({
        key: sec.section_id,
        section_id: sec.section_id,
        task_id: sec.task_id || undefined,
        label: sec.label,
        ra: sec.ra,
        dec: sec.dec,
        fov_arcsec: sec.fov_arcsec,
        progress: 0.15,
        message: 'Downloading cutout section…',
      });
    }
  });
  return merged;
}

const MatchingDownloadStatusButton: React.FC<{
  ra: number;
  dec: number;
  fovArcsec: number;
  queueState?: 'queued' | 'installing';
}> = React.memo(({ ra, dec, fovArcsec, queueState }) => {
  const liveDownloads = useDownloadingSections();
  const match = liveDownloads.find(
    (d) =>
      Math.abs(d.ra - ra) < 0.002 &&
      Math.abs(d.dec - dec) < 0.002 &&
      Math.abs(d.fov_arcsec - fovArcsec) <= 1
  );
  const resolvedQueueState = match?.queueState ?? queueState;
  const pct = Math.round((match?.progress ?? 0.15) * 100);
  return (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      disabled
      className="flex-1 h-7 text-[11px] border-orange-500/50 bg-orange-500/15 text-orange-300"
    >
      {resolvedQueueState === 'queued'
        ? 'Queued for Download'
        : `Downloading (${pct}%)`}
    </Button>
  );
});

const ActiveDownloadsQueuePanel: React.FC<{
  installedSections: InstalledSection[];
  onCancelQueued: (key: string) => void;
}> = React.memo(({ installedSections, onCancelQueued }) => {
  const liveDownloads = useDownloadingSections();
  const items = useMemo(
    () => mergeDownloadingSectionsWithLibrary(liveDownloads, installedSections),
    [liveDownloads, installedSections]
  );
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map((dl) => {
        const isQueued = dl.queueState === 'queued';
        return (
          <div
            key={dl.key}
            className="rounded border border-orange-500/50 bg-orange-500/10 px-2.5 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-[10px] text-orange-300">
              <span className="truncate font-medium">
                {dl.label} · {Math.round(dl.fov_arcsec)}&quot;
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-mono tabular-nums">
                  {isQueued ? 'Queued' : `${Math.round(dl.progress * 100)}%`}
                </span>
                {isQueued && (
                  <button
                    type="button"
                    onClick={() => onCancelQueued(dl.key)}
                    className="rounded px-1 text-orange-300/80 hover:bg-orange-500/20 hover:text-orange-100"
                    title="Remove from install queue"
                    aria-label={`Cancel queued section ${dl.label}`}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="mt-0.5 truncate text-[9px] text-orange-200/80">
              {dl.message}
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-background">
              <div
                className={`h-full transition-[width] duration-150 ${isQueued ? 'bg-orange-400/50' : 'bg-orange-500'}`}
                style={{
                  width: isQueued
                    ? '15%'
                    : `${Math.max(5, Math.min(100, Math.round(dl.progress * 100)))}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

export const CelestialNavigator: React.FC = () => {
  const aladinContainerRef = useRef<HTMLDivElement>(null);
  const aladinInstanceRef = useRef<any>(null);
  const footprintOverlayRef = useRef<any>(null);
  const cutoutOverlayRef = useRef<any>(null);
  const downloadingOverlayRef = useRef<any>(null);
  const catalogOverlayRef = useRef<any>(null);
  const deepFieldOverlayRef = useRef<any>(null);
  const archiveMocsRef = useRef<any[]>([]);
  const cachedMocsRef = useRef<any[]>([]);
  const downloadingMocsRef = useRef<any[]>([]);
  const gaiaCatalogRef = useRef<any>(null);
  const gaiaMotionOverlayRef = useRef<any>(null);
  const skybotCatalogRef = useRef<any>(null);
  const skybotCacheRef = useRef<Map<string, any>>(new Map());

  // High-frequency DOM refs for real-time cursor readouts
  const cursorRaDecDomRef = useRef<HTMLSpanElement>(null);
  const cursorSexaDomRef = useRef<HTMLSpanElement>(null);
  const cursorLvfDomRef = useRef<HTMLSpanElement>(null);
  const cursorSkyPositionRef = useRef<{ ra: number; dec: number } | null>(null);
  const detailFitsLayerRef = useRef<{ name: string; url: string } | null>(null);
  const detailFitsRequestIdRef = useRef(0);
  const detailFitsAbortControllerRef = useRef<AbortController | null>(null);
  const ignoreClickAfterPanUntilRef = useRef(0);

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
  const [showLvfFootprints, setShowLvfFootprints] = useState<boolean>(false);
  const [showAvailableCoverage, setShowAvailableCoverage] = useState<boolean>(false);
  const [showInstalledSections, setShowInstalledSections] = useState<boolean>(true);
  const [showCoverageCard, setShowCoverageCard] = useState<boolean>(false);
  const [showWcsGrid, setShowWcsGrid] = useState<boolean>(false);
  const [showCutoutBox, setShowCutoutBox] = useState<boolean>(true);
  const [activeSurvey, setActiveSurvey] = useState<PhotographicSurveyId>('allwise-color');
  const [selectedBandFilter, setSelectedBandFilter] = useState<string>('ALL');
  const [hoveredObsId, setHoveredObsId] = useState<string | null>(null);
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);
  // Sky viewport FoV is separate from fovArcsec, which is the spectral cutout size.
  const [displayFovDeg, setDisplayFovDeg] = useState<number>(DEFAULT_SKY_FOV_DEG);
  const [hipsReady, setHipsReady] = useState<boolean>(false);
  const [hipsError, setHipsError] = useState<boolean>(false);
  const [aladinReady, setAladinReady] = useState<boolean>(false);
  const [archiveExposures, setArchiveExposures] = useState<IrsaExposure[]>([]);
  const [fullCoverageExposures, setFullCoverageExposures] = useState<IrsaExposure[]>([]);
  const [coverageMocs, setCoverageMocs] = useState<Record<string, { moc_order: number; moc_json: Record<string, number[]>; sky_fraction: number; cell_count: number; exposure_count: number }>>({});
  const [deepFieldExposures, setDeepFieldExposures] = useState<IrsaExposure[]>([]);
  const [coverageZones, setCoverageZones] = useState<Array<{ ra: number; dec: number; count: number }>>([]);
  const {
    installedSections,
    installError,
    refreshInstalledSections,
    startSectionInstall,
    cancelQueuedInstall,
    uninstallSectionById,
  } = useInstalledSectionState();
  const { downloadingMeta } = useDownloadingSummary();
  const [archiveStatus, setArchiveStatus] = useState<'idle' | 'loading' | 'ready' | 'partial' | 'empty' | 'error'>('idle');
  const [gaiaStatus, setGaiaStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const [skybotStatus, setSkybotStatus] = useState<'loading' | 'live' | 'cached_only' | 'unavailable'>('loading');
  const [showSyntheticPreview, setShowSyntheticPreview] = useState<boolean>(false);
  const surveyLoadIdRef = useRef<number>(0);
  const surveyLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedSurveyIdRef = useRef<PhotographicSurveyId | null>(null);

  // Smooth gesture telemetry & anti-feedback refs
  const lastInternalCoordRef = useRef<{ ra: number; dec: number }>({ ra, dec });
  const posDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createHiPSSurvey = useCallback((surveySpec: PhotographicSurveySpec) => {
    const requestId = ++surveyLoadIdRef.current;
    if (surveyLoadTimerRef.current) clearTimeout(surveyLoadTimerRef.current);
    setHipsReady(false);
    setHipsError(false);
    surveyLoadTimerRef.current = setTimeout(() => {
      if (requestId === surveyLoadIdRef.current) {
        setHipsReady(false);
        setHipsError(true);
      }
    }, 25000);
    return A.HiPS(surveySpec.hipsUrl, {
      name: surveySpec.label,
      cooFrame: 'equatorial',
      maxOrder: surveySpec.maxOrder,
      imgFormat: surveySpec.imgFormat,
      tileSize: surveySpec.tileSize,
      successCallback: () => {
        if (requestId === surveyLoadIdRef.current) {
          if (surveyLoadTimerRef.current) clearTimeout(surveyLoadTimerRef.current);
          setHipsReady(true);
          setHipsError(false);
        }
      },
      errorCallback: () => {
        if (requestId === surveyLoadIdRef.current) {
          if (surveyLoadTimerRef.current) clearTimeout(surveyLoadTimerRef.current);
          setHipsReady(false);
          setHipsError(true);
        }
      },
    });
  }, []);

  // Direct coordinate input fields in the right-hand inspector
  const [raInputStr, setRaInputStr] = useState<string>(ra.toFixed(5));
  const [decInputStr, setDecInputStr] = useState<string>(dec.toFixed(5));

  useEffect(() => {
    setRaInputStr(ra.toFixed(5));
    setDecInputStr(dec.toFixed(5));
  }, [ra, dec]);

  // Generate overlapping SPHEREx Level-2 spectral image exposures for the active target
  const allExposures = useMemo(
    () => showSyntheticPreview ? generateSpherexExposuresForCoord(ra, dec) : [],
    [ra, dec, showSyntheticPreview]
  );

  // Pre-load all-sky SPHEREx mission coverage footprints from database
  useEffect(() => {
    let active = true;
    fetch('/api/coverage/full')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Coverage unavailable'))))
      .then((payload) => {
        if (!active) return;
        if (Array.isArray(payload.exposures)) {
          const parsed = parseIrsaSiaResponse(payload);
          setFullCoverageExposures(parsed);
        }
        if (payload.mocs && typeof payload.mocs === 'object') {
          setCoverageMocs(payload.mocs);
        }
        if (Array.isArray(payload.deep_fields)) {
          setDeepFieldExposures(parseIrsaSiaResponse({ exposures: payload.deep_fields }));
        }
        if (Array.isArray(payload.zones)) {
          setCoverageZones(payload.zones);
        }
      })
      .catch((err) => {
        console.warn('Full coverage fetch error:', err);
      });
    return () => {
      active = false;
    };
  }, []);

  // Reset target-level exposure table when user selects a new coordinate (no auto-querying on pan)
  useEffect(() => {
    setArchiveExposures([]);
    setArchiveStatus('idle');
  }, [ra, dec, fovArcsec]);

  useEffect(() => {
    void refreshInstalledSections();
  }, [refreshInstalledSections]);

  const readyInstalledSections = useMemo(
    () => installedSections.filter((s) => s.status === 'ready'),
    [installedSections]
  );
  const readyInstalledSectionsRef = useRef(readyInstalledSections);
  readyInstalledSectionsRef.current = readyInstalledSections;
  const readySectionsGeometryKey = useMemo(
    () =>
      readyInstalledSections
        .map(
          (s) =>
            `${s.section_id}:${s.ra.toFixed(5)}:${s.dec.toFixed(5)}:${Math.round(s.fov_arcsec)}`
        )
        .sort()
        .join('|'),
    [readyInstalledSections]
  );

  const activeDownloadingSections = useMemo<DownloadingSectionMeta[]>(() => {
    const merged: DownloadingSectionMeta[] = [...downloadingMeta];
    installedSections.forEach((sec) => {
      if (sec.status !== 'installing') return;
      const alreadyTracked = merged.some(
        (d) =>
          (d.section_id && d.section_id === sec.section_id) ||
          (Math.abs(d.ra - sec.ra) < 0.002 &&
            Math.abs(d.dec - sec.dec) < 0.002 &&
            Math.abs(d.fov_arcsec - sec.fov_arcsec) <= 1)
      );
      if (!alreadyTracked) {
        merged.push({
          key: sec.section_id,
          section_id: sec.section_id,
          task_id: sec.task_id || undefined,
          label: sec.label,
          ra: sec.ra,
          dec: sec.dec,
          fov_arcsec: sec.fov_arcsec,
        });
      }
    });
    return merged;
  }, [downloadingMeta, installedSections]);
  const activeDownloadingSectionsRef = useRef(activeDownloadingSections);
  activeDownloadingSectionsRef.current = activeDownloadingSections;
  const downloadingSectionsGeometryKey = useMemo(
    () =>
      activeDownloadingSections
        .map(
          (s) => `${s.key}:${s.ra.toFixed(5)}:${s.dec.toFixed(5)}:${Math.round(s.fov_arcsec)}`
        )
        .sort()
        .join('|'),
    [activeDownloadingSections]
  );

  const matchedInstalledSection = useMemo(
    () => findMatchingSection(installedSections, ra, dec, fovArcsec),
    [installedSections, ra, dec, fovArcsec]
  );

  const matchingDownloadingSection = useMemo(
    () =>
      activeDownloadingSections.find(
        (d) =>
          Math.abs(d.ra - ra) < 0.002 &&
          Math.abs(d.dec - dec) < 0.002 &&
          Math.abs(d.fov_arcsec - fovArcsec) <= 1
      ) || null,
    [activeDownloadingSections, ra, dec, fovArcsec]
  );

  const checkSelectedCoverage = useCallback(async () => {
    setArchiveStatus('loading');
    const radiusDeg = Math.min(Math.max((fovArcsec * 1.5) / 3600, 0.04), 0.12);
    const params = new URLSearchParams({
      ra: String(ra),
      dec: String(dec),
      radius_deg: String(radiusDeg),
    });
    try {
      const response = await fetch(`/api/coverage?${params}`);
      if (!response.ok) throw new Error(`Coverage API returned ${response.status}`);
      const payload = await response.json();
      const results = parseIrsaSiaResponse(payload);
      const coverageStatus = (payload as { status?: string }).status;
      setArchiveExposures(results);
      setArchiveStatus(
        coverageStatus === 'partial'
          ? 'partial'
          : coverageStatus === 'empty'
            ? 'empty'
            : results.length > 0
              ? 'ready'
              : 'empty'
      );
    } catch {
      setArchiveExposures([]);
      setArchiveStatus('error');
    }
  }, [ra, dec, fovArcsec]);

  const handleInstallSection = useCallback(() => {
    void startSectionInstall({
      ra,
      dec,
      fovArcsec,
      label: activeTargetName || undefined,
    });
  }, [ra, dec, fovArcsec, activeTargetName, startSectionInstall]);

  const handleUninstallSection = useCallback(
    async (sectionId: string) => {
      try {
        await uninstallSectionById(sectionId);
      } catch (err) {
        console.warn('Uninstall error:', err);
      }
    },
    [uninstallSectionById]
  );

  const filteredExposures = useMemo(() => {
    if (selectedBandFilter === 'ALL') return allExposures;
    return allExposures.filter((e) => e.detector.id === selectedBandFilter);
  }, [allExposures, selectedBandFilter]);

  const filteredArchiveExposures = useMemo(() => {
    if (selectedBandFilter === 'ALL') return archiveExposures;
    return archiveExposures.filter(
      (exp) =>
        exp.detector.toUpperCase().includes(selectedBandFilter) ||
        exp.wavelength.toUpperCase().includes(selectedBandFilter)
    );
  }, [archiveExposures, selectedBandFilter]);

  const detectorCounts = useMemo(() => {
    const counts: Record<string, number> = { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, D6: 0 };
    archiveExposures.forEach((exp) => {
      const detText = `${exp.detector} ${exp.wavelength}`.toUpperCase();
      SPHEREX_DETECTORS.forEach((det) => {
        if (detText.includes(det.id)) {
          counts[det.id] = (counts[det.id] || 0) + 1;
        }
      });
    });
    return counts;
  }, [archiveExposures]);

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
        mountedSurveyIdRef.current = surveySpec.id;

        const instance = A.aladin(aladinContainerRef.current, {
          survey: createHiPSSurvey(surveySpec),
          target: `${ra} ${dec}`,
          fov: DEFAULT_SKY_FOV_DEG,
          projection: 'TAN',
          cooFrame: 'ICRSd',
          showReticle: true,
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
        setAladinReady(true);
        instance.setFoVRange?.(MIN_SKY_FOV_DEG, MAX_SKY_FOV_DEG);

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

            const downloadingOverlay = A.graphicOverlay({
              name: 'Downloading Cutouts',
              color: '#F97316',
              lineWidth: 2.5,
            });
            instance.addOverlay(downloadingOverlay);
            downloadingOverlayRef.current = downloadingOverlay;
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

        // Sync telemetry when user drags or pans the sky (debounced to break feedback loop)
        instance.on('positionChanged', (data: any) => {
          if (!data) return;
          const newRa = typeof data.ra === 'number' ? data.ra : Number(data.ra);
          const newDec = typeof data.dec === 'number' ? data.dec : Number(data.dec);
          if (Number.isFinite(newRa) && Number.isFinite(newDec)) {
            const normRa = Number((((newRa % 360) + 360) % 360).toFixed(6));
            const normDec = Number(Math.max(-90, Math.min(90, newDec)).toFixed(6));
            if (data.dragging) {
              ignoreClickAfterPanUntilRef.current = performance.now() + 500;
              const detailLayer = detailFitsLayerRef.current;
              if (detailLayer) {
                instance.removeImageLayer(detailLayer.name);
                URL.revokeObjectURL(detailLayer.url);
                detailFitsLayerRef.current = null;
              }
            }
            lastInternalCoordRef.current = { ra: normRa, dec: normDec };

            if (posDebounceTimerRef.current) clearTimeout(posDebounceTimerRef.current);
            posDebounceTimerRef.current = setTimeout(() => {
              startTransition(() => {
                setCoordinates(
                  normRa,
                  normDec,
                  `Field ${normRa.toFixed(4)}°, ${normDec >= 0 ? '+' : ''}${normDec.toFixed(4)}°`,
                  SIMULATED_PREVIEW_BADGE
                );
                setRa(normRa);
                setDec(normDec);
              });
            }, 250);
          }
        });

        // Track camera FoV for the scale bar; URL fov remains the cutout size in arcseconds.
        instance.on('zoomChanged', (fovDeg: number) => {
          if (Number.isFinite(fovDeg)) {
            setDisplayFovDeg(fovDeg);
          }
        });

        // Real-time cursor coordinates readout
        instance.on('mouseMove', (data: any) => {
          if (!data) return;
          const cRa = typeof data.ra === 'number' ? data.ra : Number(data.ra);
          const cDec = typeof data.dec === 'number' ? data.dec : Number(data.dec);
          if (!Number.isFinite(cRa) || !Number.isFinite(cDec)) return;
          cursorSkyPositionRef.current = { ra: cRa, dec: cDec };
          if (cursorRaDecDomRef.current) {
            cursorRaDecDomRef.current.textContent = `${cRa.toFixed(5)}° ${
              cDec >= 0 ? `+${cDec.toFixed(5)}` : cDec.toFixed(5)
            }°`;
          }
          if (cursorSexaDomRef.current) {
            cursorSexaDomRef.current.textContent = formatSexagesimal(cRa, cDec);
          }
        });

        // Selecting empty sky updates the target coordinates just like selecting a catalog source.
        instance.on('click', (data: any) => {
          // Aladin also emits a click after a drag. Do not turn that release into
          // a target selection and pull the camera back to the cursor position.
          if (performance.now() < ignoreClickAfterPanUntilRef.current) return;
          const clickedPosition =
            data && Number.isFinite(Number(data.ra)) && Number.isFinite(Number(data.dec))
              ? { ra: Number(data.ra), dec: Number(data.dec) }
              : cursorSkyPositionRef.current;
          if (!clickedPosition) return;
          const { ra: clickedRa, dec: clickedDec } = clickedPosition;
          if (!Number.isFinite(clickedRa) || !Number.isFinite(clickedDec)) return;

          const normRa = Number((((clickedRa % 360) + 360) % 360).toFixed(6));
          const normDec = Number(Math.max(-90, Math.min(90, clickedDec)).toFixed(6));
          setCoordinates(
            normRa,
            normDec,
            `J2000 ${normRa.toFixed(4)}°, ${normDec >= 0 ? '+' : ''}${normDec.toFixed(4)}°`,
            SIMULATED_PREVIEW_BADGE
          );
          setRa(normRa);
          setDec(normDec);
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
              isBench ? '[NASA Benchmark (Pre-cached)]' : SIMULATED_PREVIEW_BADGE
            );
            setRa(item.ra);
            setDec(item.dec);
            if (item.preset) {
              setRgbPreset(item.preset);
              setPreset(item.preset);
            }
          }
        });

      } catch (err) {
        console.error('Failed to initialize Aladin Lite v3:', err);
        setHipsReady(false);
        setHipsError(true);
      }
    };

    initAladin();
    return () => {
      cancelled = true;
      setAladinReady(false);
      if (surveyLoadTimerRef.current) clearTimeout(surveyLoadTimerRef.current);
      if (posDebounceTimerRef.current) clearTimeout(posDebounceTimerRef.current);
      aladinInstanceRef.current = null;
    };
    // Aladin captures the initial target and survey when it mounts; later changes sync through event handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createHiPSSurvey]);

  // Draw all-sky SPHEREx mission coverage HEALPix MOC mesh from the database
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladinReady || !aladin) return;

    archiveMocsRef.current.forEach((moc) => {
      try {
        aladin.removeOverlay?.(moc);
      } catch (e) {
        // Safe cleanup
      }
    });
    archiveMocsRef.current = [];
    if (!showAvailableCoverage) return;

    const addPolygonMoc = (sRegion: string, opts: { color: string; opacity: number; lineWidth: number }) => {
      const polygon = parseStcsPolygon(sRegion);
      if (!polygon || typeof A.MOCFromPolygon !== 'function') return;
      try {
        const moc = A.MOCFromPolygon(polygon, opts);
        aladin.addMOC(moc);
        archiveMocsRef.current.push(moc);
      } catch (error) {
        console.warn('Could not render coverage polygon MOC:', error);
      }
    };

    const mocEntries: Array<[string, string, number]> = [
      ['spherex_dr1', '#38bdf8', 0.14],
      ['spherex_qr3', '#FACC15', 0.16],
      ['spherex_qr2', '#818cf8', 0.12],
    ];
    let renderedReleaseMoc = false;
    if (typeof A.MOCFromJSON === 'function') {
      mocEntries.forEach(([collection, color, opacity]) => {
        const entry = coverageMocs[collection];
        if (!entry || !entry.moc_json || entry.cell_count === 0) return;
        try {
          const moc = A.MOCFromJSON(entry.moc_json, {
            color,
            opacity,
            lineWidth: 1.2,
            name: collection.toUpperCase().replace('_', ' '),
          });
          aladin.addMOC(moc);
          archiveMocsRef.current.push(moc);
          renderedReleaseMoc = true;
        } catch (error) {
          console.warn(`Could not render ${collection} HEALPix MOC:`, error);
        }
      });
    }

    // Fallback to individual DB footprint polygons if precomputed release MOCs are empty
    if (!renderedReleaseMoc) {
      fullCoverageExposures.forEach((exposure) => {
        addPolygonMoc(exposure.sRegion, {
          color: exposure.collection === 'spherex_dr1' || exposure.collection === 'spherex_qr2' ? '#38bdf8' : '#FACC15',
          opacity: 0.16,
          lineWidth: 1.2,
        });
      });
    }

    // Always overlay NEP/SEP Deep Field 5.64 deg boundary rings
    deepFieldExposures.forEach((field) => {
      addPolygonMoc(field.sRegion, {
        color: '#f59e0b',
        opacity: 0.08,
        lineWidth: 1.5,
      });
    });

    return () => {
      archiveMocsRef.current.forEach((moc) => {
        try {
          aladin.removeOverlay?.(moc);
        } catch (e) {
          // Safe cleanup
        }
      });
      archiveMocsRef.current = [];
    };
  }, [coverageMocs, deepFieldExposures, fullCoverageExposures, aladinReady, showAvailableCoverage]);

  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladinReady || !aladin) return;
    cachedMocsRef.current.forEach((moc) => aladin.removeOverlay?.(moc));
    cachedMocsRef.current = [];
    if (!showInstalledSections) return;

    readyInstalledSectionsRef.current.forEach((region) => {
      if (typeof A.MOCFromPolygon !== 'function') return;
      const corners = getFootprintCorners(region.ra, region.dec, region.fov_arcsec / 3600, region.fov_arcsec / 3600, 0);
      try {
        const moc = A.MOCFromPolygon({ ra: corners.map(([cornerRa]) => cornerRa), dec: corners.map(([, cornerDec]) => cornerDec) }, {
          color: '#10B981',
          opacity: 0.28,
          lineWidth: 2,
        });
        aladin.addMOC(moc);
        cachedMocsRef.current.push(moc);
      } catch (error) {
        console.warn('Could not render installed section footprint:', error);
      }
    });
    return () => {
      cachedMocsRef.current.forEach((moc) => aladin.removeOverlay?.(moc));
      cachedMocsRef.current = [];
    };
  }, [readySectionsGeometryKey, aladinReady, showInstalledSections]);

  // Keep downloading cutout sections highlighted in bright orange independently of FoV/pan changes
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    const overlay = downloadingOverlayRef.current;
    if (!aladinReady || !aladin) return;

    downloadingMocsRef.current.forEach((moc) => {
      try {
        aladin.removeOverlay?.(moc);
      } catch {
        // Safe cleanup
      }
    });
    downloadingMocsRef.current = [];
    overlay?.removeAll?.();

    activeDownloadingSectionsRef.current.forEach((sec) => {
      const sizeDeg = Math.max(sec.fov_arcsec, 60) / 3600;
      const corners = getFootprintCorners(sec.ra, sec.dec, sizeDeg, sizeDeg, 0);
      if (typeof A.MOCFromPolygon === 'function') {
        try {
          const moc = A.MOCFromPolygon(
            { ra: corners.map(([cornerRa]) => cornerRa), dec: corners.map(([, cornerDec]) => cornerDec) },
            {
              color: '#F97316',
              opacity: 0.36,
              lineWidth: 2.5,
            }
          );
          aladin.addMOC(moc);
          downloadingMocsRef.current.push(moc);
        } catch (error) {
          console.warn('Could not render downloading section MOC:', error);
        }
      }
      if (overlay && typeof A.polygon === 'function') {
        try {
          const poly = A.polygon(corners, {
            color: '#FB923C',
            lineWidth: 2.5,
          });
          overlay.add(poly);
        } catch (error) {
          console.warn('Could not render downloading section outline:', error);
        }
      }
    });

    return () => {
      downloadingMocsRef.current.forEach((moc) => {
        try {
          aladin.removeOverlay?.(moc);
        } catch {
          // Safe cleanup
        }
      });
      downloadingMocsRef.current = [];
      overlay?.removeAll?.();
    };
  }, [downloadingSectionsGeometryKey, aladinReady]);

  // Query Gaia DR3 near the active field and render five-year proper-motion vectors.
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladinReady || !aladin) return;
    if (typeof A.catalogFromVizieR !== 'function') {
      setGaiaStatus('unavailable');
      return;
    }
    let cancelled = false;
    setGaiaStatus('loading');
    const timer = window.setTimeout(() => {
      if (gaiaCatalogRef.current) aladin.removeOverlay?.(gaiaCatalogRef.current);
      if (gaiaMotionOverlayRef.current) aladin.removeOverlay?.(gaiaMotionOverlayRef.current);

      const motionOverlay = A.graphicOverlay({
        name: 'Gaia DR3 Proper Motion (5 yr)',
        color: '#FBBF24',
        lineWidth: 1.25,
      });
      gaiaMotionOverlayRef.current = motionOverlay;
      aladin.addOverlay(motionOverlay);

      A.catalogFromVizieR(
        'I/355/gaiadr3',
        { ra, dec },
        300 / 3600,
        {
          name: 'Gaia DR3 · G < 18 · 300 arcsec',
          color: '#FBBF24',
          sourceSize: 6,
          limit: 50,
          colnames: ['RA_ICRS', 'DE_ICRS', 'pmRA', 'pmDE', 'Gmag'],
          filter: (source: any) => Number(source?.data?.Gmag ?? source?.data?.G) < 18,
        },
        (catalog: any) => {
          if (cancelled) {
            aladin.removeOverlay?.(catalog);
            return;
          }
          gaiaCatalogRef.current = catalog;
          aladin.addCatalog(catalog);
          setGaiaStatus('live');
          const sources = catalog.getSources?.() || [];
          sources.slice(0, 50).forEach((source: any) => {
            const data = source.data || {};
            const sourceRa = Number(source.ra ?? data.RA_ICRS ?? data.ra);
            const sourceDec = Number(source.dec ?? data.DE_ICRS ?? data.dec);
            const pmRa = Number(data.pmRA ?? data.pmra);
            const pmDec = Number(data.pmDE ?? data.pmdec);
            const magnitude = Number(data.Gmag ?? data.G);
            if (![sourceRa, sourceDec, pmRa, pmDec, magnitude].every(Number.isFinite) || magnitude >= 18) return;
            const cosDec = Math.max(0.01, Math.abs(Math.cos((sourceDec * Math.PI) / 180)));
            const endRa = (sourceRa + (pmRa * 5) / (3_600_000 * cosDec) + 360) % 360;
            const endDec = Math.max(-90, Math.min(90, sourceDec + (pmDec * 5) / 3_600_000));
            motionOverlay.add(A.vector(sourceRa, sourceDec, endRa, endDec, { color: '#FBBF24', lineWidth: 1.25 }));
          });
        },
        (error: unknown) => {
          if (!cancelled) {
            console.warn('Gaia DR3 query failed:', error);
            setGaiaStatus('unavailable');
          }
        }
      );
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (gaiaCatalogRef.current) aladin.removeOverlay?.(gaiaCatalogRef.current);
      if (gaiaMotionOverlayRef.current) aladin.removeOverlay?.(gaiaMotionOverlayRef.current);
      gaiaCatalogRef.current = null;
      gaiaMotionOverlayRef.current = null;
    };
  }, [ra, dec, aladinReady]);

  // SkyBot is opportunistic: abandon the query after two seconds without delaying the sky view.
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladinReady || !aladin) return;
    if (typeof A.catalogFromSkyBot !== 'function') {
      setSkybotStatus('unavailable');
      return;
    }
    let settled = false;
    const cacheKey = `${ra.toFixed(5)}:${dec.toFixed(5)}:300`;
    const useCachedCatalog = () => {
      const cachedCatalog = skybotCacheRef.current.get(cacheKey);
      if (!cachedCatalog) {
        setSkybotStatus('unavailable');
        return;
      }
      skybotCatalogRef.current = cachedCatalog;
      aladin.addCatalog(cachedCatalog);
      setSkybotStatus('cached_only');
    };
    const timeout = window.setTimeout(() => {
      settled = true;
      useCachedCatalog();
    }, 2000);

    setSkybotStatus('loading');
    if (skybotCatalogRef.current) aladin.removeOverlay?.(skybotCatalogRef.current);
    skybotCatalogRef.current = null;
    A.catalogFromSkyBot(
      ra,
      dec,
      300 / 3600,
      new Date().toISOString(),
      {},
      { name: 'SkyBot · 300 arcsec', color: '#A78BFA', sourceSize: 7 },
      (catalog: any) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        skybotCatalogRef.current = catalog;
        skybotCacheRef.current.set(cacheKey, catalog);
        if (skybotCacheRef.current.size > 32) {
          const oldestKey = skybotCacheRef.current.keys().next().value;
          if (oldestKey) skybotCacheRef.current.delete(oldestKey);
        }
        aladin.addCatalog(catalog);
        setSkybotStatus('live');
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        console.warn('SkyBot query failed:', error);
        useCachedCatalog();
      }
    );

    return () => {
      settled = true;
      window.clearTimeout(timeout);
      if (skybotCatalogRef.current) aladin.removeOverlay?.(skybotCatalogRef.current);
      skybotCatalogRef.current = null;
    };
  }, [ra, dec, aladinReady]);

  // Keep the chosen HiPS survey mounted throughout ordinary zoom so Aladin can
  // reuse its tile pyramid without a mid-zoom survey swap. The 2MASS FITS cutout
  // is reserved for close detail below 0.14°.
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladin) return;
    if (mountedSurveyIdRef.current === activeSurvey) return;
    const surveySpec =
      PHOTOGRAPHIC_SURVEYS.find((s) => s.id === activeSurvey) || PHOTOGRAPHIC_SURVEYS[0];
    try {
      aladin.setImageSurvey(createHiPSSurvey(surveySpec));
      mountedSurveyIdRef.current = surveySpec.id;
    } catch (e) {
      console.warn('Error switching HiPS survey:', e);
    }
  }, [activeSurvey, createHiPSSurvey]);

  // Match IRSA's HiPS-to-FITS close-zoom behavior with an actual 2MASS Ks
  // cutout. The FITS layer is ancillary near-IR context, not SPHEREx data.
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    const viewport = aladinContainerRef.current;
    if (!aladin || !viewport || !aladinReady) return;

    const requestId = ++detailFitsRequestIdRef.current;
    detailFitsAbortControllerRef.current?.abort();
    detailFitsAbortControllerRef.current = null;

    const removeCurrentDetailLayer = () => {
      const currentLayer = detailFitsLayerRef.current;
      if (!currentLayer) return;
      aladin.removeImageLayer(currentLayer.name);
      URL.revokeObjectURL(currentLayer.url);
      detailFitsLayerRef.current = null;
    };

    if (displayFovDeg > DETAIL_FITS_FOV_DEG) {
      removeCurrentDetailLayer();
      return;
    }

    const timer = window.setTimeout(async () => {
      const center = aladin.getRaDec?.();
      const fov = aladin.getFov?.();
      const raCenter = Number(center?.[0]);
      const decCenter = Number(center?.[1]);
      const fovDeg = Array.isArray(fov) ? Math.max(Number(fov[0]), Number(fov[1])) : Number(fov);
      const aspectRatio = viewport.clientWidth / Math.max(1, viewport.clientHeight);

      if (
        !Number.isFinite(raCenter) || !Number.isFinite(decCenter) ||
        !Number.isFinite(fovDeg) || fovDeg <= 0 || !Number.isFinite(aspectRatio)
      ) {
        return;
      }

      const width = Math.max(1, Math.min(
        DETAIL_FITS_MAX_DIMENSION,
        Math.round(aspectRatio >= 1 ? DETAIL_FITS_MAX_DIMENSION : DETAIL_FITS_MAX_DIMENSION * aspectRatio)
      ));
      const height = Math.max(1, Math.min(
        DETAIL_FITS_MAX_DIMENSION,
        Math.round(aspectRatio >= 1 ? DETAIL_FITS_MAX_DIMENSION / aspectRatio : DETAIL_FITS_MAX_DIMENSION)
      ));
      const params = new URLSearchParams({
        hips: 'CDS/P/2MASS/K',
        width: String(width),
        height: String(height),
        projection: 'TAN',
        fov: String(fovDeg),
        ra: String(raCenter),
        dec: String(decCenter),
        coordsys: 'icrs',
        format: 'fits',
      });
      const controller = new AbortController();
      detailFitsAbortControllerRef.current = controller;

      try {
        const response = await fetch(
          `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${params}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`HiPS2FITS returned ${response.status}`);

        const fitsUrl = URL.createObjectURL(await response.blob());
        if (requestId !== detailFitsRequestIdRef.current || controller.signal.aborted) {
          URL.revokeObjectURL(fitsUrl);
          return;
        }

        const layerName = `${DETAIL_FITS_LAYER_PREFIX} ${requestId}`;
        const discardLayer = () => {
          // FITS parsing finishes before Aladin adds the image layer to its view.
          window.setTimeout(() => aladin.removeImageLayer(layerName), 0);
          URL.revokeObjectURL(fitsUrl);
        };
        const onFitsLoaded = () => {
          if (requestId !== detailFitsRequestIdRef.current) {
            discardLayer();
            return;
          }
          removeCurrentDetailLayer();
          detailFitsLayerRef.current = { name: layerName, url: fitsUrl };
        };
        const onFitsError = (error: unknown) => {
          discardLayer();
          if (requestId !== detailFitsRequestIdRef.current) return;
          removeCurrentDetailLayer();
          console.warn('2MASS Ks FITS detail failed to load:', error);
        };

        aladin.displayFITS(
          fitsUrl,
          { name: '2MASS Ks FITS detail · 2.16 µm' },
          onFitsLoaded,
          onFitsError,
          layerName
        );
      } catch (error) {
        if (requestId !== detailFitsRequestIdRef.current) return;
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('2MASS Ks FITS detail request failed:', error);
          removeCurrentDetailLayer();
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      detailFitsAbortControllerRef.current?.abort();
      detailFitsAbortControllerRef.current = null;
      if (requestId === detailFitsRequestIdRef.current) {
        detailFitsRequestIdRef.current += 1;
      }
    };
  }, [aladinReady, dec, displayFovDeg, ra]);

  useEffect(() => () => {
    detailFitsRequestIdRef.current += 1;
    detailFitsAbortControllerRef.current?.abort();
    const aladin = aladinInstanceRef.current;
    const currentLayer = detailFitsLayerRef.current;
    if (aladin && currentLayer) aladin.removeImageLayer(currentLayer.name);
    if (currentLayer) URL.revokeObjectURL(currentLayer.url);
  }, []);

  // Sync camera center when external target coordinates change (e.g. from search bar or catalog selection)
  useEffect(() => {
    const aladin = aladinInstanceRef.current;
    if (!aladin) return;
    const deltaRa = Math.abs(((ra - lastInternalCoordRef.current.ra + 540) % 360) - 180);
    const deltaDec = Math.abs(dec - lastInternalCoordRef.current.dec);
    // Ignore internal movements (< 0.0005 deg) to prevent breaking smooth pan/scroll animations
    if (deltaRa < 0.0005 && deltaDec < 0.0005) {
      return;
    }
    lastInternalCoordRef.current = { ra, dec };
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

  // Synchronize SPHEREx LVF Footprints Overlay (real archive s_region + wide-field DB footprints + optional synthetic)
  useEffect(() => {
    const overlay = footprintOverlayRef.current;
    if (!overlay) return;
    try {
      overlay.removeAll();
      if (showLvfFootprints && typeof A.polygon === 'function') {
        const seenObs = new Set<string>();
        const drawArchiveExp = (exp: IrsaExposure) => {
          if (seenObs.has(exp.obsId)) return;
          seenObs.add(exp.obsId);
          const parsed = parseStcsPolygon(exp.sRegion);
          if (!parsed) return;
          const corners: [number, number][] = parsed.ra.map((r, i) => [r, parsed.dec[i]]);
          const detSpec = SPHEREX_DETECTORS.find(
            (d) => exp.detector.toUpperCase().includes(d.id) || exp.wavelength.toUpperCase().includes(d.id)
          );
          const poly = A.polygon(corners, {
            color: detSpec?.colorHex || '#38BDF8',
            lineWidth: 1.5,
          });
          overlay.add(poly);
        };

        filteredArchiveExposures.forEach(drawArchiveExp);

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
  }, [showLvfFootprints, filteredArchiveExposures, filteredExposures]);

  const isMatchingDownloading = Boolean(matchingDownloadingSection);

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
          color: isMatchingDownloading ? '#F97316' : '#38BDF8',
          lineWidth: isMatchingDownloading ? 2.5 : 1.5,
        });
        overlay.add(poly);
      }
    } catch (e) {
      console.warn('Error updating cutout box overlay:', e);
    }
  }, [showCutoutBox, fovArcsec, ra, dec, isMatchingDownloading]);

  // Direct Zoom Preset Handler
  const applyZoom = useCallback((nextFovDeg: number) => {
    const clamped = Math.max(MIN_SKY_FOV_DEG, Math.min(MAX_SKY_FOV_DEG, nextFovDeg));
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
        isBench ? '[NASA Benchmark (Pre-cached)]' : SIMULATED_PREVIEW_BADGE
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
    <div className="relative flex h-full w-full overflow-hidden bg-background font-sans text-xs text-foreground select-none">
      {/* LEFT 70%: Native Aladin Lite v3 WebGL2 Sky Viewport */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Top Overlay Instrument Toolbar (Modelled after IRSA Firefly Layer & Band Bar) */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="z-20 flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Layer Toggles */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sky overlay layers">
            <Button
              variant={showLvfFootprints ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowLvfFootprints((v) => !v)}
              className={showLvfFootprints ? 'border-primary/50 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}
              title="Toggle SPHEREx Level-2 Linear Variable Filter (LVF) detector footprints"
            >
              LVF Footprints ({filteredArchiveExposures.length + filteredExposures.length})
            </Button>
            <Button
              variant={showAvailableCoverage ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowAvailableCoverage((visible) => !visible)}
              className={showAvailableCoverage ? 'border-yellow-400/50 text-yellow-300 font-medium' : 'text-muted-foreground hover:text-foreground'}
              title="Database-backed SPHEREx DR1 (cyan) & QR3 (gold) HEALPix coverage MOCs with NEP/SEP Deep Field rings"
              aria-pressed={showAvailableCoverage}
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-yellow-400/70" />
              {showAvailableCoverage ? 'DR1/QR3 Coverage Mesh' : 'Coverage Mesh (Off)'}
            </Button>
            <Button
              variant={showInstalledSections ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowInstalledSections((visible) => !visible)}
              className={showInstalledSections ? 'border-emerald-400/50 text-emerald-300 font-medium' : 'text-muted-foreground hover:text-foreground'}
              title="Show installed sky cutout sections stored for instant use across Comparator, Spectral Lab, and Ice Studio"
              aria-pressed={showInstalledSections}
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400/80" />
              Installed ({readyInstalledSections.length})
            </Button>
            {activeDownloadingSections.length > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded border border-orange-500/50 bg-orange-500/15 px-2 py-0.5 font-mono text-[10px] text-orange-300"
                title="Active section downloads remain highlighted in orange while you adjust FoV or pan"
              >
                <span className="inline-block h-2 w-2 rounded-sm bg-orange-400" />
                Downloading ({activeDownloadingSections.length})
              </span>
            )}
            <Button
              variant={showWcsGrid ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowWcsGrid((v) => !v)}
              className={showWcsGrid ? 'border-primary/50 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}
            >
              J2000 Grid
            </Button>
            <Button
              variant={showCutoutBox ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setShowCutoutBox((v) => !v)}
              className={showCutoutBox ? 'border-primary/50 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}
              title="Show true-scale cutout bounding box at target coordinate"
            >
              Cutout Box ({fovArcsec}&quot;)
            </Button>

            {/* Photographic Sky Survey Layer Selector */}
            <div className="flex items-center gap-1.5 ml-1" role="group" aria-label="Photographic survey layer">
              <span className="text-[11px] text-muted-foreground">Survey:</span>
              <Select
                sizeVariant="xs"
                value={activeSurvey}
                onChange={(e) => setActiveSurvey(e.target.value as PhotographicSurveyId)}
                title="Select background photographic survey"
                className="bg-background text-foreground"
              >
                {PHOTOGRAPHIC_SURVEYS.map((surv) => (
                  <option key={surv.id} value={surv.id}>
                    {surv.label} ({surv.badge})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* SPHEREx Detector Band Filter (D1-D6) */}
          <div className="flex items-center gap-1" role="group" aria-label="SPHEREx detector filter">
            <span className="mr-1 text-[11px] text-muted-foreground">Detector:</span>
            <Button
              variant={selectedBandFilter === 'ALL' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setSelectedBandFilter('ALL')}
              className={
                selectedBandFilter === 'ALL'
                  ? 'h-6 px-1.5 font-mono text-[11px] border-primary/50 text-foreground font-medium'
                  : 'h-6 px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground'
              }
            >
              All ({archiveExposures.length})
            </Button>
            {SPHEREX_DETECTORS.map((det) => {
              const count = detectorCounts[det.id] || 0;
              return (
              <Button
                key={det.id}
                variant={selectedBandFilter === det.id ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => {
                  setSelectedBandFilter(det.id);
                  setShowLvfFootprints(true);
                }}
                title={`${det.label} · R=${det.resolvingPower} · ${count} exposures`}
                className={
                  selectedBandFilter === det.id
                    ? 'h-6 px-1.5 font-mono text-[11px] border-primary/50 text-foreground font-medium'
                    : count === 0
                    ? 'h-6 px-1.5 font-mono text-[11px] text-muted-foreground/50 hover:text-foreground'
                    : 'h-6 px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground'
                }
              >
                {det.id} ({count})
              </Button>
              );
            })}
          </div>

          {/* Field of View Zoom Controls */}
          <div className="flex items-center rounded-sm border border-border bg-background p-0.5 gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => applyZoom(displayFovDeg * 0.65)}
              className="font-mono text-xs text-foreground hover:bg-accent"
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => applyZoom(displayFovDeg * 1.5)}
              className="font-mono text-xs text-foreground hover:bg-accent"
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </Button>
            <span className="h-3.5 w-px bg-border" aria-hidden="true" />
            <Button
              variant="ghost"
              size="xs"
              onClick={() => applyZoom(60.0)}
              className="h-6 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              title="Maximum wide-field context (60°)"
            >
              60°
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => applyZoom(18.0)}
              className="h-6 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              title="Wide survey context (18°)"
            >
              18°
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => applyZoom(6.0)}
              className="h-6 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              title="SPHEREx detector array scale (6°)"
            >
              6°
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => applyZoom(1.2)}
              className="h-6 px-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              title="Target field scale (1.2°)"
            >
              1.2°
            </Button>
          </div>
          </div>

          {/* Hamburger Toggle for Floating SPHEREx Coverage Preview Card (pinned right) */}
          <div className="flex shrink-0 items-center">
            <Button
              variant={showCoverageCard ? 'secondary' : 'outline'}
              size="icon-sm"
              onClick={() => setShowCoverageCard((open) => !open)}
              className={showCoverageCard ? 'border-primary/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}
              title="Toggle SPHEREx Coverage Preview card"
              aria-label="Toggle SPHEREx Coverage Preview"
              aria-expanded={showCoverageCard}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </Button>
          </div>
        </div>

        {/* 100% Native Aladin Lite v3 WebGL2 All-Sky HiPS Viewport */}
        <div
          className="relative flex-1 w-full overflow-hidden bg-black"
        >
          {/* Aladin Lite v3 Canvas Container (Receives all drag, scroll, touch, and click events directly) */}
          <div
            ref={aladinContainerRef}
            className="absolute inset-0 h-full w-full"
            style={{ touchAction: 'none' }}
          />

          {!hipsReady && !hipsError && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-neutral-800 bg-neutral-950/85 px-3 py-1 font-mono text-[10px] text-neutral-400 shadow-md backdrop-blur">
              Loading {PHOTOGRAPHIC_SURVEYS.find((survey) => survey.id === activeSurvey)?.label} sky imagery…
            </div>
          )}
          {hipsError && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/90 px-6 text-center font-mono text-xs text-amber-400">
              Survey imagery failed to load. Select another survey or check access to the HiPS image service.
            </div>
          )}

          <div className="pointer-events-none absolute right-3 top-3 z-20 flex gap-2 rounded-lg border border-neutral-800 bg-neutral-950/92 px-2.5 py-1 font-mono text-[9px] text-neutral-400 shadow-sm">
            <span>Gaia DR3: {gaiaStatus}</span>
            <span className="text-neutral-700">|</span>
            <span>SkyBot: {skybotStatus}</span>
          </div>

          {/* Bottom-Right Calibrated Angular Scale Bar */}
          <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1 rounded-lg border border-neutral-800 bg-neutral-950/92 px-2.5 py-1.5 shadow-sm">
            <span className="font-mono text-[10px] tabular-nums text-white">
              Scale: {scaleBar.label} (FoV {formatFieldFov(displayFovDeg)})
            </span>
            <div
              style={{ width: `${scaleBar.widthPx}px` }}
              className="h-1.5 border-b border-l border-r border-white"
            />
          </div>
        </div>

        {/* Bottom 32px High-Frequency Cursor Telemetry Strip */}
        <footer className="z-20 flex h-[34px] items-center justify-between border-t border-border bg-card px-3 text-[11px]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Cursor J2000:</span>
              <span
                ref={cursorRaDecDomRef}
                className="font-mono tabular-nums text-foreground"
              >
                {ra.toFixed(5)}° {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}°
              </span>
            </div>
            <span className="hidden md:inline text-border">|</span>
            <span
              ref={cursorSexaDomRef}
              className="hidden md:inline font-mono tabular-nums text-muted-foreground"
            >
              {sexagesimalTarget}
            </span>
            <span className="hidden lg:inline text-border">|</span>
            <div className="hidden lg:flex items-center gap-1.5">
              <span className="text-muted-foreground">WCS-WAVE at cursor:</span>
              <span
                ref={cursorLvfDomRef}
                className="font-mono tabular-nums text-primary"
              >
                {activeExposure
                  ? `${activeExposure.detector.id} λ=${activeExposure.lambdaAtTargetUm.toFixed(
                      3
                    )} µm (R=${activeExposure.detector.resolvingPower})`
                  : '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
            <span>β_ecl = {coverageDepth.eclipticLatDeg >= 0 ? '+' : ''}{coverageDepth.eclipticLatDeg.toFixed(1)}°</span>
            <span className="text-border">·</span>
            <span className="text-foreground">{coverageDepth.cadenceLabel}</span>
          </div>
        </footer>
      </div>

      {/* FLOATING CARD: SPHEREx Spectral Image Search & Footprint Inspector */}
      {showCoverageCard && (
      <aside
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute right-3 top-12 z-30 flex max-h-[calc(100%-4rem)] w-[360px] xl:w-[410px] flex-col overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
      >
        {/* 1. Target Position & Spatial Cutout Parameters */}
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-foreground">
              SPHEREx Coverage Preview
            </h2>
            <div className="flex items-center gap-1.5">
              <Badge variant="sky" className="font-mono text-[10px]">
                SIMULATED PREVIEW
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowCoverageCard(false)}
                className="h-5 w-5 rounded-md text-muted-foreground hover:text-foreground"
                title="Close SPHEREx Coverage Preview"
                aria-label="Close SPHEREx Coverage Preview"
              >
                ×
              </Button>
            </div>
          </div>

          <div className="mt-2 rounded-sm border border-border bg-background p-2.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">
                {activeTargetName || 'Selected Sky Position'}
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  aladinInstanceRef.current?.gotoRaDec(ra, dec);
                }}
                className="h-5 px-1.5 text-[10px]"
                title="Center sky viewport on active target coordinates"
              >
                Center map
              </Button>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-primary">
              RA {ra.toFixed(5)}° · Dec {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}°
            </div>
            <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {sexagesimalTarget}
            </div>
          </div>

          {/* Direct Coordinate & Cutout Size Form */}
          <form onSubmit={handleManualCoordSubmit} className="mt-2.5 grid grid-cols-12 gap-1.5">
            <div className="col-span-4">
              <label htmlFor="inspector-ra" className="block text-[10px] text-muted-foreground">
                RA (J2000 deg)
              </label>
              <Input
                id="inspector-ra"
                type="text"
                value={raInputStr}
                onChange={(e) => setRaInputStr(e.target.value)}
                className="mt-0.5 h-7 bg-background px-2 py-0.5 font-mono text-xs tabular-nums text-foreground"
              />
            </div>
            <div className="col-span-4">
              <label htmlFor="inspector-dec" className="block text-[10px] text-muted-foreground">
                Dec (J2000 deg)
              </label>
              <Input
                id="inspector-dec"
                type="text"
                value={decInputStr}
                onChange={(e) => setDecInputStr(e.target.value)}
                className="mt-0.5 h-7 bg-background px-2 py-0.5 font-mono text-xs tabular-nums text-foreground"
              />
            </div>
            <div className="col-span-4">
              <label htmlFor="inspector-fov" className="block text-[10px] text-muted-foreground">
                Cutout Size
              </label>
              <Select
                id="inspector-fov"
                sizeVariant="sm"
                value={fovArcsec}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFov(val);
                  setUrlFov(val);
                }}
                className="mt-0.5 w-full bg-background"
              >
                {FOV_CUTOUT_PRESETS.map((f) => (
                  <option key={f} value={f}>
                    {f}&quot; ({f / 60}&apos;)
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-12 mt-1 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                 Pixel scale: 6.2&quot;/px ({Math.round(fovArcsec / 6.2)}×{Math.round(fovArcsec / 6.2)} px stamp)
              </span>
              <Button
                type="submit"
                variant="secondary"
                size="xs"
                className="h-6 px-2 text-[11px]"
              >
                Update Position
              </Button>
            </div>
          </form>

          {/* Explicit Query & Install Controls (No automatic querying on pan) */}
          <div className="mt-2.5 flex flex-col gap-2 border-t border-border/60 pt-2.5">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={checkSelectedCoverage}
                disabled={archiveStatus === 'loading'}
                className="flex-1 h-7 text-[11px]"
              >
                {archiveStatus === 'loading' ? 'Querying IRSA…' : 'Query Selected Coverage'}
              </Button>
              {matchedInstalledSection ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => handleUninstallSection(matchedInstalledSection.section_id)}
                  className="h-7 px-2.5 text-[11px] border-emerald-500/40 text-emerald-300 hover:border-red-500/40 hover:text-red-300"
                  title="Remove installed cutout section from local storage"
                >
                  Installed ✓ · Remove
                </Button>
              ) : matchingDownloadingSection ? (
                <MatchingDownloadStatusButton
                  ra={ra}
                  dec={dec}
                  fovArcsec={fovArcsec}
                  queueState={matchingDownloadingSection.queueState}
                />
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  onClick={handleInstallSection}
                  className="flex-1 h-7 text-[11px]"
                  title={
                    activeDownloadingSections.length > 0
                      ? 'Add this sky section to the install queue'
                      : 'Download and persist this sky section locally'
                  }
                >
                  {activeDownloadingSections.length > 0
                    ? 'Queue Cutout Section'
                    : 'Install Cutout Section'}
                </Button>
              )}
            </div>

            {activeDownloadingSections.length > 0 && (
              <ActiveDownloadsQueuePanel
                installedSections={installedSections}
                onCancelQueued={cancelQueuedInstall}
              />
            )}

            {installError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
                {installError}
              </div>
            )}
          </div>
        </div>

        {/* 1b. Installed Sky Sections Library */}
        <div className="border-b border-border bg-background/60 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-foreground">
              Installed Sections ({readyInstalledSections.length})
            </span>
            <span className="text-[10px] text-muted-foreground">Shared across Tabs 2, 3 &amp; 4</span>
          </div>
          {readyInstalledSections.length === 0 ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Select any sky region and click <strong>Install Cutout Section</strong> to save it for offline/instant use.
            </p>
          ) : (
            <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
              {readyInstalledSections.map((sec) => {
                const isSelected = matchedInstalledSection?.section_id === sec.section_id;
                return (
                  <div
                    key={sec.section_id}
                    className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[10px] ${
                      isSelected ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-border bg-card/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCoordinates(sec.ra, sec.dec, sec.label, sec.source_badge);
                        setRa(sec.ra);
                        setDec(sec.dec);
                        setFov(sec.fov_arcsec);
                        setUrlFov(sec.fov_arcsec);
                        aladinInstanceRef.current?.gotoRaDec?.(sec.ra, sec.dec);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate font-medium text-foreground">{sec.label}</div>
                      <div className="font-mono text-[9px] text-muted-foreground">
                        {sec.fov_arcsec}&quot; · {sec.epochs}ep · {formatSectionBytes(sec.size_bytes)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUninstallSection(sec.section_id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-red-500/20 hover:text-red-300"
                      title="Uninstall section"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. Synchronized SPHEREx Level-2 Spectral Image Table (Hover highlights LVF footprint on sky) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
            <span className="text-[11px] font-medium text-foreground">
              IRSA SPHEREx DR1 + QR3 Archive ({filteredArchiveExposures.length}{selectedBandFilter !== 'ALL' ? ` · ${selectedBandFilter}` : ''})
            </span>
            <span className="text-[10px] text-muted-foreground">
              {archiveStatus === 'idle' && 'Click Query Selected Coverage to check exposures'}
              {archiveStatus === 'loading' && 'Searching IRSA…'}
              {archiveStatus === 'ready' && '[IRSA Live (spherex_dr1 + spherex_qr3)]'}
              {archiveStatus === 'partial' && 'Some IRSA releases unavailable · showing returned coverage'}
              {archiveStatus === 'empty' && 'No released exposure intersects this cutout'}
              {archiveStatus === 'error' && 'IRSA search unavailable · retry after network access returns'}
            </span>
          </div>

          <div className="max-h-48 overflow-y-auto border-b border-border">
            {filteredArchiveExposures.length > 0 && (
              <div className="flex items-center justify-between px-3 py-1 bg-emerald-500/10 border-b border-emerald-500/20 text-[10px] text-emerald-400 font-medium">
                <span className="flex items-center gap-1">
                  <span>✓</span> SPHEREx Coverage Verified ({filteredArchiveExposures.length} exposures)
                </span>
                <span className="text-[9px] text-muted-foreground font-normal">Ready for Time-Domain</span>
              </div>
            )}
            {filteredArchiveExposures.map((exposure) => {
              const cutoutUrl = new URL(exposure.accessUrl);
              cutoutUrl.searchParams.set('center', `${ra},${dec}`);
              cutoutUrl.searchParams.set('size', String(fovArcsec / 3600));
              return (
                <div key={exposure.obsId} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 font-mono text-[10px]">
                  <span className="min-w-0 truncate text-foreground" title={exposure.obsId}>{exposure.obsId}</span>
                  <span className="shrink-0 text-muted-foreground">{exposure.detector}</span>
                  <span className="shrink-0 text-muted-foreground">{exposure.mjd ? `MJD ${exposure.mjd}` : exposure.wavelength}</span>
                  <a className="shrink-0 text-primary hover:underline" href={cutoutUrl.toString()} target="_blank" rel="noreferrer">Open FITS cutout</a>
                </div>
              );
            })}
            {archiveStatus === 'empty' && archiveExposures.length === 0 && (
              <div className="space-y-2 p-3 bg-amber-500/10 border-b border-amber-500/20 text-[11px]">
                <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                  <span>⚠</span>
                  <span>Sky Region Unobserved by SPHEREx Archive</span>
                </div>
                <p className="text-muted-foreground text-[10px] leading-relaxed">
                  The current SPHEREx public release (QR2/QR3) has not yet observed this sky coordinate. Time-domain multi-epoch data cannot be extracted from this unobserved patch.
                </p>
                <div className="pt-1">
                  <div className="text-[10px] font-medium text-foreground mb-1.5">
                    Jump to a verified SPHEREx survey field:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {MANDATORY_BENCHMARKS.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setCoordinates(b.ra, b.dec, b.name, '[NASA Benchmark (Pre-cached)]');
                          setRa(b.ra);
                          setDec(b.dec);
                          aladinInstanceRef.current?.gotoRaDec?.(b.ra, b.dec);
                        }}
                        className="px-2 py-0.5 rounded text-[10px] bg-background/80 hover:bg-primary/20 hover:text-primary border border-border text-foreground transition-colors"
                      >
                        {b.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setCoordinates(NEP_COORDS.ra, NEP_COORDS.dec, NEP_COORDS.label, '[IRSA Live (Deep Field)]');
                        setRa(NEP_COORDS.ra);
                        setDec(NEP_COORDS.dec);
                        aladinInstanceRef.current?.gotoRaDec?.(NEP_COORDS.ra, NEP_COORDS.dec);
                      }}
                      className="px-2 py-0.5 rounded text-[10px] bg-background/80 hover:bg-amber-400/20 hover:text-amber-300 border border-border text-amber-400 transition-colors"
                    >
                      NEP Deep Field
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCoordinates(SEP_COORDS.ra, SEP_COORDS.dec, SEP_COORDS.label, '[IRSA Live (Deep Field)]');
                        setRa(SEP_COORDS.ra);
                        setDec(SEP_COORDS.dec);
                        aladinInstanceRef.current?.gotoRaDec?.(SEP_COORDS.ra, SEP_COORDS.dec);
                      }}
                      className="px-2 py-0.5 rounded text-[10px] bg-background/80 hover:bg-amber-400/20 hover:text-amber-300 border border-border text-amber-400 transition-colors"
                    >
                      SEP Deep Field
                    </button>
                  </div>
                </div>
              </div>
            )}
            {archiveStatus === 'error' && (
              <a
                className="inline-block px-3 py-2 text-[10px] text-primary hover:underline"
                href={`https://irsa.ipac.caltech.edu/applications/spherex/?api=spectral-images&ra=${ra}&dec=${dec}&sr=${Math.max(fovArcsec, 60)}s`}
                target="_blank"
                rel="noreferrer"
              >Open this position in the IRSA SPHEREx Data Explorer</a>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
              <span>Synthetic geometry preview · off by default</span>
              <Button
                variant="link"
                size="xs"
                className="text-primary text-[10px]"
                onClick={() => setShowSyntheticPreview((visible) => !visible)}
              >
                {showSyntheticPreview ? 'Hide synthetic preview' : 'Show synthetic preview'}
              </Button>
            </div>
            <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
              <thead className="sticky top-0 z-10 border-b border-border bg-card font-sans text-[10px] text-muted-foreground">
                <tr>
                  <th className="py-1.5 pl-3 pr-1.5 font-medium">Band</th>
                  <th className="px-1.5 py-1.5 font-medium">Pass / MJD</th>
                  <th className="px-1.5 py-1.5 text-right font-medium">λ (µm)</th>
                  <th className="px-1.5 py-1.5 text-right font-medium">Roll ψ</th>
                  <th className="py-1.5 pl-1.5 pr-3 text-right font-medium">Zodi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
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
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-1.5">
                        <span
                          style={{ borderColor: exp.detector.colorHex }}
                          className="inline-block rounded-sm border bg-background px-1.5 py-0.2 text-[10px] font-medium text-foreground"
                        >
                          {exp.detector.id}
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <div className="text-foreground">P{exp.passNumber} · {exp.mjd.toFixed(1)}</div>
                        <div className="text-[9px] text-muted-foreground">{exp.obsId}</div>
                      </td>
                      <td className="px-1.5 py-1.5 text-right text-primary">
                        <div>{exp.lambdaAtTargetUm.toFixed(3)}</div>
                        <div className="text-[9px] text-muted-foreground">±{exp.bandwidthUm.toFixed(3)}</div>
                      </td>
                      <td className="px-1.5 py-1.5 text-right">{exp.rollAngleDeg.toFixed(1)}°</td>
                      <td className="py-1.5 pl-1.5 pr-3 text-right text-muted-foreground">
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
            <div className="border-t border-border bg-background px-3 py-2 text-[11px]">
              <div className="flex items-center justify-between text-foreground">
                <span className="font-mono text-[10px] text-primary">{activeExposure.obsId} · Synthetic</span>
                <span className="font-mono text-[10px] text-muted-foreground">{activeExposure.dateUtc}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  HDU 6 WCS-WAVE: <strong className="font-mono text-foreground">{activeExposure.lambdaAtTargetUm} µm</strong> (R={activeExposure.detector.resolvingPower})
                </span>
                <span>
                  HDU 4 ZODI: <strong className="font-mono text-foreground">{activeExposure.zodiMjySr} MJy/sr</strong>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 3. Explicit User-Initiated Workspace Actions (Zero Auto-Redirects) */}
        <div className="border-t border-border bg-card p-3">
          <div className="flex flex-col gap-2">
            <Button
              variant={matchedInstalledSection ? 'default' : 'secondary'}
              size="default"
              disabled={!matchedInstalledSection && Boolean(matchingDownloadingSection)}
              onClick={() => {
                setRa(ra);
                setDec(dec);
                setUrlFov(fovArcsec);
                setTab('comparator');
              }}
              className="w-full text-xs font-medium"
            >
              {matchedInstalledSection
                ? `Open Installed ${matchedInstalledSection.fov_arcsec}" Section in Comparator →`
                : `Open ${fovArcsec}" Selection in Time-Domain Comparator →`}
            </Button>
            <Button
              variant="outline"
              size="default"
              onClick={() => setTab('spectral')}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              {matchedInstalledSection
                ? 'Inspect Installed 102-Channel Spectrum in Spectral Lab'
                : 'Extract 102-Channel Spectrum in Spectral Lab'}
            </Button>
          </div>
        </div>
      </aside>
      )}
    </div>
  );
};
