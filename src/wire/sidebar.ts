import type { App } from "../main";
import { scrollFrameStripToIndex } from "../frameStrip";

export function setSidebarOpen(app: App, open: boolean): void {
  const sidebar = document.getElementById("sidebar") as HTMLElement;
  const btn = document.getElementById("sidebar-toggle") as HTMLButtonElement;
  sidebar.classList.toggle("collapsed", !open);
  btn.setAttribute("aria-expanded", String(open));
  btn.title = open ? "Hide tools" : "Show tools";
  app.needsRender = true;
  if (open) {
    requestAnimationFrame(() => scrollFrameStripToIndex(app, app.frames.getActiveFrame(), false));
  }
}

export function wireSidebarToggle(app: App): void {
  const btn = document.getElementById("sidebar-toggle") as HTMLButtonElement;
  btn.addEventListener("click", () => setSidebarOpen(app, btn.getAttribute("aria-expanded") !== "true"));
}
