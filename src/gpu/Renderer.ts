import { BRUSH_WGSL, SHAPE_WGSL, BLIT_WGSL, DOT_GRID_WGSL, OVERLAY_WGSL } from "./shaders";
import type { RGB } from "../draw/types";

// A drawable frame "paper" — equivalent to a Cinder FBO.
export interface FrameTexture {
  texture: GPUTexture;
  view: GPUTextureView;
  blitBindGroup: GPUBindGroup;
  width: number;
  height: number;
}

// Rectangle in CSS pixels within the canvas.
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FRAME_FORMAT: GPUTextureFormat = "rgba8unorm";

// premultiplied-alpha "over" blend
const PREMULT_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

// Destination-out: reduce premultiplied dst by src alpha (eraser stamps).
const ERASE_BLEND: GPUBlendState = {
  color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
};

// straight-alpha blend (overlay previews)
const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export class Renderer {
  device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private canvas!: HTMLCanvasElement;

  private brushPipeline!: GPURenderPipeline;
  private eraseBrushPipeline!: GPURenderPipeline;
  private shapePipeline!: GPURenderPipeline;
  private blitPipeline!: GPURenderPipeline;
  private dotGridPipeline!: GPURenderPipeline;
  private overlayPipeline!: GPURenderPipeline;

  // explicit layouts so the screen-pass bind groups can use dynamic offsets
  private brushBGL!: GPUBindGroupLayout;
  private blitBGL!: GPUBindGroupLayout;
  private dotGridBGL!: GPUBindGroupLayout;
  private overlayBGL!: GPUBindGroupLayout;

  private sampler!: GPUSampler;

  // reusable buffers for drawing into frame textures
  private brushInstances!: GPUBuffer;
  private brushUniform!: GPUBuffer;
  private brushBindGroup!: GPUBindGroup;
  private shapeVerts!: GPUBuffer;
  private shapeUniform!: GPUBuffer;
  private shapeBindGroup!: GPUBindGroup;

  // ring buffers for the screen pass (dynamic offsets)
  private uniformRing!: GPUBuffer;
  private overlayVertRing!: GPUBuffer;
  private overlayBindGroup!: GPUBindGroup;
  private dotGridBindGroup!: GPUBindGroup;
  private uniformAlign = 256;
  private ringOffset = 0;
  private overlayVertOffset = 0;

  // active screen pass state
  private encoder: GPUCommandEncoder | null = null;
  private pass: GPURenderPassEncoder | null = null;
  private scissorRect: ScreenRect | null = null;
  private previewSurfaces = new WeakMap<HTMLCanvasElement, GPUCanvasContext>();
  private previewConfigured = new WeakMap<HTMLCanvasElement, boolean>();
  private previewUniform!: GPUBuffer;
  private previewBindGroups = new WeakMap<FrameTexture, GPUBindGroup>();

  // Brush instances queued during the frame; flushed once per rAF (see flushBrush).
  private brushPending = new Map<
    FrameTexture,
    { data: Float32Array; count: number; capacity: number; erase: boolean }
  >();
  private static readonly BRUSH_FLOATS = 7;
  private static readonly BRUSH_CHUNK = 20000;

  // Reusable scratch arrays to avoid per-call allocations in hot draw paths.
  private scratch4 = new Float32Array(4);
  private scratch8 = new Float32Array(8);
  private readonly previewUniformData = new Float32Array([2, -2, -1, 1, 1, 1, 1, 1]);

  background: [number, number, number, number] = [0.12, 0.12, 0.14, 1];

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    this.device = await adapter.requestDevice();
    this.device.addEventListener("uncapturederror", (e) => {
      console.error("[webgpu]", (e as GPUUncapturedErrorEvent).error.message);
    });
    this.canvas = canvas;

    const ctx = canvas.getContext("webgpu");
    if (!ctx) return false;
    this.ctx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.uniformAlign = this.device.limits.minUniformBufferOffsetAlignment;
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    this.buildPipelines();
    this.buildBuffers();
    return true;
  }

  private buildPipelines(): void {
    const d = this.device;

    // brush + eraser (shared layout; eraser uses destination-out blend)
    const brushModule = d.createShaderModule({ code: BRUSH_WGSL });
    this.brushBGL = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    const brushPL = d.createPipelineLayout({ bindGroupLayouts: [this.brushBGL] });
    const brushVertex = {
      module: brushModule,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: 7 * 4, // pos(2) + size(1) + color(4)
          stepMode: "instance" as const,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" as const },
            { shaderLocation: 1, offset: 8, format: "float32" as const },
            { shaderLocation: 2, offset: 12, format: "float32x4" as const },
          ],
        },
      ],
    };
    const brushPrimitive = { topology: "triangle-list" as const };
    this.brushPipeline = d.createRenderPipeline({
      layout: brushPL,
      vertex: brushVertex,
      fragment: {
        module: brushModule,
        entryPoint: "fs",
        targets: [{ format: FRAME_FORMAT, blend: PREMULT_BLEND }],
      },
      primitive: brushPrimitive,
    });
    this.eraseBrushPipeline = d.createRenderPipeline({
      layout: brushPL,
      vertex: brushVertex,
      fragment: {
        module: brushModule,
        entryPoint: "fs",
        targets: [{ format: FRAME_FORMAT, blend: ERASE_BLEND }],
      },
      primitive: brushPrimitive,
    });

    // shape
    const shapeModule = d.createShaderModule({ code: SHAPE_WGSL });
    this.shapePipeline = d.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shapeModule,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 2 * 4,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
        ],
      },
      fragment: {
        module: shapeModule,
        entryPoint: "fs",
        targets: [{ format: FRAME_FORMAT, blend: PREMULT_BLEND }],
      },
      primitive: { topology: "triangle-list" },
    });

    // blit
    const blitModule = d.createShaderModule({ code: BLIT_WGSL });
    this.blitBGL = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 32 },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.blitPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.blitBGL] }),
      vertex: { module: blitModule, entryPoint: "vs" },
      fragment: {
        module: blitModule,
        entryPoint: "fs",
        targets: [{ format: this.format, blend: PREMULT_BLEND }],
      },
      primitive: { topology: "triangle-list" },
    });

    // dot grid
    const dotGridModule = d.createShaderModule({ code: DOT_GRID_WGSL });
    this.dotGridBGL = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 48 },
        },
      ],
    });
    this.dotGridPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.dotGridBGL] }),
      vertex: { module: dotGridModule, entryPoint: "vs" },
      fragment: {
        module: dotGridModule,
        entryPoint: "fs",
        targets: [{ format: this.format, blend: ALPHA_BLEND }],
      },
      primitive: { topology: "triangle-list" },
    });

    // overlay
    const overlayModule = d.createShaderModule({ code: OVERLAY_WGSL });
    this.overlayBGL = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 16 },
        },
      ],
    });
    this.overlayPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.overlayBGL] }),
      vertex: {
        module: overlayModule,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 2 * 4,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          },
        ],
      },
      fragment: {
        module: overlayModule,
        entryPoint: "fs",
        targets: [{ format: this.format, blend: ALPHA_BLEND }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private buildBuffers(): void {
    const d = this.device;

    this.brushInstances = d.createBuffer({
      size: 7 * 4 * 20000, // up to 20k dots per batch
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.brushUniform = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.brushBindGroup = d.createBindGroup({
      layout: this.brushBGL,
      entries: [{ binding: 0, resource: { buffer: this.brushUniform } }],
    });

    this.shapeVerts = d.createBuffer({
      size: 2 * 4 * 4096,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.shapeUniform = d.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shapeBindGroup = d.createBindGroup({
      layout: this.shapePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shapeUniform } }],
    });

    this.uniformRing = d.createBuffer({
      size: 64 * 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.overlayVertRing = d.createBuffer({
      size: 256 * 1024,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.overlayBindGroup = d.createBindGroup({
      layout: this.overlayBGL,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformRing, offset: 0, size: 16 },
        },
      ],
    });
    this.dotGridBindGroup = d.createBindGroup({
      layout: this.dotGridBGL,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformRing, offset: 0, size: 48 },
        },
      ],
    });

    this.previewUniform = d.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // ---- frame textures ----------------------------------------------------

  createFrameTexture(width: number, height: number): FrameTexture {
    const texture = this.device.createTexture({
      size: { width, height },
      format: FRAME_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView();
    const blitBindGroup = this.device.createBindGroup({
      layout: this.blitBGL,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformRing, offset: 0, size: 32 },
        },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: view },
      ],
    });
    return { texture, view, blitBindGroup, width, height };
  }

  clearFrame(frame: FrameTexture, color: RGB, alpha = 1): void {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: frame.view,
          clearValue: { r: color.r, g: color.g, b: color.b, a: alpha },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  createImageTexture(source: ImageBitmap): {
    texture: GPUTexture;
    blitBindGroup: GPUBindGroup;
    previewBlitBindGroup: GPUBindGroup;
  } {
    const texture = this.device.createTexture({
      size: { width: source.width, height: source.height },
      format: FRAME_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source }, { texture }, {
      width: source.width,
      height: source.height,
    });
    const view = texture.createView();
    const blitBindGroup = this.device.createBindGroup({
      layout: this.blitBGL,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformRing, offset: 0, size: 32 },
        },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: view },
      ],
    });
    const previewBlitBindGroup = this.device.createBindGroup({
      layout: this.blitBGL,
      entries: [
        { binding: 0, resource: { buffer: this.previewUniform, offset: 0, size: 32 } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: view },
      ],
    });
    return { texture, blitBindGroup, previewBlitBindGroup };
  }

  // Queue soft brush dots for a frame texture; GPU work runs in flushBrush().
  // instanceData: 7 floats per dot [x, y, size, r, g, b, a]
  drawBrush(frame: FrameTexture, instanceData: Float32Array, count: number, erase = false): void {
    if (count === 0) return;
    const stride = Renderer.BRUSH_FLOATS;
    let batch = this.brushPending.get(frame);
    if (!batch) {
      batch = { data: new Float32Array(512 * stride), count: 0, capacity: 512, erase };
      this.brushPending.set(frame, batch);
    }
    if (batch.erase !== erase) {
      this.flushBrushForFrame(frame);
      batch = { data: new Float32Array(512 * stride), count: 0, capacity: 512, erase };
      this.brushPending.set(frame, batch);
    }
    if (batch.count + count > batch.capacity) {
      const capacity = Math.max(batch.capacity * 2, batch.count + count);
      const next = new Float32Array(capacity * stride);
      next.set(batch.data.subarray(0, batch.count * stride));
      batch.data = next;
      batch.capacity = capacity;
    }
    batch.data.set(instanceData.subarray(0, count * stride), batch.count * stride);
    batch.count += count;
  }

  private flushBrushForFrame(frame: FrameTexture): void {
    const batch = this.brushPending.get(frame);
    if (!batch || batch.count === 0) return;

    const encoder = this.device.createCommandEncoder();
    this.submitBrushBatch(encoder, frame, batch);
    this.device.queue.submit([encoder.finish()]);
    this.brushPending.delete(frame);
  }

  private submitBrushBatch(
    encoder: GPUCommandEncoder,
    frame: FrameTexture,
    batch: { data: Float32Array; count: number; erase: boolean },
  ): void {
    const maxChunk = Renderer.BRUSH_CHUNK;
    this.scratch4[0] = frame.width;
    this.scratch4[1] = frame.height;
    this.scratch4[2] = 0;
    this.scratch4[3] = 0;
    this.device.queue.writeBuffer(this.brushUniform, 0, this.scratch4);

    const pipeline = batch.erase ? this.eraseBrushPipeline : this.brushPipeline;
    let offset = 0;
    while (offset < batch.count) {
      const chunk = Math.min(batch.count - offset, maxChunk);
      this.device.queue.writeBuffer(
        this.brushInstances,
        0,
        batch.data as BufferSource,
        offset * Renderer.BRUSH_FLOATS,
        chunk * Renderer.BRUSH_FLOATS,
      );

      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: frame.view, loadOp: "load", storeOp: "store" }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.brushBindGroup);
      pass.setVertexBuffer(0, this.brushInstances);
      pass.draw(6, chunk);
      pass.end();

      offset += chunk;
    }
  }

  // Submit all queued brush work in one GPU submit (call once per display frame).
  flushBrush(): void {
    if (this.brushPending.size === 0) return;

    const encoder = this.device.createCommandEncoder();
    for (const [frame, batch] of this.brushPending) {
      if (batch.count === 0) continue;
      this.submitBrushBatch(encoder, frame, batch);
    }

    this.device.queue.submit([encoder.finish()]);
    this.brushPending.clear();
  }

  discardBrushPending(): void {
    this.brushPending.clear();
  }

  // Draw solid triangles into a frame texture (pixel coords).
  drawShape(frame: FrameTexture, verts: Float32Array, color: RGB): void {
    const vertCount = verts.length / 2;
    if (vertCount === 0) return;
    const u = this.scratch8;
    u[0] = frame.width;
    u[1] = frame.height;
    u[2] = 0;
    u[3] = 0;
    u[4] = color.r;
    u[5] = color.g;
    u[6] = color.b;
    u[7] = 1;
    this.device.queue.writeBuffer(this.shapeUniform, 0, u);
    this.device.queue.writeBuffer(this.shapeVerts, 0, verts as BufferSource);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: frame.view, loadOp: "load", storeOp: "store" },
      ],
    });
    pass.setPipeline(this.shapePipeline);
    pass.setBindGroup(0, this.shapeBindGroup);
    pass.setVertexBuffer(0, this.shapeVerts);
    pass.draw(vertCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  // ---- screen pass -------------------------------------------------------

  beginScreen(): void {
    this.ringOffset = 0;
    this.overlayVertOffset = 0;
    this.scissorRect = null;
    this.encoder = this.device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const [r, g, b, a] = this.background;
    this.pass = this.encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r, g, b, a },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
  }

  // Restrict screen-pass draws to a canvas-pixel rect (null = full canvas).
  setScissor(rect: ScreenRect | null): void {
    this.scissorRect = rect;
    this.applyScissor();
  }

  private applyScissor(): void {
    if (!this.pass) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!this.scissorRect) {
      this.pass.setScissorRect(0, 0, cw, ch);
      return;
    }
    const r = this.scissorRect;
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const w = Math.max(0, Math.min(cw - x, Math.ceil(r.w)));
    const h = Math.max(0, Math.min(ch - y, Math.ceil(r.h)));
    this.pass.setScissorRect(x, y, w, h);
  }

  private allocUniform(byteLength: number): number {
    const off = this.ringOffset;
    const step = Math.ceil(byteLength / this.uniformAlign) * this.uniformAlign;
    this.ringOffset += step;
    return off;
  }

  // Procedural dot grid in paper space (drawn on the screen background).
  drawDotGrid(
    rect: ScreenRect & { scale: number },
    spacing = 32,
    dotRadius = 1.2,
    alpha = 0.35,
  ): void {
    if (!this.pass) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const off = this.allocUniform(48);
    const u = new Float32Array(12);
    u[0] = cw;
    u[1] = ch;
    u[2] = rect.x;
    u[3] = rect.y;
    u[4] = rect.scale;
    u[5] = spacing;
    u[6] = dotRadius;
    u[7] = alpha;
    this.device.queue.writeBuffer(this.uniformRing, off, u);
    this.pass.setPipeline(this.dotGridPipeline);
    this.pass.setBindGroup(0, this.dotGridBindGroup, [off]);
    this.pass.draw(6);
  }

  // Solid-color rectangle on the screen (straight-alpha).
  fillRect(rect: ScreenRect, color: [number, number, number, number]): void {
    this.overlay(this.rectToClip(rect), color);
  }

  // Blit an image texture (background) to a screen rectangle.
  blitImage(blitBindGroup: GPUBindGroup, rect: ScreenRect, tint = 1): void {
    if (!this.pass) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const sx = (rect.w / cw) * 2;
    const sy = -(rect.h / ch) * 2;
    const ox = (rect.x / cw) * 2 - 1;
    const oy = 1 - (rect.y / ch) * 2;

    const off = this.allocUniform(32);
    const u = this.scratch8;
    u[0] = sx;
    u[1] = sy;
    u[2] = ox;
    u[3] = oy;
    u[4] = tint;
    u[5] = tint;
    u[6] = tint;
    u[7] = tint;
    this.device.queue.writeBuffer(this.uniformRing, off, u);
    this.pass.setPipeline(this.blitPipeline);
    this.pass.setBindGroup(0, blitBindGroup, [off]);
    this.pass.draw(6);
  }

  // Blit a frame texture to a screen rectangle with an alpha tint.
  blit(frame: FrameTexture, rect: ScreenRect, tint = 1): void {
    if (!this.pass) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const sx = (rect.w / cw) * 2;
    const sy = -(rect.h / ch) * 2;
    const ox = (rect.x / cw) * 2 - 1;
    const oy = 1 - (rect.y / ch) * 2;

    const off = this.allocUniform(32);
    const u = this.scratch8;
    u[0] = sx;
    u[1] = sy;
    u[2] = ox;
    u[3] = oy;
    u[4] = tint;
    u[5] = tint;
    u[6] = tint;
    u[7] = tint;
    this.device.queue.writeBuffer(this.uniformRing, off, u);
    this.pass.setPipeline(this.blitPipeline);
    this.pass.setBindGroup(0, frame.blitBindGroup, [off]);
    this.pass.draw(6);
  }

  // Draw colored triangles directly on the screen (clip-space verts).
  overlay(clipVerts: Float32Array, color: [number, number, number, number]): void {
    if (!this.pass) return;
    const vertCount = clipVerts.length / 2;
    if (vertCount === 0) return;

    const voff = this.overlayVertOffset;
    this.device.queue.writeBuffer(this.overlayVertRing, voff, clipVerts as BufferSource);
    this.overlayVertOffset += Math.ceil((clipVerts.byteLength) / 4) * 4;

    const off = this.allocUniform(16);
    const c = this.scratch4;
    c[0] = color[0];
    c[1] = color[1];
    c[2] = color[2];
    c[3] = color[3];
    this.device.queue.writeBuffer(this.uniformRing, off, c);

    this.pass.setPipeline(this.overlayPipeline);
    this.pass.setBindGroup(0, this.overlayBindGroup, [off]);
    this.pass.setVertexBuffer(0, this.overlayVertRing, voff, clipVerts.byteLength);
    this.pass.draw(vertCount);
  }

  endScreen(): void {
    if (this.pass) this.pass.end();
    if (this.encoder) this.device.queue.submit([this.encoder.finish()]);
    this.pass = null;
    this.encoder = null;
  }

  private previewBindGroupFor(frame: FrameTexture): GPUBindGroup {
    let group = this.previewBindGroups.get(frame);
    if (!group) {
      group = this.device.createBindGroup({
        layout: this.blitBGL,
        entries: [
          { binding: 0, resource: { buffer: this.previewUniform, offset: 0, size: 32 } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: frame.view },
        ],
      });
      this.previewBindGroups.set(frame, group);
    }
    return group;
  }

  // Blit a frame texture to a secondary canvas (e.g. the loop preview panel).
  blitFrameFill(
    target: HTMLCanvasElement,
    frame: FrameTexture,
    background?: import("../draw/BackgroundImage").BackgroundImage,
  ): void {
    if (!target || !frame?.view) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const w = Math.max(1, Math.floor(bounds.width * dpr));
    const h = Math.max(1, Math.floor(bounds.height * dpr));
    const resized = target.width !== w || target.height !== h;
    if (resized) {
      target.width = w;
      target.height = h;
    }

    let ctx = this.previewSurfaces.get(target);
    if (!ctx) {
      const next = target.getContext("webgpu");
      if (!next) return;
      ctx = next;
      this.previewSurfaces.set(target, ctx);
    }

    if (!this.previewConfigured.get(target) || resized) {
      ctx.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
      this.previewConfigured.set(target, true);
    }

    const previewBindGroup = this.previewBindGroupFor(frame);
    const bgGroup = background?.getPreviewBlitBindGroup() ?? null;
    const fit = background?.fitRect(frame.width, frame.height) ?? null;

    const encoder = this.device.createCommandEncoder();
    const view = ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.blitPipeline);

    if (bgGroup && fit) {
      const bgRect: ScreenRect = {
        x: (fit.x / frame.width) * w,
        y: (fit.y / frame.height) * h,
        w: (fit.w / frame.width) * w,
        h: (fit.h / frame.height) * h,
      };
      this.blitRectToPass(pass, bgGroup, w, h, bgRect, 1, this.previewUniform);
    }

    this.device.queue.writeBuffer(this.previewUniform, 0, this.previewUniformData);
    pass.setBindGroup(0, previewBindGroup, [0]);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private blitRectToPass(
    pass: GPURenderPassEncoder,
    bindGroup: GPUBindGroup,
    canvasW: number,
    canvasH: number,
    rect: ScreenRect,
    tint: number,
    uniformBuffer: GPUBuffer,
  ): void {
    const sx = (rect.w / canvasW) * 2;
    const sy = -(rect.h / canvasH) * 2;
    const ox = (rect.x / canvasW) * 2 - 1;
    const oy = 1 - (rect.y / canvasH) * 2;
    const u = this.scratch8;
    u[0] = sx;
    u[1] = sy;
    u[2] = ox;
    u[3] = oy;
    u[4] = tint;
    u[5] = tint;
    u[6] = tint;
    u[7] = tint;
    this.device.queue.writeBuffer(uniformBuffer, 0, u);
    pass.setBindGroup(0, bindGroup, [0]);
    pass.draw(6);
  }

  // Read a frame texture back into a PNG blob (frames are opaque rgba8unorm).
  async readFrameToBlob(frame: FrameTexture, type = "image/png", quality?: number): Promise<Blob> {
    this.flushBrush();
    const { width, height } = frame;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;

    const readBuffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: frame.texture },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    this.device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readBuffer.getMappedRange());
    const pixels = new Uint8ClampedArray(width * height * 4);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
    }
    readBuffer.unmap();
    readBuffer.destroy();

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable for frame export");
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("frame export failed"))), type, quality);
    });
  }

  // Convert a canvas-pixel rect to clip-space triangle verts (for previews).
  rectToClip(rect: ScreenRect): Float32Array {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const x0 = (rect.x / cw) * 2 - 1;
    const x1 = ((rect.x + rect.w) / cw) * 2 - 1;
    const y0 = 1 - (rect.y / ch) * 2;
    const y1 = 1 - ((rect.y + rect.h) / ch) * 2;
    return new Float32Array([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
  }
}
