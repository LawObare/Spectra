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
  crpix?: [number, number];
  mjd_ranges?: [number, number][][];
  exposure_ids?: string[] | string[][];
  release?: string;
  source_badge?: string;
  is_simulated?: boolean;
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
  payloadBuffer: ArrayBuffer;
  totalPixels: number;
}

/**
 * Invert the backend's byte shuffle over fixed-size pixel records.
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

    if (
      !Array.isArray(header.shape) || header.shape.length !== 4 ||
      header.shape.some((value) => !Number.isSafeInteger(value) || value <= 0)
    ) {
      throw new Error('Invalid tensor shape in metadata header.');
    }
    const [epochs, bands, height, width] = header.shape;
    const totalPixels = epochs * bands * height * width;
    const totalUncompressedBytes = totalPixels * 14;
    if (!Number.isSafeInteger(totalUncompressedBytes)) {
      throw new Error('Tensor shape exceeds safe byte-size limits.');
    }

    let payloadBytes = new Uint8Array(buffer, 4 + headerLen);

    // 2. Handle zstd / zstd-shuffle decompression if required
    if (header.compression === 'zstd' || header.compression === 'zstd-shuffle') {
      const { Decompressor } = await import('zstd-wasm');
      const decompressor = new Decompressor();
      await decompressor.init();
      payloadBytes = decompressor.decompress(payloadBytes);
    }

    if (header.compression === 'zstd-shuffle') {
      // The server shuffles each 14-byte [FLUX, VARIANCE, FLAGS, N_EXPOSURES]
      // pixel record as a whole before compression, not each plane separately.
      payloadBytes = unshuffleBytes(payloadBytes, 14);
    }
    if (payloadBytes.byteLength !== totalUncompressedBytes) {
      throw new Error(`Tensor payload size mismatch: got ${payloadBytes.byteLength}, expected ${totalUncompressedBytes}.`);
    }

    // Align the planes once, then transfer the single allocation. Main-thread
    // Float32Array/Uint32Array/Uint16Array views can share it without copies.
    const payloadBuffer = new ArrayBuffer(totalUncompressedBytes);
    new Uint8Array(payloadBuffer).set(payloadBytes);

    const response: TensorWorkerResponse = {
      success: true,
      taskId,
      header,
      payloadBuffer,
      totalPixels,
    };

    (self as any).postMessage(response, [payloadBuffer]);
  } catch (err: any) {
    const errorResponse: TensorWorkerResponse = {
      success: false,
      taskId,
      error: err?.message || String(err),
      header: { shape: [0, 0, 0, 0] },
      payloadBuffer: new ArrayBuffer(0),
      totalPixels: 0,
    };
    self.postMessage(errorResponse);
  }
};
