import type { App } from "../main";

export function wireDrawing(app: App): void {
  app.lines.onNewPoints.connect((points, erasing) => {
    const frame = app.frames.getActiveFrame();
    if (erasing) {
      app.frames.erasePoints(points, frame);
    } else {
      const color = app.currentColor;
      app.frames.drawPoints(points, color, frame);
      app.net.send({ type: "points", frameId: frame, color, points });
    }
  });
}
