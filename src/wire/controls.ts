import type { Tool } from "../draw/types";
import { DEFAULT_FRAMES, MIN_FRAMES, MAX_FRAMES } from "../config";
import type { App } from "../main";
import { syncFrameStripVisibility } from "../frameStrip";
import { defaultWsUrl } from "./network";
import { wireGallery } from "./gallery";

export function setTool(app: App, t: Tool): void {
  app.tool = t;
  document.querySelectorAll<HTMLButtonElement>("#tools .tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === t);
  });
}

export function setSpeed(app: App, v: number): void {
  v = Math.max(0, Math.min(80, Math.round(v)));
  app.frames.frameSpeed = v;
  (document.getElementById("speed-slider") as HTMLInputElement).value = String(v);
  app.net.send({ type: "frameSpeed", value: v });
}

export function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function setStrokeScale(app: App, value: number): void {
  const slider = document.getElementById("stroke-slider") as HTMLInputElement;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const v = Math.max(min, Math.min(max, value));
  app.strokeScale = v;
  slider.value = String(v);
}

function strokeSliderFromClientX(app: App, clientX: number): void {
  const slider = document.getElementById("stroke-slider") as HTMLInputElement;
  const rect = slider.getBoundingClientRect();
  if (rect.width <= 0) return;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  setStrokeScale(app, min + t * (max - min));
}

function wireStrokeSlider(app: App): void {
  const panel = document.getElementById("stroke-panel") as HTMLElement;
  const slider = document.getElementById("stroke-slider") as HTMLInputElement;

  const begin = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    app.strokeSliderActive = true;
    panel.setPointerCapture(e.pointerId);
    strokeSliderFromClientX(app, e.clientX);
  };

  const move = (e: PointerEvent): void => {
    if (!panel.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    strokeSliderFromClientX(app, e.clientX);
  };

  const end = (e: PointerEvent): void => {
    if (panel.hasPointerCapture(e.pointerId)) {
      panel.releasePointerCapture(e.pointerId);
    }
    app.strokeSliderActive = false;
    if (document.activeElement === slider) slider.blur();
  };

  panel.addEventListener("pointerdown", begin, { capture: true });
  panel.addEventListener("pointermove", move);
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
  panel.addEventListener("lostpointercapture", () => {
    app.strokeSliderActive = false;
  });

  slider.addEventListener("input", (e) => {
    app.strokeScale = parseFloat((e.target as HTMLInputElement).value);
  });
}

function clampFrameCount(n: number): number {
  return Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(n)));
}

function updateFrameStepperButtons(app: App): void {
  const n = app.frames.count();
  (document.getElementById("frames-up") as HTMLButtonElement).disabled = n >= MAX_FRAMES;
  (document.getElementById("frames-down") as HTMLButtonElement).disabled = n <= MIN_FRAMES;
}

export function setFrameCount(app: App, n: number, broadcast = true): void {
  const v = clampFrameCount(n);
  const framesInput = document.getElementById("frames-input") as HTMLInputElement;
  framesInput.value = String(v);
  app.frames.changeNrOfFrames(v);
  if (broadcast) app.net.send({ type: "nrOfFrames", value: v });
  syncFrameStripVisibility(app);
  updateFrameStepperButtons(app);
}

export function wireControls(app: App): void {
  document.querySelectorAll<HTMLButtonElement>("#tools .tool").forEach((b) => {
    b.addEventListener("click", () => setTool(app, b.dataset.tool as Tool));
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
    app.frames.clearAll();
    app.net.send({ type: "erase" });
    showClearConfirm(false);
  });

  clearNo.addEventListener("click", () => {
    showClearConfirm(false);
  });

  wireStrokeSlider(app);

  const framesInput = document.getElementById("frames-input") as HTMLInputElement;
  framesInput.value = String(DEFAULT_FRAMES);
  framesInput.addEventListener("change", () => {
    setFrameCount(app, parseInt(framesInput.value) || MIN_FRAMES);
  });

  (document.getElementById("frames-up") as HTMLButtonElement).addEventListener("click", () => {
    setFrameCount(app, app.frames.count() + 1);
  });
  (document.getElementById("frames-down") as HTMLButtonElement).addEventListener("click", () => {
    setFrameCount(app, app.frames.count() - 1);
  });
  updateFrameStepperButtons(app);

  const speed = document.getElementById("speed-slider") as HTMLInputElement;
  speed.value = String(app.frames.frameSpeed);
  speed.addEventListener("input", () => {
    const v = parseInt(speed.value) || 0;
    app.frames.frameSpeed = v;
    app.net.send({ type: "frameSpeed", value: v });
  });

  const urlInput = document.getElementById("ws-url") as HTMLInputElement;
  const connectBtn = document.getElementById("ws-connect") as HTMLButtonElement;
  connectBtn.addEventListener("click", () => {
    if (app.net.isOnline()) {
      app.net.disconnect();
    } else {
      const url = urlInput.value.trim() || defaultWsUrl();
      urlInput.value = url;
      app.net.connect(url);
    }
  });

  wireGallery(app);
}
