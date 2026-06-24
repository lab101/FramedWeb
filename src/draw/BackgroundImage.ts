import type { Renderer, FrameTexture, ScreenRect } from "../gpu/Renderer";
import { Signal } from "../util/signal";

export interface PaperRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Shared background image composited under all frame drawings.
export class BackgroundImage {
  private texture: GPUTexture | null = null;
  private blitBindGroup: GPUBindGroup | null = null;
  private previewBlitBindGroup: GPUBindGroup | null = null;
  private bitmap: ImageBitmap | null = null;
  private imageWidth = 0;
  private imageHeight = 0;
  private version = 0;

  readonly onChange = new Signal();

  constructor(private renderer: Renderer) {}

  hasImage(): boolean {
    return this.texture !== null;
  }

  getVersion(): number {
    return this.version;
  }

  getPreviewBlitBindGroup(): GPUBindGroup | null {
    return this.previewBlitBindGroup;
  }

  getBlitBindGroup(): GPUBindGroup | null {
    return this.blitBindGroup;
  }

  // Contain-fit within the frame paper (aspect ratio preserved).
  fitRect(frameW: number, frameH: number): PaperRect | null {
    if (!this.hasImage()) return null;
    const scale = Math.min(frameW / this.imageWidth, frameH / this.imageHeight);
    const w = this.imageWidth * scale;
    const h = this.imageHeight * scale;
    return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
  }

  async loadFromFile(file: File): Promise<boolean> {
    if (!file.type.startsWith("image/")) return false;
    const bitmap = await createImageBitmap(file);
    this.setFromBitmap(bitmap);
    return true;
  }

  async loadFromDataTransfer(dt: DataTransfer): Promise<boolean> {
    const file = [...dt.files].find((f) => f.type.startsWith("image/"));
    if (!file) return false;
    return this.loadFromFile(file);
  }

  private setFromBitmap(bitmap: ImageBitmap): void {
    this.destroyGpu();
    if (this.bitmap) this.bitmap.close();

    this.bitmap = bitmap;
    this.imageWidth = bitmap.width;
    this.imageHeight = bitmap.height;

    const img = this.renderer.createImageTexture(bitmap);
    this.texture = img.texture;
    this.blitBindGroup = img.blitBindGroup;
    this.previewBlitBindGroup = img.previewBlitBindGroup;
    this.version++;
    this.onChange.emit();
  }

  // Blit black paper, optional background image, then the drawing layer.
  blitFrame(frame: FrameTexture, destRect: ScreenRect, tint = 1): void {
    this.renderer.fillRect(destRect, [0, 0, 0, tint]);
    const fit = this.fitRect(frame.width, frame.height);
    const scale = destRect.w / frame.width;
    if (fit && this.blitBindGroup) {
      this.renderer.blitImage(
        this.blitBindGroup,
        {
          x: destRect.x + fit.x * scale,
          y: destRect.y + fit.y * scale,
          w: fit.w * scale,
          h: fit.h * scale,
        },
        tint,
      );
    }
    this.renderer.blit(frame, destRect, tint);
  }

  async exportFrame(frame: FrameTexture, type = "image/png", quality?: number): Promise<Blob> {
    this.renderer.flushBrush();
    const { width, height } = frame;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable for frame export");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    if (this.bitmap) {
      const fit = this.fitRect(width, height);
      if (fit) ctx.drawImage(this.bitmap, fit.x, fit.y, fit.w, fit.h);
    }

    const frameBlob = await this.renderer.readFrameToBlob(frame, type, quality, true);
    const frameImg = await createImageBitmap(frameBlob);
    ctx.drawImage(frameImg, 0, 0);
    frameImg.close();

    return await new Promise<Blob>((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("frame export failed"))), type, quality);
    });
  }

  clear(): void {
    this.destroyGpu();
    if (this.bitmap) {
      this.bitmap.close();
      this.bitmap = null;
    }
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.version++;
    this.onChange.emit();
  }

  private destroyGpu(): void {
    this.texture?.destroy();
    this.texture = null;
    this.blitBindGroup = null;
    this.previewBlitBindGroup = null;
  }

  destroy(): void {
    this.clear();
  }
}
