import type { ScreenRect } from "./gpu/Renderer";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
// Spring driving the displayed zoom toward the target.
// Higher stiffness = snappier follow. Damping ratio < 1 gives a little
// overshoot so the zoom eases back into place instead of just decelerating.
const ZOOM_STIFFNESS = 180;
const ZOOM_DAMPING_RATIO = 0.62;
// Cap per-frame integration step so a hitch/tab-switch can't make the spring explode.
const MAX_ZOOM_DT = 1 / 30;

// Handles the "paper" placement on screen: fit-to-area, zoom and pan.
// All rects/coords here are in device pixels (canvas backing-store pixels).
export class View {
  zoom = 0.8;
  panX = 0;
  panY = 0;

  private targetZoom = 0.8;
  private zoomVel = 0;
  private anchorSx = 0;
  private anchorSy = 0;
  private anchorPaperX = 0;
  private anchorPaperY = 0;
  private zoomAnimating = false;

  // Where the active paper is drawn on screen.
  paperRect(canvasW: number, canvasH: number, frameW: number, frameH: number): ScreenRect & { scale: number } {
    const margin = Math.min(canvasW, canvasH) * 0.03;
    const availW = canvasW - margin * 2;
    const availH = canvasH - margin * 2;
    const baseScale = Math.min(availW / frameW, availH / frameH);
    const scale = baseScale * this.zoom;
    const w = frameW * scale;
    const h = frameH * scale;
    const x = (canvasW - w) / 2 + this.panX;
    const y = (canvasH - h) / 2 + this.panY;
    return { x, y, w, h, scale };
  }

  screenToPaper(
    sx: number,
    sy: number,
    rect: ScreenRect & { scale: number },
  ): [number, number] {
    return [(sx - rect.x) / rect.scale, (sy - rect.y) / rect.scale];
  }

  zoomAt(
    sx: number,
    sy: number,
    factor: number,
    canvasW: number,
    canvasH: number,
    frameW: number,
    frameH: number,
  ): void {
    const before = this.paperRect(canvasW, canvasH, frameW, frameH);
    const paper = this.screenToPaper(sx, sy, before);
    this.anchorSx = sx;
    this.anchorSy = sy;
    this.anchorPaperX = paper[0];
    this.anchorPaperY = paper[1];
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetZoom * factor));
    this.zoomAnimating = true;
  }

  // Spring the displayed zoom toward the wheel/keyboard target while keeping the
  // anchor fixed. The under-damped spring overshoots slightly then eases back.
  update(
    dt: number,
    canvasW: number,
    canvasH: number,
    frameW: number,
    frameH: number,
  ): void {
    if (!this.zoomAnimating) return;

    const step = Math.min(dt, MAX_ZOOM_DT);
    const omega = Math.sqrt(ZOOM_STIFFNESS);
    const damping = 2 * ZOOM_DAMPING_RATIO * omega;

    // Semi-implicit Euler keeps the spring stable at frame-rate step sizes.
    const accel = ZOOM_STIFFNESS * (this.targetZoom - this.zoom) - damping * this.zoomVel;
    this.zoomVel += accel * step;
    this.zoom += this.zoomVel * step;
    this.applyAnchorPan(canvasW, canvasH, frameW, frameH);

    // Settle once both the offset and the velocity have effectively died out.
    if (Math.abs(this.targetZoom - this.zoom) < 1e-4 && Math.abs(this.zoomVel) < 1e-3) {
      this.zoom = this.targetZoom;
      this.zoomVel = 0;
      this.applyAnchorPan(canvasW, canvasH, frameW, frameH);
      this.zoomAnimating = false;
    }
  }

  // Whether the zoom spring is still settling (drives on-demand rendering).
  isAnimating(): boolean {
    return this.zoomAnimating;
  }

  // Stop chasing a pending zoom (e.g. when the user starts panning).
  settleZoom(): void {
    this.targetZoom = this.zoom;
    this.zoomVel = 0;
    this.zoomAnimating = false;
  }

  private applyAnchorPan(
    canvasW: number,
    canvasH: number,
    frameW: number,
    frameH: number,
  ): void {
    const rect = this.paperRect(canvasW, canvasH, frameW, frameH);
    const newScreenX = rect.x + this.anchorPaperX * rect.scale;
    const newScreenY = rect.y + this.anchorPaperY * rect.scale;
    this.panX += this.anchorSx - newScreenX;
    this.panY += this.anchorSy - newScreenY;
  }
}
