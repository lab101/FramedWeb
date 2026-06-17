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
  private lastDrawDistance = 0;
  private minDistance = 0;

  newLine(x: number, y: number, z: number): void {
    this.clearPath();
    this.pts.push({ x, y, z });
  }

  lineTo(x: number, y: number, z: number): void {
    if (this.pts.length === 0) {
      this.newLine(x, y, z);
      return;
    }
    this.pts.push({ x, y, z });
    this.calculate();
  }

  endLine(): void {
    this.clearPath();
  }

  private clearPath(): void {
    this.pts = [];
    this.lastDrawDistance = 0;
    this.minDistance = 0;
  }

  private totalLength(): number {
    let len = 0;
    for (let i = 1; i < this.pts.length; i++) {
      len += Math.hypot(
        this.pts[i].x - this.pts[i - 1].x,
        this.pts[i].y - this.pts[i - 1].y,
      );
    }
    return len;
  }

  // Interpolate position + size at a given arc-length distance.
  private positionAt(distance: number): P {
    if (this.pts.length === 1 || distance <= 0) return this.pts[0];
    let acc = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen === 0) continue;
      if (acc + segLen >= distance) {
        const t = (distance - acc) / segLen;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        };
      }
      acc += segLen;
    }
    return this.pts[this.pts.length - 1];
  }

  private calculate(): void {
    const length = this.totalLength();
    if (length <= this.minDistance) return;

    let newDrawPosition = this.lastDrawDistance + this.minDistance;
    const out: BrushPoint[] = [];

    while (newDrawPosition + this.minDistance < length) {
      const p = this.positionAt(newDrawPosition);
      out.push([p.x, p.y, p.z]);

      this.minDistance = Math.max(2.8, p.z * 0.17);
      this.lastDrawDistance = newDrawPosition;
      newDrawPosition = this.lastDrawDistance + this.minDistance;
    }

    if (out.length > 0) this.onNewPoints.emit(out);
  }
}
