import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTelemetryStore, type SpectralChannel } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
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

const REST_LINES: Array<{ key: string; label: string; lambdaRestUm: number; color: string }> = [
  { key: 'Ha', label: 'Hα', lambdaRestUm: 0.6563, color: '#ef4444' },
  { key: 'OIII', label: '[O III]', lambdaRestUm: 0.5007, color: '#22c55e' },
  { key: 'PaB', label: 'Paβ', lambdaRestUm: 1.282, color: '#38bdf8' },
  { key: 'HBump', label: '1.6µm H-bump', lambdaRestUm: 1.6, color: '#a78bfa' },
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

  const { installedSections } = useInstalledSectionState();
  const [spectrumSourceBadge, setSpectrumSourceBadge] = useState('[Loading Archive Spectrum…]');
  const [spectrumStatus, setSpectrumStatus] = useState('');
  const [spectralFidelity, setSpectralFidelity] = useState<SpectralFidelity>('broadband_6_interpolated');
  const [forceLiveCoordKey, setForceLiveCoordKey] = useState<string | null>(null);
  const [isCutoutBrowserOpen, setIsCutoutBrowserOpen] = useState(false);

  const [overlayEpoch, setOverlayEpoch] = useState(false);
  const [epochCompareChannels, setEpochCompareChannels] = useState<SpectralChannel[]>([]);
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('match');
  const [selectedMatchIdx, setSelectedMatchIdx] = useState<number | null>(0);

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
      const buildCacheKey = (id: string, rev: string | number) =>
        `${id}:${rev}:${probedPixel?.x ?? ''}:${probedPixel?.y ?? ''}:${isSpectralBlinkSynced ? activeEpochIndex : ''}:${isForcedFullRes ? 'full' : 'std'}`;

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
          if (isSpectralBlinkSynced) {
            qs.set('epoch', String(activeEpochIndex));
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
    forceLiveCoordKey,
    readySectionsKey,
    setActiveSpectrum,
    setSpectrumLoading,
  ]);

  // Fetch single-epoch comparison curve when overlayEpoch is toggled on
  useEffect(() => {
    if (!overlayEpoch || isSpectralBlinkSynced || !activeInstalledSection) {
      setEpochCompareChannels([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const qs = new URLSearchParams({
      normalize: 'false',
      epoch: String(activeEpochIndex),
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
  }, [overlayEpoch, isSpectralBlinkSynced, activeInstalledSection, activeEpochIndex, probedPixel?.x, probedPixel?.y]);

  const [colorByMjd, setColorByMjd] = useState(false);
  const [flagTip, setFlagTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [similarMatches, setSimilarMatches] = useState<
    Array<{ id?: string; name: string; spectral_class: string; similarity: number; flux_curve: number[] }>
  >([]);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [similarStatus, setSimilarStatus] = useState('Awaiting spectrum for template match');

  const zRef = useRef(manualRedshiftZ);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const spectrumRef = useRef<SpectralChannel[]>([]);
  const colorByMjdRef = useRef(false);
  const specMjdRef = useRef<number[]>([]);
  const mjdRangeRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    zRef.current = manualRedshiftZ;
  }, [manualRedshiftZ]);

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
    const y = spectrum.map((c) => (Number.isFinite(c.fluxMjySr) ? c.fluxMjySr : null));
    const yEpoch =
      overlayEpoch && !isSpectralBlinkSynced && epochCompareChannels.length >= 102
        ? epochCompareChannels.slice(0, 102).map((c) => (Number.isFinite(c.fluxMjySr) ? c.fluxMjySr : null))
        : x.map(() => null);
    const yTemplate = scaledTemplateOverlay || x.map(() => null);
    return [x, y, yEpoch, yTemplate];
  }, [spectrum, overlayEpoch, isSpectralBlinkSynced, epochCompareChannels, scaledTemplateOverlay]);

  const epochDeltaPct = useMemo(() => {
    if (!overlayEpoch || isSpectralBlinkSynced || epochCompareChannels.length < 102 || spectrum.length < 102) {
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
  }, [overlayEpoch, isSpectralBlinkSynced, epochCompareChannels, spectrum]);

  // Summary facts for Hero Identity Card
  const spectrumSummary = useMemo(() => {
    const finite = spectrum.filter((c) => Number.isFinite(c.fluxMjySr));
    const flaggedCount = spectrum.filter((c) => c.flag !== 0).length;
    if (finite.length === 0) {
      return { coveredCount: 0, flaggedCount: 0, peakWaveUm: null as number | null, meanFlux: null as number | null };
    }
    let peak = finite[0];
    let sum = 0;
    for (const c of finite) {
      sum += c.fluxMjySr;
      if (c.fluxMjySr > peak.fluxMjySr) peak = c;
    }
    return {
      coveredCount: finite.length,
      flaggedCount,
      peakWaveUm: peak.wavelengthUm,
      meanFlux: sum / finite.length,
    };
  }, [spectrum]);

  const topMatch = similarMatches[0] || null;
  const looksExtragalactic = useMemo(() => {
    const cls = `${topMatch?.spectral_class || ''} ${topMatch?.name || ''}`.toLowerCase();
    return ['galaxy', 'qso', 'agn', 'starburst', 'spiral', 'elliptical', 'z='].some((k) => cls.includes(k));
  }, [topMatch]);

  // Sync live finding back into Active Case
  useEffect(() => {
    const position = probeSkyPosition ?? { ra, dec };
    const targetKey =
      activeInstalledSection?.section_id || `${position.ra.toFixed(4)},${position.dec.toFixed(4)}`;
    let summary = 'No spectrum loaded';
    if (topMatch) {
      summary = `${topMatch.name} (${(topMatch.similarity * 100).toFixed(0)}%)`;
    } else if (spectrumSummary.coveredCount > 0 && spectrumSummary.peakWaveUm !== null) {
      summary = `Peak ${spectrumSummary.peakWaveUm.toFixed(2)} µm · ${spectrumSummary.coveredCount}/102 ch`;
    }
    setCaseFindings(
      {
        spectralSummary: summary,
        spectralTopClass: topMatch?.spectral_class || null,
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
      const z = zRef.current;
      for (const line of REST_LINES) {
        const obs = line.lambdaRestUm * (1 + z);
        if (obs < 0.75 || obs > 5.0) continue;
        const x = u.valToPos(obs, 'x', true);
        ctx.strokeStyle = line.color;
        ctx.globalAlpha = 0.65;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, u.bbox.top);
        ctx.lineTo(x, u.bbox.top + u.bbox.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = line.color;
        ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(`${line.label}`, x + 3, u.bbox.top + 24);
      }
      ctx.restore();
    };

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth || 720,
      height: 360,
      padding: [16, 12, 0, 0],
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
        { stroke: '#a3a3a3', grid: { stroke: 'rgba(148,163,184,0.15)' }, label: 'Wavelength λ (µm)' },
        { stroke: '#a3a3a3', grid: { stroke: 'rgba(148,163,184,0.15)' }, label: 'Brightness (MJy/sr)' },
      ],
      series: [
        {},
        {
          label: 'Observed',
          stroke: '#ffffff',
          width: 1.8,
          spanGaps: true,
          points: { show: true, size: 4, fill: '#ffffff', stroke: '#0a0a0a' },
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
      const rect = plot.over.getBoundingClientRect();
      const idx = plot.posToIdx(e.clientX - rect.left);
      const c = spectrumRef.current[idx];
      if (c && c.flag) setFlagTip({ x: e.clientX, y: e.clientY, text: flagTooltip(c.flag) });
      else setFlagTip(null);
    };
    const onLeave = () => setFlagTip(null);
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
            epochIndex={isSpectralBlinkSynced || overlayEpoch ? activeEpochIndex : null}
            colorPalette={colorPalette}
            probePixel={probedPixel ?? { x: 24, y: 24 }}
            fallbackRa={focusPos.ra}
            fallbackDec={focusPos.dec}
            fallbackFovArcsec={fovArcsec}
            onSelectPixel={handleMinimapPixelSelect}
            caption="Click any dot on the cutout to fingerprint that pixel"
          />

          <div className="rounded-xl border border-white/10 bg-neutral-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-300">
                Compare Across Time
              </span>
              <span className="font-mono text-[10px] text-sky-300">
                Epoch {activeEpochIndex}
              </span>
            </div>
            <label className="flex items-center justify-between gap-2 text-xs text-neutral-300 cursor-pointer">
              <span>Overlay Epoch {activeEpochIndex} on chart</span>
              <input
                type="checkbox"
                checked={overlayEpoch}
                disabled={isSpectralBlinkSynced || !activeInstalledSection}
                onChange={(e) => setOverlayEpoch(e.target.checked)}
                className="accent-sky-400"
              />
            </label>
            <button
              type="button"
              onClick={() => setSpectralBlinkSynced(!isSpectralBlinkSynced)}
              className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                isSpectralBlinkSynced
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
              }`}
            >
              {isSpectralBlinkSynced
                ? `Showing Epoch ${activeEpochIndex} Only`
                : 'Showing All Epochs (Coadded)'}
            </button>
            {epochDeltaPct !== null && (
              <div className="rounded-lg border border-sky-500/25 bg-sky-950/30 px-2.5 py-1.5 font-mono text-[11px] text-sky-200">
                Epoch {activeEpochIndex} vs Coadd:{' '}
                <strong>
                  {epochDeltaPct >= 0 ? '+' : ''}
                  {epochDeltaPct.toFixed(1)}%
                </strong>
              </div>
            )}
            <button
              type="button"
              onClick={() => setTab('comparator')}
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

        {/* CENTER COLUMN: Identity Verdict + Chart */}
        <section className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-neutral-800 p-3 sm:p-4 space-y-3">
          {/* Plain-English Verdict Banner */}
          <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-r from-emerald-950/35 via-neutral-900/70 to-neutral-900/70 p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                    What Is This Dot?
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      spectralFidelity === 'true_102_ch'
                        ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                        : 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    {spectralFidelity === 'true_102_ch'
                      ? 'True 102-Channel HDU 6'
                      : '6-Band Cutout Preview (D1–D6)'}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      spectrumSourceBadge.startsWith('[Installed]')
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    }`}
                  >
                    {spectrumSourceBadge}
                  </span>
                </div>
                <div className="mt-1 text-base font-semibold text-white">
                  {topMatch
                    ? `Closest match: ${topMatch.name} (${topMatch.spectral_class})`
                    : spectrumSummary.coveredCount > 0
                      ? `Infrared signature of ${displayName}`
                      : spectrumStatus || 'Select a target or click a star pixel'}
                </div>
                <p className="mt-0.5 text-xs text-neutral-300">
                  {topMatch ? (
                    <>
                      Template match confidence{' '}
                      <strong className="font-mono text-emerald-300">
                        {(topMatch.similarity * 100).toFixed(1)}%
                      </strong>
                      {spectrumSummary.peakWaveUm !== null && (
                        <>
                          {' '}
                          · Peak brightness near{' '}
                          <strong className="font-mono text-white">
                            {spectrumSummary.peakWaveUm.toFixed(2)} µm
                          </strong>
                        </>
                      )}
                      .
                    </>
                  ) : (
                    <>
                      {spectralFidelity === 'broadband_6_interpolated'
                        ? 'Preview draws smooth lines between the 6 detector bands at this pixel.'
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
                    Extract Full 102-Ch (IRSA)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTab('ice')}
                  className="rounded-lg border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/25 px-2.5 py-1.5 text-xs font-semibold text-cyan-200 transition-colors cursor-pointer"
                >
                  Check for Cosmic Ice →
                </button>
              </div>
            </div>

            {spectrumSummary.flaggedCount > 0 && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-2.5 py-1 text-[11px] text-amber-200">
                Note: {spectrumSummary.flaggedCount} channel{spectrumSummary.flaggedCount === 1 ? '' : 's'} have detector quality flags (amber triangles — hover point for details).
              </div>
            )}
          </div>

          {/* Chart Legend & uPlot */}
          <div className="rounded-xl border border-neutral-800 bg-black/50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-neutral-200">
                  <span className="inline-block h-0.5 w-4 bg-white" />
                  Observed {isSpectralBlinkSynced ? `Epoch ${activeEpochIndex}` : 'Coadd'}
                </span>
                {overlayEpoch && !isSpectralBlinkSynced && (
                  <span className="inline-flex items-center gap-1.5 text-sky-300">
                    <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sky-400" />
                    Epoch {activeEpochIndex}
                  </span>
                )}
                {scaledTemplateOverlay && selectedMatchIdx !== null && similarMatches[selectedMatchIdx] && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-300">
                    <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-emerald-400" />
                    {similarMatches[selectedMatchIdx].name} template
                  </span>
                )}
              </div>
              <span className="font-mono text-[10px] text-neutral-400">
                {spectrumStatus || '0.75–5.00 µm'}
              </span>
            </div>

            <div className="relative">
              <div
                ref={chartRef}
                className="h-[260px] sm:h-[340px] w-full rounded border border-neutral-800 bg-neutral-950"
                aria-label="102-channel hyperspectral plot"
              />
              {spectrum.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-lg border border-neutral-700 bg-neutral-900/95 px-4 py-2 text-center text-xs text-neutral-300">
                    {spectrumStatus || 'No archive spectrum loaded for this coordinate'}
                  </div>
                </div>
              )}
              {flagTip && (
                <div
                  className="pointer-events-none fixed z-50 max-w-xs rounded border border-amber-500/50 bg-neutral-900 px-2 py-1 text-[11px] text-amber-200 shadow"
                  style={{ left: flagTip.x + 10, top: flagTip.y + 10 }}
                >
                  {flagTip.text}
                </div>
              )}
            </div>

            {pointColors && (
              <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-400">
                <span>Observation MJD:</span>
                <span className="font-mono text-amber-300">
                  {Math.min(...pointColors).toFixed(1)}–{Math.max(...pointColors).toFixed(1)}
                </span>
                <span className="rounded border border-amber-500/40 px-1 text-amber-300">
                  [Non-Simultaneous Spectrum]
                </span>
              </div>
            )}
          </div>

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

        {/* RIGHT RAIL: Progressive 3-Mode Analyzers */}
        <aside className="w-full lg:w-[330px] xl:w-[360px] shrink-0 lg:overflow-y-auto bg-neutral-900/20 p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-neutral-950 p-1">
            <button
              type="button"
              onClick={() => setActiveToolTab('match')}
              className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                activeToolTab === 'match'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              1. Identify
            </button>
            <button
              type="button"
              onClick={() => setActiveToolTab('redshift')}
              className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                activeToolTab === 'redshift'
                  ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              2. Redshift {looksExtragalactic ? '★' : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveToolTab('binary')}
              className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                activeToolTab === 'binary'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              3. Binary {isEpsInd ? '★' : ''}
            </button>
          </div>

          {activeToolTab === 'match' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-neutral-900/40 p-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold uppercase tracking-wide text-neutral-200">
                    Closest Spectral Matches
                  </span>
                  {isFindingSimilar && (
                    <span className="font-mono text-[10px] text-sky-400">Scanning…</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Click any template below to overlay its shape on your spectrum chart.
                </p>
                <div className="mt-2.5 space-y-1.5">
                  {similarMatches.length > 0 ? (
                    similarMatches.slice(0, 5).map((m, idx) => {
                      const isOverlayActive = selectedMatchIdx === idx;
                      return (
                        <button
                          key={m.id || idx}
                          type="button"
                          onClick={() => setSelectedMatchIdx(isOverlayActive ? null : idx)}
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

              <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-3 text-[11px] space-y-2">
                <div className="font-semibold text-cyan-200">
                  Next: Could ice be hiding in front of this star?
                </div>
                <p className="text-neutral-300 leading-relaxed">
                  Cold stars and stars behind dust clouds can look alike in broadband light. Open Ice Studio at this exact pixel to test for frozen H₂O (3.05 µm) and CO₂ (4.27 µm).
                </p>
                <button
                  type="button"
                  onClick={() => setTab('ice')}
                  className="w-full rounded-lg border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/25 py-1.5 text-xs font-semibold text-cyan-200 cursor-pointer"
                >
                  Open in Ice Studio →
                </button>
              </div>
            </div>
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
