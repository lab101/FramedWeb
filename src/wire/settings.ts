import type { App } from "../main";

export function isSettingsOpen(): boolean {
  return !document.getElementById("settings-overlay")!.classList.contains("hidden");
}

export function openSettings(): void {
  const overlay = document.getElementById("settings-overlay") as HTMLElement;
  const btn = document.getElementById("settings-btn") as HTMLButtonElement;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  btn.setAttribute("aria-expanded", "true");
}

export function closeSettings(): void {
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

export function wireSettings(_app: App): void {
  const btn = document.getElementById("settings-btn") as HTMLButtonElement;
  const backdrop = document.querySelector(".settings-backdrop") as HTMLElement;
  btn.addEventListener("click", toggleSettings);
  backdrop.addEventListener("click", closeSettings);
}
