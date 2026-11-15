/**
 * Spectra Tab 4: SPLICES Molecular & Ice Mapping Studio.
 *
 * Specification Anchors:
 * - SPECIFICATION.md §1.3 Audit #10 (point-source background-star workflow)
 * - SPECIFICATION.md §2.4 (verified laboratory A-values)
 * - SPECIFICATION.md §6.3.4 (Tab 4: Molecular & Ice Mapping Studio)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, Select } from '../components/ui';
import { ActiveCaseBanner } from '../components/ActiveCaseBanner';
import { CutoutProbeMinimap } from '../components/CutoutProbeMinimap';
import {
  InstalledCutoutsModal,
  UseCurrentSelectedButton,
} from '../components/InstalledCutoutsModal';
import {
  fetchInstalledSections,
  fetchStaticSectionSpectrum,
  findMatchingSection,
  useInstalledSectionState,
  type InstalledSection,
} from '../lib/installedSections';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';

export interface IceTarget {
  id: string;
  name: string;
  ra: number;
  dec: number;
  catalog: string;
  environment: string;
  badge: string;
  isBrownDwarf?: boolean;
}

export type IceKey = 'h2o' | 'co2' | 'co2_13' | 'co' | 'ch3oh';
type SpectralFidelity = 'true_102_ch' | 'broadband_6_interpolated';

export interface IceBand {
  key: IceKey;
  species: string;
  label: string;
  centerUm: number;
  windowUm: [number, number];
  aValue: number;
  citation: string;
  detector: string;
  sigmaCm1: number;
  color: string;
}

export interface IceColumnResult {
  key: IceKey;
  species: string;
  centerUm: number;
  aValue: number;
  integratedTauCm1: number | null;
  columnDensity: number | null;
  suppressed: boolean;
}

export interface IceSolution {
  wavelengthsUm: number[];
  flux: number[];
  continuum: number[];
  tau: number[];
  bands: IceColumnResult[];
  ratioPercent: number | null;
  brownDwarfNotice: string | null;
}

export interface SpectrumSource {
  wavelengthsUm: number[];
  flux: number[];
  badge: string;
  fidelity: SpectralFidelity;
  coverage?: boolean[];
}

export const ICE_BANDS: IceBand[] = [
  {
    key: 'h2o',
    species: 'H2O',
    label: 'Water ice (O-H stretch)',
    centerUm: 3.05,
    windowUm: [2.8, 3.35],
    aValue: 2.0e-16,
    citation: 'Gerakines et al. (1995)',
    detector: 'D4',
    sigmaCm1: 110,
    color: '#38bdf8',
  },
  {
    key: 'co2',
    species: 'CO2',
    label: 'Carbon dioxide ice (nu3)',
    centerUm: 4.27,
    windowUm: [4.22, 4.32],
    aValue: 7.6e-17,
    citation: 'Gerakines et al. (1995)',
    detector: 'D5',
    sigmaCm1: 8,
    color: '#f59e0b',
  },
  {
    key: 'co2_13',
    species: '13CO2',
    label: 'Carbon-13 dioxide ice',
    centerUm: 4.38,
    windowUm: [4.34, 4.42],
    aValue: 7.8e-17,
    citation: 'Boogert et al. (2000)',
    detector: 'D5',
    sigmaCm1: 6,
    color: '#fb7185',
  },
  {
    key: 'co',
    species: 'CO',
    label: 'Carbon monoxide ice (C=O stretch)',
    centerUm: 4.67,
    windowUm: [4.6, 4.75],
    aValue: 1.1e-17,
    citation: 'Jiang et al. (1975)',
    detector: 'D6',
    sigmaCm1: 8,
    color: '#a78bfa',
  },
  {
    key: 'ch3oh',
    species: 'CH3OH',
    label: 'Methanol ice (C-H stretch)',
    centerUm: 3.54,
    windowUm: [3.42, 3.66],
    aValue: 5.3e-18,
    citation: 'Kerkhof et al. (1999)',
    detector: 'D4',
    sigmaCm1: 30,
    color: '#34d399',
  },
];

export const CONTINUUM_WINDOWS_UM: Array<[number, number]> = [
  [2.1, 2.4],
  [3.7, 3.9],
];

export const PHOTOSPHERIC_CH4_UM = 3.32;
export const PHOTOSPHERIC_CH4_NOTICE =
  'Scientific notice: the 3.32 um CH4 feature in WISE 0855-0714 and Epsilon Indi B is ' +
  'photospheric gas, not solid interstellar ice. Laboratory solid-ice A-values are not ' +
  'applied to brown-dwarf photospheres, and spurious ice column densities are suppressed.';

export const ICE_CLOUD_SIGHTLINES: IceTarget[] = [
  {
    id: 'elias16_taurus',
    name: 'Elias 16 (Taurus Dark Cloud)',
    ra: 69.91125,
    dec: 26.19028,
    catalog: 'Taurus Molecular Cloud',
    environment: 'Reddened background K-giant · classic H2O/CO2 ice sightline',
    badge: '[IRSA Live]',
  },
  {
    id: 'j110621_cham',
    name: 'J110621 (Chamaeleon I Cloud)',
    ra: 166.59042,
    dec: -77.39819,
    catalog: 'Chamaeleon I (JWST Ice Age)',
    environment: 'Background star behind dense cloud core · H2O/CO2/CO ices',
    badge: '[IRSA Live]',
  },
  {
    id: 'm42_orion',
    name: 'Orion Nebula (M42 / Trapezium)',
    ra: 83.82208,
    dec: -5.39111,
    catalog: 'Orion Molecular Cloud',
    environment: 'Star-forming cloud complex · icy dust & PAH sightlines',
    badge: '[IRSA Live]',
  },
];

export const BROWN_DWARF_GUARD_TARGETS: IceTarget[] = [
  {
    id: 'wise_0855',
    name: 'WISE 0855-0714',
    ra: 133.73712,
    dec: -7.24038,
    catalog: 'NASA Benchmark Guardrail',
    environment: 'Y4 cold brown dwarf - photospheric CH4',
    badge: '[IRSA Archive]',
    isBrownDwarf: true,
  },
  {
    id: 'eps_indi_b',
    name: 'Epsilon Indi B',
    ra: 331.09566,
    dec: -56.80031,
    catalog: 'NASA Benchmark Guardrail',
    environment: 'T1+T6 unresolved brown-dwarf binary - photospheric CH4',
    badge: '[IRSA Archive]',
    isBrownDwarf: true,
  },
];

// --------------------------------------------------------------------------------------
// Pure numerical helpers
// --------------------------------------------------------------------------------------

export function wavenumberCm1(wavelengthUm: number): number {
  return 10000 / wavelengthUm;
}

function chebyshevBasis(x: number, order: number): number[] {
  const values = [1];
  if (order >= 1) values.push(x);
  for (let index = 2; index <= order; index++) {
    values.push(2 * x * values[index - 1] - values[index - 2]);
  }
  return values;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-15) continue;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let k = column; k <= size; k++) augmented[column][k] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let k = column; k <= size; k++) augmented[row][k] -= factor * augmented[column][k];
    }
  }
  return augmented.map((row) => row[size]);
}

export function fitChebyshevContinuum(
  wavelengthsUm: number[],
  flux: number[],
  order = 4
): number[] {
  const minimum = Math.min(...wavelengthsUm);
  const maximum = Math.max(...wavelengthsUm);
  const span = maximum > minimum ? maximum - minimum : 1;
  const xAll = wavelengthsUm.map((wave) => (2 * (wave - minimum)) / span - 1);

  let active = wavelengthsUm.map(
    (wave) =>
      CONTINUUM_WINDOWS_UM.some(([low, high]) => wave >= low && wave <= high)
  );
  if (active.filter(Boolean).length < order + 2) active = wavelengthsUm.map(() => true);

  let coefficients = new Array(order + 1).fill(0) as number[];
  for (let iteration = 0; iteration < 3; iteration++) {
    const normal = Array.from({ length: order + 1 }, () => new Array(order + 1).fill(0));
    const rhs = new Array(order + 1).fill(0);
    const design: number[][] = [];
    const observed: number[] = [];
    wavelengthsUm.forEach((_, index) => {
      if (!active[index]) return;
      const basis = chebyshevBasis(xAll[index], order);
      design.push(basis);
      observed.push(flux[index]);
      for (let row = 0; row <= order; row++) {
        rhs[row] += basis[row] * flux[index];
        for (let column = 0; column <= order; column++) {
          normal[row][column] += basis[row] * basis[column];
        }
      }
    });
    if (design.length < order + 1) break;

    const trace = normal.reduce((sum, row, index) => sum + row[index], 0);
    const scale = trace / (order + 1);
    for (let index = 3; index <= order; index++) normal[index][index] += 1e-4 * scale * 10;

    coefficients = solveLinearSystem(normal, rhs);
    const residuals = design.map((basis, index) => {
      const model = basis.reduce((sum, value, k) => sum + value * coefficients[k], 0);
      return observed[index] - model;
    });
    const mean = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
    const variance =
      residuals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / residuals.length;
    const scatter = Math.sqrt(variance);
    if (!Number.isFinite(scatter) || scatter <= 0) break;
    let changed = false;
    const nextActive = [...active];
    let cursor = 0;
    active.forEach((isActive, index) => {
      if (!isActive) return;
      if (Math.abs(residuals[cursor]) > 3 * scatter) {
        nextActive[index] = false;
        changed = true;
      }
      cursor += 1;
    });
    active = nextActive;
    if (!changed) break;
  }

  return xAll.map((x) => {
    const basis = chebyshevBasis(x, order);
    return Math.max(
      1e-12,
      basis.reduce((sum, value, index) => sum + value * coefficients[index], 0)
    );
  });
}

export function computeOpticalDepth(flux: number[], continuum: number[]): number[] {
  return flux.map((value, index) =>
    -Math.log(Math.max(1e-4, value / Math.max(1e-12, continuum[index])))
  );
}

export function integrateTauWavenumber(
  wavelengthsUm: number[],
  tau: number[],
  windowUm: [number, number]
): number {
  const points: Array<{ nu: number; tau: number }> = [];
  wavelengthsUm.forEach((wave, index) => {
    if (wave < windowUm[0] || wave > windowUm[1]) return;
    if (!Number.isFinite(tau[index])) return;
    points.push({ nu: wavenumberCm1(wave), tau: Math.max(0, tau[index]) });
  });
  if (points.length < 2) return 0;
  points.sort((left, right) => left.nu - right.nu);
  let integral = 0;
  for (let index = 1; index < points.length; index++) {
    integral +=
      0.5 *
      (points[index].tau + points[index - 1].tau) *
      (points[index].nu - points[index - 1].nu);
  }
  return Math.max(0, integral);
}

export function isBrownDwarfTarget(name: string | null, ra: number, dec: number): boolean {
  const normalised = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalised.includes('wise0855') || normalised.includes('epsilonindib') || normalised.includes('epsindib')) {
    return true;
  }
  const separation = (ra1: number, dec1: number, ra2: number, dec2: number) => {
    const deltaRa = ((ra1 - ra2 + 180 + 360) % 360) - 180;
    const projected = deltaRa * Math.cos((((dec1 + dec2) / 2) * Math.PI) / 180);
    return Math.hypot(projected, dec1 - dec2) * 3600;
  };
  return (
    separation(ra, dec, 133.73712, -7.24038) < 30 ||
    separation(ra, dec, 331.09566, -56.80031) < 30
  );
}

export function analyzeIceProfile(
  target: IceTarget,
  wavelengthsUm: number[],
  flux: number[]
): IceSolution {
  const continuum = fitChebyshevContinuum(wavelengthsUm, flux);
  const tau = computeOpticalDepth(flux, continuum);
  const brownDwarf = target.isBrownDwarf || isBrownDwarfTarget(target.name, target.ra, target.dec);
  const bands: IceColumnResult[] = ICE_BANDS.map((band) => {
    const integral = integrateTauWavenumber(wavelengthsUm, tau, band.windowUm);
    return {
      key: band.key,
      species: band.species,
      centerUm: band.centerUm,
      aValue: band.aValue,
      integratedTauCm1: brownDwarf ? null : integral,
      columnDensity: brownDwarf ? null : integral / band.aValue,
      suppressed: brownDwarf,
    };
  });
  const water = bands.find((band) => band.key === 'h2o');
  const carbonDioxide = bands.find((band) => band.key === 'co2');
  const ratioPercent =
    !brownDwarf && water?.columnDensity && carbonDioxide?.columnDensity !== null
      ? (100 * (carbonDioxide?.columnDensity || 0)) / water.columnDensity
      : null;
  return {
    wavelengthsUm,
    flux,
    continuum,
    tau,
    bands,
    ratioPercent,
    brownDwarfNotice: brownDwarf ? PHOTOSPHERIC_CH4_NOTICE : null,
  };
}

function formatColumnDensity(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toExponential(2);
}

function distanceArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const deltaRa = ((ra1 - ra2 + 180 + 360) % 360) - 180;
  const projected = deltaRa * Math.cos((((dec1 + dec2) / 2) * Math.PI) / 180);
  return Math.hypot(projected, dec1 - dec2) * 3600;
}

function inferFidelity(payload: any): SpectralFidelity {
  const raw = payload?.provenance?.spectral_fidelity;
  if (raw === 'true_102_ch') return 'true_102_ch';
  const method = String(payload?.provenance?.method || '').toLowerCase();
  if (method.includes('hdu 5') || method.includes('wcs-wave')) return 'true_102_ch';
  return 'broadband_6_interpolated';
}

function resolveInitialTarget(
  readySections: Array<{ section_id: string; label: string; ra: number; dec: number; source_badge?: string }>,
  activeName: string | null,
  ra: number,
  dec: number
): IceTarget {
  const exactMatch =
    readySections.find(
      (section) => Math.abs(section.ra - ra) < 1e-4 && Math.abs(section.dec - dec) < 1e-4
    ) ||
    readySections.find(
      (section) => distanceArcsec(section.ra, section.dec, ra, dec) < 0.2
    );
  const bySection = exactMatch || findMatchingSection(readySections as any, ra, dec) || readySections[0];
  if (bySection) {
    const brownDwarf = isBrownDwarfTarget(bySection.label, bySection.ra, bySection.dec);
    return {
      id: bySection.section_id,
      name: bySection.label,
      ra: bySection.ra,
      dec: bySection.dec,
      catalog: 'Installed IRSA Section',
      environment: brownDwarf ? 'Brown dwarf - photospheric CH4 guardrail' : 'Point-source line of sight',
      badge: `[Installed] ${bySection.source_badge || '[IRSA Live]'}`,
      isBrownDwarf: brownDwarf,
    };
  }
  const guardMatch = [...ICE_CLOUD_SIGHTLINES, ...BROWN_DWARF_GUARD_TARGETS].find(
    (target) =>
      distanceArcsec(ra, dec, target.ra, target.dec) < 30 ||
      (activeName || '').toLowerCase().includes(target.name.toLowerCase())
  );
  if (guardMatch) return guardMatch;
  const brownDwarf = isBrownDwarfTarget(activeName, ra, dec);
  return {
    id: `coord_${ra.toFixed(4)}_${dec.toFixed(4)}`,
    name: activeName || `J2000 ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`,
    ra,
    dec,
    catalog: 'Active Sky Coordinate',
    environment: brownDwarf ? 'Brown dwarf - photospheric CH4 guardrail' : 'Point-source line of sight',
    badge: '[IRSA Live]',
    isBrownDwarf: brownDwarf,
  };
}

// --------------------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------------------

export const MolecularIceStudio: React.FC = () => {
  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    colorPalette,
    currentSelectedSection,
    setCurrentSelectedSection,
    probedPixel,
    setProbedPixel,
    setProbeSkyPosition,
    apertureRadiusPx,
    skyAnnulusInnerPx,
    skyAnnulusOuterPx,
    setIceAperture,
    setCaseFindings,
  } = useTelemetryStore();

  const {
    setTab,
    setRa: setUrlRa,
    setDec: setUrlDec,
    setFov: setUrlFov,
    setProbeX: setUrlProbeX,
    setProbeY: setUrlProbeY,
  } = useSpectraUrlState();

  const [selectedLiveId, setSelectedLiveId] = useState<string>('elias16_taurus');
  const [selectedSource, setSelectedSource] = useState<'primary' | 'sky'>('primary');
  const [mode, setMode] = useState<'transmission' | 'raw' | 'tau'>('transmission');
  const [waveZoom, setWaveZoom] = useState<'ice' | 'full'>('ice');
  const [sourceMode, setSourceMode] = useState<'installed' | 'live'>('installed');
  const { installedSections } = useInstalledSectionState();
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [isCutoutBrowserOpen, setIsCutoutBrowserOpen] = useState(false);
  const [forceFullResolutionKey, setForceFullResolutionKey] = useState<string | null>(null);
  const [liveSpectrum, setLiveSpectrum] = useState<SpectrumSource | null>(null);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [liveStatusMessage, setLiveStatusMessage] = useState('');
  const [activeBands, setActiveBands] = useState<IceKey[]>(['h2o', 'co2', 'co2_13', 'co', 'ch3oh']);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showLabDetails, setShowLabDetails] = useState(false);
  const [ledgerState, setLedgerState] = useState<'idle' | 'submitting' | 'logged' | 'offline'>('idle');
  const [ledgerNote, setLedgerNote] = useState('');

  // Debounced aperture values so typing/sliding triggers smooth tensor photometry
  const [debouncedAperture, setDebouncedAperture] = useState({
    r: apertureRadiusPx,
    inR: skyAnnulusInnerPx,
    outR: skyAnnulusOuterPx,
  });
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedAperture({ r: apertureRadiusPx, inR: skyAnnulusInnerPx, outR: skyAnnulusOuterPx });
    }, 150);
    return () => window.clearTimeout(id);
  }, [apertureRadiusPx, skyAnnulusInnerPx, skyAnnulusOuterPx]);

  const readyInstalledSections = useMemo(
    () => installedSections.filter((s) => s.status === 'ready'),
    [installedSections]
  );

  const activeInstalledSection = useMemo(
    () => readyInstalledSections.find((s) => s.section_id === selectedSectionId) || null,
    [readyInstalledSections, selectedSectionId]
  );

  const handleCloseCutoutBrowser = useCallback(() => setIsCutoutBrowserOpen(false), []);

  const handleSelectInstalledSection = useCallback(
    (chosen: InstalledSection) => {
      setSourceMode('installed');
      setForceFullResolutionKey(null);
      setSelectedSectionId(chosen.section_id);
      setCurrentSelectedSection(chosen);
      setLedgerState('idle');
      setLedgerNote('');
      setUrlRa(Number(chosen.ra.toFixed(5)));
      setUrlDec(Number(chosen.dec.toFixed(5)));
      setUrlFov(Math.round(chosen.fov_arcsec || 300));
      useTelemetryStore.setState({
        ra: chosen.ra,
        dec: chosen.dec,
        activeTargetName: chosen.label,
        probeSkyPosition: { ra: chosen.ra, dec: chosen.dec },
      });
    },
    [setUrlRa, setUrlDec, setUrlFov, setCurrentSelectedSection]
  );

  const handleSelectIcySightline = useCallback(
    (target: IceTarget) => {
      setSourceMode('live');
      setForceFullResolutionKey(null);
      setSelectedLiveId(target.id);
      setLedgerState('idle');
      setLedgerNote('');
      setUrlRa(Number(target.ra.toFixed(5)));
      setUrlDec(Number(target.dec.toFixed(5)));
      useTelemetryStore.setState({
        ra: target.ra,
        dec: target.dec,
        activeTargetName: target.name,
        probeSkyPosition: { ra: target.ra, dec: target.dec },
      });
    },
    [setUrlRa, setUrlDec]
  );

  const handleMinimapPixelSelect = useCallback(
    (px: number, py: number, skyCoord: { ra: number; dec: number }) => {
      setForceFullResolutionKey(null);
      setProbedPixel({ x: px, y: py });
      setProbeSkyPosition(skyCoord);
      setUrlProbeX(px);
      setUrlProbeY(py);
    },
    [setProbedPixel, setProbeSkyPosition, setUrlProbeX, setUrlProbeY]
  );

  useEffect(() => {
    if (installedSections.length === 0) {
      void fetchInstalledSections();
    }
  }, [installedSections.length]);

  useEffect(() => {
    if (readyInstalledSections.length === 0) {
      setSelectedSectionId('');
      return;
    }
    const exactMatch =
      readyInstalledSections.find(
        (section) => Math.abs(section.ra - ra) < 1e-4 && Math.abs(section.dec - dec) < 1e-4
      ) ||
      readyInstalledSections.find(
        (section) => distanceArcsec(section.ra, section.dec, ra, dec) < 0.2
      );
    if (exactMatch) {
      setSelectedSectionId(exactMatch.section_id);
      return;
    }
    const fallbackMatch = findMatchingSection(readyInstalledSections, ra, dec);
    if (fallbackMatch) {
      setSelectedSectionId(fallbackMatch.section_id);
    } else if (!selectedSectionId) {
      setSelectedSectionId(readyInstalledSections[0].section_id);
    }
  }, [readyInstalledSections, ra, dec, selectedSectionId]);

  const liveTargets = useMemo<IceTarget[]>(() => {
    const activeCoordTarget: IceTarget = {
      id: 'active_coord',
      name: activeTargetName || `J2000 ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°`,
      ra,
      dec,
      catalog: 'Active Telemetry Coordinate',
      environment: isBrownDwarfTarget(activeTargetName, ra, dec)
        ? 'Brown dwarf - photospheric CH4 guardrail'
        : 'Point-source line of sight',
      badge: '[IRSA Live]',
      isBrownDwarf: isBrownDwarfTarget(activeTargetName, ra, dec),
    };
    return [...ICE_CLOUD_SIGHTLINES, activeCoordTarget, ...BROWN_DWARF_GUARD_TARGETS];
  }, [activeTargetName, ra, dec]);

  useEffect(() => {
    const exactLiveTarget =
      liveTargets.find(
        (target) => target.id !== 'active_coord' && distanceArcsec(target.ra, target.dec, ra, dec) < 2.0
      ) || null;
    if (exactLiveTarget) {
      setSelectedLiveId((prev) => (prev === exactLiveTarget.id ? prev : exactLiveTarget.id));
    }
  }, [liveTargets, ra, dec]);

  const selectedTarget = useMemo<IceTarget>(() => {
    if (sourceMode === 'installed' && !forceFullResolutionKey) {
      const activeSec =
        readyInstalledSections.find((s) => s.section_id === selectedSectionId) ||
        readyInstalledSections.find(
          (s) => Math.abs(s.ra - ra) < 1e-4 && Math.abs(s.dec - dec) < 1e-4
        ) ||
        findMatchingSection(readyInstalledSections, ra, dec) ||
        readyInstalledSections[0];
      if (activeSec) {
        return resolveInitialTarget([activeSec], activeSec.label, activeSec.ra, activeSec.dec);
      }
    }
    const picked =
      liveTargets.find((t) => t.id === selectedLiveId) ||
      liveTargets.find((t) => distanceArcsec(t.ra, t.dec, ra, dec) < 2.0) ||
      liveTargets[0];
    if (picked) return picked;
    return resolveInitialTarget(readyInstalledSections, activeTargetName, ra, dec);
  }, [
    sourceMode,
    forceFullResolutionKey,
    readyInstalledSections,
    selectedSectionId,
    ra,
    dec,
    liveTargets,
    selectedLiveId,
    activeTargetName,
  ]);

  // Fetch installed tensor aperture photometry OR full 102-channel HDU 6 WCS-WAVE extraction
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const coordKey = `${selectedTarget.ra.toFixed(5)},${selectedTarget.dec.toFixed(5)}`;
    const forceLiveFull = forceFullResolutionKey === coordKey;
    setLiveSpectrum(null);
    setHoverIdx(null);
    setLiveStatus('loading');
    setLiveStatusMessage(
      forceLiveFull || sourceMode === 'live'
        ? `Querying full 102-ch HDU 6 spectrum for ${selectedTarget.name}…`
        : `Computing ${selectedSource === 'sky' ? 'sky ring' : 'aperture'} photometry on cutout…`
    );

    const fetchSourceSpectrum = async () => {
      try {
        let payload: any;
        if (sourceMode === 'installed' && !forceLiveFull) {
          const activeSec =
            readyInstalledSections.find((s) => s.section_id === selectedSectionId) ||
            findMatchingSection(readyInstalledSections, ra, dec) ||
            readyInstalledSections[0];
          if (!activeSec) {
            if (!cancelled) {
              setLiveStatus('idle');
              setLiveSpectrum(null);
            }
            return;
          }
          const qs = new URLSearchParams({
            normalize: 'false',
            sample_mode: selectedSource,
            aperture_radius: String(debouncedAperture.r),
            annulus_inner: String(debouncedAperture.inR),
            annulus_outer: String(debouncedAperture.outR),
          });
          if (probedPixel) {
            qs.set('px', String(probedPixel.x));
            qs.set('py', String(probedPixel.y));
          }
          try {
            const res = await fetch(`/api/sections/${activeSec.section_id}/spectrum?${qs.toString()}`, {
              signal: controller.signal,
            });
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            if (res.ok && !contentType.includes('text/html')) {
              payload = await res.json();
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
          }
          if (!payload) {
            payload = await fetchStaticSectionSpectrum(activeSec.section_id, controller.signal);
          }
          if (!payload) throw new Error('Installed cutout spectrum unavailable');
        } else {
          // Try full_resolution synchronous /spectrum first (or queued task fallback)
          const response = await fetch('/api/spectrum/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ ra: selectedTarget.ra, dec: selectedTarget.dec, normalize: false }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const { task_id: taskId } = await response.json();
          while (!cancelled) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            const poll = await fetch(`/api/spectrum/tasks/${taskId}`, { signal: controller.signal });
            if (!poll.ok) throw new Error(`HTTP ${poll.status}`);
            const task = await poll.json();
            if (!cancelled && task.message) setLiveStatusMessage(task.message);
            if (task.status === 'error') throw new Error(task.message || 'Live spectrum unavailable');
            if (task.status === 'complete') {
              payload = task.result;
              break;
            }
          }
        }
        if (cancelled || !payload) return;
        const sourceBadge = payload.provenance?.source_badge;
        const isValidBadge =
          typeof sourceBadge === 'string' &&
          (/^\[Installed\]/.test(sourceBadge) || /^\[IRSA Live \(.+\)\]$/.test(sourceBadge));
        if (
          !isValidBadge ||
          !Array.isArray(payload.wavelengths_um) ||
          payload.wavelengths_um.length < 102 ||
          !Array.isArray(payload.flux_jy) ||
          payload.flux_jy.length < 102 ||
          !Array.isArray(payload.channel_coverage)
        ) {
          throw new Error('Malformed spectrum payload');
        }
        setLiveSpectrum({
          wavelengthsUm: payload.wavelengths_um,
          flux: payload.flux_jy.map((flux: number, i: number) =>
            payload.channel_coverage[i] ? flux : Number.NaN
          ),
          badge: sourceBadge as string,
          fidelity: inferFidelity(payload),
          coverage: payload.channel_coverage,
        });
        setLiveStatus('ready');
        setLiveStatusMessage('');
      } catch (err) {
        if (!cancelled) {
          setLiveStatus('error');
          setLiveStatusMessage(err instanceof Error ? err.message : 'Spectrum unavailable');
        }
      }
    };
    void fetchSourceSpectrum();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    selectedTarget.ra,
    selectedTarget.dec,
    selectedTarget.name,
    sourceMode,
    forceFullResolutionKey,
    selectedSectionId,
    readyInstalledSections,
    ra,
    dec,
    selectedSource,
    debouncedAperture.r,
    debouncedAperture.inR,
    debouncedAperture.outR,
    probedPixel?.x,
    probedPixel?.y,
  ]);

  const activeSpectrum: SpectrumSource = useMemo(() => {
    if (liveSpectrum) return liveSpectrum;
    return {
      wavelengthsUm: [],
      flux: [],
      fidelity: 'broadband_6_interpolated',
      badge:
        liveStatus === 'loading'
          ? '[Extracting Spectrum…]'
          : liveStatus === 'error'
            ? '[Spectrum Unavailable]'
            : '[No Archive Data]',
    };
  }, [liveSpectrum, liveStatus]);

  const solution = useMemo(() => {
    const wavelengths = activeSpectrum.coverage
      ? activeSpectrum.wavelengthsUm.filter((_, i) => activeSpectrum.coverage?.[i])
      : activeSpectrum.wavelengthsUm;
    const flux = activeSpectrum.coverage
      ? activeSpectrum.flux.filter(
          (_, i) => activeSpectrum.coverage?.[i] && Number.isFinite(activeSpectrum.flux[i])
        )
      : activeSpectrum.flux;
    if (wavelengths.length < 5) {
      return {
        wavelengthsUm: wavelengths,
        flux,
        continuum: [],
        tau: [],
        ratioPercent: null,
        brownDwarfNotice: null,
        bands: ICE_BANDS.map((band) => ({
          key: band.key,
          species: band.species,
          centerUm: band.centerUm,
          aValue: band.aValue,
          integratedTauCm1: null,
          columnDensity: null,
          suppressed: true,
        })),
      };
    }
    return analyzeIceProfile(selectedTarget, wavelengths, flux);
  }, [activeSpectrum, selectedTarget]);

  const effectiveSolution = useMemo(() => {
    if (selectedSource !== 'sky') return solution;
    return {
      ...solution,
      bands: solution.bands.map((band) => ({
        ...band,
        integratedTauCm1: null,
        columnDensity: null,
        suppressed: true,
      })),
      ratioPercent: null,
    };
  }, [selectedSource, solution]);

  const skySelected = selectedSource === 'sky';
  const h2oDensity = effectiveSolution.bands.find((b) => b.key === 'h2o')?.columnDensity ?? null;
  const co2Density = effectiveSolution.bands.find((b) => b.key === 'co2')?.columnDensity ?? null;
  const maxBandTau = useMemo(
    () => solution.tau.reduce((mx, v) => (Number.isFinite(v) ? Math.max(mx, v) : mx), 0),
    [solution.tau]
  );
  const iceDetected =
    !skySelected &&
    !effectiveSolution.brownDwarfNotice &&
    activeSpectrum.fidelity === 'true_102_ch' &&
    ((h2oDensity !== null && h2oDensity >= 1e16) || (co2Density !== null && co2Density >= 1e15) || maxBandTau >= 0.08);

  // Sync Ice Studio verdict back into Active Case
  useEffect(() => {
    const targetKey =
      sourceMode === 'installed' && activeInstalledSection
        ? activeInstalledSection.section_id
        : `${selectedTarget.ra.toFixed(4)},${selectedTarget.dec.toFixed(4)}`;
    let summary = 'Awaiting 102-ch spectrum';
    if (effectiveSolution.brownDwarfNotice) {
      summary = 'CH₄ brown dwarf (no solid ice)';
    } else if (skySelected) {
      summary = 'Inspecting sky ring glow';
    } else if (activeSpectrum.fidelity !== 'true_102_ch') {
      summary = '6-band preview (extract 102-ch for ice)';
    } else if (iceDetected && h2oDensity !== null) {
      summary = `Ice detected · CO₂/H₂O ${effectiveSolution.ratioPercent?.toFixed(0) ?? '—'}%`;
    } else if (solution.wavelengthsUm.length >= 5) {
      summary = 'Clear sightline (no solid ice)';
    }
    setCaseFindings(
      {
        iceSummary: summary,
        iceDetected,
        iceRatioPercent: effectiveSolution.ratioPercent,
      },
      targetKey
    );
  }, [
    sourceMode,
    activeInstalledSection,
    selectedTarget.ra,
    selectedTarget.dec,
    effectiveSolution.brownDwarfNotice,
    effectiveSolution.ratioPercent,
    skySelected,
    activeSpectrum.fidelity,
    iceDetected,
    h2oDensity,
    solution.wavelengthsUm.length,
    setCaseFindings,
  ]);

  const toggleBand = (key: IceKey) => {
    setActiveBands((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    );
  };

  const lamMin = waveZoom === 'ice' ? 2.4 : 0.75;
  const lamMax = 5.0;
  const lamSpan = lamMax - lamMin;

  const selectedBands = effectiveSolution.bands.filter((band) => activeBands.includes(band.key));
  const maxTau = Math.max(0.4, ...solution.tau.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0)));

  // Scale flux across visible wavelength zoom window so mid-IR 2.4-5.0 um never gets crushed to 0.000
  const maxFlux = useMemo(() => {
    let mx = 1e-6;
    solution.wavelengthsUm.forEach((w, idx) => {
      if (w < lamMin || w > lamMax) return;
      const f = solution.flux[idx];
      const c = solution.continuum[idx];
      if (Number.isFinite(f)) mx = Math.max(mx, f);
      if (Number.isFinite(c)) mx = Math.max(mx, c);
    });
    return mx;
  }, [solution.wavelengthsUm, solution.flux, solution.continuum, lamMin, lamMax]);

  const transmission = useMemo(
    () => solution.tau.map((value) => Math.exp(-Math.max(0, value))),
    [solution.tau]
  );

  // Measure % starlight blocked in key molecular windows (0-100%)
  const blockedPctForWindow = useCallback(
    (win: [number, number]): number | null => {
      let maxBlocked = 0;
      let hits = 0;
      solution.wavelengthsUm.forEach((w, idx) => {
        if (w < win[0] || w > win[1]) return;
        const tr = transmission[idx];
        if (!Number.isFinite(tr)) return;
        hits += 1;
        maxBlocked = Math.max(maxBlocked, Math.max(0, Math.min(100, (1 - tr) * 100)));
      });
      return hits > 0 ? maxBlocked : null;
    },
    [solution.wavelengthsUm, transmission]
  );

  const h2oBlockedPct = useMemo(() => blockedPctForWindow([2.85, 3.25]), [blockedPctForWindow]);
  const co2BlockedPct = useMemo(() => blockedPctForWindow([4.22, 4.32]), [blockedPctForWindow]);

  const xForWave = useCallback(
    (wave: number) => 58 + ((wave - lamMin) / lamSpan) * 838,
    [lamMin, lamSpan]
  );

  const plotPoints = (values: number[], maximum: number): string => {
    if (solution.wavelengthsUm.length === 0 || values.length === 0) return '';
    return solution.wavelengthsUm
      .map((wave, index) => {
        if (wave < lamMin || wave > lamMax) return null;
        const val = values[index];
        if (!Number.isFinite(wave) || !Number.isFinite(val)) return null;
        const x = xForWave(wave);
        const y = 326 - (Math.max(0, val) / maximum) * 282;
        return `${x.toFixed(1)},${Math.max(24, Math.min(326, y)).toFixed(1)}`;
      })
      .filter((pt): pt is string => pt !== null)
      .join(' ');
  };

  // Shaded missing-light valley hanging below 100% roof in Transmission mode
  const transmissionValleyPath = useMemo(() => {
    if (mode !== 'transmission' || solution.wavelengthsUm.length < 2) return '';
    const roofY = 326 - 282; // y = 44 (100% baseline)
    const pts: Array<{ x: number; y: number }> = [];
    solution.wavelengthsUm.forEach((wave, index) => {
      if (wave < lamMin || wave > lamMax) return;
      const tr = transmission[index];
      if (!Number.isFinite(wave) || !Number.isFinite(tr)) return;
      const x = xForWave(wave);
      const y = Math.max(roofY, Math.min(326, 326 - Math.max(0, Math.min(1, tr)) * 282));
      pts.push({ x, y });
    });
    if (pts.length < 2) return '';
    const poly = [
      `${pts[0].x.toFixed(1)},${roofY.toFixed(1)}`,
      ...pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `${pts[pts.length - 1].x.toFixed(1)},${roofY.toFixed(1)}`,
    ];
    return poly.join(' ');
  }, [mode, solution.wavelengthsUm, transmission, lamMin, lamMax, xForWave]);

  // Highlight ice-absorption area (where baseline > observed) in Starlight vs Baseline mode
  const absorptionShadingPath = useMemo(() => {
    if (mode !== 'raw' || solution.wavelengthsUm.length < 2) return '';
    const upperPts: string[] = [];
    const lowerPts: string[] = [];
    solution.wavelengthsUm.forEach((wave, index) => {
      if (wave < lamMin || wave > lamMax) return;
      const f = solution.flux[index];
      const c = solution.continuum[index];
      if (!Number.isFinite(wave) || !Number.isFinite(f) || !Number.isFinite(c)) return;
      const x = xForWave(wave);
      const yCont = Math.max(24, Math.min(326, 326 - (Math.max(0, c) / maxFlux) * 282));
      const yObs = Math.max(24, Math.min(326, 326 - (Math.max(0, Math.min(f, c)) / maxFlux) * 282));
      upperPts.push(`${x.toFixed(1)},${yCont.toFixed(1)}`);
      lowerPts.unshift(`${x.toFixed(1)},${yObs.toFixed(1)}`);
    });
    return upperPts.length >= 2 ? [...upperPts, ...lowerPts].join(' ') : '';
  }, [mode, solution.wavelengthsUm, solution.flux, solution.continuum, maxFlux, lamMin, lamMax, xForWave]);

  const hoverPointInfo = useMemo(() => {
    if (hoverIdx === null) return null;
    const wave = solution.wavelengthsUm[hoverIdx];
    const tr = transmission[hoverIdx];
    const tauVal = solution.tau[hoverIdx];
    if (!Number.isFinite(wave)) return null;
    const nearBand = ICE_BANDS.find((b) => wave >= b.windowUm[0] && wave <= b.windowUm[1]);
    const ch4Near = Math.abs(wave - PHOTOSPHERIC_CH4_UM) <= 0.14;
    const label = nearBand
      ? `${nearBand.species} (${nearBand.label})`
      : ch4Near
        ? 'Methane (CH₄) brown-dwarf gas zone'
        : 'Continuum baseline (clean starlight)';
    const blocked = Number.isFinite(tr) ? Math.max(0, Math.min(100, (1 - tr) * 100)) : null;
    return { wave, tr, tauVal, label, blocked };
  }, [hoverIdx, solution.wavelengthsUm, transmission, solution.tau]);

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (solution.wavelengthsUm.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      const viewX = ((e.clientX - rect.left) / rect.width) * 940;
      const wave = lamMin + ((viewX - 58) / 838) * lamSpan;
      if (wave < lamMin || wave > lamMax) {
        setHoverIdx(null);
        return;
      }
      let best = -1;
      let bestDist = Infinity;
      solution.wavelengthsUm.forEach((w, idx) => {
        if (w < lamMin || w > lamMax) return;
        const d = Math.abs(w - wave);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      });
      setHoverIdx(best >= 0 ? best : null);
    },
    [solution.wavelengthsUm, lamMin, lamSpan, lamMax]
  );

  const handleSubmitLedger = useCallback(async () => {
    setLedgerState('submitting');
    setLedgerNote('');
    let observerId = localStorage.getItem('spx_observer_id');
    let observerKey = localStorage.getItem('spx_observer_key');
    if (!observerId && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      observerId = crypto.randomUUID();
      localStorage.setItem('spx_observer_id', observerId);
    }
    if (!observerKey && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      observerKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('spx_observer_key', observerKey);
    }
    const nH2O = effectiveSolution.bands.find((band) => band.key === 'h2o');
    const nCO2 = effectiveSolution.bands.find((band) => band.key === 'co2');
    const body = effectiveSolution.brownDwarfNotice
      ? `${PHOTOSPHERIC_CH4_NOTICE} Sightline: ${selectedTarget.name}. No solid-ice column density is reported.`
      : `SPLICES point-source ice ledger: N(H2O) = ${formatColumnDensity(nH2O?.columnDensity ?? null)} cm^-2, ` +
        `N(CO2) = ${formatColumnDensity(nCO2?.columnDensity ?? null)} cm^-2, ` +
        `CO2/H2O = ${effectiveSolution.ratioPercent?.toFixed(2) ?? '—'}%. ` +
        `Aperture ${apertureRadiusPx.toFixed(1)} px; sky annulus ` +
        `${skyAnnulusInnerPx.toFixed(1)}-${skyAnnulusOuterPx.toFixed(1)} px; ` +
        `source ${activeSpectrum.badge}.`;
    try {
      const response = await fetch('/api/forum/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(observerId ? { 'X-Observer-ID': observerId } : {}),
          ...(observerKey ? { 'X-Observer-Key': observerKey } : {}),
        },
        body: JSON.stringify({
          title: `SPLICES ice ledger — ${selectedTarget.name}`,
          body,
          ra: selectedTarget.ra,
          dec: selectedTarget.dec,
          fovArcsec: 180,
          renderMode: 'coadd',
          targetName: selectedTarget.name,
          classification: 'interstellar_ice',
          confidencePct: effectiveSolution.brownDwarfNotice ? 0 : 88,
          classificationVote: effectiveSolution.brownDwarfNotice ? null : 'ice_source',
          channel: 'ices',
          hashtags: effectiveSolution.brownDwarfNotice ? [] : ['#ice_source'],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLedgerState('logged');
      setLedgerNote('Molecular ice ledger entry submitted to Community Discussions (#ice_source).');
    } catch {
      setLedgerState('offline');
      setLedgerNote('Forum endpoint unavailable — failed to submit ledger entry.');
    }
  }, [
    effectiveSolution,
    apertureRadiusPx,
    skyAnnulusInnerPx,
    skyAnnulusOuterPx,
    activeSpectrum.badge,
    selectedTarget,
  ]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-xs text-foreground">
      <ActiveCaseBanner activeLens="ice" sectionLabel={selectedTarget.name} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* LEFT PANEL — Sightline Selection & Live Spatial Aperture */}
        <section className="flex w-full lg:w-[380px] xl:w-[410px] shrink-0 flex-col gap-3 lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-border p-3 sm:p-4">
          <div data-tour="ice-sightline-picker" className="rounded-lg border border-border bg-card p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  1. Pick Sightline Source
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Test real molecular-cloud stars or your active cutout
                </div>
              </div>
              <Select
                value={sourceMode}
                onChange={(event) => {
                  setSourceMode(event.target.value as 'installed' | 'live');
                  setForceFullResolutionKey(null);
                  setLedgerState('idle');
                  setLedgerNote('');
                }}
                sizeVariant="xs"
                aria-label="Ice spectrum source mode"
              >
                <option value="installed">Installed Cutouts ({readyInstalledSections.length})</option>
                <option value="live">Icy Cloud Sightlines</option>
              </Select>
            </div>

            {currentSelectedSection && (
              <UseCurrentSelectedButton
                section={currentSelectedSection}
                isActive={
                  sourceMode === 'installed' &&
                  !forceFullResolutionKey &&
                  selectedSectionId === currentSelectedSection.section_id
                }
                colorPalette={colorPalette}
                onSelect={handleSelectInstalledSection}
              />
            )}

            {sourceMode === 'installed' && readyInstalledSections.length > 0 && (
              <button
                type="button"
                onClick={() => setIsCutoutBrowserOpen(true)}
                aria-label="Browse installed sections for Ice Studio"
                className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-2.5 text-xs font-medium text-emerald-200 hover:border-emerald-400/60 hover:bg-emerald-900/50 cursor-pointer"
              >
                <span className="truncate">
                  {activeInstalledSection ? activeInstalledSection.label : 'Browse Installed'}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-emerald-300/90">
                  ({readyInstalledSections.length})
                </span>
              </button>
            )}

            {/* Quick Icy Cloud Sightline Chips */}
            <div className="pt-1 border-t border-border/60 space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                Recommended Cosmic Ice Sightlines
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ICE_CLOUD_SIGHTLINES.map((site) => {
                  const isActive =
                    sourceMode === 'live' && selectedLiveId === site.id;
                  return (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => handleSelectIcySightline(site)}
                      className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${
                        isActive
                          ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                          : 'border-border bg-secondary/70 text-neutral-300 hover:border-cyan-500/40 hover:text-white'
                      }`}
                      title={site.environment}
                    >
                      {site.name.split(' (')[0]}
                    </button>
                  );
                })}
              </div>
            </div>

            {sourceMode === 'live' && (
              <Select
                id="splices-target"
                value={selectedLiveId}
                onChange={(event) => {
                  const chosen = liveTargets.find((t) => t.id === event.target.value);
                  if (chosen) handleSelectIcySightline(chosen);
                }}
                sizeVariant="xs"
                aria-label="Choose live coordinate target"
              >
                {liveTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({target.ra.toFixed(2)}°, {target.dec >= 0 ? '+' : ''}
                    {target.dec.toFixed(2)}°)
                  </option>
                ))}
              </Select>
            )}
          </div>

          <CutoutProbeMinimap
            section={sourceMode === 'installed' ? activeInstalledSection : null}
            colorPalette={colorPalette}
            probePixel={probedPixel ?? { x: 24, y: 24 }}
            fallbackRa={selectedTarget.ra}
            fallbackDec={selectedTarget.dec}
            fallbackFovArcsec={fovArcsec}
            onSelectPixel={handleMinimapPixelSelect}
            showApertureOverlay={sourceMode === 'installed'}
            apertureRadiusPx={apertureRadiusPx}
            annulusInnerPx={skyAnnulusInnerPx}
            annulusOuterPx={skyAnnulusOuterPx}
            caption="Click background star to place green aperture & sky ring"
          />

          {/* Interactive Aperture & Sky Annulus Photometry */}
          <div data-tour="ice-aperture-check" className="rounded-lg border border-border bg-card p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                2. Star Beam vs Empty Sky Check
              </span>
              <Badge variant={selectedSource === 'primary' ? 'emerald' : 'amber'} className="font-mono text-[10px]">
                {selectedSource === 'primary' ? 'Star − Sky' : 'Sky Ring Only'}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input
                  type="radio"
                  name="ice-source"
                  checked={selectedSource === 'primary'}
                  onChange={() => setSelectedSource('primary')}
                  className="accent-emerald-400"
                />
                <span>
                  <strong className="text-neutral-200">Star Beam</strong>{' '}
                  <span className="text-muted-foreground">(light shining through cloud)</span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input
                  type="radio"
                  name="ice-source"
                  checked={selectedSource === 'sky'}
                  onChange={() => setSelectedSource('sky')}
                  className="accent-amber-400"
                />
                <span>
                  <strong className="text-neutral-200">Empty Sky Ring</strong>{' '}
                  <span className="text-muted-foreground">(check glow beside star)</span>
                </span>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="text-[10px] text-muted-foreground">
                Star r [px]
                <Input
                  type="number"
                  min={0.5}
                  max={4}
                  step={0.1}
                  value={apertureRadiusPx}
                  onChange={(event) =>
                    setIceAperture(
                      Math.max(0.5, Math.min(4, Number(event.target.value) || 1.5)),
                      skyAnnulusInnerPx,
                      skyAnnulusOuterPx
                    )
                  }
                  className="mt-1"
                />
              </label>
              <label className="text-[10px] text-muted-foreground">
                Sky in [px]
                <Input
                  type="number"
                  min={1}
                  max={8}
                  step={0.1}
                  value={skyAnnulusInnerPx}
                  onChange={(event) => {
                    const nextIn = Math.max(1, Math.min(8, Number(event.target.value) || 3));
                    setIceAperture(apertureRadiusPx, nextIn, Math.max(nextIn + 0.5, skyAnnulusOuterPx));
                  }}
                  className="mt-1"
                />
              </label>
              <label className="text-[10px] text-muted-foreground">
                Sky out [px]
                <Input
                  type="number"
                  min={2}
                  max={12}
                  step={0.1}
                  value={skyAnnulusOuterPx}
                  onChange={(event) =>
                    setIceAperture(
                      apertureRadiusPx,
                      skyAnnulusInnerPx,
                      Math.max(skyAnnulusInnerPx + 0.5, Math.min(12, Number(event.target.value) || 5))
                    )
                  }
                  className="mt-1"
                />
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Sanity test: ice valleys should appear in the Star Beam (through the cloud), NOT in the empty amber Sky Ring around it.
            </p>
          </div>
        </section>

        {/* RIGHT PANEL — Flashlight Through Cosmic Ice Lab */}
        <section className="flex min-w-0 flex-1 flex-col gap-3 lg:overflow-y-auto p-3 sm:p-4">
          {/* Plain-English Ice Verdict Hero */}
          <div
            className={`rounded-xl border p-3.5 ${
              effectiveSolution.brownDwarfNotice || skySelected || liveStatus === 'error'
                ? 'border-amber-500/40 bg-amber-950/20'
                : iceDetected
                  ? 'border-cyan-500/40 bg-gradient-to-r from-cyan-950/35 via-card to-card'
                  : 'border-border bg-card'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">
                    3. Cosmic Ice Verdict
                  </span>
                  <Badge
                    variant={activeSpectrum.fidelity === 'true_102_ch' ? 'sky' : 'amber'}
                    className="font-mono text-[10px]"
                  >
                    {activeSpectrum.fidelity === 'true_102_ch'
                      ? 'True 102-Ch HDU 6'
                      : '6-Band Cutout Preview'}
                  </Badge>
                  <Badge variant="muted" className="font-mono text-[10px]">
                    {activeSpectrum.badge}
                  </Badge>
                </div>

                <h2 className="mt-1 text-base font-semibold text-foreground">
                  {liveStatus === 'error'
                    ? `No SPHEREx Archive Coverage Yet at ${selectedTarget.name}`
                    : effectiveSolution.brownDwarfNotice
                      ? 'False-Positive Guard: Methane Gas (Brown Dwarf), Not Solid Ice'
                      : skySelected
                        ? 'Inspecting Empty Sky Ring (Surrounding Cloud Glow Only)'
                        : activeSpectrum.fidelity !== 'true_102_ch'
                          ? `Broadband Preview for ${selectedTarget.name}`
                          : iceDetected
                            ? `Solid Ice Absorption Detected along ${selectedTarget.name}`
                            : `Clear Sightline: No Solid Ice Above Noise at ${selectedTarget.name}`}
                </h2>

                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {liveStatus === 'error' ? (
                    <>
                      IRSA SPHEREx DR1 returned no overlapping exposures for this exact sky coordinate ({liveStatusMessage}). Switch to an installed Taurus star-forming cutout like <strong className="text-neutral-200">RW Aurigae</strong> to inspect real cutout light right away.
                    </>
                  ) : effectiveSolution.brownDwarfNotice ? (
                    <>
                      {selectedTarget.name} is an isolated nearby brown dwarf, not a background star behind a cloud. Its 3.32 µm dip comes from warm atmospheric methane gas (CH₄), so solid-ice measurements are suppressed.
                    </>
                  ) : skySelected ? (
                    <>
                      Sky-ring pixels sample empty cloud glow beside the star rather than starlight shining through ice, so ice totals are suppressed until you switch back to Star Beam.
                    </>
                  ) : activeSpectrum.fidelity !== 'true_102_ch' ? (
                    <>
                      Installed cutout cubes only measure 6 broad bands (D1–D6), which smooth out narrow CO₂ (4.27 µm) and CO (4.67 µm) dips. Extract all 102 HDU 6 channels from IRSA to quantify exact column densities.
                    </>
                  ) : iceDetected ? (
                    <>
                      Starlight dips sharply inside cosmic ice wavelengths (H₂O blocked{' '}
                      <strong className="text-sky-300">
                        {h2oBlockedPct !== null ? `${h2oBlockedPct.toFixed(0)}%` : '—'}
                      </strong>
                      {effectiveSolution.ratioPercent !== null && (
                        <>
                          {' '}
                          · CO₂ / H₂O ={' '}
                          <strong className="text-cyan-300">
                            {effectiveSolution.ratioPercent.toFixed(1)}%
                          </strong>
                        </>
                      )}
                      ).
                    </>
                  ) : (
                    <>
                      {selectedTarget.environment}. Pick a molecular-cloud star or Taurus/Orion sightline to measure frozen H₂O &amp; CO₂ valleys.
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const rwSec = readyInstalledSections.find((s) =>
                    s.label.toLowerCase().includes('rw aurigae')
                  );
                  if (!rwSec || (sourceMode === 'installed' && selectedSectionId === rwSec.section_id)) {
                    return null;
                  }
                  return (
                    <Button
                      variant="outline"
                      size="xs"
                      title="Load pre-installed Taurus cloud target RW Aurigae to inspect real frozen ice dips right away"
                      onClick={() => handleSelectInstalledSection(rwSec)}
                    >
                      Try RW Aurigae (Taurus Cloud)
                    </Button>
                  );
                })()}
                {activeSpectrum.fidelity !== 'true_102_ch' && liveStatus !== 'error' && (
                  <Button
                    size="xs"
                    title="Download all 102 infrared wavelength colors from NASA IRSA to resolve narrow H₂O (3.05 µm), CO₂ (4.27 µm), and CO (4.67 µm) ice dips"
                    onClick={() => {
                      const coordKey = `${selectedTarget.ra.toFixed(5)},${selectedTarget.dec.toFixed(5)}`;
                      setForceFullResolutionKey(coordKey);
                    }}
                  >
                    Extract Full 102-Ch (IRSA)
                  </Button>
                )}
                {effectiveSolution.brownDwarfNotice && (
                  <Button
                    variant="outline"
                    size="xs"
                    title="Jump to 102-Band Spectrum to see this brown dwarf's 3.3 µm methane gas dip"
                    onClick={() => setTab('spectral')}
                  >
                    Inspect Brown Dwarf in Spectrum →
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  title="Return to Time-Domain to blink multi-month photos of this sky field"
                  onClick={() => setTab('comparator')}
                >
                  ← Time-Domain
                </Button>
              </div>
            </div>
          </div>

          {/* 1-Line Flashlight Mental Model */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/15 px-3 py-2 text-[11px]">
            <div className="font-mono text-[10px] text-cyan-200">
              ☀️ Background Star &nbsp;──▶&nbsp; ❄️ Cold Ice Cloud &nbsp;──▶&nbsp; 🛰️ SPHEREx Telescope
            </div>
            <div className="text-neutral-300">
              Valleys hanging below <strong className="text-emerald-300">100%</strong> show colors swallowed by frozen molecules along the beam.
            </div>
          </div>

          {/* Interactive 3-Step Visual Story Chart */}
          <div data-tour="ice-studio-transmission" className="rounded-lg border border-border bg-black/60 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-sm border border-border">
                  <button
                    type="button"
                    onClick={() => setMode('transmission')}
                    title="Recommended beginner view: shows what % of starlight makes it through without being swallowed by ice (dips below 100% = ice)"
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      mode === 'transmission'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-background text-muted-foreground hover:text-white'
                    }`}
                  >
                    1. % Light Passing Through
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('raw')}
                    title="Compare raw measured starlight brightness against the smooth clean baseline curve"
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      mode === 'raw' ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground hover:text-white'
                    }`}
                  >
                    2. Starlight vs. Baseline
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('tau')}
                    title="Optical depth (τ): flips dips upside down as upward spikes so taller peaks mean thicker frozen ice"
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      mode === 'tau' ? 'bg-sky-500/20 text-sky-300' : 'bg-background text-muted-foreground hover:text-white'
                    }`}
                  >
                    3. Absorption Spikes (τ)
                  </button>
                </div>

                <div className="flex overflow-hidden rounded-sm border border-border">
                  <button
                    type="button"
                    onClick={() => setWaveZoom('ice')}
                    className={`px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer ${
                      waveZoom === 'ice'
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'bg-background text-muted-foreground hover:text-white'
                    }`}
                    title="Zoom into 2.4–5.0 µm where frozen water (H₂O), dry ice (CO₂), and CO ice dips appear"
                  >
                    Ice Zone (2.4–5 µm)
                  </button>
                  <button
                    type="button"
                    onClick={() => setWaveZoom('full')}
                    title="Zoom out across all 0.75–5.0 µm SPHEREx colors to see the smooth warm starlight baseline on the left"
                    className={`px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer ${
                      waveZoom === 'full'
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'bg-background text-muted-foreground hover:text-white'
                    }`}
                  >
                    Full (0.75–5 µm)
                  </button>
                </div>
              </div>

              {/* Explicit Chart Legend */}
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-neutral-300">
                {mode === 'transmission' && (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-amber-300">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-amber-400" />
                      Expected clean starlight (100%)
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-300">
                      <span className="inline-block h-0.5 w-4 bg-emerald-400" />
                      Observed starlight
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sky-300">
                      <span className="inline-block h-2.5 w-3 rounded-xs bg-cyan-400/25 border border-cyan-400/40" />
                      Absorbed by ice
                    </span>
                  </>
                )}
                {mode === 'raw' && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-amber-400" />
                      Expected clean starlight
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4 bg-sky-400" />
                      Observed starlight
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-3 rounded-xs bg-sky-400/25 border border-sky-400/40" />
                      Absorbed by ice
                    </span>
                  </>
                )}
                {mode === 'tau' && (
                  <span className="inline-flex items-center gap-1.5 text-sky-300">
                    <span className="inline-block h-0.5 w-4 bg-sky-400" />
                    Optical depth τ (taller spike = denser ice)
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {ICE_BANDS.map((band) => (
                <button
                  key={band.key}
                  type="button"
                  onClick={() => toggleBand(band.key)}
                  aria-pressed={activeBands.includes(band.key)}
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] transition-colors cursor-pointer ${
                    activeBands.includes(band.key)
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  {band.species} {band.centerUm.toFixed(2)} µm
                </button>
              ))}
            </div>

            <svg
              className="h-[260px] sm:h-[290px] w-full cursor-crosshair"
              viewBox="0 0 940 350"
              preserveAspectRatio="none"
              role="img"
              aria-label="Optical depth and continuum comparison versus wavelength"
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {[0.25, 0.5, 0.75, 1.0].map((fraction) => {
                const y = 326 - fraction * 282;
                const useMjy = maxFlux < 0.05;
                const rawVal = fraction * maxFlux * (useMjy ? 1000 : 1);
                return (
                  <g key={fraction}>
                    <line
                      x1="58"
                      y1={y}
                      x2="896"
                      y2={y}
                      stroke={mode === 'transmission' && fraction === 1.0 ? '#f59e0b' : '#262626'}
                      strokeWidth={mode === 'transmission' && fraction === 1.0 ? '1.3' : '1'}
                      strokeDasharray={mode === 'transmission' && fraction === 1.0 ? '5,4' : undefined}
                    />
                    <text x="52" y={y + 3} textAnchor="end" fill="#A3A3A3" fontSize="10" fontFamily="monospace">
                      {mode === 'tau'
                        ? (fraction * maxTau).toFixed(2)
                        : mode === 'transmission'
                          ? `${Math.round(fraction * 100)}%`
                          : rawVal >= 10
                            ? rawVal.toFixed(1)
                            : rawVal.toFixed(2)}
                    </text>
                  </g>
                );
              })}
              {mode === 'raw' && (
                <text x="52" y="16" textAnchor="end" fill="#737373" fontSize="9" fontFamily="monospace">
                  {maxFlux < 0.05 ? 'mJy' : 'Jy'}
                </text>
              )}
              <line x1="58" y1="326" x2="896" y2="326" stroke="#737373" strokeWidth="1" />
              <line x1="58" y1="24" x2="58" y2="326" stroke="#737373" strokeWidth="1" />
              {(waveZoom === 'ice'
                ? [2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
                : [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
              ).map((wave) => {
                const x = xForWave(wave);
                return (
                  <g key={wave}>
                    <line x1={x} y1="24" x2={x} y2="326" stroke="#1f1f1f" strokeWidth="1" />
                    <text x={x} y="344" textAnchor="middle" fill="#A3A3A3" fontSize="10" fontFamily="monospace">
                      {wave.toFixed(1)}
                    </text>
                  </g>
                );
              })}
              {ICE_BANDS.filter(
                (band) => activeBands.includes(band.key) && band.centerUm >= lamMin && band.centerUm <= lamMax
              ).map((band, idx) => {
                const x = xForWave(band.centerUm);
                const labelY = idx % 2 === 0 ? 34 : 48;
                return (
                  <g key={band.key}>
                    <line x1={x} y1="24" x2={x} y2="326" stroke={band.color} strokeDasharray="3,3" opacity={0.55} />
                    <text x={x + 4} y={labelY} fill={band.color} fontSize="10" fontFamily="monospace">
                      {band.species}
                    </text>
                  </g>
                );
              })}
              {solution.wavelengthsUm.length === 0 ? (
                <text x="477" y="175" textAnchor="middle" fill="#A3A3A3" fontSize="12" fontFamily="monospace">
                  {liveStatus === 'loading'
                    ? liveStatusMessage || 'Extracting archive spectrum…'
                    : liveStatus === 'error'
                      ? 'No IRSA exposures at this coordinate — try RW Aurigae or an installed cutout'
                      : 'No archive spectrum loaded — select an installed cutout or sightline'}
                </text>
              ) : mode === 'tau' ? (
                <polyline fill="none" stroke="#38bdf8" strokeWidth="2" points={plotPoints(solution.tau, maxTau)} />
              ) : mode === 'transmission' ? (
                <>
                  {transmissionValleyPath && (
                    <polygon points={transmissionValleyPath} fill="rgba(34, 211, 238, 0.22)" />
                  )}
                  <polyline fill="none" stroke="#34d399" strokeWidth="2.1" points={plotPoints(transmission, 1.0)} />
                </>
              ) : (
                <>
                  {absorptionShadingPath && (
                    <polygon points={absorptionShadingPath} fill="rgba(56, 189, 248, 0.2)" />
                  )}
                  <polyline
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                    points={plotPoints(solution.continuum, maxFlux)}
                  />
                  <polyline fill="none" stroke="#38bdf8" strokeWidth="2" points={plotPoints(solution.flux, maxFlux)} />
                </>
              )}
              {hoverPointInfo && (
                <line
                  x1={xForWave(hoverPointInfo.wave)}
                  y1="24"
                  x2={xForWave(hoverPointInfo.wave)}
                  y2="326"
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  strokeDasharray="2,2"
                />
              )}
              <text x="477" y="14" textAnchor="middle" fill="#A3A3A3" fontSize="10" fontFamily="monospace">
                Wavelength λ [µm] · {lamMin.toFixed(2)}–5.00 µm
              </text>
            </svg>

            {/* Live Hover Wavelength Translator */}
            <div className="min-h-[28px] rounded-md border border-white/10 bg-neutral-900/75 px-2.5 py-1.5 text-[11px] flex flex-wrap items-center justify-between gap-2">
              {hoverPointInfo ? (
                <>
                  <span className="text-neutral-200">
                    <strong className="font-mono text-white">{hoverPointInfo.wave.toFixed(2)} µm</strong> ·{' '}
                    {hoverPointInfo.label}
                  </span>
                  <span className="font-mono text-[10px] text-cyan-300">
                    {hoverPointInfo.blocked !== null
                      ? `${(100 - hoverPointInfo.blocked).toFixed(0)}% passing through (${hoverPointInfo.blocked.toFixed(0)}% blocked)`
                      : ''}
                  </span>
                </>
              ) : (
                <span className="text-neutral-400">
                  Hover across the curve to read how much starlight each ice color blocks at this sightline.
                </span>
              )}
            </div>

            {/* Live Plain-English Ice Chart Reader */}
            {solution.wavelengthsUm.length >= 5 && (
              <div className="rounded-md border border-white/10 bg-neutral-900/50 p-2.5 text-[11px] space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">
                  What This Graph Is Telling You
                </div>
                <p className="text-neutral-200 leading-relaxed">
                  {effectiveSolution.brownDwarfNotice ? (
                    <>
                      • <strong className="text-white">False-positive alert:</strong> Any dip near 3.3 µm here comes from hot methane gas inside a brown dwarf — not frozen ice between stars.
                    </>
                  ) : skySelected ? (
                    <>
                      • <strong className="text-white">Sky Ring sanity check:</strong> Compare this curve against Star Beam — if empty space shows no deep 3.05 / 4.27 µm valley, any ice dip in Star Beam is truly absorbing starlight.
                    </>
                  ) : (
                    <>
                      • <strong className="text-white">Missing starlight valleys:</strong> Water ice (3.05 µm) blocks up to{' '}
                      <strong className="text-sky-300">
                        {h2oBlockedPct !== null ? `${h2oBlockedPct.toFixed(0)}%` : '—'}
                      </strong>{' '}
                      of light, and dry ice CO₂ (4.27 µm) blocks up to{' '}
                      <strong className="text-amber-300">
                        {co2BlockedPct !== null ? `${co2BlockedPct.toFixed(0)}%` : '—'}
                      </strong>
                      .
                    </>
                  )}
                </p>
                {activeSpectrum.fidelity !== 'true_102_ch' && (
                  <p className="text-amber-200/90 leading-relaxed">
                    • <strong className="text-amber-200">Preview fidelity:</strong> Cutout pixels average across 6 wide bands, so sharp valleys look shallower until you run 102-channel IRSA extraction.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Human-Readable Column Density Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Water Ice — H₂O (3.05 µm)</div>
              <div className="mt-1 font-mono text-base font-semibold text-sky-300">
                {effectiveSolution.brownDwarfNotice || skySelected
                  ? 'suppressed'
                  : h2oBlockedPct !== null
                    ? `${h2oBlockedPct.toFixed(0)}% light blocked`
                    : '—'}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {effectiveSolution.brownDwarfNotice || skySelected
                  ? 'Not solid cloud ice'
                  : activeSpectrum.fidelity === 'true_102_ch'
                    ? `N(H₂O) = ${formatColumnDensity(h2oDensity)} cm⁻²`
                    : '6-band preview · extract 102-ch for N(H₂O)'}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Dry Ice — CO₂ (4.27 µm)</div>
              <div className="mt-1 font-mono text-base font-semibold text-amber-300">
                {effectiveSolution.brownDwarfNotice || skySelected
                  ? 'suppressed'
                  : co2BlockedPct !== null
                    ? `${co2BlockedPct.toFixed(0)}% light blocked`
                    : '—'}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {effectiveSolution.brownDwarfNotice || skySelected
                  ? 'Not solid cloud ice'
                  : activeSpectrum.fidelity === 'true_102_ch'
                    ? `N(CO₂) = ${formatColumnDensity(co2Density)} cm⁻²`
                    : '6-band preview · extract 102-ch for N(CO₂)'}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CO₂ / H₂O Ice Mix</div>
              <div className="mt-1 font-mono text-base font-semibold text-emerald-300">
                {effectiveSolution.ratioPercent === null || activeSpectrum.fidelity !== 'true_102_ch'
                  ? effectiveSolution.brownDwarfNotice || skySelected
                    ? 'suppressed'
                    : '102-ch only'
                  : `${effectiveSolution.ratioPercent.toFixed(1)}%`}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {effectiveSolution.brownDwarfNotice
                  ? 'Brown dwarf CH₄ gas guard active'
                  : 'Typical icy star-forming cloud: 15–25%'}
              </div>
            </div>
          </div>

          {/* Toggleable Lab Quantification Details */}
          <div className="rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => setShowLabDetails((prev) => !prev)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <span>Lab Quantification Table ({selectedBands.length} Ice Bands & Lab A-Values)</span>
              <span className="font-mono text-[10px]">{showLabDetails ? 'Hide −' : 'Inspect +'}</span>
            </button>
            {showLabDetails && (
              <div className="border-t border-border">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left font-mono text-[11px] tabular-nums">
                    <thead className="border-b border-border bg-secondary font-sans text-[10px] text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pl-3">Molecular ruler</th>
                        <th className="py-1.5">λ center</th>
                        <th className="py-1.5">Band</th>
                        <th className="py-1.5 text-right">Lab A [cm/molec]</th>
                        <th className="py-1.5 text-right">∫ τ(ν) dν [cm⁻¹]</th>
                        <th className="py-1.5 pr-3 text-right">N_ice [cm⁻²]</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {effectiveSolution.bands
                        .filter((band) => activeBands.includes(band.key))
                        .map((band) => {
                          const definition = ICE_BANDS.find((item) => item.key === band.key);
                          return (
                            <tr key={band.key} className={band.suppressed ? 'text-muted-foreground' : 'text-foreground'}>
                              <td className="py-1.5 pl-3 font-sans">
                                <span className="font-medium">{band.species}</span>
                                <span className="ml-1 text-[10px] text-muted-foreground">{definition?.label}</span>
                              </td>
                              <td className="py-1.5 text-primary">{band.centerUm.toFixed(2)} µm</td>
                              <td className="py-1.5 text-muted-foreground">{definition?.detector}</td>
                              <td className="py-1.5 text-right text-muted-foreground">{band.aValue.toExponential(1)}</td>
                              <td className="py-1.5 text-right">
                                {band.integratedTauCm1 === null ? '—' : band.integratedTauCm1.toFixed(3)}
                              </td>
                              <td className={`py-1.5 pr-3 text-right ${band.suppressed ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {band.suppressed ? 'suppressed' : formatColumnDensity(band.columnDensity)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
                  <span>4th-order Chebyshev continuum (2.1–2.4, 3.7–3.9 µm) · τ(λ) = −ln(F_obs / F_cont)</span>
                  <span>A-values: Gerakines 1995 · Boogert 2000 · Jiang 1975 · Kerkhof 1999</span>
                </div>
              </div>
            )}
          </div>

          {/* Community SPLICES Ice Ledger Submission */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                Log SPLICES Ice Finding
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Publishes aperture photometry & CO₂/H₂O ratio to Community Discussions (#ice_source).
              </p>
            </div>
            <div className="flex items-center gap-2">
              {ledgerState === 'logged' && (
                <Button variant="outline" size="xs" onClick={() => setTab('discussions')}>
                  View in Discussions →
                </Button>
              )}
              <Button
                onClick={handleSubmitLedger}
                disabled={ledgerState === 'submitting' || selectedSource === 'sky' || solution.wavelengthsUm.length < 5}
                variant={effectiveSolution.brownDwarfNotice ? 'outline' : 'default'}
              >
                {ledgerState === 'submitting'
                  ? 'Submitting…'
                  : ledgerState === 'logged'
                    ? 'Ledger entry logged'
                    : 'Submit ledger entry'}
              </Button>
            </div>
          </div>
          {ledgerNote && (
            <p className={`text-[10px] ${ledgerState === 'offline' ? 'text-amber-400' : 'text-emerald-400'}`}>
              {ledgerNote}
            </p>
          )}
        </section>
      </div>

      <InstalledCutoutsModal
        isOpen={isCutoutBrowserOpen}
        onClose={handleCloseCutoutBrowser}
        sections={readyInstalledSections}
        activeSectionId={activeInstalledSection?.section_id || null}
        currentComparatorSectionId={currentSelectedSection?.section_id || null}
        colorPalette={colorPalette}
        subtitle="Preview calibrated SPHEREx cutout stamps and select one for molecular ice analysis."
        onSelect={handleSelectInstalledSection}
      />
    </div>
  );
};

export default MolecularIceStudio;
