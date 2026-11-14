import { create } from 'zustand';

export interface EphemerisTarget {
  name: string;
  ra: number;
  dec: number;
  epoch: number;
}

export interface CutoutFrame {
  epochIndex: number;
  epochLabel: string;
  mjd: number;
  binaryFloat32Buffer?: ArrayBuffer;
  bandsFallback: Record<string, string>;
  rawMatrixD4?: number[][];
  rawMatrixD5?: number[][];
  rawUnrectifiedB64?: string;
  flagCoords: [number, number][];
  sourceType: 'benchmark' | 'irsa_live' | 'synthetic_injection';
}

export interface SpectralChannel {
  channel: number;
  detector: string;
  wavelengthUm: number;
  fluxMjySr: number;
  uncertainty: number;
  flag: number;
}

export interface AiCandidate {
  id: string;
  xPx: number;
  yPx: number;
  anomalyType: string;
  confidence: number;
}

export interface LoadedCutoutData {
  gridSize: number;
  pixelScaleArcsec: number;
  epochs: CutoutFrame[];
  aiCandidates: AiCandidate[];
}

export interface TelemetryState {
  // Spatial Parameters
  ra: number;
  dec: number;
  fovArcsec: number;
  activeTargetName: string | null;
  sourceBadge: string;

  // Cutout & Playback State
  cadence: 'survey_6month' | 'short_subexposure';
  activeEpochIndex: number;
  totalEpochs: number;
  isPlaying: boolean;
  playbackSpeedMs: number;
  loopMode: 'forward' | 'pingpong';
  renderMode: 'blink' | 'difference' | 'coadd';
  rawVsRectified: 'rectified' | 'raw_sensor';
  colorPalette: 'standard_rgb' | 'viridis' | 'cividis' | 'inverted_grayscale';

  // Super-Band Mixer
  activeRgbPreset: 'true_nir' | 'brown_dwarf' | 'water_ice' | 'comet_outgassing' | 'custom';
  customChannelMap: { r: number; g: number; b: number };
  asinhParamA: number;
  minFluxCut: number;
  maxFluxCut: number;

  // Probed Pixel & Spectral State
  probedPixel: { x: number; y: number } | null;
  activeSpectrum: SpectralChannel[];
  isSpectrumLoading: boolean;
  isSpectralBlinkSynced: boolean;
  normalizeContinuum: boolean;
  manualRedshiftZ: number;
  activeFeatureRulers: string[];

  // Point-Source Ice Aperture State (Tab 4 — SPLICES Background Star Workflow)
  apertureRadiusPx: number;
  skyAnnulusInnerPx: number;
  skyAnnulusOuterPx: number;

  // Ingested Cutout Data Payload
  loadedCutout: LoadedCutoutData | null;
  isCutoutLoading: boolean;
  cutoutError: string | null;

  // Actions
  setCoordinates: (ra: number, dec: number, targetName?: string, sourceBadge?: string) => void;
  setFov: (fov: number) => void;
  setPlayback: (isPlaying: boolean) => void;
  togglePlayback: () => void;
  setEpochIndex: (idx: number) => void;
  stepEpoch: (direction: 1 | -1) => void;
  setCadence: (cadence: 'survey_6month' | 'short_subexposure') => void;
  setRenderMode: (mode: 'blink' | 'difference' | 'coadd') => void;
  setColorPalette: (palette: 'standard_rgb' | 'viridis' | 'cividis' | 'inverted_grayscale') => void;
  toggleInvertGrayscale: () => void;
  setRawVsRectified: (mode: 'rectified' | 'raw_sensor') => void;
  setRgbPreset: (preset: 'true_nir' | 'brown_dwarf' | 'water_ice' | 'comet_outgassing' | 'custom') => void;
  setCustomChannelMap: (map: { r: number; g: number; b: number }) => void;
  setAsinhParams: (params: { a?: number; min?: number; max?: number }) => void;
  setProbedPixel: (pixel: { x: number; y: number } | null) => void;
  setManualRedshiftZ: (z: number) => void;
  toggleFeatureRuler: (rulerKey: string) => void;
  setIceAperture: (apertureRadiusPx: number, innerPx?: number, outerPx?: number) => void;
  setLoadedCutout: (cutout: LoadedCutoutData | null) => void;
  setCutoutLoading: (loading: boolean, error?: string | null) => void;
  setActiveSpectrum: (spectrum: SpectralChannel[]) => void;
  setSpectrumLoading: (loading: boolean) => void;
  resetView: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  // Spatial Parameters (defaults to WISE 0855-0714)
  ra: 133.737120,
  dec: -7.240380,
  fovArcsec: 180.0,
  activeTargetName: 'WISE 0855-0714',
  sourceBadge: '[NASA Benchmark (Pre-cached)]',

  // Cutout & Playback State
  cadence: 'survey_6month',
  activeEpochIndex: 0,
  totalEpochs: 3,
  isPlaying: false,
  playbackSpeedMs: 500,
  loopMode: 'forward',
  renderMode: 'blink',
  rawVsRectified: 'rectified',
  colorPalette: 'standard_rgb',

  // Super-Band Mixer
  activeRgbPreset: 'brown_dwarf',
  customChannelMap: { r: 5, g: 3, b: 1 },
  asinhParamA: 0.05,
  minFluxCut: 0.0,
  maxFluxCut: 1.0,

  // Probed Pixel & Spectral State
  probedPixel: { x: 16, y: 16 },
  activeSpectrum: [],
  isSpectrumLoading: false,
  isSpectralBlinkSynced: true,
  normalizeContinuum: false,
  manualRedshiftZ: 0.0,
  activeFeatureRulers: ['H2O', 'CO2'],

  // Point-Source Ice Aperture State
  apertureRadiusPx: 2.5,
  skyAnnulusInnerPx: 4.0,
  skyAnnulusOuterPx: 7.0,

  // Ingested Cutout Data Payload
  loadedCutout: null,
  isCutoutLoading: false,
  cutoutError: null,

  // Actions
  setCoordinates: (ra, dec, targetName, sourceBadge) =>
    set((state) => ({
      ra,
      dec,
      activeTargetName: targetName !== undefined ? targetName : state.activeTargetName,
      sourceBadge: sourceBadge !== undefined ? sourceBadge : state.sourceBadge,
    })),

  setFov: (fovArcsec) => set({ fovArcsec }),

  setPlayback: (isPlaying) => set({ isPlaying }),

  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setEpochIndex: (idx) =>
    set((state) => {
      const maxIdx = Math.max(0, state.totalEpochs - 1);
      return { activeEpochIndex: Math.min(Math.max(0, idx), maxIdx) };
    }),

  stepEpoch: (direction) =>
    set((state) => {
      if (state.totalEpochs <= 1) return state;
      let next = state.activeEpochIndex + direction;
      if (next >= state.totalEpochs) next = 0;
      if (next < 0) next = state.totalEpochs - 1;
      return { activeEpochIndex: next };
    }),

  setCadence: (cadence) => set({ cadence }),

  setRenderMode: (renderMode) => set({ renderMode }),

  setColorPalette: (colorPalette) => set({ colorPalette }),

  toggleInvertGrayscale: () =>
    set((state) => ({
      colorPalette:
        state.colorPalette === 'inverted_grayscale' ? 'standard_rgb' : 'inverted_grayscale',
    })),

  setRawVsRectified: (rawVsRectified) => set({ rawVsRectified }),

  setRgbPreset: (activeRgbPreset) => set({ activeRgbPreset }),

  setCustomChannelMap: (customChannelMap) => set({ customChannelMap }),

  setAsinhParams: (params) =>
    set((state) => ({
      asinhParamA: params.a !== undefined ? params.a : state.asinhParamA,
      minFluxCut: params.min !== undefined ? params.min : state.minFluxCut,
      maxFluxCut: params.max !== undefined ? params.max : state.maxFluxCut,
    })),

  setProbedPixel: (probedPixel) => set({ probedPixel }),

  setManualRedshiftZ: (manualRedshiftZ) => set({ manualRedshiftZ }),

  toggleFeatureRuler: (rulerKey) =>
    set((state) => {
      const exists = state.activeFeatureRulers.includes(rulerKey);
      return {
        activeFeatureRulers: exists
          ? state.activeFeatureRulers.filter((k) => k !== rulerKey)
          : [...state.activeFeatureRulers, rulerKey],
      };
    }),

  setIceAperture: (apertureRadiusPx, innerPx, outerPx) =>
    set((state) => ({
      apertureRadiusPx,
      skyAnnulusInnerPx: innerPx !== undefined ? innerPx : state.skyAnnulusInnerPx,
      skyAnnulusOuterPx: outerPx !== undefined ? outerPx : state.skyAnnulusOuterPx,
    })),

  setLoadedCutout: (loadedCutout) =>
    set({
      loadedCutout,
      totalEpochs: loadedCutout?.epochs.length ?? 0,
      activeEpochIndex: 0,
    }),

  setCutoutLoading: (isCutoutLoading, cutoutError = null) =>
    set({ isCutoutLoading, cutoutError }),

  setActiveSpectrum: (activeSpectrum) => set({ activeSpectrum }),

  setSpectrumLoading: (isSpectrumLoading) => set({ isSpectrumLoading }),

  resetView: () =>
    set({
      probedPixel: { x: 16, y: 16 },
      manualRedshiftZ: 0.0,
      asinhParamA: 0.05,
      minFluxCut: 0.0,
      maxFluxCut: 1.0,
    }),
}));
