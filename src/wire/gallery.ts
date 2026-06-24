import type { App } from "../main";

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function captureFrames(
  app: App,
  onProgress?: (current: number, total: number) => void,
): Promise<string[]> {
  const total = app.frames.count();
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const frame = app.frames.getFrame(i);
    const blob = await app.background.exportFrame(frame, "image/png");
    out.push(await blobToDataURL(blob));
    onProgress?.(i + 1, total);
  }
  return out;
}

export function wireGallery(app: App): void {
  const btn = document.getElementById("gallery-btn") as HTMLButtonElement;
  if (!btn) return;
  const defaultLabel = btn.textContent ?? "SEND TO GALLERY";
  let busy = false;

  const syncVisibility = (): void => {
    btn.classList.toggle("hidden", !app.frames.allFramesTouched());
  };

  app.frames.onTouchedChange.connect(syncVisibility);
  syncVisibility();

  const flash = (cls: string, label: string, revert = true): void => {
    btn.classList.remove("sent", "failed");
    if (cls) btn.classList.add(cls);
    btn.textContent = label;
    if (revert) {
      window.setTimeout(() => {
        btn.classList.remove("sent", "failed");
        btn.textContent = defaultLabel;
      }, 2200);
    }
  };

  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.classList.remove("sent", "failed");
    const total = app.frames.count();
    btn.textContent = `(0/${total})`;
    try {
      const payload = {
        frames: await captureFrames(app, (current, n) => {
          btn.textContent = `(${current}/${n})`;
        }),
        speed: app.frames.frameSpeed,
        width: app.frames.width,
        height: app.frames.height,
      };
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      flash("sent", "SENT ✓");
    } catch (err) {
      console.error("[framed] send to gallery failed:", err);
      flash("failed", "FAILED — RETRY");
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
}
