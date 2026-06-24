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

  getTextureView(): GPUTextureView | null {
    return this.texture?.createView() ?? null;
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

  // Blit flattened drawing + optional background to the screen.
  blitFrame(frame: FrameTexture, destRect: ScreenRect, tint = 1): void {
    this.renderer.compositeFrameLayer(
      frame,
      destRect,
      this.getTextureView(),
      this.fitRect(frame.width, frame.height),
      tint,
    );
  }

  async exportFrame(frame: FrameTexture, type = "image/png", quality?: number): Promise<Blob> {
    return this.renderer.readCompositeToBlob(frame, this, type, quality);
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
