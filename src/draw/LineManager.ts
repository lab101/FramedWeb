import { Signal } from "../util/signal";
import type { BrushPoint } from "./types";

interface P {
  x: number;
  y: number;
  z: number; // brush size at this sample (pressure * scale)
}

// Port of the original LineManager: it takes raw pointer samples and resamples
// the stroke along its arc length, emitting evenly spaced brush points whose
// spacing depends on the brush size (so the soft dots overlap into a smooth
// line). z carries the per-point brush diameter in pixels.
export class LineManager {
  readonly onNewPoints = new Signal<[BrushPoint[]]>();

  private pts: P[] = [];
  // cum[i] = arc length from the first sample to pts[i] (cum[0] = 0).
  private cum: number[] = [];
  private lastDrawDistance = 0;
  private minDistance = 0;
  // Forward-only segment cursor for positionAt; valid because the resample
  // distance only ever increases over the life of a stroke.
  private segCursor = 1;

  newLine(x: number, y: number, z: number): void {
    this.clearPath();
    this.pts.push({ x, y, z });
    this.cum.push(0);
  }

  lineTo(x: number, y: number, z: number): void {
    if (this.pts.length === 0) {
      this.newLine(x, y, z);
      return;
    }
    const prev = this.pts[this.pts.length - 1];
    const d = Math.hypot(x - prev.x, y - prev.y);
    this.pts.push({ x, y, z });
    this.cum.push(this.cum[this.cum.length - 1] + d);
    this.calculate();
  }

  endLine(): void {
    this.clearPath();
  }

  private clearPath(): void {
    this.pts = [];
    this.cum = [];
    this.lastDrawDistance = 0;
    this.minDistance = 0;
    this.segCursor = 1;
  }

  private totalLength(): number {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }

  // Interpolate position + size at a given arc-length distance. Callers pass
  // monotonically increasing distances, so the segment cursor never rewinds —
  // amortizing the whole stroke's resampling to O(n).
  private positionAt(distance: number): P {
    const pts = this.pts;
    if (pts.length === 1 || distance <= 0) return pts[0];

    while (this.segCursor < pts.length && this.cum[this.segCursor] < distance) {
      this.segCursor++;
    }
    if (this.segCursor >= pts.length) return pts[pts.length - 1];

    const i = this.segCursor;
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = this.cum[i] - this.cum[i - 1];
    if (segLen === 0) return b;
    const t = (distance - this.cum[i - 1]) / segLen;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  private calculate(): void {
    const length = this.totalLength();
    if (length <= this.minDistance) return;

    let newDrawPosition = this.lastDrawDistance + this.minDistance;
    const out: BrushPoint[] = [];

    while (newDrawPosition + this.minDistance < length) {
      const p = this.positionAt(newDrawPosition);
      out.push([p.x, p.y, p.z]);

      // Slightly wider spacing on large brushes to cut overdraw; small sizes unchanged.
      const base = p.z * 0.17;
      const extra = Math.max(0, (p.z - 60) * 0.02);
      this.minDistance = Math.max(2.8, base + extra);
      this.lastDrawDistance = newDrawPosition;
      newDrawPosition = this.lastDrawDistance + this.minDistance;
    }

    if (out.length > 0) this.onNewPoints.emit(out);
  }
}
