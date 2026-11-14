import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTelemetryStore, type SpectralChannel } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import {
  fetchInstalledSections,
  findMatchingSection,
  type InstalledSection,
} from '../lib/installedSections';

/**
 * Spectra Tab 3: Spectrophotometric Lab
 * SPECIFICATION.md §6.3.3 — 102-channel WCS-WAVE workbench (0.75–5.00 µm).
 * Capabilities: 60 FPS uPlot chart, D1–D6 super-bands, ±1σ variance bars,
 * FLAGS-as-amber-hollow-triangles, MJD coloring (R Draconis), accessible table,
 * 2-component NNLS spectral unmixing (Epsilon Indi B), galaxy photo-z χ²(z)
 * solver with Planck 2018 cosmology and interactive rest-frame line rulers.
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

function hash01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453123;
  return x - Math.floor(x);
}

/** Deterministic 102-channel spectrum for any target/pixel/epoch (WCS-WAVE-like). */
function generateSpectrum(params: {
  ra: number;
  dec: number;
  targetName: string | null;
  px: number;
  py: number;
  epochIndex: number;
  mjdBase?: number;
}): SpectralChannel[] {
  const { ra, dec, targetName, px, py, epochIndex } = params;
  const seed = Math.abs(Math.sin(ra * 0.17 + dec * 0.31 + px * 0.07 + py * 0.11));
  const name = (targetName || '').toLowerCase();
  const isWise = name.includes('wise 0855') || Math.abs(ra - 133.73712) < 0.2;
  const isBarnard = name.includes('barnard') || Math.abs(ra - 269.44639) < 0.2;
  const isRwAur = name.includes('rw aur') || Math.abs(ra - 76.95647) < 0.2;
  const isRDraconis = name.includes('r draconis') || Math.abs(ra - 248.16773) < 0.2;
  const isEpsInd = name.includes('epsilon indi') || Math.abs(ra - 331.09566) < 0.2;
  const mjd = (params.mjdBase ?? 60810) + epochIndex * 183 + hash01(px + py * 13) * 2;

  const channels: SpectralChannel[] = [];
  for (let i = 0; i < 102; i++) {
    const frac = i / 101;
    const lambdaUm = 0.75 + frac * 4.25;
    const det = detectorFor(lambdaUm);
    let flux = 10 * Math.exp(-0.35 * (lambdaUm - 1.2));
    if (isWise) {
      flux = lambdaUm < 3.4 ? 0.2 + 0.08 * hash01(i + 1) : 14 * Math.exp(-Math.pow((lambdaUm - 4.45) / 0.55, 2));
    } else if (isBarnard) {
      flux = 22 * Math.exp(-0.28 * (lambdaUm - 1.05));
      flux *= 1 - 0.18 * Math.exp(-Math.pow((lambdaUm - 1.4) / 0.08, 2));
      flux *= 1 - 0.22 * Math.exp(-Math.pow((lambdaUm - 1.9) / 0.1, 2));
    } else if (isRwAur) {
      const dim = 1 - 0.35 * Math.max(0, Math.sin(epochIndex * 1.7 + seed));
      flux = (12 + 2 * lambdaUm) * dim;
    } else if (isRDraconis) {
      const phase = ((mjd % 245) / 245) * Math.PI * 2;
      const pulse = 0.55 + 0.45 * Math.sin(phase);
      flux = (14 + 4 * Math.exp(-Math.pow((lambdaUm - 2.6) / 0.7, 2))) * pulse;
      flux *= 1 - 0.25 * Math.exp(-Math.pow((lambdaUm - 2.7) / 0.14, 2));
    } else if (isEpsInd) {
      const t1 = 16 * Math.exp(-Math.pow((lambdaUm - 1.25) / 0.9, 2)) * (1 - 0.2 * Math.exp(-Math.pow((lambdaUm - 1.25) / 0.06, 2)));
      const t6 = 9 * Math.exp(-Math.pow((lambdaUm - 1.55) / 0.8, 2)) * (1 - 0.35 * Math.exp(-Math.pow((lambdaUm - 1.62) / 0.07, 2)));
      flux = 0.62 * t1 + 0.38 * t6;
    } else {
      flux *= 1 - 0.18 * Math.exp(-Math.pow((lambdaUm - 1.42) / 0.09, 2));
      flux *= 1 - 0.22 * Math.exp(-Math.pow((lambdaUm - 2.72) / 0.14, 2));
    }
    const noise = (hash01(i * 12.9898 + ra + epochIndex * 7.3) - 0.5) * 0.35;
    flux = Math.max(0.001, flux + noise);
    const sigma = Math.max(0.02, 0.06 * flux + 0.12);
    let flag = 0;
    if (isBarnard && (det === 'D1' || det === 'D2') && hash01(i + px * 3) > 0.88) flag |= 1 << 1; // OVERFLOW
    if (hash01(i * 3.1 + py) > 0.985) flag |= 1 << 0; // TRANSIENT
    channels.push({
      channel: i + 1,
      detector: det,
      wavelengthUm: Number(lambdaUm.toFixed(4)),
      fluxMjySr: Number(flux.toFixed(5)),
      uncertainty: Number(sigma.toFixed(5)),
      flag,
    });
  }
  return channels;
}

/** Solve 2-component NNLS: min_{a,b>=0} sum(((y - a*t1 - b*t2)/s)^2). */
function solveNnls2(y: number[], t1: number[], t2: number[], s: number[]): { a: number; b: number; chi2Red: number } {
  let s11 = 0, s22 = 0, s12 = 0, sy1 = 0, sy2 = 0;
  const n = y.length;
  for (let i = 0; i < n; i++) {
    const w = 1 / Math.max(s[i] * s[i], 1e-12);
    s11 += w * t1[i] * t1[i];
    s22 += w * t2[i] * t2[i];
    s12 += w * t1[i] * t2[i];
    sy1 += w * y[i] * t1[i];
    sy2 += w * y[i] * t2[i];
  }
  const det = s11 * s22 - s12 * s12;
  let a = det !== 0 ? (s22 * sy1 - s12 * sy2) / det : 0;
  let b = det !== 0 ? (s11 * sy2 - s12 * sy1) / det : 0;
  // enforce non-negativity by projecting to feasible candidates
  const candidates: Array<[number, number]> = [[Math.max(0, a), Math.max(0, b)], [0, 0]];
  const a0 = sy1 / Math.max(s11, 1e-12); candidates.push([Math.max(0, a0), 0]);
  const b0 = sy2 / Math.max(s22, 1e-12); candidates.push([0, Math.max(0, b0)]);
  let best = { a: 0, b: 0, chi2: Infinity };
  for (const [ca, cb] of candidates) {
    let chi2 = 0;
    for (let i = 0; i < n; i++) {
      const r = (y[i] - ca * t1[i] - cb * t2[i]) / Math.max(s[i], 1e-12);
      chi2 += r * r;
    }
    if (chi2 < best.chi2) best = { a: ca, b: cb, chi2 };
  }
  a = best.a; b = best.b;
  const dof = Math.max(1, n - 2);
  return { a, b, chi2Red: best.chi2 / dof };
}

type PzPoint = { z: number; chi2: number; p: number; lookbackGyr: number; dCMpc: number };

function planckCosmo(z: number): { lookbackGyr: number; dCMpc: number } {
  // Planck 2018: H0=67.4, Ωm=0.315, ΩΛ=0.685 (flat)
  const H0 = 67.4, Om = 0.315, Ol = 0.685;
  const c = 299792.458; // km/s
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
  const tH = 9.778 / (H0 / 100); // Gyr*h? use 977.8/H0 Gyr
  const lookbackGyr = (977.8 / H0) * tl;
  return { lookbackGyr, dCMpc: dc };
}

function computePhotoZ(lambdas: number[], flux: number[], sigma: number[]): { grid: PzPoint[]; bestZ: number } {
  const valid = lambdas.map((wave, i) => ({ wave, flux: flux[i], sigma: sigma[i] }))
    .filter((point) => Number.isFinite(point.wave) && Number.isFinite(point.flux) && Number.isFinite(point.sigma));
  const grid: PzPoint[] = [];
  let best: PzPoint | null = null;
  for (let zi = 0; zi <= 250; zi++) {
    const z = zi * 0.01;
    let chi2 = 0;
    for (const point of valid) {
      const rest = point.wave / (1 + z);
      // simple emission-line + continuum template proxy
      let model = 8 * Math.exp(-0.3 * Math.max(0, rest - 0.8));
      model += 10 * Math.exp(-Math.pow((rest - 0.6563) / 0.03, 2)); // Hα
      model += 7 * Math.exp(-Math.pow((rest - 0.5007) / 0.025, 2)); // [O III]
      model += 4 * Math.exp(-Math.pow((rest - 1.282) / 0.04, 2)); // Paβ
      model += 3 * Math.exp(-Math.pow((rest - 1.6) / 0.08, 2)); // H-bump
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
  for (const p of grid) { p.p = Math.exp(-0.5 * (p.chi2 - minChi2)); sumP += p.p; }
  for (const p of grid) p.p /= Math.max(sumP, 1e-12);
  return { grid, bestZ: best ? best.z : 0 };
}

export const SpectrophotometricLab: React.FC = () => {
  const {
    ra, dec, activeTargetName, probedPixel, probeSkyPosition, activeSpectrum, activeEpochIndex,
    isSpectralBlinkSynced, manualRedshiftZ, setManualRedshiftZ, loadedCutout,
    setActiveSpectrum, setSpectrumLoading,
  } = useTelemetryStore();
  const { setZ, setRa: setUrlRa, setDec: setUrlDec, setFov: setUrlFov } = useSpectraUrlState();
  const [spectrumSourceBadge, setSpectrumSourceBadge] = useState('[Synthetic Injection Mode]');
  const [spectrumStatus, setSpectrumStatus] = useState('');
  const [installedSections, setInstalledSections] = useState<InstalledSection[]>([]);
  const [activeInstalledSection, setActiveInstalledSection] = useState<InstalledSection | null>(null);
  const [forceLiveCoordKey, setForceLiveCoordKey] = useState<string | null>(null);

  const readyInstalledSections = useMemo(
    () => installedSections.filter((s) => s.status === 'ready'),
    [installedSections]
  );

  // Live / Installed 102-Channel WCS-WAVE Hyperspectral Fetch (SPECIFICATION.md §4.1 Pipeline 2, §5.3.1)
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const fetchLiveSpectrum = async () => {
      setSpectrumLoading(true);
      setActiveSpectrum([]);
      setSpectrumSourceBadge('[Synthetic Injection Mode]');
      try {
        const position = probeSkyPosition ?? { ra, dec };
        const coordKey = `${position.ra.toFixed(5)},${position.dec.toFixed(5)}`;

        // 1. Prefer locally installed sky section spectrum so Tab 3 never re-queries IRSA needlessly
        let sections: InstalledSection[] = [];
        try {
          sections = await fetchInstalledSections(controller.signal);
          if (!cancelled) setInstalledSections(sections);
        } catch {
          // Ignore list error and check live fallback policy
        }
        if (cancelled) return;

        const matched = findMatchingSection(sections, position.ra, position.dec);
        let data: any;
        if (matched) {
          setActiveInstalledSection(matched);
          setSpectrumStatus(`Extracting 102-ch spectrum from installed "${matched.label}"…`);
          const qs = new URLSearchParams({ normalize: 'false' });
          if (probedPixel) {
            qs.set('px', String(probedPixel.x));
            qs.set('py', String(probedPixel.y));
          }
          if (isSpectralBlinkSynced) {
            qs.set('epoch', String(activeEpochIndex));
          }
          const secRes = await fetch(`/api/sections/${matched.section_id}/spectrum?${qs.toString()}`, {
            signal: controller.signal,
          });
          if (!secRes.ok) throw new Error(`HTTP ${secRes.status}`);
          data = await secRes.json();
        } else {
          setActiveInstalledSection(null);
          if (forceLiveCoordKey !== coordKey) {
            setSpectrumStatus('No installed section at this coordinate — pick an installed section or click Query Live');
            return;
          }
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
            setSpectrumStatus(task.message || 'Extracting archive spectrum');
            if (task.status === 'error') throw new Error(task.message || 'Live spectrum unavailable');
            if (task.status === 'complete') { data = task.result; break; }
          }
        }
        if (cancelled || !data) return;
        const sourceBadge = data.provenance?.source_badge;
        const hasHonestSource =
          typeof sourceBadge === 'string' &&
          (/^\[Installed\]/.test(sourceBadge) ||
            /^\[IRSA Live \(.+\)\]$/.test(sourceBadge) ||
            /^\[NASA Benchmark/.test(sourceBadge));
        if (!cancelled && hasHonestSource && Array.isArray(data.wavelengths_um) && data.wavelengths_um.length >= 102 && Array.isArray(data.flux_jy) && data.flux_jy.length >= 102) {
          const convFactor = 9.0229788e-4; // Jy per (MJy/sr) for 6.2" pixel
          const channels: SpectralChannel[] = data.wavelengths_um.map((lam: number, i: number) => ({
            channel: i + 1,
            detector: detectorFor(lam),
            wavelengthUm: lam,
            uncertainty: Number((Math.sqrt(Math.max(0, data.variance_jy2?.[i] ?? 0)) / convFactor).toFixed(5)),
            flag: data.flags?.[i] ?? 0,
            mjd: data.mjd_per_channel?.[i],
            fluxMjySr: data.channel_coverage?.[i] ? Number((data.flux_jy[i] / convFactor).toFixed(5)) : Number.NaN,
          }));
          setActiveSpectrum(channels);
          setSpectrumSourceBadge(sourceBadge as string);
          setSpectrumStatus(`${data.provenance.covered_channels}/${data.provenance.channel_count} channels covered`);
        }
      } catch {
        // Keep the deterministic fallback, with its source badge visible in the UI.
      } finally {
        if (!cancelled) setSpectrumLoading(false);
      }
    };
    fetchLiveSpectrum();
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
    setActiveSpectrum,
    setSpectrumLoading,
  ]);

  const [colorByMjd, setColorByMjd] = useState(false);
  const [flagTip, setFlagTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [similarMatches, setSimilarMatches] = useState<
    Array<{ id?: string; name: string; spectral_class: string; similarity: number; flux_curve: number[] }>
  >([]);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);

  const zRef = useRef(manualRedshiftZ);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const spectrumRef = useRef<SpectralChannel[]>([]);
  const colorByMjdRef = useRef(false);
  const specMjdRef = useRef<number[]>([]);
  const mjdRangeRef = useRef<[number, number] | null>(null);

  useEffect(() => { zRef.current = manualRedshiftZ; }, [manualRedshiftZ]);

  const epochIndex = isSpectralBlinkSynced ? activeEpochIndex : 0;
  const mjd = useMemo(() => {
    const ep = loadedCutout?.epochs?.[epochIndex];
    return (ep as any)?.mjd ?? 60810 + epochIndex * 183;
  }, [loadedCutout, epochIndex]);

  const spectrum = useMemo(() => {
    if (activeSpectrum && activeSpectrum.length >= 102) return activeSpectrum.slice(0, 102);
    return generateSpectrum({
      ra, dec, targetName: activeTargetName,
      px: probedPixel?.x ?? 16, py: probedPixel?.y ?? 16,
      epochIndex, mjdBase: 60810,
    });
  }, [activeSpectrum, ra, dec, activeTargetName, probedPixel?.x, probedPixel?.y, epochIndex]);
  useEffect(() => { spectrumRef.current = spectrum; }, [spectrum]);

  useEffect(() => {
    let cancelled = false;
    const fetchSimilar = async () => {
      if (!spectrum || spectrum.length < 10 || spectrumSourceBadge.includes('Synthetic') || spectrum.some((channel) => !Number.isFinite(channel.fluxMjySr))) return;
      setIsFindingSimilar(true);
      try {
        const fluxArr = spectrum.map((c) => c.fluxMjySr);
        const res = await fetch('/api/subjects/similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spectrum: fluxArr }),
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.matches)) {
            setSimilarMatches(data.matches);
          }
        }
      } catch {
        // Fallback gracefully
      } finally {
        if (!cancelled) setIsFindingSimilar(false);
      }
    };
    fetchSimilar();
    return () => {
      cancelled = true;
    };
  }, [spectrum, spectrumSourceBadge]);

  const isRDraconis = (activeTargetName || '').toLowerCase().includes('r draconis') || Math.abs(ra - 248.16773) < 0.2;
  const isEpsInd = (activeTargetName || '').toLowerCase().includes('epsilon indi') || Math.abs(ra - 331.09566) < 0.2;

  const perChannelMjd = useMemo(() => {
    if (spectrum.some((channel) => Number.isFinite(channel.mjd))) return spectrum.map((channel) => channel.mjd ?? Number.NaN);
    // R Draconis: spectral assembly is non-simultaneous across survey passes/epochs.
    if (!isRDraconis) return spectrum.map(() => mjd);
    return spectrum.map((c, i) => mjd + ((c.channel * 7 + i * 3) % 120) - 60);
  }, [isRDraconis, spectrum, mjd]);
  useEffect(() => { colorByMjdRef.current = colorByMjd && isRDraconis; }, [colorByMjd, isRDraconis]);
  useEffect(() => { specMjdRef.current = perChannelMjd; }, [perChannelMjd]);
  useEffect(() => {
    const arr = perChannelMjd.filter(Number.isFinite);
    mjdRangeRef.current = arr.length ? [Math.min(...arr), Math.max(...arr)] : null;
  }, [perChannelMjd]);
  useEffect(() => { if (plotRef.current) plotRef.current.redraw(false); }, [colorByMjd, perChannelMjd]);

  const data = useMemo((): uPlot.AlignedData => {
    const x = spectrum.map((c) => c.wavelengthUm);
    const y = spectrum.map((c) => c.fluxMjySr);
    return [x, y];
  }, [spectrum]);

  // Epsilon Indi B NNLS unmixing
  const unmix = useMemo(() => {
    if (!isEpsInd) return null;
    const y = spectrum.map((c) => c.fluxMjySr);
    const s = spectrum.map((c) => c.uncertainty);
    const t1 = spectrum.map((c) => 16 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.9, 2)) * (1 - 0.2 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.06, 2))));
    const t6 = spectrum.map((c) => 9 * Math.exp(-Math.pow((c.wavelengthUm - 1.55) / 0.8, 2)) * (1 - 0.35 * Math.exp(-Math.pow((c.wavelengthUm - 1.62) / 0.07, 2))));
    return solveNnls2(y, t1, t6, s);
  }, [isEpsInd, spectrum]);

  const photoZ = useMemo(() => {
    const lambdas = spectrum.map((c) => c.wavelengthUm);
    const flux = spectrum.map((c) => c.fluxMjySr);
    const sig = spectrum.map((c) => c.uncertainty);
    return computePhotoZ(lambdas, flux, sig);
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
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(d.id, x0 + 4, top + 12);
      }
      ctx.restore();
    };
    const drawErrorsFlagsAndRulers = (u: uPlot) => {
      const ctx = u.ctx;
      const spec = spectrumRef.current;
      ctx.save();
      // error bars
      ctx.strokeStyle = 'rgba(148,163,184,0.55)';
      ctx.lineWidth = 1;
      for (let i = 0; i < spec.length; i++) {
        const c = spec[i];
        const x = u.valToPos(c.wavelengthUm, 'x', true);
        const y0 = u.valToPos(c.fluxMjySr - c.uncertainty, 'y', true);
        const y1 = u.valToPos(c.fluxMjySr + c.uncertainty, 'y', true);
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      }
      // optional MJD coloring (R Draconis non-simultaneous spectrum assembly)
      if (colorByMjdRef.current && mjdRangeRef.current) {
        const [m0, m1] = mjdRangeRef.current;
        for (let i = 0; i < spec.length; i++) {
          const c = spec[i];
          const x = u.valToPos(c.wavelengthUm, 'x', true);
          const y = u.valToPos(c.fluxMjySr, 'y', true);
          const m = specMjdRef.current[i] ?? m0;
          const t = m1 > m0 ? (m - m0) / (m1 - m0) : 0;
          const hue = 210 - 180 * Math.max(0, Math.min(1, t)); // blue->amber
          ctx.fillStyle = `hsl(${hue} 85% 62%)`;
          ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      // flags as amber hollow triangles
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < spec.length; i++) {
        const c = spec[i];
        if (!c.flag) continue;
        const x = u.valToPos(c.wavelengthUm, 'x', true);
        const y = u.valToPos(c.fluxMjySr, 'y', true);
        const s = 5;
        ctx.beginPath();
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath();
        ctx.stroke();
      }
      // redshift rulers
      const z = zRef.current;
      for (const line of REST_LINES) {
        const obs = line.lambdaRestUm * (1 + z);
        if (obs < 0.75 || obs > 5.0) continue;
        const x = u.valToPos(obs, 'x', true);
        ctx.strokeStyle = line.color;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = line.color;
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(`${line.label} z=${z.toFixed(2)}`, x + 3, u.bbox.top + 24);
      }
      ctx.restore();
    };

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth || 900,
      height: 420,
      padding: [16, 12, 0, 0],
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false, min: 0.75, max: 5.0 }, y: { auto: true } },
      axes: [
        { stroke: '#a3a3a3', grid: { stroke: 'rgba(148,163,184,0.15)' }, label: 'Wavelength λ (µm)' },
        { stroke: '#a3a3a3', grid: { stroke: 'rgba(148,163,184,0.15)' }, label: 'Flux (MJy/sr)' },
      ],
      series: [
        {},
        {
          label: 'Fν',
          stroke: '#ffffff',
          width: 1.5,
          points: { show: true, size: 4, fill: '#ffffff', stroke: '#0a0a0a' },
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
      const left = e.clientX - rect.left;
      const idx = plot.posToIdx(left);
      const c = spectrumRef.current[idx];
      if (c && c.flag) setFlagTip({ x: e.clientX, y: e.clientY, text: flagTooltip(c.flag) });
      else setFlagTip(null);
    };
    const onLeave = () => setFlagTip(null);
    plot.over.addEventListener('mousemove', onMove);
    plot.over.addEventListener('mouseleave', onLeave);

    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) plot.setSize({ width: Math.floor(ent.contentRect.width), height: 420 });
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

  // Update data when spectrum changes (<1.5ms/frame typical for 102 points)
  useEffect(() => {
    if (plotRef.current) plotRef.current.setData(data, true);
  }, [data]);

  // Redshift slider: update store + URL and redraw rulers at 60 FPS (no data rebuild)
  const onZChange = useCallback((val: number) => {
    zRef.current = val;
    setManualRedshiftZ(val);
    setZ(val);
    // redraw overlays (rulers) without rebuilding series data
    if (plotRef.current) plotRef.current.redraw(false);
  }, [setManualRedshiftZ, setZ]);

  const pointColors = useMemo(() => {
    if (!isRDraconis || !colorByMjd) return null;
    return perChannelMjd;
  }, [isRDraconis, colorByMjd, perChannelMjd]);

  return (
    <div className="flex h-full min-h-[720px] bg-neutral-950 text-neutral-100">
      <div className="flex min-w-0 flex-1 flex-col border-r border-neutral-800">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-white">Tab 3 — Spectrophotometric Lab</h2>
            <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[10px] text-neutral-300">102 channels · 0.75–5.00 µm · λ vs Fν (MJy/sr)</span>
            <span className={`rounded px-2 py-0.5 font-mono text-[10px] ${spectrumSourceBadge.includes('Synthetic') ? 'bg-amber-950/60 text-amber-300' : spectrumSourceBadge.startsWith('[Installed]') ? 'bg-emerald-950/60 text-emerald-300' : 'bg-sky-950/60 text-sky-300'}`}>{spectrumSourceBadge}</span>
            {readyInstalledSections.length > 0 && (
              <select
                aria-label="Installed section for spectrum"
                value={activeInstalledSection?.section_id || ''}
                onChange={(e) => {
                  const chosen = readyInstalledSections.find((s) => s.section_id === e.target.value);
                  if (!chosen) return;
                  setForceLiveCoordKey(null);
                  setUrlRa(Number(chosen.ra.toFixed(5)));
                  setUrlDec(Number(chosen.dec.toFixed(5)));
                  setUrlFov(Math.round(chosen.fov_arcsec || 180));
                  useTelemetryStore.setState({
                    ra: chosen.ra,
                    dec: chosen.dec,
                    activeTargetName: chosen.label,
                    probeSkyPosition: { ra: chosen.ra, dec: chosen.dec },
                  });
                }}
                className="max-w-[200px] rounded border border-emerald-700/60 bg-emerald-950/60 px-2 py-0.5 text-[10px] text-emerald-200 focus:outline-none"
                title="Use an installed section for 102-channel extraction"
              >
                {!activeInstalledSection && (
                  <option value="">Installed ({readyInstalledSections.length})</option>
                )}
                {readyInstalledSections.map((sec) => (
                  <option key={sec.section_id} value={sec.section_id}>
                    {sec.label}
                  </option>
                ))}
              </select>
            )}
            {!activeInstalledSection && (
              <button
                type="button"
                onClick={() => {
                  const position = probeSkyPosition ?? { ra, dec };
                  setForceLiveCoordKey(`${position.ra.toFixed(5)},${position.dec.toFixed(5)}`);
                }}
                className="rounded border border-cyan-700/60 bg-cyan-950/50 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-900/60"
                title="Query IRSA live for this coordinate without installing"
              >
                Query Live Spectrum
              </button>
            )}
            <span className="rounded bg-sky-950/60 px-2 py-0.5 font-mono text-[10px] text-sky-300">probe px ({probedPixel?.x ?? 16},{probedPixel?.y ?? 16})</span>
            {isSpectralBlinkSynced && <span className="rounded bg-emerald-950/60 px-2 py-0.5 text-[10px] text-emerald-300">Spectral blink synced (epoch {epochIndex})</span>}
            {spectrumStatus && <span className="text-[10px] text-neutral-400">{spectrumStatus}</span>}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            Target: <span className="font-mono text-neutral-200">{activeTargetName || 'Custom RA/Dec'}</span> · RA {ra.toFixed(5)}° Dec {dec.toFixed(5)}° ·
            shaded D1–D6 super-bands · ±1σ VARIANCE bars · amber hollow triangles = FLAGS≠0 (hover for bitmask tooltip).
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500">
            <span><span className="inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-amber-400 align-middle" /> Bit 0 TRANSIENT</span>
            <span><span className="inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-amber-400 align-middle" /> Bit 1 OVERFLOW</span>
            <span>uPlot canvas, 102 points (&lt;1.5 ms/frame updates)</span>
          </div>
          {isRDraconis && (
            <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-neutral-300">
              <input type="checkbox" checked={colorByMjd} onChange={(e) => setColorByMjd(e.target.checked)} />
              Color points by observation MJD (R Draconis, [Non-Simultaneous Spectrum], MJD {mjd.toFixed(2)})
            </label>
          )}
        </div>

        <div className="relative min-h-0 flex-1 p-3">
          <div ref={chartRef} className="h-[420px] w-full rounded border border-neutral-800 bg-neutral-950" aria-label="102-channel hyperspectral plot" />
          {flagTip && (
            <div className="pointer-events-none fixed z-50 max-w-xs rounded border border-amber-500/50 bg-neutral-900 px-2 py-1 text-[11px] text-amber-200 shadow" style={{ left: flagTip.x + 10, top: flagTip.y + 10 }}>
              {flagTip.text}
            </div>
          )}
          {/* MJD color legend for R Draconis */}
          {pointColors && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-400">
              <span>Observation MJD:</span>
              <span className="font-mono text-amber-300">{Math.min(...pointColors).toFixed(1)}–{Math.max(...pointColors).toFixed(1)}</span>
              <span className="rounded border border-amber-500/40 px-1 text-amber-300">[Non-Simultaneous Spectrum]</span>
            </div>
          )}
          {/* Accessible hidden table */}
          <div className="sr-only" aria-live="polite">
            <table role="table">
              <caption>102-channel SPHEREx spectrum (accessible data table)</caption>
              <thead><tr><th>Channel</th><th>Detector</th><th>Wavelength (µm)</th><th>Flux (MJy/sr)</th><th>Uncertainty</th><th>FLAGS</th></tr></thead>
              <tbody>
                {spectrum.map((c) => (
                  <tr key={c.channel}>
                    <td>{c.channel}</td><td>{c.detector}</td><td>{c.wavelengthUm}</td><td>{c.fluxMjySr}</td><td>{c.uncertainty}</td><td>{c.flag ? flagTooltip(c.flag) : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Photo-z / χ²(z) + P(z) */}
        <div className="border-t border-neutral-800 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">Automated Galaxy Photo-z Solver (Planck 2018: H0=67.4, Ωm=0.315, ΩΛ=0.685)</h3>
          <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3 text-[11px]">
              <div>Best-fit redshift: <span className="font-mono font-semibold text-sky-300">z = {photoZ.bestZ.toFixed(2)}</span> (grid Δz=0.01, z∈[0,2.5])</div>
              {(() => { const b = photoZ.grid[Math.round(photoZ.bestZ * 100)] || photoZ.grid[0]; return (
                <div className="mt-1 text-neutral-300">Lookback time: <span className="font-mono text-white">{b.lookbackGyr.toFixed(2)} Gyr</span> · Comoving distance D_C: <span className="font-mono text-white">{b.dCMpc.toFixed(0)} Mpc</span></div>
              ); })()}
              <svg viewBox="0 0 320 90" className="mt-2 h-[90px] w-full rounded bg-neutral-950">
                {photoZ.grid.map((p, i) => {
                  if (i % 2) return null;
                  const x = (p.z / 2.5) * 318 + 1;
                  const y = 88 - p.p * 84;
                  return <circle key={p.z} cx={x} cy={y} r={1.2} fill="#38bdf8" />;
                })}
                <line x1={(photoZ.bestZ/2.5)*318+1} y1={0} x2={(photoZ.bestZ/2.5)*318+1} y2={90} stroke="#f59e0b" strokeDasharray="3 2" />
                <text x="4" y="12" fill="#a3a3a3" fontSize="9">P(z)</text>
                <text x="280" y="86" fill="#a3a3a3" fontSize="9">z</text>
              </svg>
            </div>
            <div className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="flex items-center justify-between text-[11px]">
                <label htmlFor="lab-z-slider" className="text-neutral-300">Redshift ruler scrubber (λ_obs = λ_rest·(1+z))</label>
                <span className="font-mono font-semibold text-amber-300">z = {manualRedshiftZ.toFixed(3)}</span>
              </div>
              <input id="lab-z-slider" type="range" min={0} max={2.5} step={0.01} value={manualRedshiftZ}
                onChange={(e) => onZChange(Number(e.target.value))} className="mt-2 w-full accent-amber-400" />
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                {REST_LINES.map((l) => {
                  const obs = l.lambdaRestUm * (1 + manualRedshiftZ);
                  const vis = obs >= 0.75 && obs <= 5.0;
                  return <span key={l.key} className={`rounded border px-1.5 py-0.5 ${vis ? 'border-neutral-600 text-neutral-200' : 'border-neutral-800 text-neutral-600'}`} style={{ borderColor: vis ? l.color : undefined }}>{l.label} {l.lambdaRestUm}µm → {obs.toFixed(3)}µm</span>;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: NNLS unmixing / controls */}
      <aside className="w-[360px] shrink-0 overflow-y-auto bg-neutral-900/20 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">Two-Component NNLS Spectral Unmixing</h3>
        {isEpsInd && unmix ? (
          <div className="mt-2 rounded border border-amber-500/30 bg-amber-950/10 p-3 text-[11px]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold text-amber-200">Epsilon Indi Ba+Bb (blended 6.2″ pixel)</span>
              <span className="rounded border border-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">[Illustrative Two-Component De-blend]</span>
            </div>
            <div>Component A (T1 Brown Dwarf): weight <span className="font-mono text-white">a = {unmix.a.toFixed(4)}</span></div>
            <div>Component B (T6 Brown Dwarf): weight <span className="font-mono text-white">b = {unmix.b.toFixed(4)}</span></div>
            <div>Residual reduced chi-square: <span className="font-mono text-white">χ²_red = {unmix.chi2Red.toFixed(3)}</span></div>
            <div className="mt-2 text-neutral-400">Model: min<sub>a,b≥0</sub> Σ((F_obs(λ_k)-[a·T1(λ_k)+b·T6(λ_k)])/σ_k)², k=1..102.</div>
            <svg viewBox="0 0 320 120" className="mt-2 h-[120px] w-full rounded bg-neutral-950">
              {(() => {
                const t1 = spectrum.map((c) => 16 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.9, 2)) * (1 - 0.2 * Math.exp(-Math.pow((c.wavelengthUm - 1.25) / 0.06, 2))));
                const t6 = spectrum.map((c) => 9 * Math.exp(-Math.pow((c.wavelengthUm - 1.55) / 0.8, 2)) * (1 - 0.35 * Math.exp(-Math.pow((c.wavelengthUm - 1.62) / 0.07, 2))));
                const comp = spectrum.map((_, i) => unmix.a * t1[i] + unmix.b * t6[i]);
                const vals = [...spectrum.map(c=>c.fluxMjySr), ...comp];
                const max = Math.max(...vals, 1); const min = Math.min(...vals, 0);
                const sx = (l: number) => ((l - 0.75) / 4.25) * 318 + 1;
                const sy = (v: number) => 118 - ((v - min) / Math.max(max - min, 1e-6)) * 114;
                const path = (arr: number[]) => arr.map((v,i)=>`${i?'L':'M'}${sx(spectrum[i].wavelengthUm)},${sy(v)}`).join(' ');
                return (<>
                  <path d={path(spectrum.map(c=>c.fluxMjySr))} fill="none" stroke="#fff" strokeWidth="1.2" />
                  <path d={path(comp)} fill="none" stroke="#22c55e" strokeWidth="1.2" strokeDasharray="4 2" />
                  <text x="4" y="12" fill="#fff" fontSize="9">obs</text><text x="26" y="12" fill="#22c55e" fontSize="9">a·T1+b·T6</text>
                </>);
              })()}
            </svg>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-neutral-500">Unmixing panel activates for Epsilon Indi B (Epoch 2025.5: 331.09566°, -56.80031°). Select that benchmark/coordinate to see T1+T6 de-blend, weights a/b, residual χ²_red, and the illustrative badge.</p>
        )}

        {/* Spectral Similarity Matches (POST /api/subjects/similar) */}
        <div className="mt-4 rounded border border-neutral-800 bg-neutral-900/40 p-3 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-neutral-300">
              SIMD Spectral Match (10k Templates)
            </span>
            {isFindingSimilar && (
              <span className="font-mono text-[10px] text-sky-400">Scanning...</span>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {similarMatches.length > 0 ? (
              similarMatches.slice(0, 4).map((m, idx) => (
                <div
                  key={m.id || idx}
                  className="flex items-center justify-between rounded bg-neutral-950/60 px-2 py-1"
                >
                  <div className="truncate mr-2">
                    <span className="font-medium text-white">{m.name}</span>
                    <span className="ml-1 text-[10px] text-neutral-400">({m.spectral_class})</span>
                  </div>
                  <span className="font-mono font-semibold text-emerald-400 shrink-0">
                    {(m.similarity * 100).toFixed(1)}%
                  </span>
                </div>
              ))
            ) : (
              <div className="text-neutral-500 text-[10px]">Evaluating SIMD cosine similarity...</div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded border border-neutral-800 bg-neutral-950/40 p-3 text-[11px] text-neutral-400">
          <div className="font-semibold text-neutral-300">Pixel → Spectrum link (Tab 2 contract)</div>
          <div className="mt-1">Reads <span className="font-mono">useTelemetryStore.probedPixel</span> / <span className="font-mono">activeSpectrum</span> (set by Tab 2 on pixel click). When no 102-ch spectrum is loaded, generates a deterministic 102-channel preview for the current target, pixel, and epoch.</div>
        </div>
      </aside>
    </div>
  );
};

export default SpectrophotometricLab;
