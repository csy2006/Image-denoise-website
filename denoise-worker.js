/**
 * Bilateral Filter Worker — 在后台线程运行双边滤波降噪。
 * 
 * 输入消息:  { id, pixels: Uint8ClampedArray, width, height, sigmaS, sigmaR, mode }
 * 输出消息:  { id, type: 'done', pixels: Uint8ClampedArray, elapsed }
 *            { id, type: 'error', message }
 *
 * mode: 'bilateral' — 彩色双边（RGB 三通道）
 *       'grayscale'  — 灰度 Y 通道（保持色彩，仅平滑亮度）
 */

/* ──────── 预计算查找表 ──────── */
function gaussianLUT(sigma) {
  const lut = new Float32Array(256);
  const denom = 2 * sigma * sigma;
  for (let d = 0; d < 256; d++) {
    lut[d] = Math.exp(-(d * d) / denom);
  }
  return lut;
}

/* ──────── 预计算空间核 ──────── */
function buildSpatialKernel(radius, sigma) {
  const size = 2 * radius + 1;
  const kernel = new Float32Array(size * size);
  const denom = 2 * sigma * sigma;
  let ki = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      kernel[ki++] = Math.exp(-(dx * dx + dy * dy) / denom);
    }
  }
  return { kernel, size, radius };
}

/* ──────── 双边滤波：彩色模式 ──────── */
function bilateralColor(src, dst, w, h, radius, size, kernel, rLUT) {
  const wh = w * h;
  for (let idx = 0; idx < wh; idx++) {
    const x = idx % w;
    const y = (idx / w) | 0;
    const ci = idx * 4;
    const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
    let sumR = 0, sumG = 0, sumB = 0, sumW = 0;

    const kyMin = Math.max(0, y - radius);
    const kyMax = Math.min(h - 1, y + radius);
    const kxMin = Math.max(0, x - radius);
    const kxMax = Math.min(w - 1, x + radius);

    for (let ky = kyMin; ky <= kyMax; ky++) {
      const rowOff = ky * w * 4;
      const kyOff = (ky - y + radius) * size;
      for (let kx = kxMin; kx <= kxMax; kx++) {
        const si = rowOff + kx * 4;
        const sr = src[si], sg = src[si + 1], sb = src[si + 2];
        // 手动 abs（比 Math.abs 快）
        let d = cr - sr; if (d < 0) d = -d;
        let rw = rLUT[d];
        d = cg - sg; if (d < 0) d = -d;
        rw *= rLUT[d];
        d = cb - sb; if (d < 0) d = -d;
        rw *= rLUT[d];

        const wgt = kernel[kyOff + (kx - x + radius)] * rw;
        sumR += sr * wgt;
        sumG += sg * wgt;
        sumB += sb * wgt;
        sumW += wgt;
      }
    }

    const invW = sumW > 0 ? 1 / sumW : 0;
    dst[ci]     = sumW > 0 ? sumR * invW : cr;
    dst[ci + 1] = sumW > 0 ? sumG * invW : cg;
    dst[ci + 2] = sumW > 0 ? sumB * invW : cb;
    dst[ci + 3] = 255;
  }
}

/* ──────── 双边滤波：灰度模式 ──────── */
function bilateralGrayscale(src, dst, w, h, radius, size, kernel, rLUT) {
  const wh = w * h;
  // 先计算全图 Y 通道
  const yBuf = new Uint8ClampedArray(wh);
  for (let i = 0; i < wh; i++) {
    const ci = i * 4;
    yBuf[i] = Math.round(0.299 * src[ci] + 0.587 * src[ci + 1] + 0.114 * src[ci + 2]);
  }

  for (let idx = 0; idx < wh; idx++) {
    const x = idx % w;
    const y = (idx / w) | 0;
    const ci = idx * 4;
    const cy = yBuf[idx];
    let sumY = 0, sumW = 0;

    const kyMin = Math.max(0, y - radius);
    const kyMax = Math.min(h - 1, y + radius);
    const kxMin = Math.max(0, x - radius);
    const kxMax = Math.min(w - 1, x + radius);

    for (let ky = kyMin; ky <= kyMax; ky++) {
      const rowOff = ky * w;
      const kyOff = (ky - y + radius) * size;
      for (let kx = kxMin; kx <= kxMax; kx++) {
        const syVal = yBuf[rowOff + kx];
        let d = cy - syVal; if (d < 0) d = -d;
        const wgt = kernel[kyOff + (kx - x + radius)] * rLUT[d];
        sumY += syVal * wgt;
        sumW += wgt;
      }
    }

    const finalY = sumW > 0 ? Math.round(sumY / sumW) : cy;
    const factor = cy > 0 ? finalY / cy : 1;
    dst[ci]     = Math.min(255, Math.round(src[ci] * factor));
    dst[ci + 1] = Math.min(255, Math.round(src[ci + 1] * factor));
    dst[ci + 2] = Math.min(255, Math.round(src[ci + 2] * factor));
    dst[ci + 3] = 255;
  }
}

/* ──────── 主入口 ──────── */
self.onmessage = function (e) {
  const { id, pixels, width, height, sigmaS, sigmaR, mode } = e.data;
  const w = width, h = height;

  try {
    // 核半径 = 2*sigma_s，上限 8 → 最大 17x17 核（移动端可接受）
    const radius = Math.min(Math.max(1, Math.ceil(sigmaS * 2)), 8);
    const { kernel, size } = buildSpatialKernel(radius, sigmaS);
    const rLUT = gaussianLUT(sigmaR);

    const src = new Uint8ClampedArray(pixels);
    const dst = new Uint8ClampedArray(src.length);

    const start = performance.now();

    if (mode === 'grayscale') {
      bilateralGrayscale(src, dst, w, h, radius, size, kernel, rLUT);
    } else {
      bilateralColor(src, dst, w, h, radius, size, kernel, rLUT);
    }

    const elapsed = Math.round(performance.now() - start);
    self.postMessage({ id, type: 'done', pixels: dst, elapsed }, [dst.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message || String(err) });
  }
};
