import { Renderer, type ScreenRect } from "./gpu/Renderer";
import { FrameManager } from "./gpu/FrameManager";
import { LineManager } from "./draw/LineManager";
import { NetworkManager } from "./net/NetworkManager";
import { ColorPicker } from "./ui/ColorPicker";
import { View } from "./View";
import { map, readCssVarColor } from "./util/color";
import type { RGB, Tool, DrawMessage } from "./draw/types";

const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
const labelCanvas = document.getElementById("frame-label-canvas") as HTMLCanvasElement;
const loopPreviewCanvas = document.getElementById("loop-preview-canvas") as HTMLCanvasElement;
const stage = document.getElementById("stage") as HTMLElement;
const noWebGPU = document.getElementById("no-webgpu") as HTMLElement;

const FRAME_W = 1920;
const FRAME_H = 1080;
const DEFAULT_FRAMES = 6;
const MIN_BRUSH_SIZE = 12;
const MAX_BRUSH_SIZE = 240;
const WHEEL_ZOOM_BASE = 1.00025; // exponential wheel zoom; lower = slower
const KEYBOARD_ZOOM_STEP = 1.02;

const renderer = new Renderer();
const frames = new FrameManager(renderer);
const lines = new LineManager();
const net = new NetworkManager();
const view = new View();
let colorPicker: ColorPicker;

// --- live state -----------------------------------------------------------
let tool: Tool = "brush";
let currentColor: RGB = { r: 1, g: 0.2, b: 0.45 };
let strokeScale = 0.5; // 0..1 -> brush size range
let strokeSliderActive = false;

let drawing = false;
let panning = false;
let spaceDown = false;
let projector = false; // projector mode: animation loop shown fullscreen
let shapeStart: [number, number] = [0, 0];
let shapeEnd: [number, number] = [0, 0];
let lastPan: [number, number] = [0, 0];

let dpr = Math.max(1, window.devicePixelRatio || 1);
let thumbHits: Array<{ rect: ScreenRect; index: number }> = [];

interface FrameStripLayout {
  stripX: number;
  stripW: number;
  thumbW: number;
  thumbH: number;
  gap: number;
  scrollTop: number;
  visibleTop: number;
  visibleH: number;
  n: number;
}

const FRAME_STRIP_GAP_CSS = 4;

// =========================================================================
async function boot(): Promise<void> {
  const ok = await renderer.init(canvas);
  if (!ok) {
    noWebGPU.classList.remove("hidden");
    return;
  }
  renderer.background = readCssVarColor("--bg");

  resize();
  frames.setup(DEFAULT_FRAMES, FRAME_W, FRAME_H);
  frames.frameSpeed = 8;

  colorPicker = new ColorPicker();
  currentColor = colorPicker.getColor();
  colorPicker.onChange.connect((c) => (currentColor = c));

  wireDrawing();
  wirePointer();
  wireLoopPreview();
  wireFrameStrip();
  wireKeyboard();
  wireControls();
  wireSettings();
  wireSidebarToggle();
  wireNetwork();

  // Observe the app shell so the canvas fills the viewport behind the sidebar.
  const app = document.getElementById("app") as HTMLElement;
  new ResizeObserver(resize).observe(app);
  document.addEventListener("fullscreenchange", resize);
  requestAnimationFrame(loop);
}

function resize(): void {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const app = document.getElementById("app") as HTMLElement;
  const w = Math.max(1, Math.floor(app.clientWidth * dpr));
  const h = Math.max(1, Math.floor(app.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  labelCanvas.width = w;
  labelCanvas.height = h;
}

function syncFrameStripVisibility(): void {
  const show = frames.count() > 1 && !projector;
  (document.getElementById("frame-strip") as HTMLElement).classList.toggle("hidden", !show);
}

function elementScreenRect(el: HTMLElement): ScreenRect | null {
  const canvasRect = canvas.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (elRect.width <= 0 || elRect.height <= 0) return null;
  const sx = canvas.width / canvasRect.width;
  const sy = canvas.height / canvasRect.height;
  return {
    x: (elRect.left - canvasRect.left) * sx,
    y: (elRect.top - canvasRect.top) * sy,
    w: elRect.width * sx,
    h: elRect.height * sy,
  };
}

function updateFrameStripLayout(): FrameStripLayout | null {
  syncFrameStripVisibility();
  const el = document.getElementById("frame-strip") as HTMLElement;
  const spacer = document.getElementById("frame-strip-spacer") as HTMLElement;
  if (el.classList.contains("hidden") || frames.count() <= 1) {
    spacer.style.height = "0px";
    return null;
  }

  const n = frames.count();
  const aspect = frames.width / frames.height;
  const thumbHCss = el.clientWidth / aspect;
  const gapCss = FRAME_STRIP_GAP_CSS;
  const contentCss = n * thumbHCss + (n - 1) * gapCss;
  spacer.style.height = `${contentCss}px`;

  const base = elementScreenRect(el);
  if (!base) return null;

  const thumbW = base.w;
  const thumbH = thumbW / aspect;

  return {
    stripX: base.x,
    stripW: base.w,
    thumbW,
    thumbH,
    gap: gapCss * (canvas.height / canvas.getBoundingClientRect().height),
    scrollTop: el.scrollTop * (canvas.height / canvas.getBoundingClientRect().height),
    visibleTop: base.y,
    visibleH: base.h,
    n,
  };
}

function contentYToScreen(layout: FrameStripLayout, contentY: number): number {
  return layout.visibleTop + contentY - layout.scrollTop;
}

function isRectVisible(layout: FrameStripLayout, y: number, h: number): boolean {
  return y + h > layout.visibleTop && y < layout.visibleTop + layout.visibleH;
}

function frameThumbContentY(index: number, thumbHCss: number, gapCss: number): number {
  return index * (thumbHCss + gapCss);
}

function scrollFrameStripToIndex(index: number, smooth = true): void {
  const el = document.getElementById("frame-strip") as HTMLElement;
  if (el.classList.contains("hidden") || frames.count() <= 1) return;

  updateFrameStripLayout();

  const aspect = frames.width / frames.height;
  const thumbH = el.clientWidth / aspect;
  const gap = FRAME_STRIP_GAP_CSS;
  const thumbCenterY = frameThumbContentY(index, thumbH, gap) + thumbH / 2;
  const targetScroll = thumbCenterY - el.clientHeight / 2;
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  const top = Math.max(0, Math.min(maxScroll, targetScroll));

  if (smooth && maxScroll > 0) {
    el.scrollTo({ top, behavior: "smooth" });
  } else {
    el.scrollTop = top;
  }
}

function frameStripScissor(layout: FrameStripLayout): ScreenRect {
  return {
    x: layout.stripX,
    y: layout.visibleTop,
    w: layout.stripW,
    h: layout.visibleH,
  };
}

// --- local drawing -> canvas + network ------------------------------------
function wireDrawing(): void {
  lines.onNewPoints.connect((points) => {
    const frame = frames.getActiveFrame();
    const color = currentColor;
    frames.drawPoints(points, color, frame);
    net.send({ type: "points", frameId: frame, color, points });
  });
}

// Default relay URL: the same origin this page was served from, at `/ws`.
// e.g. http://host:8080  ->  ws://host:8080/ws   (https -> wss).
// Falls back to the standalone relay default when opened from a file:// page.
function defaultWsUrl(): string {
  if (location.protocol === "http:" || location.protocol === "https:") {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }
  return "ws://localhost:8080";
}

// --- network -> canvas ----------------------------------------------------
function wireNetwork(): void {
  net.onMessage.connect(applyMessage);
  net.onStatus.connect((status, detail) => {
    const el = document.getElementById("ws-status") as HTMLElement;
    el.className = `status ${status}`;
    const labels: Record<string, string> = {
      offline: "offline (single user)",
      connecting: "connecting…",
      online: "connected",
      error: "error",
    };
    el.textContent = `${labels[status]}${detail && status !== "online" ? " · " + detail : ""}`;
    (document.getElementById("ws-connect") as HTMLButtonElement).textContent =
      status === "online" || status === "connecting" ? "Disconnect" : "Connect";
  });

  // Default to the same-origin relay and auto-connect, so the hosted build
  // behaves like the desktop app (everyone on the shared canvas immediately).
  const urlInput = document.getElementById("ws-url") as HTMLInputElement;
  if (!urlInput.value.trim()) urlInput.value = defaultWsUrl();
  net.connect(urlInput.value.trim());
}

function applyMessage(msg: DrawMessage): void {
  switch (msg.type) {
    case "points":
      frames.drawPoints(msg.points, msg.color, msg.frameId);
      break;
    case "shape":
      if (msg.shape === "circle") frames.drawCircle(msg.p1, msg.p2, msg.color, msg.frameId);
      else frames.drawRectangle(msg.p1, msg.p2, msg.color, msg.frameId);
      break;
    case "erase":
      frames.clearAll();
      break;
    case "nrOfFrames":
      frames.changeNrOfFrames(msg.value);
      (document.getElementById("frames-input") as HTMLInputElement).value = String(msg.value);
      syncFrameStripVisibility();
      break;
    case "frameSpeed":
      frames.frameSpeed = msg.value;
      (document.getElementById("speed-slider") as HTMLInputElement).value = String(msg.value);
      break;
    case "frameSize":
      frames.setup(frames.count(), msg.width, msg.height);
      break;
  }
}

// --- pointer / pen --------------------------------------------------------
// Map client (CSS) coordinates to canvas backing-store pixels using the actual
// displayed size, so it stays correct even if the backing size is momentarily
// out of sync (e.g. right after a fullscreen / projector toggle).
function toDevice(clientX: number, clientY: number): [number, number] {
  const r = canvas.getBoundingClientRect();
  const sx = r.width > 0 ? canvas.width / r.width : dpr;
  const sy = r.height > 0 ? canvas.height / r.height : dpr;
  return [(clientX - r.left) * sx, (clientY - r.top) * sy];
}

function deviceCoords(e: { clientX: number; clientY: number }): [number, number] {
  return toDevice(e.clientX, e.clientY);
}

function pressureSize(e: PointerEvent): number {
  const pressure = e.pointerType === "pen" ? Math.max(e.pressure || 0.5, 0.05) : 0.5;
  return pressure * map(strokeScale, 0, 1, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}

function currentPaperRect() {
  return view.paperRect(canvas.width, canvas.height, frames.width, frames.height);
}

function wirePointer(): void {
  canvas.addEventListener("pointerdown", (e) => {
    if (projector) {
      if (e.button === 0) setProjector(false);
      return;
    }
    const [dx, dy] = deviceCoords(e);

    // pan with space or middle mouse
    if (spaceDown || e.button === 1) {
      view.settleZoom();
      panning = true;
      lastPan = [dx, dy];
      canvas.setPointerCapture(e.pointerId);
      stage.classList.add("panning");
      return;
    }
    if (e.button !== 0) return;

    const rect = currentPaperRect();
    const [px, py] = view.screenToPaper(dx, dy, rect);
    drawing = true;
    canvas.setPointerCapture(e.pointerId);

    if (tool === "brush") {
      lines.newLine(px, py, pressureSize(e));
    } else {
      shapeStart = [px, py];
      shapeEnd = [px, py];
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const [dx, dy] = deviceCoords(e);

    if (panning) {
      view.panX += dx - lastPan[0];
      view.panY += dy - lastPan[1];
      lastPan = [dx, dy];
      return;
    }
    if (!drawing) return;

    const rect = currentPaperRect();
    if (tool === "brush") {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [ex, ey] = deviceCoords(ev);
        const [px, py] = view.screenToPaper(ex, ey, rect);
        lines.lineTo(px, py, pressureSize(ev));
      }
    } else {
      shapeEnd = view.screenToPaper(dx, dy, rect);
    }
  });

  const endPointer = () => {
    if (panning) {
      panning = false;
      stage.classList.remove("panning");
      return;
    }
    if (!drawing) return;
    drawing = false;

    const frame = frames.getActiveFrame();
    if (tool === "brush") {
      lines.endLine();
    } else if (tool === "circle") {
      frames.drawCircle(shapeStart, shapeEnd, currentColor, frame);
      net.send({ type: "shape", shape: "circle", frameId: frame, color: currentColor, p1: shapeStart, p2: shapeEnd });
    } else if (tool === "rectangle") {
      frames.drawRectangle(shapeStart, shapeEnd, currentColor, frame);
      net.send({ type: "shape", shape: "rectangle", frameId: frame, color: currentColor, p1: shapeStart, p2: shapeEnd });
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [dx, dy] = deviceCoords(e);
      const factor = Math.pow(WHEEL_ZOOM_BASE, -e.deltaY);
      view.zoomAt(dx, dy, factor, canvas.width, canvas.height, frames.width, frames.height);
    },
    { passive: false },
  );
}

function wireLoopPreview(): void {
  const el = document.getElementById("loop-preview") as HTMLElement;
  el.addEventListener("pointerdown", (e) => {
    if (projector || frames.count() <= 1) return;
    if (e.button !== 0) return;
    setProjector(true);
    e.preventDefault();
    e.stopPropagation();
  });
}

function wireFrameStrip(): void {
  const el = document.getElementById("frame-strip") as HTMLElement;
  el.addEventListener("pointerdown", (e) => {
    if (projector || frames.count() <= 1) return;
    if (e.button !== 0) return;
    const hit = hitFrameStripClient(e.clientX, e.clientY);
    if (hit !== null) {
      frames.setActiveFrame(hit);
      scrollFrameStripToIndex(hit);
      e.preventDefault();
      e.stopPropagation();
    }
  });
  el.addEventListener(
    "wheel",
    (e) => {
      if (el.scrollHeight <= el.clientHeight) return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    },
    { passive: false },
  );
}

// --- keyboard -------------------------------------------------------------
function wireKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    if (strokeSliderActive) return;
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp":
        frames.prevFrame();
        scrollFrameStripToIndex(frames.getActiveFrame());
        break;
      case "ArrowRight":
      case "ArrowDown":
        frames.nextFrame();
        scrollFrameStripToIndex(frames.getActiveFrame());
        break;
      case "x":
        frames.clearAll();
        net.send({ type: "erase" });
        break;
      case "b":
        setTool("brush");
        break;
      case "r":
        setTool("rectangle");
        break;
      case "c":
        setTool("circle");
        break;
      // zoom in / out (held repeats)
      case "v":
        zoomBy(KEYBOARD_ZOOM_STEP);
        break;
      case "n":
        zoomBy(1 / KEYBOARD_ZOOM_STEP);
        break;
      // frame speed (matches original: '[' faster, ']' slower)
      case "[":
        setSpeed(frames.frameSpeed + 1);
        break;
      case "]":
        setSpeed(frames.frameSpeed - 1);
        break;
      case "f":
        toggleFullscreen();
        break;
      case "p":
        setProjector(!projector);
        break;
      case "Escape":
        if (isSettingsOpen()) {
          closeSettings();
        } else if (projector) {
          setProjector(false);
        }
        break;
      case " ":
        spaceDown = true;
        stage.classList.add("panning");
        e.preventDefault();
        break;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (strokeSliderActive) return;
    if (e.key === " ") {
      spaceDown = false;
      if (!panning) stage.classList.remove("panning");
    }
  });
}

function zoomBy(factor: number): void {
  view.zoomAt(canvas.width / 2, canvas.height / 2, factor, canvas.width, canvas.height, frames.width, frames.height);
}

function setSpeed(v: number): void {
  v = Math.max(0, Math.min(80, Math.round(v)));
  frames.frameSpeed = v;
  (document.getElementById("speed-slider") as HTMLInputElement).value = String(v);
  net.send({ type: "frameSpeed", value: v });
}

function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function setProjector(on: boolean): void {
  projector = on;
  document.body.classList.toggle("projector", on);
  if (on) closeSettings();
  syncFrameStripVisibility();
  // sidebar visibility changes the stage size; sync the backing store now
  resize();
}

function isSettingsOpen(): boolean {
  return !document.getElementById("settings-overlay")!.classList.contains("hidden");
}

function openSettings(): void {
  const overlay = document.getElementById("settings-overlay") as HTMLElement;
  const btn = document.getElementById("settings-btn") as HTMLButtonElement;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  btn.setAttribute("aria-expanded", "true");
}

function closeSettings(): void {
  const overlay = document.getElementById("settings-overlay") as HTMLElement;
  const btn = document.getElementById("settings-btn") as HTMLButtonElement;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  btn.setAttribute("aria-expanded", "false");
}

function toggleSettings(): void {
  if (isSettingsOpen()) closeSettings();
  else openSettings();
}

function wireSettings(): void {
  const btn = document.getElementById("settings-btn") as HTMLButtonElement;
  const backdrop = document.querySelector(".settings-backdrop") as HTMLElement;
  btn.addEventListener("click", toggleSettings);
  backdrop.addEventListener("click", closeSettings);
}

function setSidebarOpen(open: boolean): void {
  const sidebar = document.getElementById("sidebar") as HTMLElement;
  const btn = document.getElementById("sidebar-toggle") as HTMLButtonElement;
  sidebar.classList.toggle("collapsed", !open);
  btn.setAttribute("aria-expanded", String(open));
  btn.title = open ? "Hide tools" : "Show tools";
}

function wireSidebarToggle(): void {
  const btn = document.getElementById("sidebar-toggle") as HTMLButtonElement;
  btn.addEventListener("click", () => setSidebarOpen(btn.getAttribute("aria-expanded") !== "true"));
}

// --- DOM controls ---------------------------------------------------------
function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>("#tools .tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === t);
  });
}

function setStrokeScale(value: number): void {
  const slider = document.getElementById("stroke-slider") as HTMLInputElement;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const v = Math.max(min, Math.min(max, value));
  strokeScale = v;
  slider.value = String(v);
}

function strokeSliderFromClientX(clientX: number): void {
  const slider = document.getElementById("stroke-slider") as HTMLInputElement;
  const rect = slider.getBoundingClientRect();
  if (rect.width <= 0) return;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  setStrokeScale(min + t * (max - min));
}

function wireStrokeSlider(): void {
  const panel = document.getElementById("stroke-panel") as HTMLElement;
  const slider = document.getElementById("stroke-slider") as HTMLInputElement;

  const begin = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    strokeSliderActive = true;
    panel.setPointerCapture(e.pointerId);
    strokeSliderFromClientX(e.clientX);
  };

  const move = (e: PointerEvent): void => {
    if (!panel.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    strokeSliderFromClientX(e.clientX);
  };

  const end = (e: PointerEvent): void => {
    if (panel.hasPointerCapture(e.pointerId)) {
      panel.releasePointerCapture(e.pointerId);
    }
    strokeSliderActive = false;
    if (document.activeElement === slider) slider.blur();
  };

  panel.addEventListener("pointerdown", begin, { capture: true });
  panel.addEventListener("pointermove", move);
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
  panel.addEventListener("lostpointercapture", () => {
    strokeSliderActive = false;
  });

  slider.addEventListener("input", (e) => {
    strokeScale = parseFloat((e.target as HTMLInputElement).value);
  });
}

function wireControls(): void {
  document.querySelectorAll<HTMLButtonElement>("#tools .tool").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
  });

  const clearWrap = document.getElementById("clear-wrap") as HTMLDivElement;
  const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
  const clearYes = document.getElementById("clear-yes") as HTMLButtonElement;
  const clearNo = document.getElementById("clear-no") as HTMLButtonElement;

  const showClearConfirm = (show: boolean): void => {
    clearWrap.classList.toggle("confirming", show);
  };

  clearBtn.addEventListener("click", () => {
    showClearConfirm(true);
  });

  clearYes.addEventListener("click", () => {
    frames.clearAll();
    net.send({ type: "erase" });
    showClearConfirm(false);
  });

  clearNo.addEventListener("click", () => {
    showClearConfirm(false);
  });

  wireStrokeSlider();

  const framesInput = document.getElementById("frames-input") as HTMLInputElement;
  framesInput.value = String(DEFAULT_FRAMES);
  framesInput.addEventListener("change", () => {
    const v = Math.max(1, Math.min(60, parseInt(framesInput.value) || 1));
    framesInput.value = String(v);
    frames.changeNrOfFrames(v);
    net.send({ type: "nrOfFrames", value: v });
    syncFrameStripVisibility();
  });

  const speed = document.getElementById("speed-slider") as HTMLInputElement;
  speed.value = String(frames.frameSpeed);
  speed.addEventListener("input", () => {
    const v = parseInt(speed.value) || 0;
    frames.frameSpeed = v;
    net.send({ type: "frameSpeed", value: v });
  });

  const urlInput = document.getElementById("ws-url") as HTMLInputElement;
  const connectBtn = document.getElementById("ws-connect") as HTMLButtonElement;
  connectBtn.addEventListener("click", () => {
    if (net.isOnline()) {
      net.disconnect();
    } else {
      const url = urlInput.value.trim() || defaultWsUrl();
      urlInput.value = url;
      net.connect(url);
    }
  });

  wireGallery();
}

// --- send to gallery ------------------------------------------------------
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function captureFrames(): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < frames.count(); i++) {
    const blob = await renderer.readFrameToBlob(frames.getFrame(i), "image/png");
    out.push(await blobToDataURL(blob));
  }
  return out;
}

function wireGallery(): void {
  const btn = document.getElementById("gallery-btn") as HTMLButtonElement;
  if (!btn) return;
  const defaultLabel = btn.textContent ?? "SEND TO GALLERY";
  let busy = false;

  const syncVisibility = (): void => {
    btn.classList.toggle("hidden", !frames.allFramesTouched());
  };

  frames.onTouchedChange.connect(syncVisibility);
  syncVisibility();

  const flash = (cls: string, label: string, revert = true): void => {
    btn.classList.remove("sent", "failed");
    if (cls) btn.classList.add(cls);
    btn.textContent = label;
    if (revert) {
      window.setTimeout(() => {
        btn.classList.remove("sent", "failed");
        btn.textContent = defaultLabel;
      }, 2200);
    }
  };

  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.classList.remove("sent", "failed");
    btn.textContent = "SENDING…";
    try {
      const payload = {
        frames: await captureFrames(),
        speed: frames.frameSpeed,
        width: frames.width,
        height: frames.height,
      };
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      flash("sent", "SENT ✓");
    } catch (err) {
      console.error("[framed] send to gallery failed:", err);
      flash("failed", "FAILED — RETRY");
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
}

// --- render loop ----------------------------------------------------------
let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  frames.update(dt);
  view.update(dt, canvas.width, canvas.height, frames.width, frames.height);

  renderer.beginScreen();
  if (projector) {
    drawProjector();
  } else {
    drawPaper();
    drawFrameStrip();
    drawShapePreview();
  }
  renderer.endScreen();
  drawLoopPreview();
  drawFrameStripLabels();

  requestAnimationFrame(loop);
}

// Projector mode: the looping animation, aspect-fit to the whole canvas.
function drawProjector(): void {
  const aspect = frames.width / frames.height;
  const cw = canvas.width;
  const ch = canvas.height;
  let w = cw;
  let h = cw / aspect;
  if (h > ch) {
    h = ch;
    w = ch * aspect;
  }
  renderer.blit(frames.getFrame(frames.getLoopIndex()), { x: (cw - w) / 2, y: (ch - h) / 2, w, h }, 1);
}

function drawPaper(): void {
  const rect = currentPaperRect();
  const active = frames.getActiveFrame();
  renderer.blit(frames.getActiveTexture(), rect, 1);
  // onion skin: ghost of the previous frame
  if (frames.count() > 1) {
    const prev = (active - 1 + frames.count()) % frames.count();
    renderer.blit(frames.getFrame(prev), rect, 0.25);
  }
}

function hitFrameStripClient(clientX: number, clientY: number): number | null {
  const layout = updateFrameStripLayout();
  if (!layout) return null;

  const el = document.getElementById("frame-strip") as HTMLElement;
  const elRect = el.getBoundingClientRect();
  if (
    clientX < elRect.left ||
    clientX > elRect.right ||
    clientY < elRect.top ||
    clientY > elRect.bottom
  ) {
    return null;
  }

  const aspect = frames.width / frames.height;
  const thumbH = elRect.width / aspect;
  const gap = FRAME_STRIP_GAP_CSS;
  const localY = clientY - elRect.top + el.scrollTop;

  const relY = localY;
  const slot = thumbH + gap;
  const index = Math.floor(relY / slot);
  if (index < 0 || index >= layout.n) return null;
  if (relY - index * slot > thumbH) return null;
  return index;
}

function drawLoopPreview(): void {
  if (projector) return;
  renderer.blitFrameFill(loopPreviewCanvas, frames.getFrame(frames.getLoopIndex()));
}

function drawFrameStrip(): void {
  thumbHits = [];
  const layout = updateFrameStripLayout();
  if (!layout) return;

  const { stripX, thumbW, thumbH, gap, n } = layout;
  const clip = frameStripScissor(layout);
  renderer.setScissor(clip);

  for (let i = 0; i < n; i++) {
    const contentY = i * (thumbH + gap);
    const y = contentYToScreen(layout, contentY);
    const rect: ScreenRect = { x: stripX, y, w: thumbW, h: thumbH };
    if (!isRectVisible(layout, y, thumbH)) continue;
    const active = i === frames.getActiveFrame();
    renderer.blit(frames.getFrame(i), rect, active ? 1 : 0.5);
    if (active) strokeThumbBorder(rect);
    thumbHits.push({ rect, index: i });
  }

  renderer.setScissor(null);
}

function drawFrameStripLabels(): void {
  const ctx = labelCanvas.getContext("2d")!;
  ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  if (projector || thumbHits.length === 0) return;

  const layout = updateFrameStripLayout();
  if (!layout) return;

  const clip = frameStripScissor(layout);
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();

  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const t of thumbHits) {
    const fontSize = Math.round(Math.max(8 * dpr, Math.min(14 * dpr, t.rect.h * 0.2)));
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = Math.round(2 * dpr);
    ctx.fillText(String(t.index + 1), t.rect.x + t.rect.w / 2, t.rect.y + t.rect.h / 2);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function strokeThumbBorder(rect: ScreenRect): void {
  const w = Math.max(1, Math.round(1 * dpr));
  const col: [number, number, number, number] = [1, 1, 1, 1];
  const { x, y, h } = rect;
  const right = x + rect.w;
  const bottom = y + h;
  renderer.overlay(renderer.rectToClip({ x, y, w: rect.w, h: w }), col);
  renderer.overlay(renderer.rectToClip({ x, y: bottom - w, w: rect.w, h: w }), col);
  renderer.overlay(renderer.rectToClip({ x, y, w, h }), col);
  renderer.overlay(renderer.rectToClip({ x: right - w, y, w, h }), col);
}

function drawShapePreview(): void {
  if (!drawing || tool === "brush") return;
  const rect = currentPaperRect();
  const sx = rect.x + shapeStart[0] * rect.scale;
  const sy = rect.y + shapeStart[1] * rect.scale;
  const ex = rect.x + shapeEnd[0] * rect.scale;
  const ey = rect.y + shapeEnd[1] * rect.scale;
  const col: [number, number, number, number] = [currentColor.r, currentColor.g, currentColor.b, 0.5];

  if (tool === "rectangle") {
    renderer.overlay(
      renderer.rectToClip({ x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) }),
      col,
    );
  } else {
    const r = Math.hypot(ex - sx, ey - sy);
    renderer.overlay(circleClip(sx, sy, r), col);
  }
}

function circleClip(cx: number, cy: number, r: number): Float32Array {
  const seg = 48;
  const cw = canvas.width;
  const ch = canvas.height;
  const toClip = (x: number, y: number): [number, number] => [(x / cw) * 2 - 1, 1 - (y / ch) * 2];
  const out = new Float32Array(seg * 6);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c = toClip(cx, cy);
    const p0 = toClip(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    const p1 = toClip(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    const o = i * 6;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = p0[0];
    out[o + 3] = p0[1];
    out[o + 4] = p1[0];
    out[o + 5] = p1[1];
  }
  return out;
}

boot();
