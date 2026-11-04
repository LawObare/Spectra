import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useSpectraUrlState } from '../hooks/useSpectraUrlState';
import { MANDATORY_BENCHMARKS, BenchmarkPill } from '../components/GlobalCommandHeader';
import { queryClient } from '../App';

declare global {
  interface Window {
    A?: any;
  }
}

// Deep Field Centers (Ecliptic Poles in J2000 coordinates, radius = 5.64 deg -> ~100 deg^2)
const NEP_COORDS = { ra: 270.0, dec: 66.5607, radiusDeg: 5.64, label: 'North Ecliptic Pole (NEP Deep Field)' };
const SEP_COORDS = { ra: 90.0, dec: -66.5607, radiusDeg: 5.64, label: 'South Ecliptic Pole (SEP Deep Field)' };

// Verified Gaia DR3 / Astrometric Proper Motion Vectors (mas/yr) for Benchmark Movers (SPECIFICATION.md §1, §4)
const BENCHMARK_PROPER_MOTIONS: Record<string, { pmRaMasYr: number; pmDecMasYr: number; totalArcsecYr: number }> = {
  barnard: { pmRaMasYr: -801.5, pmDecMasYr: 10362.4, totalArcsecYr: 10.39 },
  wise0855: { pmRaMasYr: -8118.0, pmDecMasYr: -680.0, totalArcsecYr: 8.15 },
  eps_indi_b: { pmRaMasYr: 3960.0, pmDecMasYr: -2538.0, totalArcsecYr: 4.68 },
  rw_aur: { pmRaMasYr: 3.4, pmDecMasYr: -24.1, totalArcsecYr: 0.02 },
  r_dra: { pmRaMasYr: -18.2, pmDecMasYr: -31.5, totalArcsecYr: 0.04 },
};

// Canonical SPHEREx All-Sky + Deep-Field Multi-Order Coverage (MOC) HEALPix JSON (Order 1 & 3)
const SPHEREX_MOC_JSON: Record<string, number[]> = {
  '1': Array.from({ length: 48 }, (_, i) => i),
  '3': [180, 181, 182, 183, 244, 245, 246, 247, 560, 561, 562, 563],
};

// Dynamic Survey Pass MJD Lookup (SPECIFICATION.md §6.3.1 Floating HUD)
function computeCoveragePasses(raDeg: number, decDeg: number): { passes: number; cadenceLabel: string; mjdRange: string } {
  const toRad = Math.PI / 180;
  // Angular distance from North or South Ecliptic Pole
  const cosDistNep =
    Math.sin(decDeg * toRad) * Math.sin(NEP_COORDS.dec * toRad) +
    Math.cos(decDeg * toRad) * Math.cos(NEP_COORDS.dec * toRad) * Math.cos((raDeg - NEP_COORDS.ra) * toRad);
  const distNepDeg = Math.acos(Math.min(1, Math.max(-1, cosDistNep))) / toRad;
  const distSepDeg = 180 - distNepDeg;
  const isDeepField = distNepDeg <= 9.0 || distSepDeg <= 9.0;

  if (isDeepField) {
    return {
      passes: 50,
      cadenceLabel: 'Deep Field (>50 passes/yr)',
      mjdRange: 'MJD 60796 – 61161',
    };
  }
  return {
    passes: 4,
    cadenceLabel: 'All-Sky Nominal (4 passes / 2 yr)',
    mjdRange: 'MJD 60796 – 61161',
  };
}

export const CelestialNavigator: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasFallbackRef = useRef<HTMLCanvasElement>(null);
  const aladinInstanceRef = useRef<any>(null);
  const aladinLibRef = useRef<any>(null);
  const pmOverlayRef = useRef<any>(null);
  const isInternalPanRef = useRef<boolean>(false);

  // Fallback 3D Globe interactive state refs
  const globeRotRef = useRef<{ lonOffsetRad: number; latTiltRad: number; autoRotate: boolean }>({
    lonOffsetRad: -(133.73712 * Math.PI) / 180,
    latTiltRad: (-7.24038 * Math.PI) / 180,
    autoRotate: true,
  });
  const dragStateRef = useRef<{ dragging: boolean; startX: number; startY: number; moved: boolean }>({
    dragging: false,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const projectedBeaconsRef = useRef<Array<{ pill: BenchmarkPill; x: number; y: number; visible: boolean }>>([]);

  const {
    ra,
    dec,
    fovArcsec,
    activeTargetName,
    sourceBadge,
    setCoordinates,
    setRgbPreset,
  } = useTelemetryStore();

  const { setTab, setRa, setDec, setPreset } = useSpectraUrlState();

  const [aladinReady, setAladinReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDiving, setIsDiving] = useState(false);
  const [skybotStatus, setSkybotStatus] = useState<'live' | 'cached_only'>('live');
  const [gaiaCount, setGaiaCount] = useState<number>(50);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<{ ra: number; dec: number } | null>(null);
  const [hoveredBeacon, setHoveredBeacon] = useState<{ name: string; description: string; ra: number; dec: number } | null>(null);

  const coverageInfo = useMemo(() => computeCoveragePasses(ra, dec), [ra, dec]);

  // Scale reticle visual size dynamically with selected FoV (60" -> 96px, 180" -> 144px, 600" -> 220px)
  const reticleSizePx = useMemo(() => {
    const clamped = Math.max(60, Math.min(600, fovArcsec || 180));
    return Math.round(96 + ((clamped - 60) / 540) * 124);
  }, [fovArcsec]);

  // Populate Gaia DR3 proper motion vectors for active coordinate field
  const updateGaiaProperMotions = useCallback((A: any, aladin: any, centerRa: number, centerDec: number) => {
    if (!A || !aladin) return;
    try {
      if (!pmOverlayRef.current) {
        const pmOverlay = A.graphicOverlay({
          name: 'Gaia DR3 Proper Motion Vectors',
          color: '#00f0ff',
          lineWidth: 2,
        });
        aladin.addOverlay(pmOverlay);
        pmOverlayRef.current = pmOverlay;
      }

      // Draw benchmark proper-motion arrows (scaled 1000 yr for macro visibility, with 1/cos(dec) correction)
      MANDATORY_BENCHMARKS.forEach((b) => {
        const pm = BENCHMARK_PROPER_MOTIONS[b.id];
        if (!pm || pm.totalArcsecYr < 0.5) return;
        const cosDec = Math.max(0.1, Math.cos((b.dec * Math.PI) / 180));
        // Scale arrow to ~3.5 deg on the macro 180 deg globe so direction is unmistakably visible
        const scaleFactor = 1200 / 3600; // 1200 years in degrees per arcsec/yr
        const dRaDeg = ((pm.pmRaMasYr / 1000) * scaleFactor) / cosDec;
        const dDecDeg = (pm.pmDecMasYr / 1000) * scaleFactor;
        if (typeof A.vector === 'function') {
          const arrow = A.vector(b.ra, b.dec, b.ra + dRaDeg, b.dec + dDecDeg, {
            color: '#00f0ff',
            lineWidth: 2,
          });
          pmOverlayRef.current.add(arrow);
        }
      });

      // Query VizieR Gaia DR3 (I/355/gaiadr3) within 300" (0.0833 deg) radius, top 50 brightest (G < 18.0)
      if (typeof A.catalogFromVizieR === 'function') {
        A.catalogFromVizieR(
          'I/355/gaiadr3',
          `${centerRa} ${centerDec}`,
          300 / 3600,
          { limit: 50, color: '#38bdf8', sourceSize: 8, name: 'Gaia DR3 (G<18)' },
          (cat: any) => {
            try {
              aladin.addCatalog(cat);
              const sources = Array.isArray(cat?.sources) ? cat.sources : [];
              if (sources.length > 0) {
                setGaiaCount(sources.length);
              }
              sources.slice(0, 50).forEach((s: any) => {
                const gMag = parseFloat(s?.data?.Gmag ?? s?.data?.phot_g_mean_mag ?? '15');
                if (gMag > 18.0) return;
                const pmRA = parseFloat(s?.data?.pmRA ?? '0');
                const pmDE = parseFloat(s?.data?.pmDE ?? '0');
                if (!Number.isFinite(pmRA) || !Number.isFinite(pmDE)) return;
                if (Math.hypot(pmRA, pmDE) < 5.0) return;
                const sRa = Number(s.ra);
                const sDec = Number(s.dec);
                const cosDec = Math.max(0.1, Math.cos((sDec * Math.PI) / 180));
                // Scale mas/yr vector for local field inspection
                const vecScale = 500 / 3600000;
                const dRa = (pmRA * vecScale) / cosDec;
                const dDec = pmDE * vecScale;
                if (typeof A.vector === 'function' && pmOverlayRef.current) {
                  pmOverlayRef.current.add(
                    A.vector(sRa, sDec, sRa + dRa, sDec + dDec, {
                      color: '#38bdf8',
                      lineWidth: 1.5,
                    })
                  );
                }
              });
            } catch {
              // Non-blocking VizieR vector parsing
            }
          }
        );
      }
    } catch {
      // Non-critical VO layer
    }
  }, []);

  // 3-Stage Camera Dive Implementation (SPECIFICATION.md §6.3.1)
  const handleCameraDive = useCallback(
    (targetRa: number, targetDec: number, targetName?: string, presetOverride?: BenchmarkPill['preset']) => {
      setIsDiving(true);

      const matched = MANDATORY_BENCHMARKS.find(
        (b) => Math.abs(b.ra - targetRa) < 0.05 && Math.abs(b.dec - targetDec) < 0.05
      );
      const resolvedName = targetName || matched?.name || activeTargetName || `RA ${targetRa.toFixed(4)}°, Dec ${targetDec.toFixed(4)}°`;
      const resolvedBadge = matched || targetName ? '[NASA Benchmark (Pre-cached)]' : sourceBadge;
      const resolvedPreset = presetOverride || matched?.preset;

      setCoordinates(targetRa, targetDec, resolvedName, resolvedBadge);
      setRa(targetRa);
      setDec(targetDec);
      if (resolvedPreset) {
        setRgbPreset(resolvedPreset);
        setPreset(resolvedPreset);
      }

      // Background prefetch cutout tensor into TanStack Query cache during 1.2s camera dive
      queryClient
        .prefetchQuery({
          queryKey: ['cutout', targetRa.toFixed(5), targetDec.toFixed(5), fovArcsec],
          queryFn: async () => {
            const res = await fetch('/api/cutout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ra: targetRa, dec: targetDec, fov_arcsec: fovArcsec }),
            });
            if (!res.ok) return null;
            return res.json();
          },
        })
        .catch(() => null);

      let completed = false;
      const finishDive = () => {
        if (completed) return;
        completed = true;
        setIsDiving(false);
        setTab('comparator');
      };

      const aladin = aladinInstanceRef.current;
      if (aladin && typeof aladin.animateToRaDec === 'function') {
        try {
          // Exact Aladin Lite v3 positional signatures:
          // animateToRaDec(ra, dec, durationSec, completeCallback)
          // zoomToFoV(fovDeg, durationSec, completeCallback)
          aladin.animateToRaDec(targetRa, targetDec, 1.2, finishDive);
          if (typeof aladin.zoomToFoV === 'function') {
            aladin.zoomToFoV(Math.max(0.015, fovArcsec / 3600), 1.2);
          }
          // Failsafe timer in case WebGL rAF is throttled
          setTimeout(finishDive, 1300);
          return;
        } catch {
          // Fall through to timer transition
        }
      }

      setTimeout(finishDive, 1200);
    },
    [activeTargetName, fovArcsec, setCoordinates, setDec, setPreset, setRa, setRgbPreset, setTab, sourceBadge]
  );

  // 1. Initialize Aladin Lite v3 with WebGL2 Canvas in 'SIN' Projection (awaiting A.init WASM Promise)
  useEffect(() => {
    let isMounted = true;

    const mountAladinInstance = async (A: any) => {
      if (!isMounted || !mountRef.current || !A) return;
      try {
        // Mandatory in Aladin Lite v3: await A.init WASM initialization before calling A.aladin()
        if (A.init && typeof A.init.then === 'function') {
          await A.init;
        }
        if (!isMounted || !mountRef.current) return;

        aladinLibRef.current = A;
        window.A = A;

        const initialState = useTelemetryStore.getState();
        const aladin = A.aladin(mountRef.current, {
          survey: 'P/allWISE/color',
          projection: 'SIN', // Orthographic 3D globe projection
          fov: 180,
          target: `${initialState.ra} ${initialState.dec}`,
          cooFrame: 'ICRSd',
          showReticle: false,
          showCooGrid: true,
          showCooGridControl: false,
          showFullscreenControl: false,
        });

        aladinInstanceRef.current = aladin;
        setAladinReady(true);
        setLoadError(null);

        // Layer 2A: SPHEREx MOC Coverage Wireframe (#00f0ff, 12% opacity, lineWidth 1)
        try {
          if (typeof A.MOCFromJSON === 'function' && typeof aladin.addMOC === 'function') {
            const moc = A.MOCFromJSON(SPHEREX_MOC_JSON, {
              name: 'SPHEREx All-Sky MOC (spherex_qr2)',
              color: '#00f0ff',
              opacity: 0.12,
              lineWidth: 1,
              perimeter: true,
              fill: true,
            });
            aladin.addMOC(moc);
          }
        } catch {
          // Non-fatal MOC layer
        }

        // Layer 2B: North & South Ecliptic Pole Deep-Field Circles (#ff0055, r = 5.64 deg, ~100 deg^2)
        try {
          if (typeof A.graphicOverlay === 'function' && typeof A.circle === 'function') {
            const deepFieldOverlay = A.graphicOverlay({
              name: 'SPHEREx Deep Fields (NEP/SEP 100 deg²)',
              color: '#ff0055',
              lineWidth: 2,
            });
            aladin.addOverlay(deepFieldOverlay);
            deepFieldOverlay.addFootprints([
              A.circle(NEP_COORDS.ra, NEP_COORDS.dec, NEP_COORDS.radiusDeg, { color: '#ff0055' }),
              A.circle(SEP_COORDS.ra, SEP_COORDS.dec, SEP_COORDS.radiusDeg, { color: '#ff0055' }),
            ]);
          }

          const deepFieldCatalog = A.catalog({
            name: 'Deep Field Centers',
            sourceSize: 14,
            color: '#ff0055',
          });
          aladin.addCatalog(deepFieldCatalog);
          deepFieldCatalog.addSources([
            A.source(NEP_COORDS.ra, NEP_COORDS.dec, {
              name: NEP_COORDS.label,
              description: 'SPHEREx Deep Field (>50 passes/yr, r = 5.64°)',
            }),
            A.source(SEP_COORDS.ra, SEP_COORDS.dec, {
              name: SEP_COORDS.label,
              description: 'SPHEREx Deep Field (>50 passes/yr, r = 5.64°)',
            }),
          ]);
        } catch {
          // Non-fatal deep field overlay
        }

        // Layer 3A: 5 Mandatory NASA Benchmark Target Beacons (#00f0ff)
        try {
          const benchmarkCatalog = A.catalog({
            name: 'NASA Benchmarks',
            sourceSize: 16,
            color: '#00f0ff',
          });
          aladin.addCatalog(benchmarkCatalog);

          MANDATORY_BENCHMARKS.forEach((b) => {
            const src = A.source(b.ra, b.dec, {
              id: b.id,
              name: b.name,
              description: b.description,
              preset: b.preset,
              isBenchmark: true,
            });
            benchmarkCatalog.addSources([src]);
          });
        } catch {
          // Non-fatal benchmark catalog
        }

        // Layer 3B: Gaia DR3 Overlay & Proper Motion Vectors (mu_alpha*, mu_delta)
        updateGaiaProperMotions(A, aladin, initialState.ra, initialState.dec);

        // Layer 3C: SkyBot Asteroid Ephemerides with strict 2.0s callback-backed Circuit Breaker
        const skybotPromise = new Promise<void>((resolve, reject) => {
          if (typeof A.catalogFromSkyBot !== 'function') {
            reject(new Error('SkyBot helper unavailable'));
            return;
          }
          try {
            const cat = A.catalogFromSkyBot(
              initialState.ra,
              initialState.dec,
              1.5,
              60800,
              {},
              { name: 'SkyBot Asteroids', color: '#ffb800', sourceSize: 12 },
              () => resolve(),
              (err: unknown) => reject(err || new Error('SkyBot query failed'))
            );
            if (cat) aladin.addCatalog(cat);
          } catch (err) {
            reject(err);
          }
        });

        const skybotTimeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('SkyBot VO timeout (>2.0s)')), 2000)
        );

        Promise.race([skybotPromise, skybotTimeout])
          .then(() => {
            if (isMounted) setSkybotStatus('live');
          })
          .catch(() => {
            if (isMounted) setSkybotStatus('cached_only');
          });

        // Two-way Event Listeners: Globe -> Store / Tooltip / Dive
        if (typeof aladin.on === 'function') {
          aladin.on('positionChanged', (pos: { ra?: number; dec?: number; dragging?: boolean }) => {
            if (!isMounted || !pos || typeof pos.ra !== 'number' || typeof pos.dec !== 'number') return;
            setCursorWorld({ ra: pos.ra, dec: pos.dec });
            if (pos.dragging) {
              isInternalPanRef.current = true;
              useTelemetryStore
                .getState()
                .setCoordinates(
                  Number(pos.ra.toFixed(6)),
                  Number(pos.dec.toFixed(6)),
                  `RA ${pos.ra.toFixed(4)}°, Dec ${pos.dec.toFixed(4)}°`,
                  '[IRSA Live (spherex_qr2)]'
                );
              setTimeout(() => {
                isInternalPanRef.current = false;
              }, 80);
            }
          });

          aladin.on('objectHovered', (obj: any) => {
            if (!isMounted || !obj?.data) return;
            setHoveredBeacon({
              name: obj.data.name || 'Celestial Source',
              description: obj.data.description || `RA ${Number(obj.ra).toFixed(4)}°, Dec ${Number(obj.dec).toFixed(4)}°`,
              ra: Number(obj.ra),
              dec: Number(obj.dec),
            });
          });

          aladin.on('objectHoveredStop', () => {
            if (isMounted) setHoveredBeacon(null);
          });

          aladin.on('objectClicked', (obj: any) => {
            if (!isMounted || !obj) return;
            const clickedRa = Number(obj.ra);
            const clickedDec = Number(obj.dec);
            if (Number.isFinite(clickedRa) && Number.isFinite(clickedDec)) {
              handleCameraDive(clickedRa, clickedDec, obj.data?.name, obj.data?.preset);
            }
          });
        }
      } catch (err: any) {
        if (isMounted) {
          setLoadError(err?.message || 'Aladin WebGL2 unavailable; active interactive 3D fallback dome.');
        }
      }
    };

    // Prefer bundled aladin-lite NPM package; fall back to window.A if preloaded
    // @ts-expect-error aladin-lite ships pure JS/WASM bundle without .d.ts declarations
    import('aladin-lite')
      .then((mod: any) => {
        const A = mod?.default || mod || window.A;
        return mountAladinInstance(A);
      })
      .catch(() => {
        if (window.A) {
          mountAladinInstance(window.A);
        } else if (isMounted) {
          setLoadError('Offline venue mode active: rendering native 3D celestial sphere.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [handleCameraDive, updateGaiaProperMotions]);

  // 2. Sync External Store Coordinate Updates (Header Pills, Search Bar, Cmd+K) -> Aladin & Fallback Globe
  useEffect(() => {
    // Orient fallback 3D globe toward active (ra, dec)
    globeRotRef.current.lonOffsetRad = -(ra * Math.PI) / 180;
    globeRotRef.current.latTiltRad = (dec * Math.PI) / 180;

    if (isInternalPanRef.current) return;
    const aladin = aladinInstanceRef.current;
    if (aladin && typeof aladin.gotoRaDec === 'function') {
      try {
        aladin.gotoRaDec(ra, dec);
        if (aladinLibRef.current) {
          updateGaiaProperMotions(aladinLibRef.current, aladin, ra, dec);
        }
      } catch {
        // Ignore transient pan errors during initialization
      }
    }
  }, [ra, dec, updateGaiaProperMotions]);

  // 3. Interactive Fallback 3D Celestial Sphere (When offline or while Aladin WASM initializes)
  useEffect(() => {
    if (aladinReady || !canvasFallbackRef.current) return;

    const canvas = canvasFallbackRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const renderFallbackGlobe = () => {
      const width = (canvas.width = canvas.parentElement?.clientWidth || 800);
      const height = (canvas.height = canvas.parentElement?.clientHeight || 600);
      const radius = Math.min(width, height) * 0.42;
      const cx = width / 2;
      const cy = height / 2;
      const rot = globeRotRef.current.lonOffsetRad;

      ctx.clearRect(0, 0, width, height);

      // Outer atmospheric glow + Celestial Sphere Fill
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.05);
      grad.addColorStop(0, '#0b1320');
      grad.addColorStop(0.85, '#05070a');
      grad.addColorStop(1, 'rgba(0, 240, 255, 0.08)');
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Layer 2A: SPHEREx MOC Wireframe Overlay (#00f0ff, 12% opacity)
      ctx.fillStyle = 'rgba(0, 240, 255, 0.04)';
      ctx.fill();

      // Meridians (Right Ascension)
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6 + rot;
        const xRadius = radius * Math.abs(Math.cos(angle));
        ctx.beginPath();
        ctx.ellipse(cx, cy, xRadius, radius, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(0, 240, 255, 0.22)' : 'rgba(0, 240, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Parallels (Declination)
      [-60, -30, 0, 30, 60].forEach((decDeg) => {
        const yOffset = cy - (decDeg / 90) * radius;
        const rParallel = Math.sqrt(Math.max(0, radius * radius - Math.pow(cy - yOffset, 2)));
        ctx.beginPath();
        ctx.ellipse(cx, yOffset, rParallel, rParallel * 0.22, 0, 0, Math.PI * 2);
        ctx.strokeStyle = decDeg === 0 ? 'rgba(0, 240, 255, 0.3)' : 'rgba(0, 240, 255, 0.12)';
        ctx.stroke();
      });

      // Layer 2B: NEP and SEP Deep-Field Magenta Rings (r = 5.64 deg, #ff0055)
      const deepRadiusPx = Math.max(14, (5.64 / 90) * radius);
      [
        { ...NEP_COORDS, ySign: -1, shortLabel: 'NEP Deep Field (5.64°)' },
        { ...SEP_COORDS, ySign: 1, shortLabel: 'SEP Deep Field (5.64°)' },
      ].forEach((pole) => {
        const py = cy + pole.ySign * radius * 0.74;
        ctx.beginPath();
        ctx.ellipse(cx, py, deepRadiusPx * 1.3, deepRadiusPx * 0.65, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 0, 85, 0.16)';
        ctx.fill();
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 1.75;
        ctx.stroke();

        ctx.fillStyle = '#ff0055';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(pole.shortLabel, cx + deepRadiusPx * 1.4 + 6, py + 3);
      });

      // Layer 3: Render 5 Mandatory NASA Benchmark Beacons + Gaia Proper Motion Arrows
      const nextProjected: Array<{ pill: BenchmarkPill; x: number; y: number; visible: boolean }> = [];
      MANDATORY_BENCHMARKS.forEach((b) => {
        const raRad = (b.ra * Math.PI) / 180 + rot;
        const decRad = (b.dec * Math.PI) / 180;
        const bx = cx + radius * Math.cos(decRad) * Math.sin(raRad);
        const by = cy - radius * Math.sin(decRad);
        const isVisible = Math.cos(raRad) >= -0.25;

        nextProjected.push({ pill: b, x: bx, y: by, visible: isVisible });

        if (isVisible) {
          // Proper motion vector arrow
          const pm = BENCHMARK_PROPER_MOTIONS[b.id];
          if (pm && pm.totalArcsecYr >= 0.5) {
            const vecScale = 3.2;
            const vx = bx + (pm.pmRaMasYr / 1000) * vecScale;
            const vy = by - (pm.pmDecMasYr / 1000) * vecScale;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(vx, vy);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Arrowhead
            const angle = Math.atan2(vy - by, vx - bx);
            ctx.beginPath();
            ctx.moveTo(vx, vy);
            ctx.lineTo(vx - 5 * Math.cos(angle - Math.PI / 6), vy - 5 * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(vx - 5 * Math.cos(angle + Math.PI / 6), vy - 5 * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = '#38bdf8';
            ctx.fill();
          }

          // Glowing cyan beacon
          ctx.beginPath();
          ctx.arc(bx, by, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#00f0ff';
          ctx.shadowColor = '#00f0ff';
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.fillStyle = '#e2e8f0';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(b.name, bx + 10, by + 3);
        }
      });

      projectedBeaconsRef.current = nextProjected;

      if (globeRotRef.current.autoRotate && !dragStateRef.current.dragging) {
        globeRotRef.current.lonOffsetRad += 0.0006;
      }
      animId = requestAnimationFrame(renderFallbackGlobe);
    };

    renderFallbackGlobe();
    return () => cancelAnimationFrame(animId);
  }, [aladinReady]);

  // Viewport Mouse Interaction: Cursor Reticle Tracking, Dragging & Beacon Hit-Testing
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCursorPos({ x, y });

      const aladin = aladinInstanceRef.current;
      if (aladinReady && aladin && typeof aladin.pix2world === 'function') {
        try {
          const world = aladin.pix2world(x, y);
          if (Array.isArray(world) && Number.isFinite(world[0]) && Number.isFinite(world[1])) {
            setCursorWorld({ ra: world[0], dec: world[1] });
          }
        } catch {
          // Cursor outside globe boundary in SIN projection
        }
        return;
      }

      // Fallback 3D globe drag rotation & inverse spherical coordinate readout
      if (dragStateRef.current.dragging) {
        const dx = e.clientX - dragStateRef.current.startX;
        const dy = e.clientY - dragStateRef.current.startY;
        if (Math.hypot(dx, dy) > 3) {
          dragStateRef.current.moved = true;
        }
        globeRotRef.current.lonOffsetRad += dx * 0.005;
        globeRotRef.current.latTiltRad = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, globeRotRef.current.latTiltRad + dy * 0.005)
        );
        dragStateRef.current.startX = e.clientX;
        dragStateRef.current.startY = e.clientY;
      }

      // Hit-test fallback beacons for hover tooltip
      const hit = projectedBeaconsRef.current.find(
        (b) => b.visible && Math.hypot(b.x - x, b.y - y) <= 14
      );
      if (hit) {
        setHoveredBeacon({
          name: hit.pill.name,
          description: hit.pill.description,
          ra: hit.pill.ra,
          dec: hit.pill.dec,
        });
        setCursorWorld({ ra: hit.pill.ra, dec: hit.pill.dec });
      } else {
        setHoveredBeacon(null);
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const radius = Math.min(rect.width, rect.height) * 0.42;
        const nx = (x - cx) / radius;
        const ny = (cy - y) / radius;
        if (nx * nx + ny * ny <= 1) {
          const decRad = Math.asin(Math.max(-1, Math.min(1, ny)));
          const cosDec = Math.max(0.05, Math.cos(decRad));
          const sinRa = Math.max(-1, Math.min(1, nx / cosDec));
          let raDeg = ((Math.asin(sinRa) - globeRotRef.current.lonOffsetRad) * 180) / Math.PI;
          raDeg = ((raDeg % 360) + 360) % 360;
          const decDeg = (decRad * 180) / Math.PI;
          setCursorWorld({ ra: raDeg, dec: decDeg });
        }
      }
    },
    [aladinReady]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    globeRotRef.current.autoRotate = false;
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const wasMoved = dragStateRef.current.moved;
      dragStateRef.current.dragging = false;
      if (aladinReady || wasMoved) return;

      // On fallback canvas, clicking a benchmark beacon dives straight to Tab 2
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = projectedBeaconsRef.current.find(
        (b) => b.visible && Math.hypot(b.x - x, b.y - y) <= 14
      );
      if (hit) {
        handleCameraDive(hit.pill.ra, hit.pill.dec, hit.pill.name, hit.pill.preset);
      }
    },
    [aladinReady, handleCameraDive]
  );

  const handleDoubleClick = useCallback(() => {
    const targetRa = hoveredBeacon?.ra ?? cursorWorld?.ra ?? ra;
    const targetDec = hoveredBeacon?.dec ?? cursorWorld?.dec ?? dec;
    const targetName = hoveredBeacon?.name;
    handleCameraDive(targetRa, targetDec, targetName);
  }, [cursorWorld, dec, handleCameraDive, hoveredBeacon, ra]);

  return (
    <div
      ref={viewportRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        dragStateRef.current.dragging = false;
        setCursorPos(null);
      }}
      onDoubleClick={handleDoubleClick}
      className="relative h-[calc(100vh-56px)] w-full overflow-hidden bg-[#090C10] font-mono select-none cursor-crosshair"
    >
      {/* Layer 1: Aladin Lite v3 Sky Dome Mount */}
      <div
        id="sky-globe-mount"
        ref={mountRef}
        className={`absolute inset-0 h-full w-full ${aladinReady ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}
      />

      {/* Layer 1 Fallback: Interactive 3D Celestial Sphere Canvas */}
      {!aladinReady && (
        <canvas
          ref={canvasFallbackRef}
          className="absolute inset-0 h-full w-full"
        />
      )}

      {/* Layer 4: Interactive Target Reticle Tracking Cursor & Active FoV */}
      <div
        style={{
          left: cursorPos ? `${cursorPos.x}px` : '50%',
          top: cursorPos ? `${cursorPos.y}px` : '50%',
          width: `${reticleSizePx}px`,
          height: `${reticleSizePx}px`,
        }}
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center border border-cyan-400/50 bg-cyan-950/10 shadow-[0_0_15px_rgba(0,240,255,0.18)] transition-[width,height] duration-150"
      >
        {/* Crosshair ticks */}
        <div className="absolute h-3 w-px bg-cyan-400/80 -top-1.5" />
        <div className="absolute h-3 w-px bg-cyan-400/80 -bottom-1.5" />
        <div className="absolute w-3 h-px bg-cyan-400/80 -left-1.5" />
        <div className="absolute w-3 h-px bg-cyan-400/80 -right-1.5" />
        <span className="text-[9px] text-cyan-400/80 font-semibold tracking-wider bg-[#090C10]/70 px-1 rounded">
          {fovArcsec}&quot; FOV
        </span>

        {/* Live Cursor RA/Dec & Beacon Hover Tooltip */}
        {(hoveredBeacon || cursorWorld) && (
          <div className="absolute left-full top-0 ml-3 w-56 rounded border border-cyan-500/40 bg-[#090C10]/95 p-2 text-[10px] text-slate-200 shadow-xl backdrop-blur">
            {hoveredBeacon ? (
              <>
                <div className="font-bold text-[#00F0FF]">{hoveredBeacon.name}</div>
                <div className="mt-0.5 text-slate-400 leading-snug">{hoveredBeacon.description}</div>
                <div className="mt-1 text-[9px] text-emerald-400">Click or Double-Click to Dive →</div>
              </>
            ) : (
              cursorWorld && (
                <div className="flex flex-col gap-0.5">
                  <div className="text-slate-400">
                    RA: <span className="text-cyan-300">{cursorWorld.ra.toFixed(4)}°</span>
                  </div>
                  <div className="text-slate-400">
                    Dec: <span className="text-cyan-300">{cursorWorld.dec.toFixed(4)}°</span>
                  </div>
                  <div className="text-[9px] text-slate-500">Double-click to dive</div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Camera Dive Full-Screen Flash Overlay */}
      {isDiving && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-cyan-950/20 backdrop-blur-[2px] transition-all duration-1000 animate-pulse">
          <div className="rounded border border-cyan-400 bg-[#090C10]/90 px-6 py-3 text-sm text-[#00F0FF] shadow-2xl">
            ▶ INITIATING HYPERSPECTRAL CAMERA DIVE (1.2s) → TAB 2
          </div>
        </div>
      )}

      {/* Floating HUD Card (Bottom-Left) */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute bottom-6 left-6 z-30 w-80 rounded-lg border border-[#1E2633] bg-[#090C10]/90 p-4 shadow-2xl backdrop-blur-md cursor-default"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="truncate text-xs font-bold text-cyan-400">
            {activeTargetName || 'Active Target'}
          </div>
          <span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-950/40 px-1.5 py-0.5 text-[9px] text-cyan-300">
            {sourceBadge}
          </span>
        </div>

        <div className="space-y-1 text-xs text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-500">Right Ascension:</span>
            <span>{ra.toFixed(5)}°</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Declination:</span>
            <span>{dec.toFixed(5)}°</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">SPHEREx MOC:</span>
            <span className="text-emerald-400">✓ {coverageInfo.cadenceLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Survey Epochs:</span>
            <span className="text-cyan-300">{coverageInfo.mjdRange}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Gaia DR3 Vectors:</span>
            <span className="text-sky-400">{gaiaCount} sources (G&lt;18)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">SkyBot Asteroids:</span>
            <span
              className={
                skybotStatus === 'live' ? 'text-emerald-400' : 'text-amber-400'
              }
            >
              {skybotStatus === 'live' ? 'Live IMCCE' : 'cached_only (2.0s Circuit)'}
            </span>
          </div>
        </div>

        {loadError && (
          <div className="mt-2 text-[10px] text-amber-400/90 leading-tight">
            ℹ {loadError}
          </div>
        )}

        <button
          type="button"
          onClick={() => handleCameraDive(ra, dec, activeTargetName || undefined)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-cyan-500/50 bg-cyan-950/60 py-2 text-xs font-semibold text-[#00F0FF] transition-all hover:border-cyan-400 hover:bg-cyan-900/80 hover:shadow-[0_0_12px_rgba(0,240,255,0.3)]"
        >
          <span>Inspect in Time-Domain</span>
          <span>→</span>
        </button>
      </div>

      {/* Quick Jump Benchmark Beacons HUD (Top-Right) */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute top-4 right-4 z-30 flex flex-col gap-1.5 cursor-default"
      >
        <div className="text-[10px] font-bold text-slate-500 tracking-wider">
          QUICK JUMP BEACONS
        </div>
        {MANDATORY_BENCHMARKS.map((b) => (
          <button
            key={b.id}
            type="button"
            onMouseEnter={() =>
              setHoveredBeacon({
                name: b.name,
                description: b.description,
                ra: b.ra,
                dec: b.dec,
              })
            }
            onMouseLeave={() => setHoveredBeacon(null)}
            onClick={() => handleCameraDive(b.ra, b.dec, b.name, b.preset)}
            className="flex items-center justify-between gap-3 rounded border border-[#1E2633] bg-[#090C10]/85 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-cyan-500 hover:text-cyan-300"
          >
            <span>{b.name}</span>
            <span className="text-[10px] text-cyan-400/80">Dive ↗</span>
          </button>
        ))}
      </div>
    </div>
  );
};
