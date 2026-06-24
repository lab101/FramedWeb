import { canvas, stage } from "../dom";
import { KEYBOARD_ZOOM_STEP } from "../config";
import type { App } from "../main";
import { scrollFrameStripToIndex } from "../frameStrip";
import { isSettingsOpen, closeSettings } from "./settings";
import { isHelpOpen, closeHelp } from "./help";
import { setSpeed, toggleFullscreen, setTool } from "./controls";

export function wireKeyboard(app: App): void {
  window.addEventListener("keydown", (e) => {
    if (app.strokeSliderActive) return;
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp":
        app.frames.prevFrame();
        scrollFrameStripToIndex(app, app.frames.getActiveFrame());
        break;
      case "ArrowRight":
      case "ArrowDown":
        app.frames.nextFrame();
        scrollFrameStripToIndex(app, app.frames.getActiveFrame());
        break;
      case "x":
        app.frames.clearAll();
        app.net.send({ type: "erase" });
        break;
      case "e":
        setTool(app, "eraser");
        break;
      case "b":
        setTool(app, "brush");
        break;
      case "r":
        setTool(app, "rectangle");
        break;
      case "c":
        setTool(app, "circle");
        break;
      case "v":
        zoomBy(app, KEYBOARD_ZOOM_STEP);
        break;
      case "n":
        zoomBy(app, 1 / KEYBOARD_ZOOM_STEP);
        break;
      case "[":
        setSpeed(app, app.frames.frameSpeed + 1);
        break;
      case "]":
        setSpeed(app, app.frames.frameSpeed - 1);
        break;
      case "f":
        toggleFullscreen();
        break;
      case "p":
        app.setProjector(!app.projector);
        break;
      case "Escape":
        if (isHelpOpen()) {
          closeHelp();
        } else if (isSettingsOpen()) {
          closeSettings();
        } else if (app.projector) {
          app.setProjector(false);
        }
        break;
      case " ":
        app.spaceDown = true;
        stage.classList.add("panning");
        e.preventDefault();
        break;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (app.strokeSliderActive) return;
    if (e.key === " ") {
      app.spaceDown = false;
      if (!app.panning) stage.classList.remove("panning");
    }
  });
}

function zoomBy(app: App, factor: number): void {
  app.view.zoomAt(canvas.width / 2, canvas.height / 2, factor, canvas.width, canvas.height, app.frames.width, app.frames.height);
}
