import type { ScreenRect } from "./gpu/Renderer";
import { canvas, frameStripEl, frameStripSpacerEl } from "./dom";
import { FRAME_STRIP_GAP_CSS } from "./config";
import type { App } from "./main";

export interface FrameStripLayout {
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

export function canvasRect(app: App): DOMRect {
  return app.frameCanvasRect ?? canvas.getBoundingClientRect();
}

export function elementScreenRect(app: App, el: HTMLElement): ScreenRect | null {
  const cRect = canvasRect(app);
  const elRect = el.getBoundingClientRect();
  if (elRect.width <= 0 || elRect.height <= 0) return null;
  const sx = canvas.width / cRect.width;
  const sy = canvas.height / cRect.height;
  return {
    x: (elRect.left - cRect.left) * sx,
    y: (elRect.top - cRect.top) * sy,
    w: elRect.width * sx,
    h: elRect.height * sy,
  };
}

export function isFrameStripShown(app: App): boolean {
  return app.frames.count() > 1 && !app.projector && !frameStripEl.hidden;
}

export function syncFrameStripVisibility(app: App): void {
  const show = app.frames.count() > 1 && !app.projector;
  frameStripEl.classList.toggle("hidden", !show);
  frameStripEl.hidden = !show;
  app.needsRender = true;
}

export function updateFrameStripLayout(app: App): FrameStripLayout | null {
  syncFrameStripVisibility(app);
  const el = frameStripEl;
  if (!isFrameStripShown(app)) {
    frameStripSpacerEl.style.height = "0px";
    return null;
  }

  const n = app.frames.count();
  const aspect = app.frames.width / app.frames.height;
  const thumbHCss = el.clientWidth / aspect;
  const gapCss = FRAME_STRIP_GAP_CSS;
  const contentCss = n * thumbHCss + (n - 1) * gapCss;
  frameStripSpacerEl.style.height = `${contentCss}px`;

  const base = elementScreenRect(app, el);
  if (!base) return null;

  const thumbW = base.w;
  const thumbH = thumbW / aspect;
  const pxPerCss = canvas.height / canvasRect(app).height;

  return {
    stripX: base.x,
    stripW: base.w,
    thumbW,
    thumbH,
    gap: gapCss * pxPerCss,
    scrollTop: el.scrollTop * pxPerCss,
    visibleTop: base.y,
    visibleH: base.h,
    n,
  };
}

export function contentYToScreen(layout: FrameStripLayout, contentY: number): number {
  return layout.visibleTop + contentY - layout.scrollTop;
}

export function isRectVisible(layout: FrameStripLayout, y: number, h: number): boolean {
  return y + h > layout.visibleTop && y < layout.visibleTop + layout.visibleH;
}

export function frameThumbContentY(index: number, thumbHCss: number, gapCss: number): number {
  return index * (thumbHCss + gapCss);
}

export function scrollFrameStripToIndex(app: App, index: number, smooth = true): void {
  const el = frameStripEl;
  if (!isFrameStripShown(app)) return;

  updateFrameStripLayout(app);

  const aspect = app.frames.width / app.frames.height;
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

export function frameStripScissor(layout: FrameStripLayout): ScreenRect {
  return {
    x: layout.stripX,
    y: layout.visibleTop,
    w: layout.stripW,
    h: layout.visibleH,
  };
}

export function hitFrameStripClient(app: App, clientX: number, clientY: number): number | null {
  const layout = updateFrameStripLayout(app);
  if (!layout) return null;

  const el = frameStripEl;
  const elRect = el.getBoundingClientRect();
  if (
    clientX < elRect.left ||
    clientX > elRect.right ||
    clientY < elRect.top ||
    clientY > elRect.bottom
  ) {
    return null;
  }

  const aspect = app.frames.width / app.frames.height;
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

export function wireFrameStrip(app: App): void {
  const el = frameStripEl;
  el.addEventListener("pointerdown", (e) => {
    if (app.projector || app.frames.count() <= 1) return;
    if (e.button !== 0) return;
    const hit = hitFrameStripClient(app, e.clientX, e.clientY);
    if (hit !== null) {
      app.frames.setActiveFrame(hit);
      scrollFrameStripToIndex(app, hit);
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

export function wireLoopPreview(app: App): void {
  const el = document.getElementById("loop-preview") as HTMLElement;
  el.addEventListener("pointerdown", (e) => {
    if (app.projector || app.frames.count() <= 1) return;
    if (e.button !== 0) return;
    app.setProjector(true);
    e.preventDefault();
    e.stopPropagation();
  });
}
