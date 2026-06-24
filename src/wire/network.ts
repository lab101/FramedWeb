import type { DrawMessage } from "../draw/types";
import type { App } from "../main";
import { setFrameCount } from "./controls";

function defaultWsUrl(): string {
  if (location.protocol === "http:" || location.protocol === "https:") {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }
  return "ws://localhost:8080";
}

export function wireNetwork(app: App): void {
  app.net.onMessage.connect((msg) => applyMessage(app, msg));
  app.net.onStatus.connect((status, detail) => {
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

  const urlInput = document.getElementById("ws-url") as HTMLInputElement;
  if (!urlInput.value.trim()) urlInput.value = defaultWsUrl();
  app.net.connect(urlInput.value.trim());
}

function applyMessage(app: App, msg: DrawMessage): void {
  switch (msg.type) {
    case "points":
      app.frames.drawPoints(msg.points, msg.color, msg.frameId);
      break;
    case "shape":
      if (msg.shape === "circle") app.frames.drawCircle(msg.p1, msg.p2, msg.color, msg.frameId);
      else app.frames.drawRectangle(msg.p1, msg.p2, msg.color, msg.frameId);
      break;
    case "erase":
      app.frames.clearAll();
      break;
    case "nrOfFrames":
      setFrameCount(app, msg.value, false);
      break;
    case "frameSpeed":
      app.frames.frameSpeed = msg.value;
      (document.getElementById("speed-slider") as HTMLInputElement).value = String(msg.value);
      break;
    case "frameSize":
      app.frames.setup(app.frames.count(), msg.width, msg.height);
      break;
  }
}

export { defaultWsUrl };
