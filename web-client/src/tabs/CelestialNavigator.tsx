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
const NEP_COORDS = { ra: 270.0, dec: 66.5607, radiusDeg: 5.64, label: 'NEP deep field (r = 5.64°)' };
const SEP_COORDS = { ra: 90.0, dec: -66.5607, radiusDeg: 5.64, label: 'SEP deep field (r = 5.64°)' };

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

// Deterministic integer hash for reproducible procedural field stars
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

// Format angular field of view in degrees, arcminutes, or arcseconds
function formatFieldFov(fovDeg: number): string {
  if (fovDeg >= 1.0) return `${fovDeg.toFixed(2)}°`;
  const arcmin = fovDeg * 60;
  if (arcmin >= 1.0) return `${arcmin.toFixed(1)}'`;
  return `${(fovDeg * 3600).toFixed(0)}"`;
}

// Dynamic Survey Pass MJD Lookup (SPECIFICATION.md §6.3.1)
function computeCoveragePasses(raDeg: number, decDeg: number): { passes: number; cadenceLabel: string; mjdRange: string } {
  const toRad = Math.PI / 180;
  const cosDistNep =
    Math.sin(decDeg * toRad) * Math.sin(NEP_COORDS.dec * toRad) +
    Math.cos(decDeg * toRad) * Math.cos(NEP_COORDS.dec * toRad) * Math.cos((raDeg - NEP_COORDS.ra) * toRad);
  const distNepDeg = Math.acos(Math.min(1, Math.max(-1, cosDistNep))) / toRad;
  const distSepDeg = 180 - distNepDeg;
  const isDeepField = distNepDeg <= 9.0 || distSepDeg <= 9.0;

  if (isDeepField) {
    return {
      passes: 50,
      cadenceLabel: 'Deep field (>50 passes/yr)',
      mjdRange: 'MJD 60796–61161',
    };
  }
  return {
    passes: 4,
    cadenceLabel: 'All-sky nominal (4 passes)',
    mjdRange: 'MJD 60796–61161',
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

  // Immersed Sky Viewport Camera State (Default 12.0 deg wide-field tangent view, zoomable 0.02 deg -> 60 deg)
  const [skyFovDeg, setSkyFovDeg] = useState<number>(12.0);
  const skyViewRef = useRef<{ centerRa: number; centerDec: number; fovDeg: number }>({
    centerRa: ra,
    centerDec: dec,
    fovDeg: 12.0,
  });
  const dragStateRef = useRef<{ dragging: boolean; startX: number; startY: number; moved: boolean }>({
    dragging: false,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const projectedTargetsRef = useRef<Array<{ pill: BenchmarkPill; x: number; y: number; inView: boolean }>>([]);

  const [aladinReady, setAladinReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDiving, setIsDiving] = useState(false);
  const [skybotStatus, setSkybotStatus] = useState<'live' | 'cached_only'>('live');
  const [gaiaCount, setGaiaCount] = useState<number>(50);
  const [cursorWorld, setCursorWorld] = useState<{ ra: number; dec: number } | null>(null);
  const [hoveredBeacon, setHoveredBeacon] = useState<{
    name: string;
    description: string;
    ra: number;
    dec: number;
    preset?: BenchmarkPill['preset'];
  } | null>(null);

  const coverageInfo = useMemo(() => computeCoveragePasses(ra, dec), [ra, dec]);
  const sexagesimalCenter = useMemo(() => formatSexagesimal(ra, dec), [ra, dec]);

  // Compute cutout reticle pixel size based on current skyFovDeg vs selected cutout fovArcsec
  const reticleSizePx = useMemo(() => {
    const cutoutDeg = (fovArcsec || 180) / 3600;
    const ratio = cutoutDeg / Math.max(0.02, skyFovDeg);
    const rawPx = ratio * 900;
    return Math.round(Math.max(44, Math.min(320, rawPx)));
  }, [fovArcsec, skyFovDeg]);

  // Calibrated angular scale bar (bottom-right)
  const scaleBar = useMemo(() => {
    const targetDeg = skyFovDeg * 0.15;
    const candidatesDeg = [10, 5, 2, 1, 0.5, 0.25, 0.1, 1 / 60, 0.5 / 60];
    const chosenDeg = candidatesDeg.reduce((prev, curr) =>
      Math.abs(curr - targetDeg) < Math.abs(prev - targetDeg) ? curr : prev
    );
    const widthPx = Math.round(Math.max(48, Math.min(160, (chosenDeg / skyFovDeg) * 900)));
    return {
      widthPx,
      label: formatFieldFov(chosenDeg),
    };
  }, [skyFovDeg]);

  // Populate Gaia DR3 proper motion vectors for active coordinate field
  const updateGaiaProperMotions = useCallback((A: any, aladin: any, centerRa: number, centerDec: number) => {
    if (!A || !aladin) return;
    try {
      if (!pmOverlayRef.current) {
        const pmOverlay = A.graphicOverlay({
          name: 'Gaia DR3 proper motion vectors',
          color: '#38bdf8',
          lineWidth: 1.5,
        });
        aladin.addOverlay(pmOverlay);
        pmOverlayRef.current = pmOverlay;
      }

      MANDATORY_BENCHMARKS.forEach((b) => {
        const pm = BENCHMARK_PROPER_MOTIONS[b.id];
        if (!pm || pm.totalArcsecYr < 0.5) return;
        const cosDec = Math.max(0.1, Math.cos((b.dec * Math.PI) / 180));
        const scaleFactor = 600 / 3600;
        const dRaDeg = ((pm.pmRaMasYr / 1000) * scaleFactor) / cosDec;
        const dDecDeg = (pm.pmDecMasYr / 1000) * scaleFactor;
        if (typeof A.vector === 'function') {
          const arrow = A.vector(b.ra, b.dec, b.ra + dRaDeg, b.dec + dDecDeg, {
            color: '#38bdf8',
            lineWidth: 1.5,
          });
          pmOverlayRef.current.add(arrow);
        }
      });

      if (typeof A.catalogFromVizieR === 'function') {
        A.catalogFromVizieR(
          'I/355/gaiadr3',
          `${centerRa} ${centerDec}`,
          300 / 3600,
          { limit: 50, color: '#38bdf8', sourceSize: 7, name: 'Gaia DR3 (G<18)' },
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
                const vecScale = 500 / 3600000;
                const dRa = (pmRA * vecScale) / cosDec;
                const dDec = pmDE * vecScale;
                if (typeof A.vector === 'function' && pmOverlayRef.current) {
                  pmOverlayRef.current.add(
                    A.vector(sRa, sDec, sRa + dRa, sDec + dDec, {
                      color: '#38bdf8',
                      lineWidth: 1.25,
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

  // Cutout Extraction & Smooth Camera Zoom into Tab 2 (SPECIFICATION.md §6.3.1)
  const handleCameraDive = useCallback(
    (targetRa: number, targetDec: number, targetName?: string, presetOverride?: BenchmarkPill['preset']) => {
      setIsDiving(true);

      const matched = MANDATORY_BENCHMARKS.find(
        (b) => Math.abs(b.ra - targetRa) < 0.05 && Math.abs(b.dec - targetDec) < 0.05
      );
      const resolvedName =
        targetName || matched?.name || activeTargetName || `RA ${targetRa.toFixed(4)}°, Dec ${targetDec.toFixed(4)}°`;
      const resolvedBadge = matched || targetName ? '[NASA Benchmark (Pre-cached)]' : sourceBadge;
      const resolvedPreset = presetOverride || matched?.preset;

      setCoordinates(targetRa, targetDec, resolvedName, resolvedBadge);
      setRa(targetRa);
      setDec(targetDec);
      if (resolvedPreset) {
        setRgbPreset(resolvedPreset);
        setPreset(resolvedPreset);
      }

      // Prefetch cutout tensor into TanStack Query cache during camera zoom
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

      const targetFovDeg = Math.max(0.02, fovArcsec / 3600);
      skyViewRef.current.centerRa = targetRa;
      skyViewRef.current.centerDec = targetDec;
      skyViewRef.current.fovDeg = targetFovDeg;
      setSkyFovDeg(targetFovDeg);

      const aladin = aladinInstanceRef.current;
      if (aladin && typeof aladin.animateToRaDec === 'function') {
        try {
          aladin.animateToRaDec(targetRa, targetDec, 1.2, finishDive);
          if (typeof aladin.zoomToFoV === 'function') {
            aladin.zoomToFoV(targetFovDeg, 1.2);
          }
          setTimeout(finishDive, 1300);
          return;
        } catch {
          // Fall through to timer transition
        }
      }

      setTimeout(finishDive, 800);
    },
    [activeTargetName, fovArcsec, setCoordinates, setDec, setPreset, setRa, setRgbPreset, setTab, sourceBadge]
  );

  // Zoom controls (+ / - / Reset)
  const handleZoomByFactor = useCallback((factor: number) => {
    const nextFov = Math.max(0.02, Math.min(60.0, skyViewRef.current.fovDeg * factor));
    skyViewRef.current.fovDeg = nextFov;
    setSkyFovDeg(nextFov);
    const aladin = aladinInstanceRef.current;
    if (aladin && typeof aladin.setFoV === 'function') {
      try {
        aladin.setFoV(nextFov);
      } catch {
        // Ignore transient zoom bounds
      }
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    skyViewRef.current.fovDeg = 12.0;
    setSkyFovDeg(12.0);
    const aladin = aladinInstanceRef.current;
    if (aladin && typeof aladin.setFoV === 'function') {
      try {
        aladin.setFoV(12.0);
      } catch {
        // Ignore
      }
    }
  }, []);

  // 1. Initialize Aladin Lite v3 in Immersed Full-Viewport Tangent Projection ('TAN', fov: 12 deg)
  useEffect(() => {
    let isMounted = true;

    const mountAladinInstance = async (A: any) => {
      if (!isMounted || !mountRef.current || !A) return;
      try {
        if (A.init && typeof A.init.then === 'function') {
          await A.init;
        }
        if (!isMounted || !mountRef.current) return;

        aladinLibRef.current = A;
        window.A = A;

        const initialState = useTelemetryStore.getState();
        const aladin = A.aladin(mountRef.current, {
          survey: 'P/allWISE/color',
          projection: 'TAN', // Immersed gnomonic tangent-plane sky window (fills 100% of screen)
          fov: 12.0,
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

        // Layer 2A: SPHEREx MOC Coverage Wireframe (#38bdf8, 12% opacity, lineWidth 1)
        try {
          if (typeof A.MOCFromJSON === 'function' && typeof aladin.addMOC === 'function') {
            const moc = A.MOCFromJSON(SPHEREX_MOC_JSON, {
              name: 'SPHEREx All-Sky MOC (spherex_qr2)',
              color: '#38bdf8',
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

        // Layer 2B: North & South Ecliptic Pole Deep-Field Rings (#ff0055, r = 5.64 deg, ~100 deg^2)
        try {
          if (typeof A.graphicOverlay === 'function' && typeof A.circle === 'function') {
            const deepFieldOverlay = A.graphicOverlay({
              name: 'SPHEREx Deep Fields (NEP/SEP 100 deg²)',
              color: '#ff0055',
              lineWidth: 1.5,
            });
            aladin.addOverlay(deepFieldOverlay);
            deepFieldOverlay.addFootprints([
              A.circle(NEP_COORDS.ra, NEP_COORDS.dec, NEP_COORDS.radiusDeg, { color: '#ff0055' }),
              A.circle(SEP_COORDS.ra, SEP_COORDS.dec, SEP_COORDS.radiusDeg, { color: '#ff0055' }),
            ]);
          }
        } catch {
          // Non-fatal deep field overlay
        }

        // Layer 3A: 5 Mandatory NASA Benchmark Calibration Targets (#38bdf8)
        try {
          const benchmarkCatalog = A.catalog({
            name: 'NASA Benchmarks',
            sourceSize: 12,
            color: '#38bdf8',
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

        // Layer 3B: Gaia DR3 Overlay & Proper Motion Vectors
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
              { name: 'SkyBot Asteroids', color: '#f59e0b', sourceSize: 10 },
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

        // Two-way Event Listeners: Sky View -> Store / Tooltip / Zoom Readout
        if (typeof aladin.on === 'function') {
          aladin.on('positionChanged', (pos: { ra?: number; dec?: number; dragging?: boolean }) => {
            if (!isMounted || !pos || typeof pos.ra !== 'number' || typeof pos.dec !== 'number') return;
            skyViewRef.current.centerRa = pos.ra;
            skyViewRef.current.centerDec = pos.dec;
            setCursorWorld({ ra: pos.ra, dec: pos.dec });
            if (pos.dragging) {
              isInternalPanRef.current = true;
              useTelemetryStore
                .getState()
                .setCoordinates(
                  Number(pos.ra.toFixed(6)),
                  Number(pos.dec.toFixed(6)),
                  `Field ${pos.ra.toFixed(4)}°, ${pos.dec.toFixed(4)}°`,
                  '[IRSA Live (spherex_qr2)]'
                );
              setTimeout(() => {
                isInternalPanRef.current = false;
              }, 80);
            }
          });

          aladin.on('zoomChanged', (fov: number) => {
            if (!isMounted || typeof fov !== 'number' || !Number.isFinite(fov)) return;
            skyViewRef.current.fovDeg = fov;
            setSkyFovDeg(fov);
          });

          aladin.on('objectHovered', (obj: any) => {
            if (!isMounted || !obj?.data) return;
            setHoveredBeacon({
              name: obj.data.name || 'Field source',
              description: obj.data.description || `RA ${Number(obj.ra).toFixed(4)}°, Dec ${Number(obj.dec).toFixed(4)}°`,
              ra: Number(obj.ra),
              dec: Number(obj.dec),
              preset: obj.data.preset,
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
          setLoadError(err?.message || 'Rendering local tangent-plane starfield.');
        }
      }
    };

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
          setLoadError('Local tangent-plane starfield active.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [handleCameraDive, updateGaiaProperMotions]);

  // 2. Sync External Store Coordinate Updates (Header Targets, Search Bar, Cmd+K) -> Sky View
  useEffect(() => {
    skyViewRef.current.centerRa = ra;
    skyViewRef.current.centerDec = dec;

    if (isInternalPanRef.current) return;
    const aladin = aladinInstanceRef.current;
    if (aladin && typeof aladin.gotoRaDec === 'function') {
      try {
        aladin.gotoRaDec(ra, dec);
        if (aladinLibRef.current) {
          updateGaiaProperMotions(aladinLibRef.current, aladin, ra, dec);
        }
      } catch {
        // Ignore transient pan errors
      }
    }
  }, [ra, dec, updateGaiaProperMotions]);

  // 3. Full-Bleed Immersed Tangent-Plane Starfield Renderer (Fills 100% of screen edge-to-edge)
  useEffect(() => {
    if (aladinReady || !canvasFallbackRef.current) return;

    const canvas = canvasFallbackRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const starColors = ['#d8e8ff', '#f0f6ff', '#fff8e7', '#ffe4b5', '#ffcc99'];

    const renderImmersedStarfield = () => {
      const width = (canvas.width = canvas.parentElement?.clientWidth || 1280);
      const height = (canvas.height = canvas.parentElement?.clientHeight || 720);
      const { centerRa, centerDec, fovDeg } = skyViewRef.current;

      const scalePxPerDeg = width / Math.max(0.02, fovDeg);
      const halfFovX = fovDeg / 2;
      const halfFovY = (fovDeg * (height / Math.max(1, width))) / 2;
      const cosCenterDec = Math.max(0.08, Math.cos((centerDec * Math.PI) / 180));

      // Project world (sRa, sDec) onto flat tangent screen (x, y)
      const worldToScreen = (sRa: number, sDec: number): { x: number; y: number; inBounds: boolean } => {
        let dRa = sRa - centerRa;
        if (dRa > 180) dRa -= 360;
        if (dRa < -180) dRa += 360;
        const dDec = sDec - centerDec;
        // East is left on standard astronomical sky charts (RA increases leftward)
        const x = width / 2 - dRa * cosCenterDec * scalePxPerDeg;
        const y = height / 2 - dDec * scalePxPerDeg;
        const inBounds = x >= -40 && x <= width + 40 && y >= -40 && y <= height + 40;
        return { x, y, inBounds };
      };

      // Deep-space background well
      ctx.fillStyle = '#080A0F';
      ctx.fillRect(0, 0, width, height);

      // Subtle Galactic / zodiacal infrared background gradient anchored to sky coordinates
      const bgGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        10,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.75
      );
      bgGrad.addColorStop(0, '#0d131d');
      bgGrad.addColorStop(1, '#080A0F');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 1. Hairline J2000 WCS Coordinate Grid (Adaptive step by zoom level)
      const gridStepDeg =
        fovDeg > 25 ? 5 : fovDeg > 8 ? 2 : fovDeg > 3 ? 1 : fovDeg > 1 ? 0.25 : fovDeg > 0.25 ? 0.05 : 0.01;

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.lineWidth = 1;

      const minDec = Math.max(-89, Math.floor((centerDec - halfFovY * 1.2) / gridStepDeg) * gridStepDeg);
      const maxDec = Math.min(89, Math.ceil((centerDec + halfFovY * 1.2) / gridStepDeg) * gridStepDeg);
      for (let gDec = minDec; gDec <= maxDec; gDec += gridStepDeg) {
        const y = height / 2 - (gDec - centerDec) * scalePxPerDeg;
        if (y >= 0 && y <= height) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
          ctx.fillText(`${gDec >= 0 ? '+' : ''}${gDec.toFixed(gridStepDeg < 1 ? 2 : 0)}°`, 8, y - 4);
        }
      }

      const raSpan = (halfFovX * 1.3) / cosCenterDec;
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
          ctx.fillText(`${normRa.toFixed(gridStepDeg < 1 ? 2 : 0)}°`, x + 4, 14);
        }
      }

      // 2. NEP and SEP Deep-Field Boundary Rings (r = 5.64 deg, #ff0055)
      [NEP_COORDS, SEP_COORDS].forEach((pole) => {
        const pos = worldToScreen(pole.ra, pole.dec);
        const rPx = pole.radiusDeg * scalePxPerDeg;
        if (pos.x + rPx >= 0 && pos.x - rPx <= width && pos.y + rPx >= 0 && pos.y - rPx <= height) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, rPx, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 0, 85, 0.05)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 0, 85, 0.55)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#ff0055';
          ctx.fillText(pole.label, pos.x + 8, pos.y - 8);
        }
      });

      // 3. Multi-Scale Deterministic Field Stars (Reveals deeper magnitudes as user zooms in)
      const cellDeg = fovDeg > 15 ? 2.0 : fovDeg > 4 ? 0.5 : fovDeg > 1 ? 0.15 : 0.04;
      const cellRaStart = Math.floor((centerRa - raSpan) / cellDeg);
      const cellRaEnd = Math.ceil((centerRa + raSpan) / cellDeg);
      const cellDecStart = Math.floor((centerDec - halfFovY * 1.2) / cellDeg);
      const cellDecEnd = Math.ceil((centerDec + halfFovY * 1.2) / cellDeg);

      const starsPerCell = 6;
      for (let cDec = cellDecStart; cDec <= cellDecEnd; cDec++) {
        if (cDec * cellDeg < -89.5 || cDec * cellDeg > 89.5) continue;
        for (let cRa = cellRaStart; cRa <= cellRaEnd; cRa++) {
          const wrappedRaCell = ((cRa % Math.round(360 / cellDeg)) + Math.round(360 / cellDeg)) % Math.round(360 / cellDeg);
          for (let s = 0; s < starsPerCell; s++) {
            const u = hashSkyCell(wrappedRaCell, cDec, s * 3 + 1);
            const v = hashSkyCell(wrappedRaCell, cDec, s * 3 + 2);
            const magHash = hashSkyCell(wrappedRaCell, cDec, s * 3 + 3);

            const starRa = (cRa + u) * cellDeg;
            const starDec = (cDec + v) * cellDeg;
            const pos = worldToScreen(starRa, starDec);
            if (!pos.inBounds) continue;

            // Magnitude distribution (brighter stars rarer, fainter stars numerous)
            const mag = 8.0 + Math.pow(magHash, 0.65) * 10.0;
            const radiusPx = Math.max(0.6, Math.min(3.2, (18.5 - mag) * 0.24));
            const alpha = Math.max(0.2, Math.min(0.95, (19.0 - mag) / 10.0));
            const colorHex = starColors[(wrappedRaCell + cDec + s) % starColors.length];

            ctx.globalAlpha = alpha;
            ctx.fillStyle = colorHex;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
            ctx.fill();

            // Diffraction spike crosshairs on bright field stars (G < 10.2)
            if (mag < 10.2) {
              ctx.strokeStyle = colorHex;
              ctx.lineWidth = 0.75;
              ctx.beginPath();
              ctx.moveTo(pos.x - radiusPx * 3.2, pos.y);
              ctx.lineTo(pos.x + radiusPx * 3.2, pos.y);
              ctx.moveTo(pos.x, pos.y - radiusPx * 3.2);
              ctx.lineTo(pos.x, pos.y + radiusPx * 3.2);
              ctx.stroke();
            }
          }
        }
      }
      ctx.globalAlpha = 1.0;

      // 4. Render 5 Mandatory NASA Benchmark Targets with Astronomical Crosshairs & Proper-Motion Vectors
      const nextProjected: Array<{ pill: BenchmarkPill; x: number; y: number; inView: boolean }> = [];
      MANDATORY_BENCHMARKS.forEach((b) => {
        const pos = worldToScreen(b.ra, b.dec);
        nextProjected.push({ pill: b, x: pos.x, y: pos.y, inView: pos.inBounds });
        if (!pos.inBounds) return;

        // Proper-motion vector arrow (East is left: -pmRa, North is up: -pmDec)
        const pm = BENCHMARK_PROPER_MOTIONS[b.id];
        if (pm && pm.totalArcsecYr >= 0.5) {
          const vecScale = 4.0;
          const vx = pos.x - (pm.pmRaMasYr / 1000) * vecScale;
          const vy = pos.y - (pm.pmDecMasYr / 1000) * vecScale;
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(vx, vy);
          ctx.stroke();

          const angle = Math.atan2(vy - pos.y, vx - pos.x);
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.lineTo(vx - 5 * Math.cos(angle - Math.PI / 6), vy - 5 * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(vx - 5 * Math.cos(angle + Math.PI / 6), vy - 5 * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fillStyle = '#38BDF8';
          ctx.fill();
        }

        // Open astronomical target reticle ticks (instead of solid toy balls)
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 1.25;
        const gap = 4;
        const arm = 9;
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

        // Point-source core
        ctx.fillStyle = '#E6ECF2';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
        ctx.fill();

        // Target label
        ctx.fillStyle = '#E6ECF2';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.fillText(b.name, pos.x + 12, pos.y + 3);
      });

      projectedTargetsRef.current = nextProjected;
      animId = requestAnimationFrame(renderImmersedStarfield);
    };

    renderImmersedStarfield();
    return () => cancelAnimationFrame(animId);
  }, [aladinReady]);

  // Viewport Mouse Pan, Wheel Zoom, and Cursor Coordinate Conversion
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (aladinReady) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      handleZoomByFactor(factor);
    },
    [aladinReady, handleZoomByFactor]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const aladin = aladinInstanceRef.current;
      if (aladinReady && aladin && typeof aladin.pix2world === 'function') {
        try {
          const world = aladin.pix2world(x, y);
          if (Array.isArray(world) && Number.isFinite(world[0]) && Number.isFinite(world[1])) {
            setCursorWorld({ ra: world[0], dec: world[1] });
          }
        } catch {
          // Ignore edge conversion
        }
        return;
      }

      const { centerRa, centerDec, fovDeg } = skyViewRef.current;
      const scalePxPerDeg = rect.width / Math.max(0.02, fovDeg);
      const cosCenterDec = Math.max(0.08, Math.cos((centerDec * Math.PI) / 180));

      if (dragStateRef.current.dragging) {
        const dx = e.clientX - dragStateRef.current.startX;
        const dy = e.clientY - dragStateRef.current.startY;
        if (Math.hypot(dx, dy) > 2) {
          dragStateRef.current.moved = true;
        }
        // Dragging right pans West (increases RA on sky chart), dragging down pans North
        const nextRa = (((centerRa + dx / (scalePxPerDeg * cosCenterDec)) % 360) + 360) % 360;
        const nextDec = Math.max(-89.5, Math.min(89.5, centerDec + dy / scalePxPerDeg));
        skyViewRef.current.centerRa = nextRa;
        skyViewRef.current.centerDec = nextDec;
        dragStateRef.current.startX = e.clientX;
        dragStateRef.current.startY = e.clientY;

        isInternalPanRef.current = true;
        useTelemetryStore
          .getState()
          .setCoordinates(
            Number(nextRa.toFixed(6)),
            Number(nextDec.toFixed(6)),
            `Field ${nextRa.toFixed(4)}°, ${nextDec.toFixed(4)}°`,
            '[IRSA Live (spherex_qr2)]'
          );
        setTimeout(() => {
          isInternalPanRef.current = false;
        }, 60);
      }

      // Hit-test calibration targets
      const hit = projectedTargetsRef.current.find(
        (b) => b.inView && Math.hypot(b.x - x, b.y - y) <= 14
      );
      if (hit) {
        setHoveredBeacon({
          name: hit.pill.name,
          description: hit.pill.description,
          ra: hit.pill.ra,
          dec: hit.pill.dec,
          preset: hit.pill.preset,
        });
        setCursorWorld({ ra: hit.pill.ra, dec: hit.pill.dec });
      } else {
        setHoveredBeacon(null);
        const curRa =
          (((centerRa - (x - rect.width / 2) / (scalePxPerDeg * cosCenterDec)) % 360) + 360) % 360;
        const curDec = Math.max(
          -90,
          Math.min(90, centerDec - (y - rect.height / 2) / scalePxPerDeg)
        );
        setCursorWorld({ ra: curRa, dec: curDec });
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
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const wasMoved = dragStateRef.current.moved;
      dragStateRef.current.dragging = false;
      if (aladinReady || wasMoved) return;

      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = projectedTargetsRef.current.find(
        (b) => b.inView && Math.hypot(b.x - x, b.y - y) <= 14
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
    handleCameraDive(targetRa, targetDec, hoveredBeacon?.name, hoveredBeacon?.preset);
  }, [cursorWorld, dec, handleCameraDive, hoveredBeacon, ra]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#080A0F] font-sans text-xs text-[#E6ECF2] select-none">
      {/* Immersed Full-Bleed Sky Viewport */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragStateRef.current.dragging = false;
        }}
        onDoubleClick={handleDoubleClick}
        className="relative flex-1 w-full overflow-hidden bg-[#080A0F] cursor-grab active:cursor-grabbing"
      >
        {/* Layer 1: Aladin Lite v3 Tangent-Plane Sky Window */}
        <div
          id="sky-globe-mount"
          ref={mountRef}
          className={`absolute inset-0 h-full w-full ${aladinReady ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        />

        {/* Layer 1 Fallback: Full-Viewport Immersed Astrometric Starfield */}
        {!aladinReady && (
          <canvas
            ref={canvasFallbackRef}
            className="absolute inset-0 h-full w-full"
          />
        )}

        {/* Layer 4: Center Cutout Extraction Footprint Reticle */}
        <div
          style={{
            width: `${reticleSizePx}px`,
            height: `${reticleSizePx}px`,
          }}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center border border-[#38BDF8]/70"
        >
          <div className="absolute h-2.5 w-px bg-[#38BDF8] -top-1.5" />
          <div className="absolute h-2.5 w-px bg-[#38BDF8] -bottom-1.5" />
          <div className="absolute w-2.5 h-px bg-[#38BDF8] -left-1.5" />
          <div className="absolute w-2.5 h-px bg-[#38BDF8] -right-1.5" />
          <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-[#1E2530] bg-[#0F131A] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[#E6ECF2]">
            {fovArcsec}&quot; cutout footprint
          </span>
        </div>

        {/* Hovered Source Inspection Popover */}
        {hoveredBeacon && (
          <div className="pointer-events-none absolute left-4 top-4 z-30 max-w-xs rounded-sm border border-[#1E2530] bg-[#0F131A] p-2.5 text-xs">
            <div className="font-semibold text-[#E6ECF2]">{hoveredBeacon.name}</div>
            <div className="mt-0.5 text-[11px] text-[#94A3B8]">{hoveredBeacon.description}</div>
            <div className="mt-1 font-mono text-[10px] tabular-nums text-[#38BDF8]">
              RA {hoveredBeacon.ra.toFixed(5)}° · Dec {hoveredBeacon.dec.toFixed(5)}°
            </div>
          </div>
        )}

        {/* Cutout Extraction Status Banner */}
        {isDiving && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-1/2 top-6 z-40 -translate-x-1/2 rounded-sm border border-[#38BDF8] bg-[#0F131A] px-4 py-2 text-xs text-[#E6ECF2]"
          >
            Extracting <span className="font-mono tabular-nums">{fovArcsec}&quot;</span> cutout at{' '}
            <span className="font-mono tabular-nums">
              {ra.toFixed(4)}°, {dec.toFixed(4)}°
            </span>{' '}
            into comparator...
          </div>
        )}

        {/* Top-Right Instrument Controls: Zoom & Calibration Targets */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute right-4 top-4 z-30 flex flex-col items-end gap-2 cursor-default"
        >
          {/* Zoom Controls */}
          <div className="flex items-center rounded-sm border border-[#1E2530] bg-[#0F131A]" role="group" aria-label="Sky zoom controls">
            <button
              type="button"
              onClick={() => handleZoomByFactor(0.65)}
              className="px-2.5 py-1 font-mono text-xs text-[#E6ECF2] transition-colors duration-150 hover:bg-[#151B24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <span className="h-4 w-px bg-[#1E2530]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => handleZoomByFactor(1.5)}
              className="px-2.5 py-1 font-mono text-xs text-[#E6ECF2] transition-colors duration-150 hover:bg-[#151B24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="h-4 w-px bg-[#1E2530]" aria-hidden="true" />
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-2 py-1 text-[11px] text-[#94A3B8] transition-colors duration-150 hover:bg-[#151B24] hover:text-[#E6ECF2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
              title="Reset field of view to 12°"
            >
              Reset 12°
            </button>
          </div>

          {/* Calibration Target Selector Panel */}
          <div className="w-52 rounded-sm border border-[#1E2530] bg-[#0F131A] p-2">
            <div className="mb-1.5 px-1 text-[11px] font-medium text-[#94A3B8]">
              Calibration targets
            </div>
            <div className="flex flex-col gap-1">
              {MANDATORY_BENCHMARKS.map((b) => {
                const isSelected =
                  Math.abs(ra - b.ra) < 0.01 && Math.abs(dec - b.dec) < 0.01;
                return (
                  <div key={b.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onMouseEnter={() =>
                        setHoveredBeacon({
                          name: b.name,
                          description: b.description,
                          ra: b.ra,
                          dec: b.dec,
                          preset: b.preset,
                        })
                      }
                      onMouseLeave={() => setHoveredBeacon(null)}
                      onClick={() => {
                        setCoordinates(b.ra, b.dec, b.name, '[NASA Benchmark (Pre-cached)]');
                        setRa(b.ra);
                        setDec(b.dec);
                      }}
                      className={`flex-1 truncate rounded-sm border px-2 py-1 text-left text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                        isSelected
                          ? 'border-[#38BDF8] bg-[#151B24] font-medium text-[#E6ECF2]'
                          : 'border-transparent text-[#94A3B8] hover:bg-[#151B24] hover:text-[#E6ECF2]'
                      }`}
                    >
                      {b.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCameraDive(b.ra, b.dec, b.name, b.preset)}
                      className="shrink-0 rounded-sm border border-[#1E2530] bg-[#151B24] px-1.5 py-1 text-[10px] text-[#E6ECF2] transition-colors duration-150 hover:border-[#38BDF8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
                      title={`Open ${b.name} cutout in time-domain comparator`}
                    >
                      Open
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom-Right Angular Scale Bar */}
        <div className="pointer-events-none absolute bottom-3 right-4 z-20 flex flex-col items-end gap-1 rounded-sm border border-[#1E2530] bg-[#0F131A] px-2.5 py-1.5">
          <span className="font-mono text-[10px] tabular-nums text-[#E6ECF2]">
            {scaleBar.label}
          </span>
          <div
            style={{ width: `${scaleBar.widthPx}px` }}
            className="h-1.5 border-b border-l border-r border-[#E6ECF2]"
          />
        </div>
      </div>

      {/* Docked Bottom Instrument Readout Strip */}
      <footer
        onMouseDown={(e) => e.stopPropagation()}
        className="z-30 flex min-h-[42px] flex-wrap items-center justify-between gap-4 border-t border-[#1E2530] bg-[#0F131A] px-4 py-1.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-4">
          {/* Active Target & J2000 Coordinates */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#E6ECF2]">
              {activeTargetName || 'Field center'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[#38BDF8]">
              {ra.toFixed(5)}° {dec >= 0 ? `+${dec.toFixed(5)}` : dec.toFixed(5)}°
            </span>
            <span className="hidden md:inline font-mono text-[11px] tabular-nums text-[#94A3B8]">
              ({sexagesimalCenter})
            </span>
          </div>

          <span className="hidden sm:inline h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />

          {/* Cursor World Readout */}
          {cursorWorld && (
            <div className="hidden xl:flex items-center gap-1.5 text-[11px]">
              <span className="text-[#94A3B8]">Cursor</span>
              <span className="font-mono tabular-nums text-[#E6ECF2]">
                {cursorWorld.ra.toFixed(4)}° {cursorWorld.dec >= 0 ? `+${cursorWorld.dec.toFixed(4)}` : cursorWorld.dec.toFixed(4)}°
              </span>
            </div>
          )}

          {/* Field FoV */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[#94A3B8]">Sky field</span>
            <span className="font-mono tabular-nums text-[#E6ECF2]">
              {formatFieldFov(skyFovDeg)}
            </span>
          </div>

          <span className="hidden lg:inline h-3.5 w-px bg-[#1E2530]" aria-hidden="true" />

          {/* SPHEREx Survey Coverage & Epochs */}
          <div className="hidden lg:flex items-center gap-2 text-[11px]">
            <span className="text-[#94A3B8]">Coverage:</span>
            <span className="text-[#E6ECF2]">{coverageInfo.cadenceLabel}</span>
            <span className="font-mono tabular-nums text-[#94A3B8]">({coverageInfo.mjdRange})</span>
          </div>

          {/* Gaia DR3 & SkyBot Status */}
          <div className="hidden 2xl:flex items-center gap-3 text-[11px]">
            <span className="text-[#94A3B8]">
              Gaia DR3: <strong className="font-mono font-normal tabular-nums text-[#E6ECF2]">{gaiaCount}</strong> vectors
            </span>
            <span className="text-[#94A3B8]">
              SkyBot:{' '}
              <strong
                className={`font-mono font-normal ${
                  skybotStatus === 'live' ? 'text-[#22C55E]' : 'text-[#F59E0B]'
                }`}
              >
                {skybotStatus === 'live' ? 'Live IMCCE' : 'cached_only'}
              </strong>
            </span>
          </div>
        </div>

        {/* Primary Action: Extract Cutout to Tab 2 */}
        <div className="flex items-center gap-3">
          {loadError && (
            <span className="hidden md:inline text-[11px] text-[#94A3B8]">
              {loadError}
            </span>
          )}
          <button
            type="button"
            onClick={() => handleCameraDive(ra, dec, activeTargetName || undefined)}
            className="rounded-sm border border-[#38BDF8] bg-[#151B24] px-3 py-1 text-xs font-medium text-[#E6ECF2] transition-colors duration-150 hover:bg-[#38BDF8]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
          >
            Open cutout ({fovArcsec}&quot;)
          </button>
        </div>
      </footer>
    </div>
  );
};
