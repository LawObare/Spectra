import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import vertShaderSource from '../shaders/float32_stretch.vert?raw';
import fragShaderSource from '../shaders/float32_stretch.frag?raw';

/**
 * Spectra WebGL2 Float32 Multi-Epoch Comparator Canvas
 * Specification Anchor: SPECIFICATION.md §3.2, §6.1.6, §6.1.7, §6.3.2
 * Role: E3 (role:E3-webgl)
 *
 * Provides GPU-accelerated:
 * - IEEE-754 32-bit float texture uploads (gl.R32F)
 * - Dynamic Asinh stretching (a in [1e-4, 1.0])
 * - Symmetric signed difference subtraction (t_N - t_0) mapped around 0.5 mid-grey
 * - True inverse-variance co-addition (I_coadd = sum(I / sigma^2) / sum(1 / sigma^2))
 * - 3-band RGB false-color super-band synthesis
 * - Colormaps: Grayscale, Viridis, Cividis, Inverted Grayscale
 * - Sub-pixel hover HUD probing and click interactions
 */

export interface HoverPixelInfo {
  x: number;
  y: number;
  flux: number;
  variance: number;
  snr: number;
  flags: number;
  flagNames: string[];
  radiusPx?: number;
}

export interface WebGLComparatorCanvasProps {
  fluxData: Float32Array | null;
  refFluxData?: Float32Array | null;
  varianceData?: Float32Array | null;
  refVarianceData?: Float32Array | null;
  flagsData?: Uint32Array | null;
  width: number;
  height: number;
  renderMode: 'blink' | 'difference' | 'coadd';
  asinhParamA?: number;
  minFluxCut?: number;
  maxFluxCut?: number;
  diffScale?: number;
  colorPalette?: 'standard_rgb' | 'viridis' | 'cividis' | 'inverted_grayscale';
  rgbBandsData?: {
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
  } | null;
  isFrameZero?: boolean;
  gaiaPin?: {
    subpixelX: number; // in pixel units [0..width]
    subpixelY: number; // in pixel units [0..height]
    label?: string;
  } | null;
  onPixelHover?: (info: HoverPixelInfo | null) => void;
  onPixelClick?: (info: HoverPixelInfo) => void;
  className?: string;
  smooth?: boolean;
}

const FLAG_NAMES: Record<number, string> = {
  1: 'TRANSIENT',
  2: 'OVERFLOW',
  4: 'SUR_ERROR',
  16: 'PHANTOM',
  32: 'REFERENCE',
  64: 'NONFUNC',
  128: 'DICHROIC',
  512: 'MISSING_DATA',
  1024: 'HOT',
  2048: 'COLD',
  131072: 'PERSISTENCE',
  4194304: 'GHOST',
};

function decodeFlagNames(flagsVal: number): string[] {
  if (!flagsVal) return ['CLEAN (0x000)'];
  const names: string[] = [];
  for (const [bitValStr, name] of Object.entries(FLAG_NAMES)) {
    const bitVal = Number(bitValStr);
    if ((flagsVal & bitVal) === bitVal) {
      names.push(name);
    }
  }
  return names.length > 0 ? names : [`FLAG_0x${flagsVal.toString(16)}`];
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation error: ${info}`);
  }
  return shader;
}

export const WebGLComparatorCanvas: React.FC<WebGLComparatorCanvasProps> = ({
  fluxData,
  refFluxData,
  varianceData,
  refVarianceData,
  flagsData,
  width,
  height,
  renderMode,
  asinhParamA = 0.1,
  minFluxCut,
  maxFluxCut,
  diffScale,
  colorPalette = 'standard_rgb',
  rgbBandsData,
  isFrameZero = false,
  gaiaPin,
  onPixelHover,
  onPixelClick,
  className = '',
  smooth = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const texturesRef = useRef<{
    currentFlux: WebGLTexture | null;
    referenceFlux: WebGLTexture | null;
    currentVar: WebGLTexture | null;
    referenceVar: WebGLTexture | null;
    bandR: WebGLTexture | null;
    bandG: WebGLTexture | null;
    bandB: WebGLTexture | null;
  }>({
    currentFlux: null,
    referenceFlux: null,
    currentVar: null,
    referenceVar: null,
    bandR: null,
    bandG: null,
    bandB: null,
  });

  const floatLinearSupportedRef = useRef<boolean>(false);
  const filterModeRef = useRef<number>(WebGL2RenderingContext.NEAREST);
  const [glReady, setGlReady] = useState(false);
  const [dragCircle, setDragCircle] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    radiusPx: number;
  } | null>(null);
  const dragCircleRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    radiusPx: number;
  } | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  const effectiveCuts = useMemo(() => {
    if (minFluxCut !== undefined && maxFluxCut !== undefined) {
      return { min: minFluxCut, max: maxFluxCut };
    }
    if (!fluxData || fluxData.length === 0) {
      return { min: 0.0, max: 1.0 };
    }
    let min = Infinity;
    let max = -Infinity;
    const step = Math.max(1, Math.floor(fluxData.length / 1000));
    for (let i = 0; i < fluxData.length; i += step) {
      const v = fluxData[i];
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) min = 0.0;
    if (max === -Infinity || max <= min) max = min + 1.0;
    return {
      min: minFluxCut !== undefined ? minFluxCut : min,
      max: maxFluxCut !== undefined ? maxFluxCut : max,
    };
  }, [fluxData, minFluxCut, maxFluxCut]);

  const effectiveDiffScale = useMemo(() => {
    if (diffScale !== undefined) return diffScale;
    const span = effectiveCuts.max - effectiveCuts.min;
    return Math.max(span * 0.5, 0.1);
  }, [diffScale, effectiveCuts]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });

    if (!gl) {
      console.warn('WebGL2 not supported on this client device. Falling back to canvas 2D preview.');
      return;
    }
    glRef.current = gl;

    const floatLinearExt = gl.getExtension('OES_texture_float_linear');
    floatLinearSupportedRef.current = Boolean(floatLinearExt);
    filterModeRef.current = smooth && floatLinearExt ? gl.LINEAR : gl.NEAREST;

    try {
      const vertShader = compileShader(gl, gl.VERTEX_SHADER, vertShaderSource);
      const fragShader = compileShader(gl, gl.FRAGMENT_SHADER, fragShaderSource);

      const program = gl.createProgram();
      if (!program) throw new Error('Failed to create WebGL program.');
      gl.attachShader(program, vertShader);
      gl.attachShader(program, fragShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Shader program link error: ${gl.getProgramInfoLog(program)}`);
      }
      programRef.current = program;

      const quadVertices = new Float32Array([
        -1.0, -1.0, 0.0, 1.0,
        1.0, -1.0, 1.0, 1.0,
        -1.0, 1.0, 0.0, 0.0,
        1.0, 1.0, 1.0, 0.0,
      ]);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

      const aPos = gl.getAttribLocation(program, 'a_position');
      const aUv = gl.getAttribLocation(program, 'a_uv');

      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);

      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

      const createR32Texture = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterModeRef.current);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterModeRef.current);
        return tex;
      };

      texturesRef.current = {
        currentFlux: createR32Texture(),
        referenceFlux: createR32Texture(),
        currentVar: createR32Texture(),
        referenceVar: createR32Texture(),
        bandR: createR32Texture(),
        bandG: createR32Texture(),
        bandB: createR32Texture(),
      };

      setGlReady(true);
    } catch (err) {
      console.error('WebGL2 initialization error:', err);
    }

    return () => {
      if (gl) {
        Object.values(texturesRef.current).forEach((tex) => tex && gl.deleteTexture(tex));
        if (programRef.current) gl.deleteProgram(programRef.current);
      }
    };
  }, []);

  const uploadTexture = useCallback(
    (tex: WebGLTexture | null, data: Float32Array | null | undefined, w: number, h: number) => {
      const gl = glRef.current;
      if (!gl || !tex) return;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterModeRef.current);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterModeRef.current);
      if (data && data.length >= w * h) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R32F,
          w,
          h,
          0,
          gl.RED,
          gl.FLOAT,
          data
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R32F,
          1,
          1,
          0,
          gl.RED,
          gl.FLOAT,
          new Float32Array([0.0])
        );
      }
    },
    []
  );

  // Upload float32 textures to GPU ONLY when underlying buffer references, dimensions, or filter mode change.
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    if (!glReady || !gl || !program || width <= 0 || height <= 0) return;

    filterModeRef.current = smooth && floatLinearSupportedRef.current ? gl.LINEAR : gl.NEAREST;

    const isRgb = !!(rgbBandsData && rgbBandsData.r && rgbBandsData.g && rgbBandsData.b);
    if (isRgb && rgbBandsData) {
      uploadTexture(texturesRef.current.bandR, rgbBandsData.r, width, height);
      uploadTexture(texturesRef.current.bandG, rgbBandsData.g, width, height);
      uploadTexture(texturesRef.current.bandB, rgbBandsData.b, width, height);
    } else {
      uploadTexture(texturesRef.current.currentFlux, fluxData, width, height);
      uploadTexture(texturesRef.current.referenceFlux, refFluxData || fluxData, width, height);
      uploadTexture(texturesRef.current.currentVar, varianceData, width, height);
      uploadTexture(texturesRef.current.referenceVar, refVarianceData || varianceData, width, height);
    }
  }, [
    glReady,
    fluxData,
    refFluxData,
    varianceData,
    refVarianceData,
    rgbBandsData,
    width,
    height,
    smooth,
    uploadTexture,
  ]);

  // Update shader uniforms and redraw quad without re-uploading GPU textures on slider/mode/palette changes.
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    if (!glReady || !gl || !program || width <= 0 || height <= 0) return;

    gl.useProgram(program);
    gl.viewport(0, 0, width, height);

    const isRgb = !!(rgbBandsData && rgbBandsData.r && rgbBandsData.g && rgbBandsData.b);

    const texUnits: [WebGLTexture | null, string, number][] = [
      [texturesRef.current.currentFlux, 'u_epoch_current', 0],
      [texturesRef.current.referenceFlux, 'u_epoch_reference', 1],
      [texturesRef.current.currentVar, 'u_var_current', 2],
      [texturesRef.current.referenceVar, 'u_var_reference', 3],
      [texturesRef.current.bandR, 'u_band_r', 4],
      [texturesRef.current.bandG, 'u_band_g', 5],
      [texturesRef.current.bandB, 'u_band_b', 6],
    ];

    texUnits.forEach(([tex, uniformName, unitIndex]) => {
      gl.activeTexture(gl.TEXTURE0 + unitIndex);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(program, uniformName), unitIndex);
    });

    gl.uniform1i(gl.getUniformLocation(program, 'u_is_rgb'), isRgb ? 1 : 0);

    const modeMap = { blink: 0, difference: 1, coadd: 2 };
    gl.uniform1i(gl.getUniformLocation(program, 'u_mode'), modeMap[renderMode] ?? 0);

    const paletteMap = { standard_rgb: 0, viridis: 1, cividis: 2, inverted_grayscale: 3 };
    gl.uniform1i(gl.getUniformLocation(program, 'u_color_palette'), paletteMap[colorPalette] ?? 0);

    gl.uniform1f(gl.getUniformLocation(program, 'u_black'), effectiveCuts.min);
    gl.uniform1f(gl.getUniformLocation(program, 'u_white'), effectiveCuts.max);
    gl.uniform1f(gl.getUniformLocation(program, 'u_asinh_a'), Math.max(asinhParamA, 1e-4));
    gl.uniform1f(gl.getUniformLocation(program, 'u_diff_scale'), effectiveDiffScale);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [
    glReady,
    fluxData,
    refFluxData,
    varianceData,
    refVarianceData,
    rgbBandsData,
    width,
    height,
    renderMode,
    asinhParamA,
    effectiveCuts,
    effectiveDiffScale,
    colorPalette,
    smooth,
  ]);

  const buildPixelInfo = useCallback(
    (pxX: number, pxY: number, radiusPx?: number): HoverPixelInfo => {
      const clampedX = Math.max(0, Math.min(width - 1, pxX));
      const clampedY = Math.max(0, Math.min(height - 1, pxY));
      const idx = clampedY * width + clampedX;
      const flux = fluxData && idx < fluxData.length ? fluxData[idx] : 0;
      const variance = varianceData && idx < varianceData.length ? varianceData[idx] : 0;
      const snr = variance > 0 ? flux / Math.sqrt(variance) : 0;
      const flagsVal = flagsData && idx < flagsData.length ? flagsData[idx] : 0;

      return {
        x: clampedX,
        y: clampedY,
        flux,
        variance,
        snr,
        flags: flagsVal,
        flagNames: decodeFlagNames(flagsVal),
        ...(radiusPx !== undefined ? { radiusPx } : {}),
      };
    },
    [fluxData, varianceData, flagsData, width, height]
  );

  const clientToImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || width <= 0 || height <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const fracX = ((e.clientX - rect.left) / rect.width) * width;
      const fracY = ((e.clientY - rect.top) / rect.height) * height;
      const pxX = Math.floor(fracX);
      const pxY = Math.floor(fracY);
      return { fracX, fracY, pxX, pxY };
    },
    [width, height]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 || !onPixelClick) return;
      const coords = clientToImageCoords(e);
      if (!coords) return;
      const { fracX, fracY, pxX, pxY } = coords;
      if (pxX < 0 || pxX >= width || pxY < 0 || pxY >= height) return;
      suppressNextClickRef.current = false;
      const nextDrag = {
        startX: fracX,
        startY: fracY,
        currentX: fracX,
        currentY: fracY,
        radiusPx: 0,
      };
      dragCircleRef.current = nextDrag;
      setDragCircle(nextDrag);
    },
    [clientToImageCoords, width, height, onPixelClick]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onPixelHover && !onPixelClick) return;
      const coords = clientToImageCoords(e);
      if (!coords) return;
      const { fracX, fracY, pxX, pxY } = coords;

      const activeDrag = dragCircleRef.current;
      if (activeDrag) {
        const clampedFracX = Math.max(0, Math.min(width, fracX));
        const clampedFracY = Math.max(0, Math.min(height, fracY));
        const radiusPx = Math.min(
          Math.max(width, height) * 0.45,
          Math.hypot(clampedFracX - activeDrag.startX, clampedFracY - activeDrag.startY)
        );
        const updatedDrag = {
          ...activeDrag,
          currentX: clampedFracX,
          currentY: clampedFracY,
          radiusPx,
        };
        dragCircleRef.current = updatedDrag;
        setDragCircle(updatedDrag);
      }

      if (pxX < 0 || pxX >= width || pxY < 0 || pxY >= height) {
        onPixelHover?.(null);
        return;
      }

      onPixelHover?.(buildPixelInfo(pxX, pxY));
    },
    [clientToImageCoords, buildPixelInfo, width, height, onPixelHover, onPixelClick]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const activeDrag = dragCircleRef.current;
      dragCircleRef.current = null;
      setDragCircle(null);

      if (!activeDrag || !onPixelClick) return;
      if (activeDrag.radiusPx >= 0.75) {
        suppressNextClickRef.current = true;
        const centerPxX = Math.max(0, Math.min(width - 1, Math.floor(activeDrag.startX)));
        const centerPxY = Math.max(0, Math.min(height - 1, Math.floor(activeDrag.startY)));
        onPixelClick(buildPixelInfo(centerPxX, centerPxY, Number(activeDrag.radiusPx.toFixed(2))));
      }
    },
    [buildPixelInfo, width, height, onPixelClick]
  );

  const handleMouseLeave = useCallback(() => {
    dragCircleRef.current = null;
    setDragCircle(null);
    onPixelHover?.(null);
  }, [onPixelHover]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (!onPixelClick) return;
      const coords = clientToImageCoords(e);
      if (!coords) return;
      const { pxX, pxY } = coords;
      if (pxX >= 0 && pxX < width && pxY >= 0 && pxY < height) {
        onPixelClick(buildPixelInfo(pxX, pxY));
      }
    },
    [clientToImageCoords, buildPixelInfo, width, height, onPixelClick]
  );

  return (
    <div
      className={`relative inline-block overflow-hidden select-none bg-[#080A0F] ${className}`}
      style={{
        boxShadow: isFrameZero ? 'inset 0 0 0 1px #00f0ff' : undefined,
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="block h-full w-full cursor-crosshair"
        style={{
          imageRendering: smooth ? 'auto' : 'pixelated',
        }}
      />

      {dragCircle && dragCircle.radiusPx >= 0.5 && width > 0 && height > 0 && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-cyan-400 bg-cyan-400/10 shadow-[0_0_12px_rgba(34,211,238,0.45)]"
          style={{
            left: `${(dragCircle.startX / width) * 100}%`,
            top: `${(dragCircle.startY / height) * 100}%`,
            width: `${((dragCircle.radiusPx * 2) / width) * 100}%`,
            height: `${((dragCircle.radiusPx * 2) / height) * 100}%`,
          }}
        >
          <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-cyan-500/50 bg-[#080A0F]/90 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">
            r = {dragCircle.radiusPx.toFixed(1)} px · {(dragCircle.radiusPx * 6.2).toFixed(1)}&quot;
          </span>
        </div>
      )}

      {isFrameZero && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-sm border border-[#00f0ff] bg-[#0F131A]/90 px-1.5 py-0.5 font-mono text-[10px] text-[#00f0ff]">
          FRAME 0 (T₀)
        </div>
      )}

      {gaiaPin && width > 0 && height > 0 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(gaiaPin.subpixelX / width) * 100}%`,
            top: `${(gaiaPin.subpixelY / height) * 100}%`,
          }}
        >
          <div className="relative flex items-center justify-center">
            <div className="absolute h-4 w-[1px] bg-[#38BDF8]" />
            <div className="absolute h-[1px] w-4 bg-[#38BDF8]" />
            <div className="h-2 w-2 rounded-full border border-[#38BDF8]" />
            {gaiaPin.label && (
              <span className="absolute left-3 top-[-8px] whitespace-nowrap rounded-sm bg-[#0F131A]/80 px-1 font-mono text-[9px] text-[#38BDF8]">
                {gaiaPin.label}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
