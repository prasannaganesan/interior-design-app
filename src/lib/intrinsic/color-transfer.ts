import { srgbToLinear, linearToSrgb } from '../color';

export function hexToLinearRgb(hex: string): [number, number, number] {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16));
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16));
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16));
  return [r, g, b];
}

export function applyReflectanceColor(
  image: ImageData,
  decomposition: { R: Float32Array; S: Float32Array; E: Float32Array },
  indices: Uint32Array,
  hex: string
) {
  const [rt, gt, bt] = hexToLinearRgb(hex);
  const mean = [0, 0, 0];
  for (const idx of indices) {
    const base = idx * 3;
    mean[0] += decomposition.R[base];
    mean[1] += decomposition.R[base + 1];
    mean[2] += decomposition.R[base + 2];
  }
  mean[0] /= indices.length; mean[1] /= indices.length; mean[2] /= indices.length;
  const gain = [rt / mean[0], gt / mean[1], bt / mean[2]];
  const data = image.data;
  for (const idx of indices) {
    const b3 = idx * 3;
    const s = decomposition.S[idx];
    const sp = decomposition.E[b3];
    const r = Math.min(1, Math.max(0, decomposition.R[b3] * gain[0]));
    const g = Math.min(1, Math.max(0, decomposition.R[b3 + 1] * gain[1]));
    const b = Math.min(1, Math.max(0, decomposition.R[b3 + 2] * gain[2]));
    const outR = linearToSrgb(r * s + sp);
    const outG = linearToSrgb(g * s + sp);
    const outB = linearToSrgb(b * s + sp);
    const p = idx * 4;
    data[p] = outR;
    data[p + 1] = outG;
    data[p + 2] = outB;
  }
}
