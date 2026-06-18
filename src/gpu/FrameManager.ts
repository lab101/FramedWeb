import type { Renderer, FrameTexture } from "./Renderer";
import type { RGB, BrushPoint } from "../draw/types";
import { Signal } from "../util/signal";

const FRAME_BG: RGB = { r: 0, g: 0, b: 0 }; // original fboBackground = black

// Manages the stack of animation frames (each an offscreen "paper" texture),
// the active frame, drawing operations and the playback loop.
export class FrameManager {
  private frames: FrameTexture[] = [];
  private frameTouched: boolean[] = [];
  private activeIndex = 0;
  width = 1920;
  height = 1080;

  // playback position (float), advanced like the original update()
  currentFrame = 0;
  frameSpeed = 8;

  readonly onTouchedChange = new Signal<[boolean]>();

  constructor(private renderer: Renderer) {}

  setup(nrOfFrames: number, width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const f of this.frames) f.texture.destroy();
    this.frames = [];
    this.frameTouched = [];
    this.changeNrOfFrames(nrOfFrames);
    this.activeIndex = 0;
  }

  changeNrOfFrames(n: number): void {
    n = Math.max(1, Math.floor(n));
    if (n < this.frames.length) {
      for (let i = n; i < this.frames.length; i++) this.frames[i].texture.destroy();
      this.frames.length = n;
      this.frameTouched.length = n;
    } else {
      while (this.frames.length < n) {
        const f = this.renderer.createFrameTexture(this.width, this.height);
        this.renderer.clearFrame(f, FRAME_BG);
        this.frames.push(f);
        this.frameTouched.push(false);
      }
    }
    if (this.activeIndex >= this.frames.length) this.activeIndex = this.frames.length - 1;
    this.onTouchedChange.emit(this.allFramesTouched());
  }

  clearAll(): void {
    for (const f of this.frames) this.renderer.clearFrame(f, FRAME_BG);
    this.activeIndex = 0;
    this.frameTouched.fill(false);
    this.onTouchedChange.emit(false);
  }

  allFramesTouched(): boolean {
    if (this.frames.length === 0) return false;
    for (let i = 0; i < this.frames.length; i++) {
      if (!this.frameTouched[i]) return false;
    }
    return true;
  }

  private markTouched(id: number): void {
    if (id < 0 || id >= this.frames.length || this.frameTouched[id]) return;
    this.frameTouched[id] = true;
    this.onTouchedChange.emit(this.allFramesTouched());
  }

  update(dt: number): void {
    this.currentFrame += 0.4 * this.frameSpeed * dt;
    if (!isFinite(this.currentFrame)) this.currentFrame = 0;
  }

  // ---- drawing -----------------------------------------------------------

  drawPoints(points: BrushPoint[], color: RGB, frameId = -1): void {
    const id = frameId < 0 ? this.activeIndex : frameId;
    if (id < 0 || id >= this.frames.length || points.length === 0) return;
    const data = new Float32Array(points.length * 7);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const o = i * 7;
      data[o] = p[0];
      data[o + 1] = p[1];
      data[o + 2] = p[2];
      data[o + 3] = color.r;
      data[o + 4] = color.g;
      data[o + 5] = color.b;
      data[o + 6] = 1;
    }
    this.renderer.drawBrush(this.frames[id], data, points.length);
    this.markTouched(id);
  }

  drawCircle(p1: [number, number], p2: [number, number], color: RGB, frameId = -1): void {
    const id = frameId < 0 ? this.activeIndex : frameId;
    if (id < 0 || id >= this.frames.length) return;
    const radius = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    this.renderer.drawShape(this.frames[id], circleVerts(p1[0], p1[1], radius), color);
    this.markTouched(id);
  }

  drawRectangle(p1: [number, number], p2: [number, number], color: RGB, frameId = -1): void {
    const id = frameId < 0 ? this.activeIndex : frameId;
    if (id < 0 || id >= this.frames.length) return;
    this.renderer.drawShape(this.frames[id], rectVerts(p1[0], p1[1], p2[0], p2[1]), color);
    this.markTouched(id);
  }

  // ---- navigation --------------------------------------------------------

  setActiveFrame(i: number): void {
    if (i >= 0 && i < this.frames.length) this.activeIndex = i;
  }
  getActiveFrame(): number {
    return this.activeIndex;
  }
  nextFrame(): void {
    this.activeIndex = (this.activeIndex + 1) % this.frames.length;
  }
  prevFrame(): void {
    this.activeIndex = (this.activeIndex - 1 + this.frames.length) % this.frames.length;
  }

  count(): number {
    return this.frames.length;
  }
  getFrame(i: number): FrameTexture {
    return this.frames[i];
  }
  getActiveTexture(): FrameTexture {
    return this.frames[this.activeIndex];
  }
  getLoopIndex(): number {
    return Math.floor(this.currentFrame) % this.frames.length;
  }
}

const CIRCLE_SEGMENTS = 72;

function circleVerts(cx: number, cy: number, r: number): Float32Array {
  const out = new Float32Array(CIRCLE_SEGMENTS * 6);
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
    const o = i * 6;
    out[o] = cx;
    out[o + 1] = cy;
    out[o + 2] = cx + Math.cos(a0) * r;
    out[o + 3] = cy + Math.sin(a0) * r;
    out[o + 4] = cx + Math.cos(a1) * r;
    out[o + 5] = cy + Math.sin(a1) * r;
  }
  return out;
}

function rectVerts(ax: number, ay: number, bx: number, by: number): Float32Array {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return new Float32Array([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
}
