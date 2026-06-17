import type { ScreenRect } from "./gpu/Renderer";

// Handles the "paper" placement on screen: fit-to-area, zoom and pan.
// All rects/coords here are in device pixels (canvas backing-store pixels).
export class View {
  zoom = 0.8;
  panX = 0;
  panY = 0;

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
    this.zoom = Math.max(0.1, Math.min(8, this.zoom * factor));
    const after = this.paperRect(canvasW, canvasH, frameW, frameH);
    // keep the paper point under the cursor fixed
    const newScreenX = after.x + paper[0] * after.scale;
    const newScreenY = after.y + paper[1] * after.scale;
    this.panX += sx - newScreenX;
    this.panY += sy - newScreenY;
  }
}
