import type { ScreenRect } from "./gpu/Renderer";
import { canvas, frameStripEl, labelCanvas, labelCtx, loopPreviewCanvas } from "./dom";
import {
  DOT_GRID_ALPHA,
  DOT_GRID_RADIUS,
  DOT_GRID_SPACING,
} from "./config";
import type { App } from "./main";
import {
  contentYToScreen,
  frameStripScissor,
  isFrameStripShown,
  isRectVisible,
  updateFrameStripLayout,
  type FrameStripLayout,
} from "./frameStrip";

export function sceneSignature(app: App): string {
  const scroll = isFrameStripShown(app) ? Math.round(frameStripEl.scrollTop) : 0;
  return (
    `${canvas.width}x${canvas.height}|${app.view.zoom.toFixed(4)}|` +
    `${Math.round(app.view.panX)},${Math.round(app.view.panY)}|` +
    `${app.frames.getActiveFrame()}|${app.frames.getContentVersion()}|` +
    `${app.frames.count()}|${app.projector ? 1 : 0}|${scroll}|${app.background.getVersion()}`
  );
}

let activeLoopId = 0;

export function startRenderLoop(app: App): void {
  const loopId = ++activeLoopId;
  let lastTime = performance.now();
  let lastSceneSig = "";

  const loop = (now: number): void => {
    if (loopId !== activeLoopId || !app.ready) return;
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    app.renderer.flushBrush();
    app.frames.update(dt);
    app.view.update(dt, canvas.width, canvas.height, app.frames.width, app.frames.height);

    app.frameCanvasRect = canvas.getBoundingClientRect();

    const animating = app.projector || app.drawing || app.panning || app.view.isAnimating();
    const sig = sceneSignature(app);
    if (app.needsRender || animating || sig !== lastSceneSig) {
      app.needsRender = false;
      lastSceneSig = sig;
      const stripLayout = app.projector ? null : updateFrameStripLayout(app);

      app.renderer.beginScreen();
      if (app.projector) {
        drawProjector(app);
      } else {
        drawPaper(app);
        drawFrameStrip(app, stripLayout);
        drawShapePreview(app);
      }
      app.renderer.endScreen();
      drawFrameStripLabels(app, stripLayout);
    }

    drawLoopPreview(app);

    app.frameCanvasRect = null;
    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function blitFrameComposite(
  app: App,
  frame: ReturnType<App["frames"]["getFrame"]>,
  rect: ScreenRect,
  tint = 1,
): void {
  app.background.blitFrame(frame, rect, tint);
}

function drawProjector(app: App): void {
  const aspect = app.frames.width / app.frames.height;
  const cw = canvas.width;
  const ch = canvas.height;
  let w = cw;
  let h = cw / aspect;
  if (h > ch) {
    h = ch;
    w = ch * aspect;
  }
  blitFrameComposite(app, app.frames.getFrame(app.frames.getLoopIndex()), {
    x: (cw - w) / 2,
    y: (ch - h) / 2,
    w,
    h,
  });
}

function drawPaper(app: App): void {
  const rect = app.currentPaperRect();
  app.renderer.drawDotGrid(rect, DOT_GRID_SPACING, DOT_GRID_RADIUS, DOT_GRID_ALPHA);
  const active = app.frames.getActiveFrame();
  blitFrameComposite(app, app.frames.getActiveTexture(), rect, 1);
  if (app.frames.count() > 1) {
    const prev = (active - 1 + app.frames.count()) % app.frames.count();
    // Onion skin overlays only the previous frame's strokes, not its background.
    app.renderer.blit(app.frames.getFrame(prev), rect, 0.25);
  }
}

function drawLoopPreview(app: App): void {
  if (app.projector) return;
  const n = app.frames.count();
  if (n === 0) return;
  const idx = app.frames.getLoopIndex();
  if (idx < 0 || idx >= n) return;
  const ver = app.frames.getContentVersion();
  const bgVer = app.background.getVersion();
  if (idx === app.lastLoopPreviewIndex && ver === app.lastLoopPreviewVersion && bgVer === app.lastLoopPreviewBgVersion) return;
  const frame = app.frames.getFrame(idx);
  if (!frame?.view) return;
  app.lastLoopPreviewIndex = idx;
  app.lastLoopPreviewVersion = ver;
  app.lastLoopPreviewBgVersion = bgVer;
  app.renderer.blitFrameFill(loopPreviewCanvas, frame, app.background);
}

function drawFrameStrip(app: App, layout: FrameStripLayout | null): void {
  app.thumbHits = [];
  if (!layout) return;

  const { stripX, thumbW, thumbH, gap, n } = layout;
  const clip = frameStripScissor(layout);
  app.renderer.setScissor(clip);

  for (let i = 0; i < n; i++) {
    const contentY = i * (thumbH + gap);
    const y = contentYToScreen(layout, contentY);
    const rect: ScreenRect = { x: stripX, y, w: thumbW, h: thumbH };
    if (!isRectVisible(layout, y, thumbH)) continue;
    const active = i === app.frames.getActiveFrame();
    blitFrameComposite(app, app.frames.getFrame(i), rect, active ? 1 : 0.5);
    if (active) strokeThumbBorder(app, rect);
    app.thumbHits.push({ rect, index: i });
  }

  app.renderer.setScissor(null);
}

function drawFrameStripLabels(app: App, layout: FrameStripLayout | null): void {
  const ctx = labelCtx;

  let sig = "empty";
  if (!app.projector && layout && app.thumbHits.length > 0) {
    sig = `${app.dpr}|${app.frames.getActiveFrame()}`;
    for (const t of app.thumbHits) {
      sig += `|${t.index}:${Math.round(t.rect.y)},${Math.round(t.rect.h)}`;
    }
  }
  if (sig === app.lastLabelSig) return;
  app.lastLabelSig = sig;

  ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  if (sig === "empty" || !layout) return;

  const clip = frameStripScissor(layout);
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();

  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const t of app.thumbHits) {
    const fontSize = Math.round(Math.max(8 * app.dpr, Math.min(14 * app.dpr, t.rect.h * 0.2)));
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = Math.round(2 * app.dpr);
    ctx.fillText(String(t.index + 1), t.rect.x + t.rect.w / 2, t.rect.y + t.rect.h / 2);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function strokeThumbBorder(app: App, rect: ScreenRect): void {
  const w = Math.max(1, Math.round(1 * app.dpr));
  const col: [number, number, number, number] = [1, 1, 1, 1];
  const { x, y, h } = rect;
  const right = x + rect.w;
  const bottom = y + h;
  app.renderer.overlay(app.renderer.rectToClip({ x, y, w: rect.w, h: w }), col);
  app.renderer.overlay(app.renderer.rectToClip({ x, y: bottom - w, w: rect.w, h: w }), col);
  app.renderer.overlay(app.renderer.rectToClip({ x, y, w, h }), col);
  app.renderer.overlay(app.renderer.rectToClip({ x: right - w, y, w, h }), col);
}

function drawShapePreview(app: App): void {
  if (!app.drawing || app.tool === "brush" || app.tool === "eraser") return;
  const rect = app.currentPaperRect();
  const sx = rect.x + app.shapeStart[0] * rect.scale;
  const sy = rect.y + app.shapeStart[1] * rect.scale;
  const ex = rect.x + app.shapeEnd[0] * rect.scale;
  const ey = rect.y + app.shapeEnd[1] * rect.scale;
  const col: [number, number, number, number] = [app.currentColor.r, app.currentColor.g, app.currentColor.b, 0.5];

  if (app.tool === "rectangle") {
    app.renderer.overlay(
      app.renderer.rectToClip({ x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) }),
      col,
    );
  } else {
    const r = Math.hypot(ex - sx, ey - sy);
    app.renderer.overlay(circleClip(sx, sy, r), col);
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
