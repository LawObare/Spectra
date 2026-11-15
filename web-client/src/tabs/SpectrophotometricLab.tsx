import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTelemetryStore, type SpectralChannel } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { ActiveCaseBanner } from '../components/ActiveCaseBanner';
import {
  CutoutProbeMinimap,
  type CutoutPassInfo,
  type CutoutTimelineMode,
  type CutoutTimelineState,
} from '../components/CutoutProbeMinimap';
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

/**
 * Spectra Tab 3: Spectrophotometric Lab
 * SPECIFICATION.md §6.3.3 — 102-channel WCS-WAVE workbench (0.75–5.00 µm).
 */

const DETECTORS: Array<{ id: string; min: number; max: number; color: string }> = [
  { id: 'D1', min: 0.75, max: 1.11, color: 'rgba(96,165,250,0.10)' },
  { id: 'D2', min: 1.11, max: 1.63, color: 'rgba(52,211,153,0.10)' },
  { id: 'D3', min: 1.63, max: 2.42, color: 'rgba(250,204,21,0.10)' },
  { id: 'D4', min: 2.42, max: 3.82, color: 'rgba(251,146,60,0.10)' },
  { id: 'D5', min: 3.82, max: 4.42, color: 'rgba(244,114,182,0.10)' },
  { id: 'D6', min: 4.42, max: 5.0, color: 'rgba(167,139,250,0.10)' },
];

const FLAG_DEFS: Record<number, string> = {
  0: 'TRANSIENT (cosmic ray/glitch)',
  1: 'OVERFLOW (saturation)',
  2: 'SUR_ERROR',
  4: 'PHANTOM',
  5: 'REFERENCE',
  6: 'NONFUNC',
  7: 'DICHROIC',
  9: 'MISSING_DATA',
  10: 'HOT',
  11: 'COLD',
  17: 'PERSISTENCE',
  22: 'GHOST',
};

const BAND_ANCHOR_UM = [0.93, 1.37, 2.025, 3.12, 4.12, 4.71];

function describeWavelengthZone(lam: number): string {
  if (Math.abs(lam - 3.32) <= 0.14) return 'Methane (CH₄) gas dip — hallmark of cold brown dwarfs';
  if (Math.abs(lam - 3.05) <= 0.18) return 'Water ice (H₂O) & steam zone — cold clouds/cool atmospheres carve dips here';
  if (Math.abs(lam - 4.27) <= 0.12) return 'Dry ice (CO₂) zone — dense molecular-cloud fingerprint';
  if (Math.abs(lam - 1.6) <= 0.08) return '1.6 µm H⁻ opacity bump — stellar & galaxy peak clue';
  if (Math.abs(lam - 2.3) <= 0.12) return 'CO bandhead — giant stars & warm circumstellar disks';
  if (lam < 1.5) return 'Hot starlight zone — bright here if the object is warm (like a sun-like or M star)';
  if (lam < 3.82) return 'Mid-IR molecule zone — water vapor, methane, and solid ices absorb light here';
  return 'Cold thermal heat zone — rises here only if the object is very cold (<1,000 K) or dusty';
}

function formatTemplateDisplayName(rawName: string): string {
  return rawName
    .replace(/\s*Variant\s*#\d+/i, ' Family')
    .replace(/\s*#\d+/g, '')
    .trim();
}

const REST_LINES: Array<{ key: string; label: string; lambdaRestUm: number; color: string }> = [
  { key: 'Ha', label: 'Hα', lambdaRestUm: 0.6563, color: '#ef4444' },
  { key: 'OIII', label: '[O III]', lambdaRestUm: 0.5007, color: '#22c55e' },
  { key: 'PaB', label: 'Paβ', lambdaRestUm: 1.282, color: '#38bdf8' },
  { key: 'HBump', label: 'H-bump', lambdaRestUm: 1.6, color: '#a78bfa' },
  { key: 'BrG', label: 'Brγ', lambdaRestUm: 2.166, color: '#f59e0b' },
];

function detectorFor(lambdaUm: number): string {
  for (const d of DETECTORS) if (lambdaUm >= d.min && lambdaUm < d.max) return d.id;
  return 'D6';
}

function flagTooltip(flag: number): string {
  if (!flag) return '';
  const names = Object.entries(FLAG_DEFS)
    .filter(([bit]) => (flag & (1 << Number(bit))) !== 0)
    .map(([bit, name]) => `Bit ${bit}: ${name}`);
  return names.length ? names.join(' | ') : `FLAGS=0x${flag.toString(16)}`;
}

function solveNnls2(y: number[], t1: number[], t2: number[], s: number[]): { a: number; b: number; chi2Red: number } {
  let s11 = 0, s22 = 0, s12 = 0, sy1 = 0, sy2 = 0;
  let validCount = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(s[i])) continue;
    validCount += 1;
    const w = 1 / Math.max(s[i] * s[i], 1e-12);
    s11 += w * t1[i] * t1[i];
    s22 += w * t2[i] * t2[i];
    s12 += w * t1[i] * t2[i];
    sy1 += w * y[i] * t1[i];
    sy2 += w * y[i] * t2[i];
  }
  if (validCount < 2) return { a: 0, b: 0, chi2Red: 0 };
  const det = s11 * s22 - s12 * s12;
  let a = det !== 0 ? (s22 * sy1 - s12 * sy2) / det : 0;
  let b = det !== 0 ? (s11 * sy2 - s12 * sy1) / det : 0;
  const candidates: Array<[number, number]> = [[Math.max(0, a), Math.max(0, b)], [0, 0]];
  candidates.push([Math.max(0, sy1 / Math.max(s11, 1e-12)), 0]);
  candidates.push([0, Math.max(0, sy2 / Math.max(s22, 1e-12))]);
  let best = { a: 0, b: 0, chi2: Infinity };
  for (const [ca, cb] of candidates) {
    let chi2 = 0;
    for (let i = 0; i < y.length; i++) {
      if (!Number.isFinite(y[i]) || !Number.isFinite(s[i])) continue;
      const r = (y[i] - ca * t1[i] - cb * t2[i]) / Math.max(s[i], 1e-12);
      chi2 += r * r;
    }
    if (chi2 < best.chi2) best = { a: ca, b: cb, chi2 };
  }
  a = best.a; b = best.b;
  return { a, b, chi2Red: best.chi2 / Math.max(1, validCount - 2) };
}

type PzPoint = { z: number; chi2: number; p: number; lookbackGyr: number; dCMpc: number };
type PhotoZResult = { grid: PzPoint[]; bestZ: number | null };
type SpectralFidelity = 'true_102_ch' | 'broadband_6_interpolated';
type ToolTab = 'match' | 'redshift' | 'binary';

interface CachedExtractedSpectrum {
  channels: SpectralChannel[];
  badge: string;
  status: string;
  fidelity: SpectralFidelity;
}

const MAX_SPECTRUM_CACHE_ENTRIES = 24;
const SPECTRUM_MEM_CACHE = new Map<string, CachedExtractedSpectrum>();

function getCachedSpectrum(key: string): CachedExtractedSpectrum | null {
  const hit = SPECTRUM_MEM_CACHE.get(key);
  if (!hit) return null;
  SPECTRUM_MEM_CACHE.delete(key);
  SPECTRUM_MEM_CACHE.set(key, hit);
  return hit;
}

function setCachedSpectrum(key: string, entry: CachedExtractedSpectrum): void {
  if (SPECTRUM_MEM_CACHE.has(key)) SPECTRUM_MEM_CACHE.delete(key);
  else if (SPECTRUM_MEM_CACHE.size >= MAX_SPECTRUM_CACHE_ENTRIES) {
    const oldestKey = SPECTRUM_MEM_CACHE.keys().next().value;
    if (oldestKey !== undefined) SPECTRUM_MEM_CACHE.delete(oldestKey);
  }
  SPECTRUM_MEM_CACHE.set(key, entry);
}

function planckCosmo(z: number): { lookbackGyr: number; dCMpc: number } {
  const H0 = 67.4, Om = 0.315, Ol = 0.685;
  const c = 299792.458;
  const Ez = (zp: number) => Math.sqrt(Om * Math.pow(1 + zp, 3) + Ol);
  const steps = Math.max(8, Math.ceil(z * 80));
  let dc = 0, tl = 0;
  const dz = z / steps;
  for (let i = 0; i < steps; i++) {
    const z1 = (i + 0.5) * dz;
    const invE = 1 / Ez(z1);
    dc += (c / H0) * invE * dz;
    tl += invE * dz / (1 + z1);
  }
  return { lookbackGyr: (977.8 / H0) * tl, dCMpc: dc };
}

function computePhotoZ(lambdas: number[], flux: number[], sigma: number[]): PhotoZResult {
  const valid = lambdas
    .map((wave, i) => ({ wave, flux: flux[i], sigma: sigma[i] }))
    .filter((pt) => Number.isFinite(pt.wave) && Number.isFinite(pt.flux) && Number.isFinite(pt.sigma));
  if (valid.length < 5) return { grid: [], bestZ: null };
  const grid: PzPoint[] = [];
  let best: PzPoint | null = null;
  for (let zi = 0; zi <= 250; zi++) {
    const z = zi * 0.01;
    let chi2 = 0;
    for (const point of valid) {
      const rest = point.wave / (1 + z);
      let model = 8 * Math.exp(-0.3 * Math.max(0, rest - 0.8));
      model += 10 * Math.exp(-Math.pow((rest - 0.6563) / 0.03, 2));
      model += 7 * Math.exp(-Math.pow((rest - 0.5007) / 0.025, 2));
      model += 4 * Math.exp(-Math.pow((rest - 1.282) / 0.04, 2));
      model += 3 * Math.exp(-Math.pow((rest - 1.6) / 0.08, 2));
      const r = (point.flux - model) / Math.max(point.sigma, 1e-6);
      chi2 += r * r;
    }
    const cos = planckCosmo(z);
    const pt = { z, chi2, p: 0, lookbackGyr: cos.lookbackGyr, dCMpc: cos.dCMpc };
    grid.push(pt);
    if (!best || chi2 < best.chi2) best = pt;
  }
  const minChi2 = best ? best.chi2 : grid[0].chi2;
  let sumP = 0;
  for (const p of grid) {
    p.p = Math.exp(-0.5 * (p.chi2 - minChi2));
    sumP += p.p;
  }
  for (const p of grid) p.p /= Math.max(sumP, 1e-12);
  return { grid, bestZ: best ? best.z : 0 };
}

function payloadToChannels(data: any): SpectralChannel[] {
  const convFactor = 9.0229788e-4;
  return data.wavelengths_um.map((lam: number, i: number) => ({
    channel: i + 1,
    detector: detectorFor(lam),
    wavelengthUm: lam,
    uncertainty: Number((Math.sqrt(Math.max(0, data.variance_jy2?.[i] ?? 0)) / convFactor).toFixed(5)),
    flag: data.flags?.[i] ?? 0,
    mjd: data.mjd_per_channel?.[i],
    fluxMjySr: data.channel_coverage?.[i] ? Number((data.flux_jy[i] / convFactor).toFixed(5)) : Number.NaN,
  }));
}

function inferFidelity(data: any): SpectralFidelity {
  const raw = data?.provenance?.spectral_fidelity;
  if (raw === 'true_102_ch') return 'true_102_ch';
  const method = String(data?.provenance?.method || '').toLowerCase();
  if (method.includes('hdu 5') || method.includes('wcs-wave')) return 'true_102_ch';
  return 'broadband_6_interpolated';
}

export const SpectrophotometricLab: React.FC = () => {
  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    probedPixel,
    setProbedPixel,
    probeSkyPosition,
    setProbeSkyPosition,
    activeSpectrum,
    activeEpochIndex,
    isSpectralBlinkSynced,
    setSpectralBlinkSynced,
    manualRedshiftZ,
    setManualRedshiftZ,
    loadedCutout,
    setActiveSpectrum,
    setSpectrumLoading,
    colorPalette,
    currentSelectedSection,
    setCurrentSelectedSection,
    setCaseFindings,
  } = useTelemetryStore();

  const {
    setTab,
    setZ,
    setRa: setUrlRa,
    setDec: setUrlDec,
    setFov: setUrlFov,
    setProbeX: setUrlProbeX,
    setProbeY: setUrlProbeY,
  } = useSpectraUrlState();

  const { installedSections, startSectionInstall } = useInstalledSectionState();
  const [spectrumSourceBadge, setSpectrumSourceBadge] = useState('[Loading Archive Spectrum…]');
  const [spectrumStatus, setSpectrumStatus] = useState('');
  const [spectralFidelity, setSpectralFidelity] = useState<SpectralFidelity>('broadband_6_interpolated');
  const [forceLiveCoordKey, setForceLiveCoordKey] = useState<string | null>(null);
  const [isCutoutBrowserOpen, setIsCutoutBrowserOpen] = useState(false);

  const [overlayEpoch, setOverlayEpoch] = useState(false);
  const [epochCompareChannels, setEpochCompareChannels] = useState<SpectralChannel[]>([]);
  const [timelineMode, setTimelineMode] = useState<CutoutTimelineMode>('coadd');
  const [baselineEpoch, setBaselineEpoch] = useState<number>(0);
  const [compareEpoch, setCompareEpoch] = useState<number>(1);
  const [cutoutPasses, setCutoutPasses] = useState<CutoutPassInfo[]>([]);
  const [mjdDeltaDays, setMjdDeltaDays] = useState<number | null>(null);
  const [showDiffSpectrum, setShowDiffSpectrum] = useState<boolean>(false);
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('match');
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [selectedMatchIdx, setSelectedMatchIdx] = useState<number | null>(0);

  const handleTimelineChange = useCallback((state: CutoutTimelineState) => {
    setTimelineMode(state.mode);
    setBaselineEpoch(state.baselineEpoch);
    setCompareEpoch(state.compareEpoch);
    setCutoutPasses(state.passes);
    setMjdDeltaDays(state.mjdDeltaDays);
    if (state.mode !== 'diff') {
      setShowDiffSpectrum(false);
    }
  }, []);

  const readyInstalledSections = useMemo(
    () => installedSections.filter((s) => s.status === 'ready'),
    [installedSections]
  );
  const readySectionsKey = useMemo(
    () => readyInstalledSections.map((s) => `${s.section_id}:${s.updated_at || ''}`).join('|'),
    [readyInstalledSections]
  );
  const activeInstalledSection = useMemo(() => {
    const position = probeSkyPosition ?? { ra, dec };
    return findMatchingSection(readyInstalledSections, position.ra, position.dec) ||
      findMatchingSection(readyInstalledSections, ra, dec);
  }, [readyInstalledSections, probeSkyPosition, ra, dec]);

  const handleSelectInstalledSection = useCallback(
    (chosen: InstalledSection) => {
      setForceLiveCoordKey(null);
      setUrlRa(Number(chosen.ra.toFixed(5)));
      setUrlDec(Number(chosen.dec.toFixed(5)));
      setUrlFov(Math.round(chosen.fov_arcsec || 300));
      setCurrentSelectedSection(chosen);
      useTelemetryStore.setState({
        ra: chosen.ra,
        dec: chosen.dec,
        activeTargetName: chosen.label,
        probeSkyPosition: { ra: chosen.ra, dec: chosen.dec },
      });
    },
    [setUrlRa, setUrlDec, setUrlFov, setCurrentSelectedSection]
  );

  const handleMinimapPixelSelect = useCallback(
    (px: number, py: number, skyCoord: { ra: number; dec: number }) => {
      setForceLiveCoordKey(null);
      setProbedPixel({ x: px, y: py });
      setProbeSkyPosition(skyCoord);
      setUrlProbeX(px);
      setUrlProbeY(py);
    },
    [setProbedPixel, setProbeSkyPosition, setUrlProbeX, setUrlProbeY]
  );

  const handleReinstallSection = useCallback(
    (sec: InstalledSection) => {
      void startSectionInstall({
        ra: sec.ra,
        dec: sec.dec,
        fovArcsec: sec.fov_arcsec || 300,
        label: sec.label,
      });
    },
    [startSectionInstall]
  );

  const handleCloseCutoutBrowser = useCallback(() => setIsCutoutBrowserOpen(false), []);

  useEffect(() => {
    if (installedSections.length === 0) {
      void fetchInstalledSections();
    }
  }, [installedSections.length]);

  // Fetch main 102-channel / section spectrum
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const fetchLiveSpectrum = async () => {
      const position = probeSkyPosition ?? { ra, dec };
      const coordKey = `${position.ra.toFixed(5)},${position.dec.toFixed(5)}`;
      const isForcedFullRes = forceLiveCoordKey === coordKey;
      const quickMatch = !isForcedFullRes
        ? findMatchingSection(readyInstalledSections, position.ra, position.dec) ||
          findMatchingSection(readyInstalledSections, ra, dec)
        : null;
      const primaryEpoch =
        timelineMode === 'single' || timelineMode === 'diff'
          ? baselineEpoch
          : isSpectralBlinkSynced
            ? activeEpochIndex
            : null;
      const buildCacheKey = (id: string, rev: string | number) =>
        `${id}:${rev}:${probedPixel?.x ?? ''}:${probedPixel?.y ?? ''}:${primaryEpoch ?? ''}:${isForcedFullRes ? 'full' : 'std'}`;

      if (quickMatch) {
        const cached = getCachedSpectrum(buildCacheKey(quickMatch.section_id, quickMatch.updated_at || quickMatch.size_bytes || ''));
        if (cached) {
          setActiveSpectrum(cached.channels);
          setSpectrumSourceBadge(cached.badge);
          setSpectrumStatus(cached.status);
          setSpectralFidelity(cached.fidelity);
          setSpectrumLoading(false);
          return;
        }
      }

      setSpectrumLoading(true);
      setActiveSpectrum([]);
      setSpectrumSourceBadge('[Loading Archive Spectrum…]');
      try {
        let sections = readyInstalledSections;
        if (sections.length === 0) {
          sections = (await fetchInstalledSections()).filter((s) => s.status === 'ready');
        }
        if (cancelled) return;

        const matched = !isForcedFullRes
          ? findMatchingSection(sections, position.ra, position.dec) ||
            findMatchingSection(sections, ra, dec)
          : null;
        const matchedKey = matched
          ? buildCacheKey(matched.section_id, matched.updated_at || matched.size_bytes || '')
          : null;
        if (matched && matchedKey) {
          const cached = getCachedSpectrum(matchedKey);
          if (cached) {
            setActiveSpectrum(cached.channels);
            setSpectrumSourceBadge(cached.badge);
            setSpectrumStatus(cached.status);
            setSpectralFidelity(cached.fidelity);
            setSpectrumLoading(false);
            return;
          }
        }

        let data: any;
        if (matched) {
          setSpectrumStatus(`Sampling "${matched.label}" at px (${probedPixel?.x ?? 24},${probedPixel?.y ?? 24})…`);
          const qs = new URLSearchParams({ normalize: 'false' });
          if (probedPixel) {
            qs.set('px', String(probedPixel.x));
            qs.set('py', String(probedPixel.y));
          }
          if (primaryEpoch !== null) {
            qs.set('epoch', String(primaryEpoch));
          }
          try {
            const secRes = await fetch(`/api/sections/${matched.section_id}/spectrum?${qs.toString()}`, {
              signal: controller.signal,
            });
            const secType = (secRes.headers.get('content-type') || '').toLowerCase();
            if (secRes.ok && !secType.includes('text/html')) {
              data = await secRes.json();
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
          }
          if (!data) {
            data = await fetchStaticSectionSpectrum(matched.section_id, controller.signal);
          }
          if (!data) throw new Error('Installed spectrum unavailable');
        } else {
          if (!isForcedFullRes) {
            setSpectrumSourceBadge('[No Installed Cutout]');
            setSpectrumStatus('No installed cutout covers this spot — select a cutout or extract live from IRSA.');
            return;
          }
          setSpectrumStatus('Extracting true 102-channel IRSA HDU 6 WCS-WAVE spectrum…');
          const queued = await fetch('/api/spectrum/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ ...position, normalize: false }),
          });
          if (!queued.ok) throw new Error(`HTTP ${queued.status}`);
          const { task_id: taskId } = await queued.json();
          while (!cancelled) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            const poll = await fetch(`/api/spectrum/tasks/${taskId}`, { signal: controller.signal });
            if (!poll.ok) throw new Error(`HTTP ${poll.status}`);
            const task = await poll.json();
            setSpectrumStatus(task.message || 'Extracting HDU 6 archive spectrum');
            if (task.status === 'error') throw new Error(task.message || 'Live spectrum unavailable');
            if (task.status === 'complete') {
              data = task.result;
              break;
            }
          }
        }
        if (cancelled || !data) return;
        const sourceBadge = data.provenance?.source_badge;
        const hasHonestSource =
          typeof sourceBadge === 'string' &&
          (/^\[Installed\]/.test(sourceBadge) ||
            /^\[IRSA Live \(.+\)\]$/.test(sourceBadge) ||
            /^\[NASA Benchmark/.test(sourceBadge));
        if (
          !cancelled &&
          hasHonestSource &&
          Array.isArray(data.wavelengths_um) &&
          data.wavelengths_um.length >= 102 &&
          Array.isArray(data.flux_jy) &&
          data.flux_jy.length >= 102
        ) {
          const channels = payloadToChannels(data);
          const fidelity = inferFidelity(data);
          const statusText = `${data.provenance.covered_channels}/${data.provenance.channel_count} channels covered`;
          if (matchedKey) {
            setCachedSpectrum(matchedKey, {
              channels,
              badge: sourceBadge as string,
              status: statusText,
              fidelity,
            });
          }
          setActiveSpectrum(channels);
          setSpectrumSourceBadge(sourceBadge as string);
          setSpectrumStatus(statusText);
          setSpectralFidelity(fidelity);
          if (data.provenance?.spatial_probe_unavailable) {
            setSpectrumStatus('Cutout tensor missing on server — showing center spectrum (re-download cutout to probe pixels)');
          }
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setSpectrumSourceBadge('[Spectrum Unavailable]');
          setSpectrumStatus(err instanceof Error ? err.message : 'Archive spectrum extraction unavailable');
        }
      } finally {
        if (!cancelled) setSpectrumLoading(false);
      }
    };
    void fetchLiveSpectrum();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    ra,
    dec,
    probeSkyPosition?.ra,
    probeSkyPosition?.dec,
    probedPixel?.x,
    probedPixel?.y,
    isSpectralBlinkSynced,
    activeEpochIndex,
    timelineMode,
    baselineEpoch,
    forceLiveCoordKey,
    readySectionsKey,
    setActiveSpectrum,
    setSpectrumLoading,
  ]);

  // Fetch comparison pass spectrum when Diff (Pass A vs Pass B) or Overlay Epoch is active
  const isComparingPasses = timelineMode === 'diff';
  const compareTargetEpoch = isComparingPasses ? compareEpoch : activeEpochIndex;
  const shouldFetchCompareCurve =
    Boolean(activeInstalledSection) && (isComparingPasses || (overlayEpoch && !isSpectralBlinkSynced));

  useEffect(() => {
    if (!shouldFetchCompareCurve || !activeInstalledSection) {
      setEpochCompareChannels([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const qs = new URLSearchParams({
      normalize: 'false',
      epoch: String(compareTargetEpoch),
    });
    if (probedPixel) {
      qs.set('px', String(probedPixel.x));
      qs.set('py', String(probedPixel.y));
    }
    fetch(`/api/sections/${activeInstalledSection.section_id}/spectrum?${qs.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.wavelengths_um)) return;
        setEpochCompareChannels(payloadToChannels(data));
      })
      .catch(() => {
        if (!cancelled) setEpochCompareChannels([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [shouldFetchCompareCurve, activeInstalledSection, compareTargetEpoch, probedPixel?.x, probedPixel?.y]);

  const [colorByMjd, setColorByMjd] = useState(false);
  const [hoverInsight, setHoverInsight] = useState<{
    waveUm: number;
    detector: string;
    flux: number;
    compareFlux: number | null;
    templateFlux: number | null;
    meaning: string;
    flagText: string;
    cursorX: number;
    cursorY: number;
    containerW: number;
    containerH: number;
  } | null>(null);
  const [confirmedIdentity, setConfirmedIdentity] = useState<string | null>(null);
  const [similarMatches, setSimilarMatches] = useState<
    Array<{ id?: string; name: string; spectral_class: string; similarity: number; flux_curve: number[] }>
  >([]);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [similarStatus, setSimilarStatus] = useState('Awaiting spectrum for template match');

  const zRef = useRef(manualRedshiftZ);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const spectrumRef = useRef<SpectralChannel[]>([]);
  const spectralFidelityRef = useRef<SpectralFidelity>(spectralFidelity);
  const colorByMjdRef = useRef(false);
  const specMjdRef = useRef<number[]>([]);
  const mjdRangeRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    zRef.current = manualRedshiftZ;
  }, [manualRedshiftZ]);
  useEffect(() => {
    spectralFidelityRef.current = spectralFidelity;
    if (plotRef.current) plotRef.current.redraw(false);
  }, [spectralFidelity]);

  const epochIndex = isSpectralBlinkSynced ? activeEpochIndex : 0;
  const mjd = useMemo(() => {
    const ep = loadedCutout?.epochs?.[epochIndex] as { mjd?: number } | undefined;
    return typeof ep?.mjd === 'number' && ep.mjd > 0 ? ep.mjd : null;
  }, [loadedCutout, epochIndex]);

  const spectrum = useMemo(
    () => (activeSpectrum && activeSpectrum.length >= 102 ? activeSpectrum.slice(0, 102) : []),
    [activeSpectrum]
  );
  useEffect(() => {
    spectrumRef.current = spectrum;
  }, [spectrum]);

  // Run SIMD spectral similarity matching
  useEffect(() => {
    let cancelled = false;
    const fetchSimilar = async () => {
      if (!spectrum || spectrum.length < 102) {
        setSimilarMatches([]);
        setSimilarStatus('Select a cutout or extract live spectrum to match templates');
        return;
      }
      const finiteIdx: number[] = [];
      for (let i = 0; i < spectrum.length; i++) {
        if (Number.isFinite(spectrum[i].fluxMjySr)) finiteIdx.push(i);
      }
      if (finiteIdx.length < 17) {
        setSimilarMatches([]);
        setSimilarStatus(`Only ${finiteIdx.length}/102 channels covered here — need ≥17 for match`);
        return;
      }
      const fluxArr = spectrum.map((c, idx) => {
        if (Number.isFinite(c.fluxMjySr)) return c.fluxMjySr;
        let left = -1;
        let right = -1;
        for (const fi of finiteIdx) {
          if (fi < idx) left = fi;
          else if (fi > idx) {
            right = fi;
            break;
          }
        }
        if (left >= 0 && right >= 0) {
          const t = (idx - left) / (right - left);
          return spectrum[left].fluxMjySr * (1 - t) + spectrum[right].fluxMjySr * t;
        }
        return spectrum[left >= 0 ? left : right].fluxMjySr;
      });
      setIsFindingSimilar(true);
      setSimilarStatus('Matching against spectral library…');
      try {
        const res = await fetch('/api/subjects/similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spectrum: fluxArr }),
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.matches)) {
            setSimilarMatches(data.matches);
            if (data.matches.length === 0) setSimilarStatus('No template matches returned');
          }
        } else if (!cancelled) {
          setSimilarStatus(`Similarity service unavailable (HTTP ${res.status})`);
        }
      } catch {
        if (!cancelled) setSimilarStatus('Similarity service unreachable');
      } finally {
        if (!cancelled) setIsFindingSimilar(false);
      }
    };
    void fetchSimilar();
    return () => {
      cancelled = true;
    };
  }, [spectrum, spectrumSourceBadge, probedPixel?.x, probedPixel?.y]);

  const isRDraconis =
    (activeTargetName || '').toLowerCase().includes('r draconis') || Math.abs(ra - 248.16773) < 0.2;
  const isEpsInd =
    (activeTargetName || '').toLowerCase().includes('epsilon indi') || Math.abs(ra - 331.09566) < 0.2;

  const perChannelMjd = useMemo(
    () =>
      spectrum.map((channel) =>
        typeof channel.mjd === 'number' && channel.mjd > 0 ? channel.mjd : Number.NaN
      ),
    [spectrum]
  );
  const hasFiniteMjds = useMemo(() => perChannelMjd.some(Number.isFinite), [perChannelMjd]);
  useEffect(() => {
    colorByMjdRef.current = colorByMjd && isRDraconis && hasFiniteMjds;
  }, [colorByMjd, isRDraconis, hasFiniteMjds]);
  useEffect(() => {
    specMjdRef.current = perChannelMjd;
  }, [perChannelMjd]);
  useEffect(() => {
    const arr = perChannelMjd.filter(Number.isFinite);
    mjdRangeRef.current = arr.length ? [Math.min(...arr), Math.max(...arr)] : null;
  }, [perChannelMjd]);
  useEffect(() => {
    if (plotRef.current) plotRef.current.redraw(false);
  }, [colorByMjd, perChannelMjd]);

  // Scale selected template match onto observed flux range for visual comparison
  const scaledTemplateOverlay = useMemo<(number | null)[] | null>(() => {
    if (selectedMatchIdx === null || !similarMatches[selectedMatchIdx] || spectrum.length < 102) {
      return null;
    }
    const curve = similarMatches[selectedMatchIdx].flux_curve;
    if (!Array.isArray(curve) || curve.length < 102) return null;
    const obsValid = spectrum.map((c) => c.fluxMjySr).filter(Number.isFinite);
    const tplValid = curve.slice(0, 102).filter(Number.isFinite);
    if (obsValid.length === 0 || tplValid.length === 0) return null;
    const obsMed = obsValid.reduce((a, b) => a + Math.abs(b), 0) / obsValid.length;
    const tplMed = tplValid.reduce((a, b) => a + Math.abs(b), 0) / tplValid.length;
    const gain = tplMed > 1e-12 ? obsMed / tplMed : 1;
    return curve.slice(0, 102).map((v) => (Number.isFinite(v) ? v * gain : null));
  }, [selectedMatchIdx, similarMatches, spectrum]);

  const data = useMemo((): uPlot.AlignedData => {
    const x = spectrum.map((c) => c.wavelengthUm);
    const hasCompare = shouldFetchCompareCurve && epochCompareChannels.length >= 102;
    if (showDiffSpectrum && hasCompare && spectrum.length >= 102) {
      const yDiff = spectrum.map((c, i) => {
        const a = c.fluxMjySr;
        const b = epochCompareChannels[i]?.fluxMjySr;
        return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
      });
      return [x, yDiff, x.map(() => null), x.map(() => null)];
    }
    const y = spectrum.map((c) => (Number.isFinite(c.fluxMjySr) ? c.fluxMjySr : null));
    const yEpoch = hasCompare
      ? epochCompareChannels.slice(0, 102).map((c) => (Number.isFinite(c.fluxMjySr) ? c.fluxMjySr : null))
      : x.map(() => null);
    const yTemplate = scaledTemplateOverlay || x.map(() => null);
    return [x, y, yEpoch, yTemplate];
  }, [spectrum, shouldFetchCompareCurve, showDiffSpectrum, epochCompareChannels, scaledTemplateOverlay]);

  const epochDeltaPct = useMemo(() => {
    if (!shouldFetchCompareCurve || epochCompareChannels.length < 102 || spectrum.length < 102) {
      return null;
    }
    const pairs: Array<{ base: number; ep: number }> = [];
    for (let i = 0; i < 102; i++) {
      const a = spectrum[i].fluxMjySr;
      const b = epochCompareChannels[i].fluxMjySr;
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) > 1e-6) {
        pairs.push({ base: a, ep: b });
      }
    }
    if (pairs.length < 5) return null;
    const meanBase = pairs.reduce((s, p) => s + p.base, 0) / pairs.length;
    const meanEp = pairs.reduce((s, p) => s + p.ep, 0) / pairs.length;
    return Math.abs(meanBase) > 1e-9 ? ((meanEp - meanBase) / Math.abs(meanBase)) * 100 : null;
  }, [shouldFetchCompareCurve, epochCompareChannels, spectrum]);

  const passALabel = cutoutPasses[baselineEpoch]
    ? `Pass ${baselineEpoch + 1} (${cutoutPasses[baselineEpoch].dateLabel})`
    : `Pass ${baselineEpoch + 1}`;
  const passBLabel = cutoutPasses[compareTargetEpoch]
    ? `Pass ${compareTargetEpoch + 1} (${cutoutPasses[compareTargetEpoch].dateLabel})`
    : `Pass ${compareTargetEpoch + 1}`;

  // Summary facts & live human-readable chart narration
  const spectrumSummary = useMemo(() => {
    const finite = spectrum.filter((c) => Number.isFinite(c.fluxMjySr));
    const flaggedCount = spectrum.filter((c) => c.flag !== 0).length;
    if (finite.length === 0) {
      return {
        coveredCount: 0,
        flaggedCount: 0,
        peakWaveUm: null as number | null,
        meanFlux: null as number | null,
        shortMean: null as number | null,
        longMean: null as number | null,
        slopeRatio: null as number | null,
        ch4DipRatio: null as number | null,
      };
    }
    let peak = finite[0];
    let sum = 0;
    const shortVals: number[] = [];
    const longVals: number[] = [];
    const ch4Vals: number[] = [];
    const contVals: number[] = [];
    for (const c of finite) {
      sum += c.fluxMjySr;
      if (c.fluxMjySr > peak.fluxMjySr) peak = c;
      if (c.wavelengthUm <= 1.5) shortVals.push(c.fluxMjySr);
      if (c.wavelengthUm >= 3.8) longVals.push(c.fluxMjySr);
      if (c.wavelengthUm >= 3.2 && c.wavelengthUm <= 3.45) ch4Vals.push(c.fluxMjySr);
      if (c.wavelengthUm >= 2.15 && c.wavelengthUm <= 2.4) contVals.push(c.fluxMjySr);
    }
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const shortMean = avg(shortVals);
    const longMean = avg(longVals);
    const slopeRatio =
      shortMean !== null && longMean !== null && Math.abs(shortMean) > 1e-9
        ? longMean / shortMean
        : null;
    const ch4Mean = avg(ch4Vals);
    const contMean = avg(contVals);
    const ch4DipRatio =
      ch4Mean !== null && contMean !== null && Math.abs(contMean) > 1e-9
        ? ch4Mean / contMean
        : null;
    return {
      coveredCount: finite.length,
      flaggedCount,
      peakWaveUm: peak.wavelengthUm,
      meanFlux: sum / finite.length,
      shortMean,
      longMean,
      slopeRatio,
      ch4DipRatio,
    };
  }, [spectrum]);

  // Deduplicate noisy synthetic "#1234" clones while keeping real named matches
  const displayMatches = useMemo(() => {
    const seen = new Set<string>();
    const cleaned: Array<{
      id?: string;
      rawIndex: number;
      name: string;
      spectral_class: string;
      similarity: number;
    }> = [];
    similarMatches.forEach((m, rawIndex) => {
      const cleanName = formatTemplateDisplayName(m.name);
      const key = `${cleanName.toLowerCase()}::${m.spectral_class.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      cleaned.push({
        id: m.id,
        rawIndex,
        name: cleanName,
        spectral_class: m.spectral_class,
        similarity: m.similarity,
      });
    });
    return cleaned;
  }, [similarMatches]);

  const topMatch = displayMatches[0] || null;
  const looksExtragalactic = useMemo(() => {
    const cls = `${topMatch?.spectral_class || ''} ${topMatch?.name || ''}`.toLowerCase();
    return ['galaxy', 'qso', 'agn', 'starburst', 'spiral', 'elliptical', 'z='].some((k) => cls.includes(k));
  }, [topMatch]);

  const liveChartReading = useMemo(() => {
    if (spectrumSummary.coveredCount === 0) return null;
    const ratio = spectrumSummary.slopeRatio;
    const slopeClue =
      ratio === null
        ? 'Limited wavelength span covered here — check which detector bands loaded below.'
        : ratio > 1.3
          ? `Rises toward 4–5 µm (${ratio.toFixed(1)}× brighter than 1 µm): Very cold heat glow (<1,000 K) or thick dust cocoon — not a normal warm star.`
          : ratio < 0.7
            ? `Drops left-to-right (${Math.round((1 - ratio) * 100)}% dimmer by 4–5 µm): Classic warm star cooling off in deep infrared.`
            : 'Stays fairly level across 1–5 µm: Warm dusty disk, distant star-forming galaxy, or cool red dwarf.';
    const detailClue =
      spectralFidelity === 'broadband_6_interpolated'
        ? 'Preview mode: Only the 6 hollow dots (D1–D6) are direct cutout measurements; sharp gas dips between dots are smoothed until you extract all 102 colors from IRSA.'
        : spectrumSummary.ch4DipRatio !== null && spectrumSummary.ch4DipRatio < 0.72
          ? 'Noticeable notch near 3.3 µm: Matches atmospheric methane gas (CH₄) in cold brown dwarfs.'
          : spectrumSummary.peakWaveUm !== null
            ? `Strongest light lands near ${spectrumSummary.peakWaveUm.toFixed(2)} µm across ${spectrumSummary.coveredCount} measured wavelength channels.`
            : 'Full 102-channel HDU 6 extraction active.';
    const contrastTip =
      'Try this: Click a different bright star on the cutout image (left) to watch the line slope flip between hot normal stars (↘) and cold/dusty objects (↗).';
    return { slopeClue, detailClue, contrastTip };
  }, [spectrumSummary, spectralFidelity]);

  useEffect(() => {
    setConfirmedIdentity(null);
  }, [ra, dec, probedPixel?.x, probedPixel?.y, activeInstalledSection?.section_id]);

  // Sync live finding back into Active Case
  useEffect(() => {
    const position = probeSkyPosition ?? { ra, dec };
    const targetKey =
      activeInstalledSection?.section_id || `${position.ra.toFixed(4)},${position.dec.toFixed(4)}`;
    let summary = 'No spectrum loaded';
    if (confirmedIdentity) {
      summary = `Confirmed: ${confirmedIdentity}`;
    } else if (topMatch) {
      summary = `${topMatch.name} (${(topMatch.similarity * 100).toFixed(0)}%)`;
    } else if (spectrumSummary.coveredCount > 0 && spectrumSummary.peakWaveUm !== null) {
      summary =
        spectralFidelity === 'broadband_6_interpolated'
          ? `6-band preview · peak ${spectrumSummary.peakWaveUm.toFixed(2)} µm`
          : `Peak ${spectrumSummary.peakWaveUm.toFixed(2)} µm · ${spectrumSummary.coveredCount}/102 ch`;
    }
    setCaseFindings(
      {
        spectralSummary: summary,
        spectralTopClass: confirmedIdentity || topMatch?.spectral_class || null,
        spectralFidelity,
      },
      targetKey
    );
  }, [
    activeInstalledSection?.section_id,
    probeSkyPosition?.ra,
    probeSkyPosition?.dec,
    ra,
    dec,
    confirmedIdentity,
    topMatch,
    spectrumSummary.coveredCount,
    spectrumSummary.peakWaveUm,
    spectralFidelity,
    setCaseFindings,
  ]);

  // Epsilon Indi B NNLS unmixing
  const unmix = useMemo(() => {
    if (!isEpsInd || spectrum.filter((c) => Number.isFinite(c.fluxMjySr)).length < 2) return null;
    const y = spectrum.map((c) => c.fluxMjySr);
    const s = spectrum.map((c) => c.uncertainty);
    const t1 = spectrum.map(
      (c) => 16 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.9, 2)) * (1 - 0.2 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.06, 2)))
    );
    const t6 = spectrum.map(
      (c) => 9 * Math.exp(-Math.pow((c.wavelengthUm - 1.55) / 0.8, 2)) * (1 - 0.35 * Math.exp(-Math.pow((c.wavelengthUm - 1.62) / 0.07, 2)))
    );
    return solveNnls2(y, t1, t6, s);
  }, [isEpsInd, spectrum]);

  const [photoZ, setPhotoZ] = useState<PhotoZResult>({ grid: [], bestZ: null });
  useEffect(() => {
    if (spectrum.length === 0) {
      setPhotoZ({ grid: [], bestZ: null });
      return;
    }
    const timerId = window.setTimeout(() => {
      setPhotoZ(
        computePhotoZ(
          spectrum.map((c) => c.wavelengthUm),
          spectrum.map((c) => c.fluxMjySr),
          spectrum.map((c) => c.uncertainty)
        )
      );
    }, 16);
    return () => window.clearTimeout(timerId);
  }, [spectrum]);

  // Build uPlot instance
  useEffect(() => {
    if (!chartRef.current) return;
    const drawBands = (u: uPlot) => {
      const ctx = u.ctx;
      const { top, height } = u.bbox;
      ctx.save();
      for (const d of DETECTORS) {
        const x0 = u.valToPos(d.min, 'x', true);
        const x1 = u.valToPos(d.max, 'x', true);
        ctx.fillStyle = d.color;
        ctx.fillRect(x0, top, x1 - x0, height);
        ctx.fillStyle = 'rgba(229,229,229,0.45)';
        ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(d.id, x0 + 4, top + 12);
      }
      ctx.restore();
    };
    const drawErrorsFlagsAndRulers = (u: uPlot) => {
      const ctx = u.ctx;
      const spec = spectrumRef.current;
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < spec.length; i++) {
        const c = spec[i];
        if (!Number.isFinite(c.fluxMjySr) || !Number.isFinite(c.uncertainty)) continue;
        const x = u.valToPos(c.wavelengthUm, 'x', true);
        const y0 = u.valToPos(c.fluxMjySr - c.uncertainty, 'y', true);
        const y1 = u.valToPos(c.fluxMjySr + c.uncertainty, 'y', true);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
      if (colorByMjdRef.current && mjdRangeRef.current) {
        const [m0, m1] = mjdRangeRef.current;
        for (let i = 0; i < spec.length; i++) {
          const c = spec[i];
          if (!Number.isFinite(c.fluxMjySr)) continue;
          const x = u.valToPos(c.wavelengthUm, 'x', true);
          const y = u.valToPos(c.fluxMjySr, 'y', true);
          const m = specMjdRef.current[i] ?? m0;
          const t = m1 > m0 ? (m - m0) / (m1 - m0) : 0;
          const hue = 210 - 180 * Math.max(0, Math.min(1, t));
          ctx.fillStyle = `hsl(${hue} 85% 62%)`;
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (spectralFidelityRef.current === 'broadband_6_interpolated' && spec.length > 0) {
        ctx.save();
        for (const anchorUm of BAND_ANCHOR_UM) {
          let bestPoint: SpectralChannel | null = null;
          let bestDist = Infinity;
          for (const ch of spec) {
            if (!Number.isFinite(ch.fluxMjySr)) continue;
            const d = Math.abs(ch.wavelengthUm - anchorUm);
            if (d < bestDist && d < 0.25) {
              bestDist = d;
              bestPoint = ch;
            }
          }
          if (!bestPoint) continue;
          const ax = u.valToPos(bestPoint.wavelengthUm, 'x', true);
          const ay = u.valToPos(bestPoint.fluxMjySr, 'y', true);
          ctx.beginPath();
          ctx.arc(ax, ay, 5.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = '#fbbf24';
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < spec.length; i++) {
        const c = spec[i];
        if (!c.flag || !Number.isFinite(c.fluxMjySr)) continue;
        const x = u.valToPos(c.wavelengthUm, 'x', true);
        const y = u.valToPos(c.fluxMjySr, 'y', true);
        const s = 5;
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.lineTo(x - s, y + s);
        ctx.closePath();
        ctx.stroke();
      }
      // Subtle CH4 3.32 um callout for cold brown dwarfs
      const xCh4 = u.valToPos(3.32, 'x', true);
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xCh4, u.bbox.top);
      ctx.lineTo(xCh4, u.bbox.top + u.bbox.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText('CH₄', xCh4 + 3, u.bbox.top + 26);
      ctx.restore();

      const z = zRef.current;
      REST_LINES.forEach((line, idx) => {
        const obs = line.lambdaRestUm * (1 + z);
        if (obs < 0.75 || obs > 5.0) return;
        const x = u.valToPos(obs, 'x', true);
        const labelY = u.bbox.top + 24 + (idx % 3) * 14;
        ctx.strokeStyle = line.color;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, u.bbox.top);
        ctx.lineTo(x, u.bbox.top + u.bbox.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = line.color;
        ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(`${line.label}`, x + 3, labelY);
      });
      ctx.restore();
    };

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth || 720,
      height: chartRef.current.clientHeight || (chartRef.current.clientWidth < 640 ? 260 : 340),
      padding: [16, 12, 0, 0],
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: false, min: 0.75, max: 5.0 },
        y: {
          auto: true,
          range: (_u, min, max) => {
            if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
            if (min === max) return [min - 0.5, max + 0.5];
            return [min, max];
          },
        },
      },
      axes: [
        { stroke: '#a3a3a3', grid: { stroke: 'rgba(148,163,184,0.15)' }, label: 'Color Wavelength λ (µm) · Hot Light → Cold Glow' },
        { stroke: '#a3a3a3', grid: { stroke: 'rgba(148,163,184,0.15)' }, label: 'Glow Brightness (MJy/sr)' },
      ],
      series: [
        {},
        {
          label: 'Observed',
          stroke: '#ffffff',
          width: 1.8,
          spanGaps: true,
          points: { show: true, size: 3.5, fill: '#ffffff', stroke: '#0a0a0a' },
        },
        {
          label: 'Active Epoch',
          stroke: '#38bdf8',
          width: 1.5,
          dash: [5, 3],
          spanGaps: true,
          points: { show: false },
        },
        {
          label: 'Matched Template',
          stroke: '#34d399',
          width: 1.5,
          dash: [3, 3],
          spanGaps: true,
          points: { show: false },
        },
      ],
      hooks: {
        drawClear: [drawBands],
        draw: [drawErrorsFlagsAndRulers],
      },
    };
    const plot = new uPlot(opts, data, chartRef.current);
    plotRef.current = plot;

    const onMove = (e: MouseEvent) => {
      const overRect = plot.over.getBoundingClientRect();
      const boxRect = chartRef.current?.getBoundingClientRect() || overRect;
      const idx = plot.posToIdx(e.clientX - overRect.left);
      const c = spectrumRef.current[idx];
      if (c && Number.isFinite(c.fluxMjySr)) {
        const s2 = plot.data[2]?.[idx];
        const s3 = plot.data[3]?.[idx];
        setHoverInsight({
          waveUm: c.wavelengthUm,
          detector: c.detector,
          flux: c.fluxMjySr,
          compareFlux: typeof s2 === 'number' && Number.isFinite(s2) ? s2 : null,
          templateFlux: typeof s3 === 'number' && Number.isFinite(s3) ? s3 : null,
          meaning: describeWavelengthZone(c.wavelengthUm),
          flagText: c.flag ? flagTooltip(c.flag) : '',
          cursorX: e.clientX - boxRect.left,
          cursorY: e.clientY - boxRect.top,
          containerW: boxRect.width,
          containerH: boxRect.height,
        });
      } else {
        setHoverInsight(null);
      }
    };
    const onLeave = () => setHoverInsight(null);
    plot.over.addEventListener('mousemove', onMove);
    plot.over.addEventListener('mouseleave', onLeave);

    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) {
        const h = ent.contentRect.width < 640 ? 260 : 340;
        plot.setSize({ width: Math.max(260, Math.floor(ent.contentRect.width)), height: h });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      plot.over.removeEventListener('mousemove', onMove);
      plot.over.removeEventListener('mouseleave', onLeave);
      plot.destroy();
      plotRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (plotRef.current) plotRef.current.setData(data, true);
  }, [data]);

  const onZChange = useCallback(
    (val: number) => {
      zRef.current = val;
      setManualRedshiftZ(val);
      setZ(val);
      if (plotRef.current) plotRef.current.redraw(false);
    },
    [setManualRedshiftZ, setZ]
  );

  const pointColors = useMemo(() => {
    if (!isRDraconis || !colorByMjd || !hasFiniteMjds) return null;
    return perChannelMjd.filter(Number.isFinite);
  }, [isRDraconis, colorByMjd, hasFiniteMjds, perChannelMjd]);

  const displayName = activeInstalledSection?.label || activeTargetName || 'Custom Sky Field';
  const focusPos = probeSkyPosition ?? { ra, dec };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <ActiveCaseBanner activeLens="spectral" sectionLabel={displayName} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* LEFT RAIL: Spatial Context & Epoch Comparison */}
        <aside className="w-full lg:w-[290px] xl:w-[310px] shrink-0 lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-neutral-800 bg-neutral-950 p-3 space-y-3">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Active Cutout & Target
            </div>
            <div className="flex flex-wrap gap-1.5">
              {currentSelectedSection && (
                <UseCurrentSelectedButton
                  section={currentSelectedSection}
                  isActive={activeInstalledSection?.section_id === currentSelectedSection.section_id}
                  colorPalette={colorPalette}
                  onSelect={handleSelectInstalledSection}
                />
              )}
              {readyInstalledSections.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsCutoutBrowserOpen(true)}
                  aria-label="Browse installed sections for spectrum"
                  className="inline-flex h-7 max-w-[230px] items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-2.5 text-xs font-medium text-emerald-200 hover:border-emerald-400/60 hover:bg-emerald-900/50 cursor-pointer"
                  title="Browse installed cutouts with previews"
                >
                  <span className="truncate">
                    {activeInstalledSection ? activeInstalledSection.label : 'Browse Installed'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-emerald-300/90">
                    ({readyInstalledSections.length})
                  </span>
                </button>
              )}
            </div>
          </div>

          <CutoutProbeMinimap
            section={activeInstalledSection}
            timelineMode={timelineMode}
            baselineEpoch={baselineEpoch}
            compareEpoch={compareEpoch}
            onTimelineChange={handleTimelineChange}
            colorPalette={colorPalette}
            probePixel={probedPixel ?? { x: 24, y: 24 }}
            fallbackRa={focusPos.ra}
            fallbackDec={focusPos.dec}
            fallbackFovArcsec={fovArcsec}
            onSelectPixel={handleMinimapPixelSelect}
            onReinstall={handleReinstallSection}
            caption="Click or drag on the cutout to fingerprint that pixel"
          />

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-300">
                Compare Across Time
              </span>
              <span className="font-mono text-[10px] text-sky-300">
                {isComparingPasses
                  ? `P${baselineEpoch + 1} vs P${compareEpoch + 1}`
                  : timelineMode === 'single'
                    ? `Pass ${baselineEpoch + 1}`
                    : `All Dates (${cutoutPasses.length || 1})`}
              </span>
            </div>
            {isComparingPasses ? (
              <label className="flex items-center justify-between gap-2 text-xs text-neutral-300 cursor-pointer">
                <span>Show Difference Curve (B − A)</span>
                <input
                  type="checkbox"
                  checked={showDiffSpectrum}
                  onChange={(e) => setShowDiffSpectrum(e.target.checked)}
                  className="accent-amber-400"
                />
              </label>
            ) : (
              <label className="flex items-center justify-between gap-2 text-xs text-neutral-300 cursor-pointer">
                <span>Overlay Pass {activeEpochIndex + 1} on chart</span>
                <input
                  type="checkbox"
                  checked={overlayEpoch}
                  disabled={isSpectralBlinkSynced || timelineMode === 'single' || !activeInstalledSection}
                  onChange={(e) => setOverlayEpoch(e.target.checked)}
                  className="accent-sky-400"
                />
              </label>
            )}
            {cutoutPasses.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  if (isComparingPasses) {
                    setTimelineMode('coadd');
                    setShowDiffSpectrum(false);
                  } else {
                    setTimelineMode('diff');
                    setBaselineEpoch(0);
                    setCompareEpoch(cutoutPasses.length - 1);
                  }
                }}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                  isComparingPasses
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                    : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
                }`}
              >
                {isComparingPasses
                  ? `Comparing ${passALabel} vs ${passBLabel}`
                  : `Compare First vs Latest Date (P1 vs P${cutoutPasses.length})`}
              </button>
            )}
            {epochDeltaPct !== null && (
              <div className="rounded-lg border border-sky-500/25 bg-sky-950/30 px-2.5 py-1.5 font-mono text-[11px] text-sky-200 space-y-0.5">
                <div>
                  {isComparingPasses ? `P${compareEpoch + 1} vs P${baselineEpoch + 1}` : `Pass ${activeEpochIndex + 1} vs All Dates`}:{' '}
                  <strong>
                    {epochDeltaPct >= 0 ? '+' : ''}
                    {epochDeltaPct.toFixed(1)}%
                  </strong>
                </div>
                {isComparingPasses && mjdDeltaDays !== null && (
                  <div className="text-[10px] text-sky-300/80">
                    Time gap: {mjdDeltaDays >= 0 ? '+' : ''}
                    {Math.round(mjdDeltaDays)} days
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setTab('comparator')}
              title="Go back to Time-Domain with this exact pixel selected to blink its brightness across dates"
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 hover:bg-white/[0.08] cursor-pointer"
            >
              ← Blink This Pixel in Time-Domain
            </button>
          </div>

          {isRDraconis && hasFiniteMjds && (
            <label className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={colorByMjd}
                onChange={(e) => setColorByMjd(e.target.checked)}
                className="accent-amber-400"
              />
              <span>
                Color channels by observation MJD
                {mjd !== null ? ` (MJD ${mjd.toFixed(1)})` : ''}
              </span>
            </label>
          )}
        </aside>

        {/* CENTER COLUMN: Identity Verdict + Chart + Live Translation */}
        <section className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-neutral-800 p-3 sm:p-4 space-y-3">
          {/* Plain-English Verdict Banner */}
          <div
            data-tour="spectral-hero-sharpen"
            className="rounded-xl border border-emerald-500/25 bg-gradient-to-r from-emerald-950/35 via-neutral-900/70 to-neutral-900/70 p-3.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                    What Is This Dot?
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      spectralFidelity === 'true_102_ch'
                        ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                        : 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    {spectralFidelity === 'true_102_ch'
                      ? 'Full 102 Colors'
                      : '6-Band Quick Preview'}
                  </span>
                </div>
                <div className="mt-1 text-base font-semibold text-white">
                  {confirmedIdentity
                    ? `Confirmed: ${confirmedIdentity}`
                    : topMatch
                      ? `${spectralFidelity === 'broadband_6_interpolated' ? 'Rough 6-band hint' : 'Closest match'}: ${topMatch.name} (${topMatch.spectral_class})`
                      : spectrumSummary.coveredCount > 0
                        ? `Infrared signature of ${displayName}`
                        : spectrumStatus || 'Select a target or click a star pixel'}
                </div>
                <p className="mt-0.5 text-xs text-neutral-300">
                  {topMatch ? (
                    <>
                      Shape match{' '}
                      <strong className="font-mono text-emerald-300">
                        {(topMatch.similarity * 100).toFixed(1)}%
                      </strong>
                      {spectrumSummary.peakWaveUm !== null && (
                        <>
                          {' '}
                          · Strongest light near{' '}
                          <strong className="font-mono text-white">
                            {spectrumSummary.peakWaveUm.toFixed(2)} µm
                          </strong>
                        </>
                      )}
                      {spectralFidelity === 'broadband_6_interpolated'
                        ? ' (6-band sketch compares overall tilt, not narrow gas dips).'
                        : '.'}
                    </>
                  ) : (
                    <>
                      {spectralFidelity === 'broadband_6_interpolated'
                        ? 'Showing 6 broad detector anchor bands connected by straight segments.'
                        : 'Measured natively across 102 infrared wavelength channels.'}
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {spectralFidelity !== 'true_102_ch' && (
                  <button
                    type="button"
                    onClick={() => {
                      const coordKey = `${focusPos.ra.toFixed(5)},${focusPos.dec.toFixed(5)}`;
                      setForceLiveCoordKey(coordKey);
                    }}
                    className="rounded-lg border border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 px-2.5 py-1.5 text-xs font-semibold text-sky-200 transition-colors cursor-pointer"
                    title="Fetch native HDU 6 WCS-WAVE 102-channel spectrum from IRSA instead of 6-band cutout interpolation"
                  >
                    Sharpen to 102 Colors (IRSA)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTab('ice')}
                  className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1.5 text-xs font-medium text-cyan-200 transition-colors cursor-pointer"
                  title="Check if dust/ice in front of a star could explain a mid-infrared slope"
                >
                  Open Ice Studio →
                </button>
              </div>
            </div>

            {spectrumSummary.flaggedCount > 0 && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-2.5 py-1 text-[11px] text-amber-200">
                Note: {spectrumSummary.flaggedCount} channel{spectrumSummary.flaggedCount === 1 ? '' : 's'} carry detector quality flags (amber triangles — hover any point below for its meaning).
              </div>
            )}
          </div>

          {/* Collapsible 3-Shape Visual Cheat Sheet (compact by default so the chart stays hero) */}
          <div data-tour="spectral-cheat-sheet" className="rounded-lg border border-white/10 bg-neutral-900/40">
            <button
              type="button"
              onClick={() => setShowCheatSheet((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-neutral-300 hover:text-white cursor-pointer"
            >
              <span>How to read infrared curve shapes (Warm Star vs. Cold Dwarf vs. Galaxy)</span>
              <span className="font-mono text-[10px] text-neutral-400">
                {showCheatSheet ? 'Hide −' : 'Show +'}
              </span>
            </button>
            {showCheatSheet && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-white/10 p-2 text-[11px]">
                <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-neutral-900/60 px-2.5 py-2">
                  <svg viewBox="0 0 44 24" className="h-6 w-11 shrink-0" aria-hidden="true">
                    <path d="M3 5 L18 11 L41 20" fill="none" stroke="#38bdf8" strokeWidth="2" />
                  </svg>
                  <div className="min-w-0 leading-tight">
                    <div className="font-semibold text-sky-200">Warm Star (↘)</div>
                    <div className="text-[10px] text-neutral-400">Bright left, fades out by 4 µm</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-neutral-900/60 px-2.5 py-2">
                  <svg viewBox="0 0 44 24" className="h-6 w-11 shrink-0" aria-hidden="true">
                    <path d="M3 12 L18 16 L27 21 L33 13 L41 4" fill="none" stroke="#34d399" strokeWidth="2" />
                  </svg>
                  <div className="min-w-0 leading-tight">
                    <div className="font-semibold text-emerald-200">Cold Brown Dwarf (↗)</div>
                    <div className="text-[10px] text-neutral-400">3.3 µm methane dip + rises at 4–5 µm</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-neutral-900/60 px-2.5 py-2">
                  <svg viewBox="0 0 44 24" className="h-6 w-11 shrink-0" aria-hidden="true">
                    <path d="M3 16 L13 9 L19 13 L29 10 L41 12" fill="none" stroke="#f59e0b" strokeWidth="2" />
                  </svg>
                  <div className="min-w-0 leading-tight">
                    <div className="font-semibold text-amber-200">Galaxy / Dusty Star</div>
                    <div className="text-[10px] text-neutral-400">Bumpy peaks shifted across 1–5 µm</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Chart Legend & uPlot */}
          <div
            data-tour="spectral-lab-chart"
            className="rounded-xl border border-neutral-800 bg-black/50 p-3 space-y-2"
          >
            {/* Clean Custom Graph Legend (Curves, Markers & Detector Bands) */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-300">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-white font-medium">
                  <span className="inline-block h-0.5 w-4 bg-white rounded-full" />
                  {showDiffSpectrum && shouldFetchCompareCurve
                    ? `Difference (${passBLabel} − ${passALabel})`
                    : isComparingPasses || timelineMode === 'single'
                      ? passALabel
                      : isSpectralBlinkSynced
                        ? `Pass ${activeEpochIndex + 1}`
                        : 'Observed Spectrum'}
                </span>
                {spectralFidelity === 'broadband_6_interpolated' && (
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-400 bg-amber-400/20" />
                    6 Cutout Bands (D1–D6)
                  </span>
                )}
                {shouldFetchCompareCurve && !showDiffSpectrum && (
                  <span className="inline-flex items-center gap-1.5 text-sky-300">
                    <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sky-400" />
                    {passBLabel}
                  </span>
                )}
                {scaledTemplateOverlay && selectedMatchIdx !== null && similarMatches[selectedMatchIdx] && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-300">
                    <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-emerald-400" />
                    Match: {formatTemplateDisplayName(similarMatches[selectedMatchIdx].name)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-sky-300/90">
                  <span className="inline-block h-3 border-l border-dashed border-sky-400" />
                  Gas &amp; Ice Rulers
                </span>
                {spectrumSummary.flaggedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-300/90">
                    <span>△</span>
                    Quality Flag
                  </span>
                )}
              </div>
              <span className="font-mono text-[10px] text-neutral-400">
                {spectralFidelity === 'broadband_6_interpolated'
                  ? '6 measured anchors'
                  : spectrumStatus || '102/102 channels'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[10px] text-neutral-400 px-1">
              <span>← Hot Starlight (0.75–1.5 µm)</span>
              <span className="hidden sm:inline">Gas &amp; Ice Fingerprints (1.6–3.6 µm)</span>
              <span>Cold Heat Glow (3.8–5.0 µm) →</span>
            </div>

            <div className="relative overflow-hidden rounded border border-neutral-800 bg-neutral-950">
              <div
                ref={chartRef}
                className="h-[260px] sm:h-[340px] w-full"
                aria-label="102-channel hyperspectral plot"
              />

              {/* Floating Cursor-Following Wavelength Translator Tooltip */}
              {hoverInsight && (
                <div
                  className="pointer-events-none absolute z-20 w-[240px] sm:w-[270px] rounded-xl border border-sky-400/40 bg-neutral-950/95 px-3 py-2.5 text-[11px] shadow-[0_12px_32px_rgba(0,0,0,0.85)] backdrop-blur-md transition-[left,top] duration-75"
                  style={{
                    left: `${
                      hoverInsight.cursorX > hoverInsight.containerW * 0.56
                        ? Math.max(8, hoverInsight.cursorX - 278)
                        : Math.min(Math.max(8, hoverInsight.containerW - 278), hoverInsight.cursorX + 16)
                    }px`,
                    top: `${
                      hoverInsight.cursorY > hoverInsight.containerH * 0.58
                        ? Math.max(8, hoverInsight.cursorY - 122)
                        : Math.min(Math.max(8, hoverInsight.containerH - 122), hoverInsight.cursorY + 14)
                    }px`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-white">
                      {hoverInsight.waveUm.toFixed(2)} µm
                    </span>
                    <span className="rounded-full border border-sky-400/35 bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-200">
                      {hoverInsight.detector} ·{' '}
                      {hoverInsight.waveUm < 1.55
                        ? 'Hot Starlight'
                        : hoverInsight.waveUm < 3.65
                          ? 'Gas & Ice'
                          : 'Cold Heat'}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-neutral-200">
                    {hoverInsight.meaning}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-white/10 pt-1.5 font-mono text-[10px]">
                    <span className="text-white">
                      Obs: <strong>{hoverInsight.flux.toFixed(4)}</strong>
                    </span>
                    {hoverInsight.compareFlux !== null && (
                      <span className="text-sky-300">
                        Pass B: <strong>{hoverInsight.compareFlux.toFixed(4)}</strong>
                      </span>
                    )}
                    {hoverInsight.templateFlux !== null && (
                      <span className="text-emerald-300">
                        Match: <strong>{hoverInsight.templateFlux.toFixed(4)}</strong>
                      </span>
                    )}
                  </div>
                  {hoverInsight.flagText && (
                    <div className="mt-1 text-[10px] text-amber-300">
                      ⚠ {hoverInsight.flagText}
                    </div>
                  )}
                </div>
              )}

              {spectrum.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-lg border border-neutral-700 bg-neutral-900/95 px-4 py-2 text-center text-xs text-neutral-300">
                    {spectrumStatus || 'No archive spectrum loaded for this coordinate'}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-400 px-1">
              <span>Hover anywhere over the curve to inspect what each infrared wavelength detects.</span>
              {pointColors && (
                <span className="font-mono text-amber-300">
                  Multi-Date Composite (MJD {Math.min(...pointColors).toFixed(1)}–{Math.max(...pointColors).toFixed(1)})
                </span>
              )}
            </div>
          </div>

          {/* Live Plain-English Graph Reader */}
          {liveChartReading && (
            <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-3 space-y-1.5 text-[11px]">
              <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                What This Graph Is Telling You
              </div>
              <p className="text-neutral-200 leading-relaxed">
                <strong className="text-white">1. Brightness tilt:</strong> {liveChartReading.slopeClue}
              </p>
              <p className="text-neutral-300 leading-relaxed">
                <strong className="text-white">2. Feature check:</strong> {liveChartReading.detailClue}
              </p>
              <p className="text-sky-200/90 leading-relaxed">
                <strong className="text-sky-300">3. Compare dots:</strong> {liveChartReading.contrastTip}
              </p>
            </div>
          )}

          {/* Accessible hidden table */}
          <div className="sr-only" aria-live="polite">
            <table role="table">
              <caption>102-channel SPHEREx spectrum (accessible data table)</caption>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Detector</th>
                  <th>Wavelength (µm)</th>
                  <th>Flux (MJy/sr)</th>
                  <th>Uncertainty</th>
                  <th>FLAGS</th>
                </tr>
              </thead>
              <tbody>
                {spectrum.map((c) => (
                  <tr key={c.channel}>
                    <td>{c.channel}</td>
                    <td>{c.detector}</td>
                    <td>{c.wavelengthUm}</td>
                    <td>{Number.isFinite(c.fluxMjySr) ? c.fluxMjySr : '—'}</td>
                    <td>{Number.isFinite(c.uncertainty) ? c.uncertainty : '—'}</td>
                    <td>{c.flag ? flagTooltip(c.flag) : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT RAIL: Clean Identification + Collapsible Advanced Tools */}
        <aside className="w-full lg:w-[330px] xl:w-[360px] shrink-0 lg:overflow-y-auto bg-neutral-900/20 p-3 sm:p-4 space-y-3">
          {activeToolTab === 'match' && (
            <div data-tour="spectral-verdict-matches" className="space-y-3">
              {/* Confirm User Decision */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3 text-[11px] space-y-2">
                <div className="font-semibold uppercase tracking-wide text-emerald-200">
                  Lock In Your Spectral Verdict
                </div>
                <p className="text-neutral-300 leading-relaxed">
                  Based on the curve shape above, what kind of object is at this pixel? This stamps your Case Report.
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    'Cold Brown Dwarf',
                    'Variable / Young Star',
                    'Normal Field Star',
                    'Distant Galaxy / AGN',
                  ].map((choice) => {
                    const active = confirmedIdentity === choice;
                    return (
                      <button
                        key={choice}
                        type="button"
                        title={`Lock in "${choice}" as your Case Report finding for this sky target`}
                        onClick={() => setConfirmedIdentity(active ? null : choice)}
                        className={`rounded-lg border px-2 py-1.5 text-left text-[11px] font-medium transition-colors cursor-pointer ${
                          active
                            ? 'border-emerald-400 bg-emerald-500/25 text-white'
                            : 'border-white/10 bg-neutral-950/70 text-neutral-300 hover:border-emerald-400/50 hover:text-white'
                        }`}
                      >
                        {active ? `✓ ${choice}` : choice}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold uppercase tracking-wide text-neutral-200">
                    Reference Library Matches
                  </span>
                  {isFindingSimilar && (
                    <span className="font-mono text-[10px] text-sky-400">Scanning…</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Click any reference below to compare its full curve against your measured line.
                </p>
                <div className="mt-2.5 space-y-1.5">
                  {displayMatches.length > 0 ? (
                    displayMatches.slice(0, 5).map((m) => {
                      const isOverlayActive = selectedMatchIdx === m.rawIndex;
                      return (
                        <button
                          key={`${m.name}-${m.rawIndex}`}
                          type="button"
                          onClick={() => setSelectedMatchIdx(isOverlayActive ? null : m.rawIndex)}
                          className={`w-full flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            isOverlayActive
                              ? 'border-emerald-400/60 bg-emerald-500/15'
                              : 'border-white/10 bg-neutral-950/60 hover:border-white/25'
                          }`}
                        >
                          <div className="truncate mr-2">
                            <span className="block font-semibold text-white">{m.name}</span>
                            <span className="text-[10px] text-neutral-400">{m.spectral_class}</span>
                          </div>
                          <span className="font-mono font-semibold text-emerald-400 shrink-0">
                            {(m.similarity * 100).toFixed(1)}%
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded border border-dashed border-neutral-800 p-2 text-[11px] text-neutral-400">
                      {similarStatus}
                    </div>
                  )}
                </div>
              </div>

              {/* Collapsed Advanced Science Tools (Redshift & Binary Unmixing) */}
              <div className="rounded-xl border border-white/10 bg-neutral-900/35">
                <button
                  type="button"
                  onClick={() => setShowAdvancedTools((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-neutral-300 hover:text-white cursor-pointer"
                >
                  <span>Advanced Tools (Galaxy Distance &amp; Binary Split)</span>
                  <span className="font-mono text-[10px] text-neutral-400">
                    {showAdvancedTools ? 'Hide −' : 'Show +'}
                  </span>
                </button>
                {showAdvancedTools && (
                  <div className="grid grid-cols-2 gap-1.5 border-t border-white/10 p-2">
                    <button
                      type="button"
                      onClick={() => setActiveToolTab('redshift')}
                      className="rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1.5 text-[11px] font-medium text-sky-200 cursor-pointer"
                    >
                      Galaxy Redshift {looksExtragalactic ? '★' : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveToolTab('binary')}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 cursor-pointer"
                    >
                      Binary Unmix {isEpsInd ? '★' : ''}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeToolTab !== 'match' && (
            <button
              type="button"
              onClick={() => setActiveToolTab('match')}
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] py-1.5 text-[11px] font-medium text-neutral-200 cursor-pointer"
            >
              ← Back to Reference Matches
            </button>
          )}

          {activeToolTab === 'redshift' && (
            <div className="space-y-3">
              {!looksExtragalactic && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-200">
                  Note: Top match looks stellar rather than a distant galaxy, so cosmological redshift is typically near <span className="font-mono">z ≈ 0</span>. Useful when inspecting galaxies!
                </div>
              )}
              <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-3 text-[11px]">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
                  Galaxy Photo-z Solver
                </h3>
                <div className="mt-1.5">
                  Best-fit redshift:{' '}
                  <span className="font-mono font-semibold text-sky-300">
                    {photoZ.bestZ !== null ? `z = ${photoZ.bestZ.toFixed(2)}` : '—'}
                  </span>
                </div>
                {(() => {
                  const best = photoZ.bestZ;
                  const b = best !== null ? photoZ.grid[Math.round(best * 100)] || photoZ.grid[0] : null;
                  return (
                    <div className="mt-1 text-neutral-300">
                      Lookback time:{' '}
                      <span className="font-mono text-white">
                        {b ? `${b.lookbackGyr.toFixed(2)} Gyr` : '—'}
                      </span>{' '}
                      · Distance:{' '}
                      <span className="font-mono text-white">
                        {b ? `${b.dCMpc.toFixed(0)} Mpc` : '—'}
                      </span>
                    </div>
                  );
                })()}
                <svg viewBox="0 0 320 90" className="mt-2 h-[90px] w-full rounded bg-neutral-950">
                  {photoZ.grid.map((p, i) => {
                    if (i % 2) return null;
                    const x = (p.z / 2.5) * 318 + 1;
                    const y = 88 - p.p * 84;
                    return <circle key={p.z} cx={x} cy={y} r={1.2} fill="#38bdf8" />;
                  })}
                  {photoZ.bestZ !== null && (
                    <line
                      x1={(photoZ.bestZ / 2.5) * 318 + 1}
                      y1={0}
                      x2={(photoZ.bestZ / 2.5) * 318 + 1}
                      y2={90}
                      stroke="#f59e0b"
                      strokeDasharray="3 2"
                    />
                  )}
                  <text x="4" y="12" fill="#a3a3a3" fontSize="9">
                    P(z)
                  </text>
                  <text x="280" y="86" fill="#a3a3a3" fontSize="9">
                    z
                  </text>
                </svg>
              </div>

              <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="lab-z-slider" className="text-neutral-200 font-medium">
                    Shift line rulers (λ_obs = λ_rest·(1+z))
                  </label>
                  <span className="font-mono font-semibold text-amber-300">
                    z = {manualRedshiftZ.toFixed(2)}
                  </span>
                </div>
                <input
                  id="lab-z-slider"
                  type="range"
                  min={0}
                  max={2.5}
                  step={0.01}
                  value={manualRedshiftZ}
                  onChange={(e) => onZChange(Number(e.target.value))}
                  className="mt-2 w-full accent-amber-400"
                />
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {REST_LINES.map((l) => {
                    const obs = l.lambdaRestUm * (1 + manualRedshiftZ);
                    const vis = obs >= 0.75 && obs <= 5.0;
                    return (
                      <span
                        key={l.key}
                        className={`rounded border px-1.5 py-0.5 ${
                          vis ? 'border-neutral-600 text-neutral-200' : 'border-neutral-800 text-neutral-600'
                        }`}
                        style={{ borderColor: vis ? l.color : undefined }}
                      >
                        {l.label} {l.lambdaRestUm}µm → {obs.toFixed(2)}µm
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeToolTab === 'binary' && (
            <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-3 text-[11px] space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-200">
                Unresolved Binary De-blending (NNLS)
              </h3>
              {isEpsInd && unmix ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-amber-200">Epsilon Indi Ba+Bb</span>
                    <span className="rounded border border-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                      6.2″ blended pixel
                    </span>
                  </div>
                  <div>
                    Component A (T1 Brown Dwarf): <span className="font-mono text-white">a = {unmix.a.toFixed(4)}</span>
                  </div>
                  <div>
                    Component B (T6 Brown Dwarf): <span className="font-mono text-white">b = {unmix.b.toFixed(4)}</span>
                  </div>
                  <div>
                    Residual χ²_red: <span className="font-mono text-white">{unmix.chi2Red.toFixed(3)}</span>
                  </div>
                  <svg viewBox="0 0 320 120" className="mt-2 h-[120px] w-full rounded bg-neutral-950">
                    {(() => {
                      const t1 = spectrum.map(
                        (c) => 16 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.9, 2)) * (1 - 0.2 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.06, 2)))
                      );
                      const t6 = spectrum.map(
                        (c) => 9 * Math.exp(-Math.pow((c.wavelengthUm - 1.55) / 0.8, 2)) * (1 - 0.35 * Math.exp(-Math.pow((c.wavelengthUm - 1.62) / 0.07, 2)))
                      );
                      const comp = spectrum.map((_, i) => unmix.a * t1[i] + unmix.b * t6[i]);
                      const vals = [...spectrum.map((c) => c.fluxMjySr), ...comp].filter(Number.isFinite);
                      const max = vals.length ? Math.max(...vals, 1) : 1;
                      const min = vals.length ? Math.min(...vals, 0) : 0;
                      const sx = (l: number) => ((l - 0.75) / 4.25) * 318 + 1;
                      const sy = (v: number) => 118 - ((v - min) / Math.max(max - min, 1e-6)) * 114;
                      const path = (arr: number[]) => {
                        let penDown = false;
                        return arr
                          .map((v, i) => {
                            if (!Number.isFinite(v)) {
                              penDown = false;
                              return '';
                            }
                            const cmd = penDown ? 'L' : 'M';
                            penDown = true;
                            return `${cmd}${sx(spectrum[i].wavelengthUm)},${sy(v)}`;
                          })
                          .filter(Boolean)
                          .join(' ');
                      };
                      return (
                        <>
                          <path d={path(spectrum.map((c) => c.fluxMjySr))} fill="none" stroke="#fff" strokeWidth="1.2" />
                          <path d={path(comp)} fill="none" stroke="#22c55e" strokeWidth="1.2" strokeDasharray="4 2" />
                          <text x="4" y="12" fill="#fff" fontSize="9">
                            obs
                          </text>
                          <text x="26" y="12" fill="#22c55e" fontSize="9">
                            a·T1+b·T6
                          </text>
                        </>
                      );
                    })()}
                  </svg>
                </div>
              ) : (
                <p className="text-neutral-400 leading-relaxed">
                  SPHEREx&apos;s 6.2″ pixel can blend two nearby brown dwarfs into one spectrum. Load{' '}
                  <strong className="text-white">Epsilon Indi B</strong> (331.09566°, -56.80031°) to see two-component T1 + T6 non-negative least-squares unmixing live.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <InstalledCutoutsModal
        isOpen={isCutoutBrowserOpen}
        onClose={handleCloseCutoutBrowser}
        sections={readyInstalledSections}
        activeSectionId={activeInstalledSection?.section_id || null}
        currentComparatorSectionId={currentSelectedSection?.section_id || null}
        colorPalette={colorPalette}
        subtitle="Preview calibrated SPHEREx cutout stamps and select one for 102-channel spectral extraction."
        onSelect={handleSelectInstalledSection}
      />
    </div>
  );
};

export default SpectrophotometricLab;
