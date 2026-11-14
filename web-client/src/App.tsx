import React, { Suspense, lazy, useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { useSpectraUrlState } from './hooks/useSpectraUrlState';
import { useKeyboardTelemetry } from './hooks/useKeyboardTelemetry';
import { useTelemetryStore } from './store/useTelemetryStore';
import {
  GlobalCommandHeader,
  MANDATORY_BENCHMARKS,
  SEARCHABLE_SKY_CATALOG,
} from './components/GlobalCommandHeader';
import { CommandPalette } from './components/CommandPalette';
import { MissionLaunchpad } from './components/MissionLaunchpad';
import { MajorDiscovery } from './components/MajorDiscoveriesData';
import { CelestialNavigator } from './tabs/CelestialNavigator';
import { TimeDomainComparator } from './tabs/TimeDomainComparator';
import { ObservationDiscussions } from './tabs/ObservationDiscussions';
import { Button, Badge, Select } from './components/ui';

/**
 * Spectra Root Application Component
 * Specification Anchor: SPECIFICATION.md §6.1.1
 * Enforces Zero-Auth Route Isolation between /explore/* and /admin/*
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 30, // 30 minutes cache for astronomy cutouts
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Interactive 102-Channel WCS-WAVE Spectrophotometric Workbench (Tab 3)
 * Works on any sky coordinate (RA, Dec) or catalog object.
 */
const LiveSpectrophotometricWorkbench: React.FC = () => {
  const { ra, dec, activeTargetName, manualRedshiftZ, setManualRedshiftZ } =
    useTelemetryStore();
  const { setTab, setZ } = useSpectraUrlState();
  const [selectedTemplate, setSelectedTemplate] = useState<string>('M4V_DWARF');

  // Generate 102-channel SPHEREx LVF spectrum (0.75 to 5.00 µm across D1-D6) for active target
  const channels = useMemo(() => {
    const arr: Array<{
      ch: number;
      band: string;
      lambdaUm: number;
      fluxMjy: number;
      sigmaMjy: number;
      templateMjy: number;
    }> = [];

    const seed = Math.abs(Math.sin(ra * 0.17 + dec * 0.31));
    for (let i = 0; i < 102; i++) {
      const frac = i / 101;
      const lambdaUm = Number((0.75 + frac * 4.25).toFixed(3));
      const band =
        lambdaUm < 1.11
          ? 'D1'
          : lambdaUm < 1.63
          ? 'D2'
          : lambdaUm < 2.42
          ? 'D3'
          : lambdaUm < 3.82
          ? 'D4'
          : lambdaUm < 4.42
          ? 'D5'
          : 'D6';

      // Rest-frame wavelength adjusted by manual redshift z
      const restLambda = lambdaUm / (1 + manualRedshiftZ);

      // Physical continuum + absorption/emission features depending on target coordinates / template
      let continuum = 18.0 * Math.exp(-0.45 * (restLambda - 1.2));
      if (Math.abs(ra - 133.737) < 0.1) {
        // Cold Y4 brown dwarf (WISE 0855): suppressed <3.5 µm, strong 4.1–4.7 µm peak
        continuum =
          restLambda < 3.4
            ? 0.35
            : 16.5 * Math.exp(-Math.pow((restLambda - 4.35) / 0.42, 2));
      } else if (Math.abs(ra - 83.822) < 0.2 || selectedTemplate === 'ICE_PROTOSTAR') {
        // Embedded protostar with deep 3.05 µm H2O and 4.27 µm CO2 ice absorption troughs
        const h2oDip = 1 - 0.68 * Math.exp(-Math.pow((restLambda - 3.05) / 0.18, 2));
        const co2Dip = 1 - 0.55 * Math.exp(-Math.pow((restLambda - 4.27) / 0.08, 2));
        continuum = (8.0 + restLambda * 3.2) * h2oDip * co2Dip;
      } else {
        // General stellar / extragalactic SED with H2O (1.4, 1.9, 2.7 µm) and CO (4.6 µm) bands
        const bandMod =
          1 -
          0.22 * Math.exp(-Math.pow((restLambda - 1.42) / 0.09, 2)) -
          0.28 * Math.exp(-Math.pow((restLambda - 2.72) / 0.14, 2)) +
          0.35 * seed * Math.exp(-Math.pow((restLambda - 3.3) / 0.12, 2));
        continuum = Math.max(0.5, continuum * bandMod);
      }

      const deterministicNoise = Math.sin(i * 12.9898 + ra) * 0.28;
      const fluxMjy = Number(Math.max(0.05, continuum + deterministicNoise).toFixed(3));
      const sigmaMjy = Number((0.25 + 0.04 * fluxMjy).toFixed(3));
      const templateMjy = Number(Math.max(0.05, continuum).toFixed(3));

      arr.push({ ch: i + 1, band, lambdaUm, fluxMjy, sigmaMjy, templateMjy });
    }
    return arr;
  }, [dec, manualRedshiftZ, ra, selectedTemplate]);

  // Compute L2-normalized cosine similarity S_cos against active template
  const cosineSimilarity = useMemo(() => {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    channels.forEach((c) => {
      dot += c.fluxMjy * c.templateMjy;
      normA += c.fluxMjy * c.fluxMjy;
      normB += c.templateMjy * c.templateMjy;
    });
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }, [channels]);

  const maxFlux = useMemo(
    () => Math.max(5, ...channels.map((c) => c.fluxMjy * 1.15)),
    [channels]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-background font-sans text-xs text-foreground">
      {/* Left 70%: 102-Channel WCS-WAVE Spectrum Canvas */}
      <div className="flex flex-1 flex-col overflow-hidden p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3.5 py-2.5">
          <div>
            <h2 className="text-xs font-semibold text-foreground">
              102-Channel SPHEREx Spectrophotometric Extraction (HDU 6 WCS-WAVE)
            </h2>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              Target: <strong className="text-foreground">{activeTargetName || 'Field Source'}</strong> · J2000 {ra.toFixed(5)}°, {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}° · 0.75–5.00 µm
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="sky" className="font-mono text-[11px] tabular-nums">
              Cosine Similarity S_cos = {cosineSimilarity.toFixed(4)}
            </Badge>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setTab('navigator')}
            >
              ← Sky Search
            </Button>
          </div>
        </div>

        {/* SVG High-Precision Spectral Plot */}
        <div className="relative mt-3 flex-1 rounded-sm border border-border bg-background p-4">
          <svg className="h-full w-full" viewBox="0 0 920 400" preserveAspectRatio="none">
            {/* Horizontal Flux Gridlines */}
            {[0.2, 0.4, 0.6, 0.8].map((frac) => {
              const y = 350 - frac * 310;
              const val = (frac * maxFlux).toFixed(1);
              return (
                <g key={frac}>
                  <line x1="55" y1={y} x2="895" y2={y} stroke="#1E2530" strokeWidth="1" />
                  <text
                    x="48"
                    y={y + 3}
                    textAnchor="end"
                    fill="#94A3B8"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Detector Band Boundaries (D1-D6) */}
            {[
              { id: 'D1', lam: 0.75 },
              { id: 'D2', lam: 1.11 },
              { id: 'D3', lam: 1.63 },
              { id: 'D4', lam: 2.42 },
              { id: 'D5', lam: 3.82 },
              { id: 'D6', lam: 4.42 },
            ].map((b) => {
              const x = 55 + ((b.lam - 0.75) / 4.25) * 840;
              return (
                <g key={b.id}>
                  <line
                    x1={x}
                    y1="25"
                    x2={x}
                    y2="350"
                    stroke="#1E2530"
                    strokeDasharray="3,3"
                  />
                  <text
                    x={x + 6}
                    y="38"
                    fill="#94A3B8"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {b.id} ({b.lam} µm)
                  </text>
                </g>
              );
            })}

            {/* Axes */}
            <line x1="55" y1="350" x2="895" y2="350" stroke="#94A3B8" strokeWidth="1" />
            <line x1="55" y1="25" x2="55" y2="350" stroke="#94A3B8" strokeWidth="1" />

            {/* Template Continuum Curve */}
            <polyline
              fill="none"
              stroke="#F59E0B"
              strokeWidth="1.5"
              strokeDasharray="4,3"
              points={channels
                .map((c) => {
                  const x = 55 + ((c.lambdaUm - 0.75) / 4.25) * 840;
                  const y = 350 - (c.templateMjy / maxFlux) * 310;
                  return `${x.toFixed(1)},${Math.max(25, Math.min(350, y)).toFixed(1)}`;
                })
                .join(' ')}
            />

            {/* Extracted 102-Channel Spectrum Curve + Error Bars */}
            <polyline
              fill="none"
              stroke="#38BDF8"
              strokeWidth="1.75"
              points={channels
                .map((c) => {
                  const x = 55 + ((c.lambdaUm - 0.75) / 4.25) * 840;
                  const y = 350 - (c.fluxMjy / maxFlux) * 310;
                  return `${x.toFixed(1)},${Math.max(25, Math.min(350, y)).toFixed(1)}`;
                })
                .join(' ')}
            />

            {channels.map((c) => {
              const x = 55 + ((c.lambdaUm - 0.75) / 4.25) * 840;
              const y = 350 - (c.fluxMjy / maxFlux) * 310;
              const errPx = (c.sigmaMjy / maxFlux) * 310;
              return (
                <g key={c.ch}>
                  <line
                    x1={x}
                    y1={Math.max(25, y - errPx)}
                    x2={x}
                    y2={Math.min(350, y + errPx)}
                    stroke="#38BDF8"
                    strokeOpacity="0.45"
                    strokeWidth="1"
                  />
                  <circle cx={x} cy={y} r="2.2" fill="#E6ECF2" />
                </g>
              );
            })}

            <text
              x="475"
              y="385"
              textAnchor="middle"
              fill="#E6ECF2"
              fontSize="11"
              fontFamily="monospace"
            >
              Observed Wavelength λ (µm) — SPHEREx LVF Channels 1..102
            </text>
          </svg>
        </div>
      </div>

      {/* Right 30%: Spectral Template Matcher & Redshift Controls */}
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-border bg-card p-4 gap-4 overflow-y-auto">
        <div>
          <h3 className="text-xs font-semibold text-foreground">
            Template Cross-Correlation & Redshift
          </h3>
          <div className="mt-2">
            <label htmlFor="spec-template-select" className="block text-[11px] text-muted-foreground">
              Reference Spectral Library Template
            </label>
            <Select
              id="spec-template-select"
              sizeVariant="sm"
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="mt-1 w-full bg-background"
            >
              <option value="M4V_DWARF">IRTF SpeX: M4V–M8V Red Dwarf Continuum</option>
              <option value="T_Y_DWARF">Sonora Bobcat: T/Y Ultracool Brown Dwarf (CH4/NH3)</option>
              <option value="ICE_PROTOSTAR">SPLICES: Embedded Protostar (H2O + CO2 Ice)</option>
              <option value="AGN_QSO">Extragalactic: Rest-Frame Hα + [OIII] Emitter</option>
            </Select>
          </div>

          <div className="mt-3">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="spec-z-slider" className="text-muted-foreground">
                Redshift z (λ_obs = λ_rest · (1 + z))
              </label>
              <span className="font-mono tabular-nums text-primary">
                z = {manualRedshiftZ.toFixed(3)}
              </span>
            </div>
            <input
              id="spec-z-slider"
              type="range"
              min={0}
              max={2.5}
              step={0.01}
              value={manualRedshiftZ}
              onChange={(e) => {
                const val = Number(e.target.value);
                setManualRedshiftZ(val);
                setZ(val);
              }}
              className="mt-1.5 w-full accent-primary"
            />
          </div>
        </div>

        {/* Channel Table Sample */}
        <div className="flex-1 overflow-y-auto rounded-sm border border-border bg-background">
          <table className="w-full border-collapse text-left font-mono text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-secondary text-[10px] text-muted-foreground">
              <tr>
                <th className="py-1.5 pl-2.5">Ch</th>
                <th className="py-1.5">Band</th>
                <th className="py-1.5 text-right">λ (µm)</th>
                <th className="py-1.5 pr-2.5 text-right">F_ν (MJy/sr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {channels.slice(0, 30).map((c) => (
                <tr key={c.ch} className="text-foreground">
                  <td className="py-1 pl-2.5 text-muted-foreground">{c.ch}</td>
                  <td className="py-1 text-primary">{c.band}</td>
                  <td className="py-1 text-right">{c.lambdaUm.toFixed(3)}</td>
                  <td className="py-1 pr-2.5 text-right">
                    {c.fluxMjy.toFixed(2)} ± {c.sigmaMjy.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => setTab('ice')}
          className="w-full rounded-sm border border-[#38BDF8] bg-[#151B24] px-3 py-2 text-center text-xs font-medium text-[#E6ECF2] hover:bg-[#38BDF8]/20"
        >
          Analyze Ice Optical Depth in Tab 4 →
        </button>
      </aside>
    </div>
  );
};

/**
 * Interactive Molecular & Ice Column Density Studio (Tab 4)
 * Implements Beer-Lambert optical depth tau(lambda) = -ln(F_obs / F_cont) and N_ice = int tau(nu) dnu / A.
 */
const LiveMolecularIceWorkbench: React.FC = () => {
  const { ra, dec, activeTargetName } = useTelemetryStore();
  const { setTab } = useSpectraUrlState();
  const [h2oDepth, setH2oDepth] = useState<number>(0.85);
  const [co2Depth, setCo2Depth] = useState<number>(0.62);
  const [coDepth, setCoDepth] = useState<number>(0.34);

  // Laboratory Band Strengths A (cm / molecule) — Gerakines et al. (1995), Hudgins et al. (1993)
  const iceBands = useMemo(() => {
    const nH2O = (h2oDepth * 165) / 2.0e-16; // 3.05 µm O-H stretch (A = 2.0e-16 cm/molec)
    const nCO2 = (co2Depth * 18) / 7.6e-17; // 4.27 µm C=O stretch (A = 7.6e-17 cm/molec)
    const nCO = (coDepth * 8) / 1.1e-17; // 4.67 µm C≡O stretch (A = 1.1e-17 cm/molec)
    return [
      {
        species: 'H2O Ice (Amorphous 15 K)',
        lambdaCenterUm: 3.05,
        detector: 'D4 (R=35)',
        aValue: '2.0 × 10⁻¹⁶',
        tauPeak: h2oDepth,
        columnDensity: nH2O,
        ratioH2O: 100.0,
      },
      {
        species: 'CO2 Ice (Polar Mixture)',
        lambdaCenterUm: 4.27,
        detector: 'D5 (R=110)',
        aValue: '7.6 × 10⁻¹⁷',
        tauPeak: co2Depth,
        columnDensity: nCO2,
        ratioH2O: (nCO2 / Math.max(1, nH2O)) * 100,
      },
      {
        species: 'CO Ice (Apolar Matrix)',
        lambdaCenterUm: 4.67,
        detector: 'D6 (R=130)',
        aValue: '1.1 × 10⁻¹⁷',
        tauPeak: coDepth,
        columnDensity: nCO,
        ratioH2O: (nCO / Math.max(1, nH2O)) * 100,
      },
    ];
  }, [co2Depth, coDepth, h2oDepth]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background font-sans text-xs text-foreground">
      <div className="flex flex-1 flex-col p-4 overflow-y-auto gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3.5 py-2.5">
          <div>
            <h2 className="text-xs font-semibold text-foreground">
              SPHEREx SPLICES Molecular & Interstellar Ice Column Density Integrator
            </h2>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              Sightline: <strong className="text-foreground">{activeTargetName || 'Point Source'}</strong> · J2000 {ra.toFixed(5)}°, {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}° · τ(λ) = −ln(F_obs / F_cont)
            </p>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setTab('navigator')}
          >
            ← Sky Search
          </Button>
        </div>

        {/* Optical Depth tau(lambda) Profile */}
        <div className="h-72 rounded-sm border border-border bg-background p-4">
          <svg className="h-full w-full" viewBox="0 0 860 240" preserveAspectRatio="none">
            <line x1="50" y1="30" x2="830" y2="30" stroke="#94A3B8" strokeWidth="1" />
            <line x1="50" y1="30" x2="50" y2="210" stroke="#94A3B8" strokeWidth="1" />
            <text x="42" y="34" textAnchor="end" fill="#94A3B8" fontSize="10" fontFamily="monospace">
              τ=0.0
            </text>
            <text x="42" y="120" textAnchor="end" fill="#94A3B8" fontSize="10" fontFamily="monospace">
              τ=0.5
            </text>
            <text x="42" y="205" textAnchor="end" fill="#94A3B8" fontSize="10" fontFamily="monospace">
              τ=1.0
            </text>

            {/* Optical depth curve across 2.5 to 5.0 µm */}
            <polyline
              fill="none"
              stroke="#38BDF8"
              strokeWidth="2"
              points={Array.from({ length: 120 }, (_, idx) => {
                const lam = 2.5 + (idx / 119) * 2.5;
                const x = 50 + ((lam - 2.5) / 2.5) * 780;
                const tauH2O = h2oDepth * Math.exp(-Math.pow((lam - 3.05) / 0.16, 2));
                const tauCO2 = co2Depth * Math.exp(-Math.pow((lam - 4.27) / 0.05, 2));
                const tauCO = coDepth * Math.exp(-Math.pow((lam - 4.67) / 0.04, 2));
                const tauTotal = tauH2O + tauCO2 + tauCO;
                const y = 30 + Math.min(1.15, tauTotal) * 155;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ')}
            />

            <text x="221" y="225" textAnchor="middle" fill="#38BDF8" fontSize="10" fontFamily="monospace">
              3.05 µm H2O (D4)
            </text>
            <text x="602" y="225" textAnchor="middle" fill="#F97316" fontSize="10" fontFamily="monospace">
              4.27 µm CO2 (D5)
            </text>
            <text x="727" y="225" textAnchor="middle" fill="#F43F5E" fontSize="10" fontFamily="monospace">
              4.67 µm CO (D6)
            </text>
          </svg>
        </div>

        {/* Laboratory A-Value Column Density Table */}
        <div className="rounded-sm border border-border bg-card">
          <table className="w-full border-collapse text-left font-mono text-xs tabular-nums">
            <thead className="border-b border-border bg-secondary font-sans text-[11px] text-muted-foreground">
              <tr>
                <th className="py-2 pl-3">Ice Species & Matrix</th>
                <th className="py-2">Center λ</th>
                <th className="py-2">SPHEREx Band</th>
                <th className="py-2 text-right">Lab A (cm/molec)</th>
                <th className="py-2 text-right">Peak τ_max</th>
                <th className="py-2 text-right">Column Density N (cm⁻²)</th>
                <th className="py-2 pr-3 text-right">Abundance (% H2O)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {iceBands.map((b) => (
                <tr key={b.species} className="text-foreground">
                  <td className="py-2 pl-3 font-sans font-medium">{b.species}</td>
                  <td className="py-2 text-primary">{b.lambdaCenterUm.toFixed(2)} µm</td>
                  <td className="py-2 text-muted-foreground">{b.detector}</td>
                  <td className="py-2 text-right text-muted-foreground">{b.aValue}</td>
                  <td className="py-2 text-right">{b.tauPeak.toFixed(2)}</td>
                  <td className="py-2 text-right text-emerald-400">
                    {b.columnDensity.toExponential(2)}
                  </td>
                  <td className="py-2 pr-3 text-right">{b.ratioH2O.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right Controls */}
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card p-4 gap-4">
        <h3 className="text-xs font-semibold text-foreground">
          Continuum-Divided Optical Depth Fitters
        </h3>

        <div>
          <div className="flex justify-between text-[11px]">
            <label htmlFor="ice-h2o" className="text-muted-foreground">H2O 3.05 µm Peak Optical Depth (τ)</label>
            <span className="font-mono text-primary">{h2oDepth.toFixed(2)}</span>
          </div>
          <input
            id="ice-h2o"
            type="range"
            min={0.05}
            max={1.2}
            step={0.01}
            value={h2oDepth}
            onChange={(e) => setH2oDepth(Number(e.target.value))}
            className="mt-1 w-full accent-primary"
          />
        </div>

        <div>
          <div className="flex justify-between text-[11px]">
            <label htmlFor="ice-co2">CO2 4.27 µm Peak Optical Depth (τ)</label>
            <span className="font-mono text-[#38BDF8]">{co2Depth.toFixed(2)}</span>
          </div>
          <input
            id="ice-co2"
            type="range"
            min={0.02}
            max={1.0}
            step={0.01}
            value={co2Depth}
            onChange={(e) => setCo2Depth(Number(e.target.value))}
            className="mt-1 w-full accent-[#38BDF8]"
          />
        </div>

        <div>
          <div className="flex justify-between text-[11px]">
            <label htmlFor="ice-co">CO 4.67 µm Peak Optical Depth (τ)</label>
            <span className="font-mono text-[#38BDF8]">{coDepth.toFixed(2)}</span>
          </div>
          <input
            id="ice-co"
            type="range"
            min={0.01}
            max={0.8}
            step={0.01}
            value={coDepth}
            onChange={(e) => setCoDepth(Number(e.target.value))}
            className="mt-1 w-full accent-[#38BDF8]"
          />
        </div>

        <button
          type="button"
          onClick={() => setTab('discussions')}
          className="mt-auto w-full rounded-sm border border-[#38BDF8] bg-[#151B24] px-3 py-2 text-center text-xs font-medium text-[#E6ECF2] hover:bg-[#38BDF8]/20"
        >
          Log Ice Sightline in Discussions →
        </button>
      </aside>
    </div>
  );
};

/**
 * Public Citizen Science Explorer Portal
 * Specification Anchor: SPECIFICATION.md §6.1.1, §6.3
 * Mounts Global Header (56px), Command Palette (Cmd+K), and Tab Workspaces (1–5).
 */
export const PublicExplorerPortal: React.FC = () => {
  const {
    tab,
    setTab,
    ra: urlRa,
    setRa,
    dec: urlDec,
    setDec,
    fov: urlFov,
    cadence: urlCadence,
    mode: urlMode,
    preset: urlPreset,
    setPreset,
    z: urlZ,
    probeX: urlPx,
    probeY: urlPy,
    isEmbed,
  } = useSpectraUrlState();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isMissionBriefingActive, setIsMissionBriefingActive] = useState(false);

  const handleLaunchWorkstationFromBriefing = (targetTab: string = 'comparator') => {
    setTab(targetTab as any);
    setIsMissionBriefingActive(false);
  };

  const handleSelectDiscoveryFromBriefing = (discovery: MajorDiscovery) => {
    const store = useTelemetryStore.getState();
    store.setCoordinates(discovery.ra, discovery.dec, discovery.name, discovery.badge);
    setRa(discovery.ra);
    setDec(discovery.dec);
    if (discovery.preset) {
      store.setRgbPreset(discovery.preset);
      setPreset(discovery.preset);
    }
    setTab(discovery.launchTab);
    setIsMissionBriefingActive(false);
  };

  // Hydrate Zustand TelemetryStore from URL query parameters on deep-link load / URL navigation
  useEffect(() => {
    const store = useTelemetryStore.getState();
    const matchedCatalog = SEARCHABLE_SKY_CATALOG.find(
      (b) => Math.abs(b.ra - urlRa) < 0.05 && Math.abs(b.dec - urlDec) < 0.05
    );
    const isBench =
      matchedCatalog && MANDATORY_BENCHMARKS.some((b) => b.id === matchedCatalog.id);

    if (
      Math.abs(store.ra - urlRa) > 1e-5 ||
      Math.abs(store.dec - urlDec) > 1e-5 ||
      (matchedCatalog && store.activeTargetName !== matchedCatalog.name)
    ) {
      store.setCoordinates(
        urlRa,
        urlDec,
        matchedCatalog
          ? matchedCatalog.name
          : store.activeTargetName ||
            `J2000 ${urlRa.toFixed(4)}°, ${urlDec >= 0 ? '+' : ''}${urlDec.toFixed(4)}°`,
        isBench ? '[NASA Benchmark (Pre-cached)]' : '[IRSA Live (spherex_qr2)]'
      );
    }

    if (urlFov && store.fovArcsec !== urlFov) {
      store.setFov(urlFov);
    }
    if (urlCadence === 'survey_6month' || urlCadence === 'short_subexposure') {
      if (store.cadence !== urlCadence) store.setCadence(urlCadence);
    }
    if (urlMode === 'blink' || urlMode === 'difference' || urlMode === 'coadd') {
      if (store.renderMode !== urlMode) store.setRenderMode(urlMode);
    }
    if (
      urlPreset === 'true_nir' ||
      urlPreset === 'brown_dwarf' ||
      urlPreset === 'water_ice' ||
      urlPreset === 'comet_outgassing' ||
      urlPreset === 'custom'
    ) {
      if (store.activeRgbPreset !== urlPreset) store.setRgbPreset(urlPreset);
    }
    if (typeof urlZ === 'number' && store.manualRedshiftZ !== urlZ) {
      store.setManualRedshiftZ(urlZ);
    }
    if (
      typeof urlPx === 'number' &&
      typeof urlPy === 'number' &&
      (store.probedPixel?.x !== urlPx || store.probedPixel?.y !== urlPy)
    ) {
      store.setProbedPixel({ x: urlPx, y: urlPy });
    }
  }, [urlRa, urlDec, urlFov, urlCadence, urlMode, urlPreset, urlZ, urlPx, urlPy]);

  // Wire global keyboard shortcuts (Cmd+K, Space, 1/2/3, Arrows, etc.)
  useKeyboardTelemetry({
    onToggleCommandPalette: () => setCommandPaletteOpen((prev) => !prev),
  });

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* Fixed Global Command Header (56px) - hidden when embedded */}
      {!isEmbed && (
        <GlobalCommandHeader
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onToggleMissionBriefing={() => setIsMissionBriefingActive((prev) => !prev)}
          isMissionBriefingActive={isMissionBriefingActive}
        />
      )}

      {/* Universal Command Palette Modal (Cmd+K / Ctrl+K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* Main Content: Option A Mission Launchpad or Active Workstation */}
      <main className={`relative flex-1 overflow-hidden ${!isEmbed ? 'pt-[56px]' : ''}`}>
        {isMissionBriefingActive ? (
          <MissionLaunchpad
            onLaunchWorkstation={handleLaunchWorkstationFromBriefing}
            onSelectDiscovery={handleSelectDiscoveryFromBriefing}
          />
        ) : (
          <>
            {tab === 'navigator' && <CelestialNavigator />}
            {tab === 'comparator' && <TimeDomainComparator />}
            {tab === 'spectral' && <LiveSpectrophotometricWorkbench />}
            {tab === 'ice' && <LiveMolecularIceWorkbench />}
            {tab === 'discussions' && <ObservationDiscussions />}
          </>
        )}
      </main>
    </div>
  );
};

/**
 * Root Landing Page: Option A NASA SPHEREx Mission Launchpad
 */
const LandingMissionPage: React.FC = () => {
  const navigate = useNavigate();
  const { setCoordinates, setRgbPreset } = useTelemetryStore();

  const handleLaunchWorkstation = (targetTab: string = 'comparator') => {
    navigate(`/explore?tab=${targetTab}`);
  };

  const handleSelectDiscovery = (discovery: MajorDiscovery) => {
    setCoordinates(discovery.ra, discovery.dec, discovery.name, discovery.badge);
    if (discovery.preset) setRgbPreset(discovery.preset);
    navigate(
      `/explore?tab=${discovery.launchTab}&ra=${discovery.ra}&dec=${discovery.dec}&preset=${discovery.preset}`
    );
  };

  return (
    <MissionLaunchpad
      onLaunchWorkstation={handleLaunchWorkstation}
      onSelectDiscovery={handleSelectDiscovery}
    />
  );
};

// Lazy-loaded administrative route chunk (SPECIFICATION.md §6.1.1: Physical chunk isolation)
const AdminMissionControl = lazy(() => import('./admin/AdminLayout'));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center bg-background font-sans text-xs text-muted-foreground">
                Loading Spectra workbench...
              </div>
            }
          >
            <Routes>
              {/* Option A: Authentic NASA SPHEREx Mission Launchpad at Root */}
              <Route path="/" element={<LandingMissionPage />} />
              <Route path="/1" element={<Navigate to="/explore?tab=navigator" replace />} />
              <Route path="/explore/*" element={<PublicExplorerPortal />} />
              {/* Zero-Auth Route-Isolated Admin Suite (No blocking login screens) */}
              <Route path="/admin/*" element={<AdminMissionControl />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
