// GPU frame textures store premultiplied RGBA; Canvas 2D expects straight alpha.
export function unpremultiplyAlpha(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a === 0) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      continue;
    }
    if (a === 255) continue;
    const inv = 255 / a;
    pixels[i] = Math.min(255, (pixels[i] * inv + 0.5) | 0);
    pixels[i + 1] = Math.min(255, (pixels[i + 1] * inv + 0.5) | 0);
    pixels[i + 2] = Math.min(255, (pixels[i + 2] * inv + 0.5) | 0);
  }
}
