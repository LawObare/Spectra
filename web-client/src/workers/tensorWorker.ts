/**
 * Spectra Binary Tensor Web Worker (Off-Thread Stream Decompression)
 * Specification Anchor: SPECIFICATION.md §3.2, §6.1.6
 * Role: E3 (role:E3-webgl)
 *
 * Wire Contract:
 * - Bytes 0..3: Little-endian uint32 byte length L of UTF-8 JSON header
 * - Bytes 4..(4+L-1): UTF-8 JSON header string
 * - Bytes (4+L)..: Binary planes in strict canonical order:
 *     1. FLUX (float32): 4 bytes/px
 *     2. VARIANCE (float32): 4 bytes/px
 *     3. FLAGS (uint32): 4 bytes/px
 *     4. N_EXPOSURES (uint16): 2 bytes/px
 *     Total: 14 bytes/pixel
 */

export interface TensorHeader {
  shape: [number, number, number, number]; // [N_epochs, N_bands, H, W]
  crval?: [number, number];
  cdelt?: [number, number];
  mjd_ranges?: [number, number][];
  exposure_ids?: string[][];
  release?: string;
  source_badge?: string;
  compression?: 'none' | 'zstd' | 'zstd-shuffle';
}

export interface TensorWorkerRequest {
  taskId?: string;
  buffer: ArrayBuffer;
}

export interface TensorWorkerResponse {
  success: boolean;
  taskId?: string;
  error?: string;
  header: TensorHeader;
  fluxBuffer: ArrayBuffer;
  varianceBuffer: ArrayBuffer;
  flagsBuffer: ArrayBuffer;
  nExposuresBuffer: ArrayBuffer;
  totalPixelsPerPlane: number;
}

/**
 * Invert byte-shuffling (Blosc/HDF5 filter standard)
 * Reconstructs array of `n` elements of `elementSize` bytes from shuffled byte stream.
 */
function unshuffleBytes(shuffled: Uint8Array, elementSize: number): Uint8Array {
  const n = Math.floor(shuffled.length / elementSize);
  const result = new Uint8Array(shuffled.length);
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < elementSize; b++) {
      result[i * elementSize + b] = shuffled[b * n + i];
    }
  }
  return result;
}

self.onmessage = async (e: MessageEvent<TensorWorkerRequest>) => {
  const { taskId, buffer } = e.data;

  try {
    if (!buffer || buffer.byteLength < 4) {
      throw new Error('Invalid binary tensor buffer: payload too small (< 4 bytes).');
    }

    const dataView = new DataView(buffer);
    const headerLen = dataView.getUint32(0, true); // Little-endian uint32

    if (buffer.byteLength < 4 + headerLen) {
      throw new Error(`Buffer truncated: expected at least ${4 + headerLen} bytes, got ${buffer.byteLength}.`);
    }

    // 1. Parse JSON Header
    const headerBytes = new Uint8Array(buffer, 4, headerLen);
    const headerStr = new TextDecoder('utf-8').decode(headerBytes);
    const header: TensorHeader = JSON.parse(headerStr);

    const [epochs, bands, height, width] = header.shape;
    const totalPixels = epochs * bands * height * width;

    const fluxBytesCount = totalPixels * 4;
    const varBytesCount = totalPixels * 4;
    const flagsBytesCount = totalPixels * 4;
    const nExpBytesCount = totalPixels * 2;
    const totalUncompressedBytes = fluxBytesCount + varBytesCount + flagsBytesCount + nExpBytesCount;

    let payloadBytes = new Uint8Array(buffer, 4 + headerLen);

    // 2. Handle zstd / zstd-shuffle decompression if required
    if (header.compression === 'zstd' || header.compression === 'zstd-shuffle') {
      try {
        const { Decompressor } = await import('zstd-wasm');
        const decompressor = new Decompressor();
        await decompressor.init();
        payloadBytes = decompressor.decompress(payloadBytes);
      } catch (decompError) {
        if (payloadBytes.byteLength !== totalUncompressedBytes) {
          throw new Error(`Zstd decompression failed: ${decompError}`);
        }
      }
    }

    // 3. Extract and un-shuffle binary planes
    let rawFluxBytes: Uint8Array;
    let rawVarBytes: Uint8Array;
    let rawFlagsBytes: Uint8Array;
    let rawNExpBytes: Uint8Array;

    let offset = 0;
    const fluxSlice = payloadBytes.subarray(offset, offset + fluxBytesCount);
    offset += fluxBytesCount;

    const varSlice = payloadBytes.subarray(offset, offset + varBytesCount);
    offset += varBytesCount;

    const flagsSlice = payloadBytes.subarray(offset, offset + flagsBytesCount);
    offset += flagsBytesCount;

    const nExpSlice = payloadBytes.subarray(offset, offset + nExpBytesCount);

    if (header.compression === 'zstd-shuffle') {
      rawFluxBytes = unshuffleBytes(fluxSlice, 4);
      rawVarBytes = unshuffleBytes(varSlice, 4);
      rawFlagsBytes = unshuffleBytes(flagsSlice, 4);
      rawNExpBytes = unshuffleBytes(nExpSlice, 2);
    } else {
      rawFluxBytes = fluxSlice;
      rawVarBytes = varSlice;
      rawFlagsBytes = flagsSlice;
      rawNExpBytes = nExpSlice;
    }

    // 4. Create typed buffers for zero-copy Transferable transfer
    const fluxTyped = new Float32Array(rawFluxBytes.buffer, rawFluxBytes.byteOffset, totalPixels);
    const varTyped = new Float32Array(rawVarBytes.buffer, rawVarBytes.byteOffset, totalPixels);
    const flagsTyped = new Uint32Array(rawFlagsBytes.buffer, rawFlagsBytes.byteOffset, totalPixels);
    const nExpTyped = new Uint16Array(rawNExpBytes.buffer, rawNExpBytes.byteOffset, totalPixels);

    const fluxBuf = fluxTyped.buffer.slice(fluxTyped.byteOffset, fluxTyped.byteOffset + fluxTyped.byteLength);
    const varBuf = varTyped.buffer.slice(varTyped.byteOffset, varTyped.byteOffset + varTyped.byteLength);
    const flagsBuf = flagsTyped.buffer.slice(flagsTyped.byteOffset, flagsTyped.byteOffset + flagsTyped.byteLength);
    const nExpBuf = nExpTyped.buffer.slice(nExpTyped.byteOffset, nExpTyped.byteOffset + nExpTyped.byteLength);

    const response: TensorWorkerResponse = {
      success: true,
      taskId,
      header,
      fluxBuffer: fluxBuf,
      varianceBuffer: varBuf,
      flagsBuffer: flagsBuf,
      nExposuresBuffer: nExpBuf,
      totalPixelsPerPlane: totalPixels,
    };

    (self as any).postMessage(response, [fluxBuf, varBuf, flagsBuf, nExpBuf]);
  } catch (err: any) {
    const errorResponse: TensorWorkerResponse = {
      success: false,
      taskId,
      error: err?.message || String(err),
      header: { shape: [0, 0, 0, 0] },
      fluxBuffer: new ArrayBuffer(0),
      varianceBuffer: new ArrayBuffer(0),
      flagsBuffer: new ArrayBuffer(0),
      nExposuresBuffer: new ArrayBuffer(0),
      totalPixelsPerPlane: 0,
    };
    self.postMessage(errorResponse);
  }
};
