/** A CIE Lab (D65) color. */
export type Lab3 = [number, number, number];

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB hex such as "D0208C" → CIE Lab (D65). */
export function hexToLab(hex: string): Lab3 {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return rgbToLab(r, g, b);
}

/** 8-bit sRGB → CIE Lab (D65). */
export function rgbToLab(red: number, green: number, blue: number): Lab3 {
  const [r, g, b] = [red, green, blue].map((c) => linear(c / 255));
  const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 color difference. */
export function deltaE(a: Lab3, b: Lab3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
