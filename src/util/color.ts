import type { RGB } from "../draw/types";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function map(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax - inMin === 0) return outMin;
  return outMin + ((v - inMin) * (outMax - outMin)) / (inMax - inMin);
}

// h in [0,360), s/v in [0,1] -> RGB in [0,1]
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: r + m, g: g + m, b: b + m };
}

export function rgbToCss({ r, g, b }: RGB): string {
  const f = (n: number) => Math.round(clamp(n, 0, 1) * 255);
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

// Parse any CSS color string into linear RGBA in [0,1].
export function parseCssColor(css: string): [number, number, number, number] {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillStyle = css.trim();
  const normalized = ctx.fillStyle;
  if (normalized.startsWith("#")) {
    const hex = normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
      : normalized;
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const m = normalized.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (m) {
    return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] !== undefined ? +m[4] : 1];
  }
  return [0.12, 0.12, 0.14, 1];
}

export function readCssVarColor(name: string): [number, number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseCssColor(value || "#16161c");
}
