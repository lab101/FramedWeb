import { Renderer, type ScreenRect } from "./gpu/Renderer";
import { FrameManager } from "./gpu/FrameManager";
import { LineManager } from "./draw/LineManager";
import { BackgroundImage } from "./draw/BackgroundImage";
import { NetworkManager } from "./net/NetworkManager";
import { ColorPicker } from "./ui/ColorPicker";
import { View } from "./View";
import { readCssVarColor } from "./util/color";
import type { RGB, Tool } from "./draw/types";
import { canvas, labelCanvas, noWebGPU } from "./dom";
import { DEFAULT_FRAMES, FRAME_H, FRAME_W } from "./config";
import { syncFrameStripVisibility, wireLoopPreview, wireFrameStrip } from "./frameStrip";
import { startRenderLoop } from "./render";
import { wireDrawing } from "./wire/drawing";
import { wirePointer } from "./wire/pointer";
import { wireKeyboard } from "./wire/keyboard";
import { wireControls } from "./wire/controls";
import { wireSettings, closeSettings } from "./wire/settings";
import { wireSidebarToggle } from "./wire/sidebar";
import { wireNetwork } from "./wire/network";
import { wireBackgroundImage } from "./wire/backgroundImage";

export class App {
  readonly renderer = new Renderer();
  readonly frames = new FrameManager(this.renderer);
  readonly lines = new LineManager();
  readonly background = new BackgroundImage(this.renderer);
  readonly net = new NetworkManager();
  readonly view = new View();
  colorPicker!: ColorPicker;

  tool: Tool = "brush";
  currentColor: RGB = { r: 1, g: 0.2, b: 0.45 };
  strokeScale = 0.5;
  strokeSliderActive = false;

  drawing = false;
  panning = false;
  spaceDown = false;
  projector = false;
  shapeStart: [number, number] = [0, 0];
  shapeEnd: [number, number] = [0, 0];
  lastPan: [number, number] = [0, 0];

  dpr = Math.max(1, window.devicePixelRatio || 1);
  thumbHits: Array<{ rect: ScreenRect; index: number }> = [];
  frameCanvasRect: DOMRect | null = null;

  ready = false;
  needsRender = true;
  lastLoopPreviewIndex = -1;
  lastLoopPreviewVersion = -1;
  lastLoopPreviewBgVersion = -1;
  lastLabelSig = "";

  async boot(): Promise<void> {
    const ok = await this.renderer.init(canvas);
    if (!ok) {
      noWebGPU.classList.remove("hidden");
      return;
    }
    this.renderer.background = readCssVarColor("--bg");

    this.resize();
    this.frames.setup(DEFAULT_FRAMES, FRAME_W, FRAME_H);
    this.frames.frameSpeed = 8;
    syncFrameStripVisibility(this);

    this.colorPicker = new ColorPicker();
    this.currentColor = this.colorPicker.getColor();
    this.colorPicker.onChange.connect((c) => (this.currentColor = c));

    wireDrawing(this);
    wirePointer(this);
    wireLoopPreview(this);
    wireFrameStrip(this);
    wireKeyboard(this);
    wireControls(this);
    wireSettings(this);
    wireSidebarToggle(this);
    wireNetwork(this);
    wireBackgroundImage(this);

    const appEl = document.getElementById("app") as HTMLElement;
    new ResizeObserver(() => this.resize()).observe(appEl);
    document.addEventListener("fullscreenchange", () => this.resize());
    this.ready = true;
    startRenderLoop(this);
  }

  resize(): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const appEl = document.getElementById("app") as HTMLElement;
    const w = Math.max(1, Math.floor(appEl.clientWidth * this.dpr));
    const h = Math.max(1, Math.floor(appEl.clientHeight * this.dpr));
    canvas.width = w;
    canvas.height = h;
    labelCanvas.width = w;
    labelCanvas.height = h;
    this.needsRender = true;
    this.lastLoopPreviewIndex = -1;
    this.lastLoopPreviewVersion = -1;
    this.lastLoopPreviewBgVersion = -1;
    this.lastLabelSig = "";
  }

  currentPaperRect() {
    return this.view.paperRect(canvas.width, canvas.height, this.frames.width, this.frames.height);
  }

  setProjector(on: boolean): void {
    this.projector = on;
    document.body.classList.toggle("projector", on);
    if (on) closeSettings();
    syncFrameStripVisibility(this);
    this.resize();
  }
}

new App().boot();
