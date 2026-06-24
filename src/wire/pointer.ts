import { map } from "../util/color";
import { canvas, stage } from "../dom";
import { MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, WHEEL_ZOOM_BASE } from "../config";
import type { App } from "../main";

function toDevice(app: App, clientX: number, clientY: number): [number, number] {
  const r = canvas.getBoundingClientRect();
  const sx = r.width > 0 ? canvas.width / r.width : app.dpr;
  const sy = r.height > 0 ? canvas.height / r.height : app.dpr;
  return [(clientX - r.left) * sx, (clientY - r.top) * sy];
}

function deviceCoords(app: App, e: { clientX: number; clientY: number }): [number, number] {
  return toDevice(app, e.clientX, e.clientY);
}

function pressureSize(app: App, e: PointerEvent): number {
  const pressure = e.pointerType === "pen" ? Math.max(e.pressure || 0.5, 0.05) : 0.5;
  return pressure * map(app.strokeScale, 0, 1, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
}

export function wirePointer(app: App): void {
  canvas.addEventListener("pointerdown", (e) => {
    if (app.projector) {
      if (e.button === 0) app.setProjector(false);
      return;
    }
    const [dx, dy] = deviceCoords(app, e);

    if (app.spaceDown || e.button === 1) {
      app.view.settleZoom();
      app.panning = true;
      app.lastPan = [dx, dy];
      canvas.setPointerCapture(e.pointerId);
      stage.classList.add("panning");
      return;
    }
    if (e.button !== 0) return;

    const rect = app.currentPaperRect();
    const [px, py] = app.view.screenToPaper(dx, dy, rect);
    app.drawing = true;
    canvas.setPointerCapture(e.pointerId);

    if (app.tool === "brush" || app.tool === "eraser") {
      app.lines.newLine(px, py, pressureSize(app, e), app.tool === "eraser");
    } else {
      app.shapeStart = [px, py];
      app.shapeEnd = [px, py];
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const [dx, dy] = deviceCoords(app, e);

    if (app.panning) {
      app.view.panX += dx - app.lastPan[0];
      app.view.panY += dy - app.lastPan[1];
      app.lastPan = [dx, dy];
      return;
    }
    if (!app.drawing) return;

    const rect = app.currentPaperRect();
    if (app.tool === "brush" || app.tool === "eraser") {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [ex, ey] = deviceCoords(app, ev);
        const [px, py] = app.view.screenToPaper(ex, ey, rect);
        app.lines.lineTo(px, py, pressureSize(app, ev));
      }
    } else {
      app.shapeEnd = app.view.screenToPaper(dx, dy, rect);
    }
  });

  const endPointer = () => {
    if (app.panning) {
      app.panning = false;
      stage.classList.remove("panning");
      return;
    }
    if (!app.drawing) return;
    app.drawing = false;

    const frame = app.frames.getActiveFrame();
    if (app.tool === "brush" || app.tool === "eraser") {
      app.lines.endLine();
    } else if (app.tool === "circle") {
      app.frames.drawCircle(app.shapeStart, app.shapeEnd, app.currentColor, frame);
      app.net.send({ type: "shape", shape: "circle", frameId: frame, color: app.currentColor, p1: app.shapeStart, p2: app.shapeEnd });
    } else if (app.tool === "rectangle") {
      app.frames.drawRectangle(app.shapeStart, app.shapeEnd, app.currentColor, frame);
      app.net.send({ type: "shape", shape: "rectangle", frameId: frame, color: app.currentColor, p1: app.shapeStart, p2: app.shapeEnd });
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [dx, dy] = deviceCoords(app, e);
      const factor = Math.pow(WHEEL_ZOOM_BASE, -e.deltaY);
      app.view.zoomAt(dx, dy, factor, canvas.width, canvas.height, app.frames.width, app.frames.height);
    },
    { passive: false },
  );
}
