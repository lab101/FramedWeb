import { Signal } from "../util/signal";
import { hsvToRgb, rgbToCss, clamp } from "../util/color";
import type { RGB } from "../draw/types";

const TWO_PI = Math.PI * 2;

// HSB color picker: hue/saturation square + brightness strip.
export class ColorPicker {
  readonly onChange = new Signal<[RGB]>();

  private square: HTMLCanvasElement;
  private squareCtx: CanvasRenderingContext2D;
  private brightnessStrip: HTMLCanvasElement;
  private brightnessCtx: CanvasRenderingContext2D;
  private swatchHost: HTMLElement;

  private h = 345; // 0..360
  private s = 0.85; // 0..1
  private v = 1; // brightness 0..1
  private recents: RGB[] = [];

  constructor() {
    this.square = document.getElementById("hsb-square") as HTMLCanvasElement;
    this.brightnessStrip = document.getElementById("brightness-strip") as HTMLCanvasElement;
    this.swatchHost = document.getElementById("swatches") as HTMLElement;
    this.squareCtx = this.square.getContext("2d")!;
    this.brightnessCtx = this.brightnessStrip.getContext("2d")!;

    this.bind(this.square, (x, y) => {
      this.setFromPolar(x, y);
      this.emit(false);
    });

    this.bind(this.brightnessStrip, (x) => {
      this.v = clamp(x, 0, 1);
      this.emit(false);
    });

    this.drawAll();
  }

  getColor(): RGB {
    return hsvToRgb(this.h, this.s, this.v);
  }

  private emit(markRecent: boolean): void {
    this.drawAll();
    this.onChange.emit(this.getColor());
    if (markRecent) this.pushRecent();
  }

  // Pointer handling for a canvas, normalized to 0..1.
  private bind(
    canvas: HTMLCanvasElement,
    onPos: (x: number, y: number) => void,
  ): void {
    let down = false;
    const handle = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      onPos((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    canvas.addEventListener("pointerdown", (e) => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      handle(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down) handle(e);
    });
    canvas.addEventListener("pointerup", (e) => {
      if (down) {
        down = false;
        canvas.releasePointerCapture(e.pointerId);
        this.pushRecent();
      }
    });
  }

  private pushRecent(): void {
    const c = this.getColor();
    this.recents = [c, ...this.recents.filter((r) => rgbToCss(r) !== rgbToCss(c))].slice(0, 8);
    this.drawSwatches();
  }

  private drawAll(): void {
    this.drawHSBOverview();
    this.drawPickerDot();
    this.drawBrightnessStrip();
    this.drawBrightnessMarker();
  }

  // Polar HSB field: angle -> hue, radius -> saturation.
  private drawHSBOverview(): void {
    const w = this.square.width;
    const hgt = this.square.height;
    const img = this.squareCtx.createImageData(w, hgt);
    const data = img.data;

    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const rgb = this.hsbAt((x + 0.5) / w, (y + 0.5) / hgt);
        const i = (y * w + x) * 4;
        data[i] = Math.round(rgb.r * 255);
        data[i + 1] = Math.round(rgb.g * 255);
        data[i + 2] = Math.round(rgb.b * 255);
        data[i + 3] = 255;
      }
    }
    this.squareCtx.putImageData(img, 0, 0);
  }

  private hsbAt(tx: number, ty: number): RGB {
    const toCenterX = 0.5 - tx;
    const toCenterY = 0.5 - ty;
    const angle = Math.atan2(toCenterY, toCenterX);
    const radius = Math.hypot(toCenterX, toCenterY) * 2;
    const hue = ((angle / TWO_PI) + 0.5) * 360;
    return hsvToRgb(hue, radius, this.v);
  }

  private setFromPolar(tx: number, ty: number): void {
    const toCenterX = 0.5 - tx;
    const toCenterY = 0.5 - ty;
    const angle = Math.atan2(toCenterY, toCenterX);
    const radius = Math.hypot(toCenterX, toCenterY) * 2;
    this.h = ((angle / TWO_PI) + 0.5) * 360;
    this.s = clamp(radius, 0, 1);
  }

  private polarToPixel(h: number, s: number): [number, number] {
    const w = this.square.width;
    const hgt = this.square.height;
    const hueNorm = h / 360;
    const angle = (hueNorm - 0.5) * TWO_PI;
    const len = s / 2;
    const tx = 0.5 - Math.cos(angle) * len;
    const ty = 0.5 - Math.sin(angle) * len;
    return [tx * w, ty * hgt];
  }

  private drawPickerDot(): void {
    const [px, py] = this.polarToPixel(this.h, this.s);
    const ctx = this.squareCtx;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Horizontal gradient: black -> current hue/sat at full brightness.
  private drawBrightnessStrip(): void {
    const w = this.brightnessStrip.width;
    const hgt = this.brightnessStrip.height;
    const img = this.brightnessCtx.createImageData(w, hgt);
    const data = img.data;

    for (let x = 0; x < w; x++) {
      const rgb = hsvToRgb(this.h, this.s, (x + 0.5) / w);
      const r = Math.round(rgb.r * 255);
      const g = Math.round(rgb.g * 255);
      const b = Math.round(rgb.b * 255);
      for (let y = 0; y < hgt; y++) {
        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    this.brightnessCtx.putImageData(img, 0, 0);
  }

  private drawBrightnessMarker(): void {
    const w = this.brightnessStrip.width;
    const hgt = this.brightnessStrip.height;
    const px = this.v * w;
    const ctx = this.brightnessCtx;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px, 3);
    ctx.lineTo(px, hgt - 3);
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawSwatches(): void {
    this.swatchHost.innerHTML = "";
    for (const c of this.recents) {
      const el = document.createElement("div");
      el.className = "swatch";
      el.style.background = rgbToCss(c);
      el.addEventListener("click", () => {
        this.setFromRgb(c);
      });
      this.swatchHost.appendChild(el);
    }
  }

  private setFromRgb(c: RGB): void {
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === c.r) h = ((c.g - c.b) / d) % 6;
      else if (max === c.g) h = (c.b - c.r) / d + 2;
      else h = (c.r - c.g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    this.h = h;
    this.s = max === 0 ? 0 : d / max;
    this.v = max;
    this.emit(false);
  }
}
