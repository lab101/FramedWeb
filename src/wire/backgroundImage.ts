import type { App } from "../main";
import { canvas, stage } from "../dom";

export function wireBackgroundImage(app: App): void {
  const targets = [stage, canvas];

  const hasImageFile = (dt: DataTransfer): boolean =>
    [...dt.items].some((item) => item.kind === "file" && item.type.startsWith("image/"));

  const onDragOver = (e: DragEvent): void => {
    if (!hasImageFile(e.dataTransfer!)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    stage.classList.add("drop-target");
  };

  const onDragLeave = (e: DragEvent): void => {
    if (e.relatedTarget && stage.contains(e.relatedTarget as Node)) return;
    stage.classList.remove("drop-target");
  };

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault();
    stage.classList.remove("drop-target");
    const dt = e.dataTransfer;
    if (!dt) return;
    const ok = await app.background.loadFromDataTransfer(dt);
    if (ok) invalidateAfterBackgroundChange(app);
  };

  for (const el of targets) {
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
  }

  app.background.onChange.connect(() => invalidateAfterBackgroundChange(app));
}

function invalidateAfterBackgroundChange(app: App): void {
  app.needsRender = true;
  app.lastLoopPreviewBgVersion = -1;
}
