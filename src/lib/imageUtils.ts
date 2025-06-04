import { hexToLab, labToLinearRgb, linearToSrgb } from './color';
import { type WhiteBalance } from '../components/WhiteBalanceControls';

export interface LightingPreset {
  r: number;
  g: number;
  b: number;
  brightness: number;
}

export const LIGHTING_SETTINGS: Record<string, LightingPreset> = {
  normal: { r: 1, g: 1, b: 1, brightness: 1 },
  morning: { r: 1.1, g: 1.05, b: 0.95, brightness: 1.1 },
  afternoon: { r: 1.05, g: 1.05, b: 1.1, brightness: 1 },
  evening: { r: 1.1, g: 0.9, b: 0.8, brightness: 1 },
  // Night mode simulates indoor LED lighting rather than moonlight
  night: { r: 0.9, g: 0.95, b: 1.1, brightness: 0.8 },
  cloudy: { r: 0.95, g: 1, b: 1.1, brightness: 0.95 }
};

export interface RetinexData {
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
  gray: Float32Array;
  shade: Float32Array;
}

export function applyWhiteBalance(image: ImageData, wb: WhiteBalance): ImageData {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    out[i] = Math.min(255, image.data[i] * wb.r);
    out[i + 1] = Math.min(255, image.data[i + 1] * wb.g);
    out[i + 2] = Math.min(255, image.data[i + 2] * wb.b);
    out[i + 3] = image.data[i + 3];
  }
  return new ImageData(out, image.width, image.height);
}

export function applyLighting(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: string
) {
  const preset = LIGHTING_SETTINGS[mode];
  if (!preset || mode === 'normal') return;
  const img = ctx.getImageData(0, 0, width, height);
  const { r, g, b, brightness } = preset;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * r * brightness);
    data[i + 1] = Math.min(255, data[i + 1] * g * brightness);
    data[i + 2] = Math.min(255, data[i + 2] * b * brightness);
  }
  ctx.putImageData(img, 0, 0);
}

export function scaleImageData(
  source: ImageData,
  targetWidth: number,
  targetHeight: number
): ImageData {
  if (source.width === targetWidth && source.height === targetHeight) {
    return source;
  }
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.putImageData(source, 0, 0);

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) throw new Error('Failed to get temp canvas context');
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
  return tempCtx.getImageData(0, 0, targetWidth, targetHeight);
}

export function maskToIndices(mask: ImageData): Uint32Array {
  const { width, height, data } = mask;
  const pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] > 0) {
        pixels.push(y * width + x);
      }
    }
  }
  return new Uint32Array(pixels);
}

export function applyRetinexRecolor(
  baseData: ImageData,
  indices: Uint32Array,
  colorHex: string,
  pre: RetinexData
) {
  const data = baseData.data;
  const { L, A, B, gray, shade } = pre;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumGray = 0;
  const count = indices.length;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    sumL += L[i];
    sumA += A[i];
    sumB += B[i];
    sumGray += gray[i];
  }
  if (count === 0) return;
  const meanL = sumL / count;
  const meanA = sumA / count;
  const meanB = sumB / count;
  const meanGray = sumGray / count;

  const [Lt, at, bt] = hexToLab(colorHex);

  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const p = i * 4;
    const chromaScale = Math.min(Math.max(gray[i] / meanGray, 0.4), 1.0);
    const a = at + (A[i] - meanA) * chromaScale;
    const b = bt + (B[i] - meanB) * chromaScale;
    const rawScale = meanL > 0 ? Lt / meanL : 1;
    const lightnessScale = Math.min(rawScale, 5);
    const Lval = Math.min(Math.max(L[i] * lightnessScale, 0), 100);
    const [rLin, gLin, bLin] = labToLinearRgb(Lval, a, b);
    const r = linearToSrgb(rLin * shade[i]);
    const g = linearToSrgb(gLin * shade[i]);
    const bb = linearToSrgb(bLin * shade[i]);
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = bb;
  }
}

