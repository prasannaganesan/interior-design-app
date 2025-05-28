export function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(value: number): number {
  const v = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v)) * 255;
}

function linearRgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  return [x, y, z];
}

function xyzToLinearRgb(x: number, y: number, z: number): [number, number, number] {
  const r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  const b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [r, g, b];
}

function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
}

function finv(t: number): number {
  const t3 = t * t * t;
  return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
}

export function linearRgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = linearRgbToXyz(r, g, b);
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  return [L, a, bb];
}

export function labToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const x = xn * finv(fx);
  const y = yn * finv(fy);
  const z = zn * finv(fz);
  return xyzToLinearRgb(x, y, z);
}

export function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  return linearRgbToLab(rl, gl, bl);
}

export function boxBlurFloat(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const dest = new Float32Array(src.length);
  const integral = new Float32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += src[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const idx1 = (y2 + 1) * (width + 1) + (x2 + 1);
      const idx2 = y1 * (width + 1) + (x2 + 1);
      const idx3 = (y2 + 1) * (width + 1) + x1;
      const idx4 = y1 * (width + 1) + x1;
      const sum = integral[idx1] - integral[idx2] - integral[idx3] + integral[idx4];
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      dest[y * width + x] = sum / area;
    }
  }
  return dest;
}
