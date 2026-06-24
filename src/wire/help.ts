import type { App } from "../main";
import { closeSettings } from "./settings";

export function isHelpOpen(): boolean {
  return !document.getElementById("help-overlay")!.classList.contains("hidden");
}

export function openHelp(): void {
  closeSettings();
  const overlay = document.getElementById("help-overlay") as HTMLElement;
  const btn = document.getElementById("help-btn") as HTMLButtonElement;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  btn.setAttribute("aria-expanded", "true");
}

export function closeHelp(): void {
  const overlay = document.getElementById("help-overlay") as HTMLElement;
  const btn = document.getElementById("help-btn") as HTMLButtonElement;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  btn.setAttribute("aria-expanded", "false");
}

function toggleHelp(): void {
  if (isHelpOpen()) closeHelp();
  else openHelp();
}

export function wireHelp(_app: App): void {
  const btn = document.getElementById("help-btn") as HTMLButtonElement;
  const backdrop = document.querySelector("#help-overlay .settings-backdrop") as HTMLElement;
  btn.addEventListener("click", toggleHelp);
  backdrop.addEventListener("click", closeHelp);
}
