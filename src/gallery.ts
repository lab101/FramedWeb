interface Creation {
  id: string;
  createdAt: string | null;
  frameCount: number | null;
  speed: number;
  width: number | null;
  height: number | null;
  anim: string;
  poster: string;
}

interface CreationsPage {
  items: Creation[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

const PAGE_SIZE = 12;

const grid = document.getElementById("gallery") as HTMLElement;
const statusEl = document.getElementById("gallery-status") as HTMLElement;
const sentinel = document.getElementById("gallery-sentinel") as HTMLElement;
const lightbox = document.getElementById("gallery-lightbox") as HTMLElement;
const lightboxCanvas = lightbox.querySelector(".gallery-lightbox__canvas") as HTMLCanvasElement;
const lightboxClose = lightbox.querySelector(".gallery-lightbox__close") as HTMLButtonElement;
const lightboxBackdrop = lightbox.querySelector(".gallery-lightbox__backdrop") as HTMLElement;
const lightboxCtx = lightboxCanvas.getContext("2d")!;

let offset = 0;
let loading = false;
let done = false;
let total = 0;

let lightboxRaf = 0;
let lightboxAbort = false;
let lightboxFrames: HTMLImageElement[] = [];
let lightboxFrameIndex = 0;
let lightboxLastFrameTime = 0;
let lightboxFrameDelay = 125;
let lightboxNativeW = 0;
let lightboxNativeH = 0;

function frameUrl(id: string, index: number): string {
  return `/media/${id}/frame_${String(index).padStart(3, "0")}.png`;
}

function frameDelayMs(speed: number): number {
  const fps = 0.4 * Math.max(1, speed || 8);
  return Math.max(20, Math.round(1000 / fps));
}

function fitLightboxCanvas(w: number, h: number): void {
  const margin =
    parseFloat(getComputedStyle(lightbox).getPropertyValue("--lightbox-margin")) || 32;
  const maxW = window.innerWidth - margin * 2;
  const maxH = window.innerHeight - margin * 2;
  const scale = Math.min(1, maxW / w, maxH / h);
  lightboxCanvas.style.width = `${w * scale}px`;
  lightboxCanvas.style.height = `${h * scale}px`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

async function loadPngSequence(id: string, frameCount: number): Promise<HTMLImageElement[]> {
  return Promise.all(
    Array.from({ length: frameCount }, (_, i) => loadImage(frameUrl(id, i))),
  );
}

function stopLightboxPlayback(): void {
  cancelAnimationFrame(lightboxRaf);
  lightboxRaf = 0;
  lightboxFrames = [];
  lightboxFrameIndex = 0;
  lightboxNativeW = 0;
  lightboxNativeH = 0;
  lightboxCtx.clearRect(0, 0, lightboxCanvas.width, lightboxCanvas.height);
  lightboxCanvas.width = 0;
  lightboxCanvas.height = 0;
  lightboxCanvas.style.width = "";
  lightboxCanvas.style.height = "";
}

function startLightboxPlayback(): void {
  const draw = (now: number): void => {
    if (lightbox.classList.contains("hidden") || lightboxFrames.length === 0) return;
    if (now - lightboxLastFrameTime >= lightboxFrameDelay) {
      lightboxLastFrameTime = now;
      lightboxFrameIndex = (lightboxFrameIndex + 1) % lightboxFrames.length;
    }
    lightboxCtx.clearRect(0, 0, lightboxNativeW, lightboxNativeH);
    lightboxCtx.drawImage(lightboxFrames[lightboxFrameIndex], 0, 0);
    lightboxRaf = requestAnimationFrame(draw);
  };
  lightboxLastFrameTime = performance.now();
  lightboxRaf = requestAnimationFrame(draw);
}

interface LightboxItem {
  id: string;
  alt: string;
  frameCount: number;
  speed: number;
  width: number | null;
  height: number | null;
}

async function openLightbox(item: LightboxItem): Promise<void> {
  closeLightbox();
  lightboxAbort = false;
  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  try {
    const frames = await loadPngSequence(item.id, item.frameCount);
    if (lightboxAbort) return;

    lightboxFrames = frames;
    lightboxFrameDelay = frameDelayMs(item.speed);

    const w = item.width ?? frames[0].naturalWidth;
    const h = item.height ?? frames[0].naturalHeight;
    lightboxNativeW = w;
    lightboxNativeH = h;
    lightboxCanvas.width = w;
    lightboxCanvas.height = h;
    fitLightboxCanvas(w, h);
    startLightboxPlayback();
  } catch (err) {
    console.error("[gallery] lightbox load failed:", err);
    closeLightbox();
  }
}

function closeLightbox(): void {
  lightboxAbort = true;
  stopLightboxPlayback();
  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

window.addEventListener("resize", () => {
  if (lightboxNativeW && lightboxNativeH && !lightbox.classList.contains("hidden")) {
    fitLightboxCanvas(lightboxNativeW, lightboxNativeH);
  }
});

lightboxClose.addEventListener("click", (e) => {
  e.stopPropagation();
  closeLightbox();
});
lightboxCanvas.addEventListener("click", () => closeLightbox());
lightboxBackdrop.addEventListener("click", () => closeLightbox());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) closeLightbox();
});

// Only start loading a creation's animation once its card nears the viewport,
// so we never fetch every clip at once.
const mediaObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target as HTMLElement;
      mediaObserver.unobserve(card);
      loadCardMedia(card);
    }
  },
  { rootMargin: "300px 0px" },
);

function loadCardMedia(card: HTMLElement): void {
  const img = card.querySelector("img") as HTMLImageElement;
  const src = card.dataset.anim;
  if (!img || !src || img.src) return;
  img.addEventListener("load", () => {
    card.classList.remove("loading");
    card.classList.add("visible");
  });
  img.addEventListener("error", () => {
    card.classList.remove("loading");
    card.classList.add("visible");
  });
  img.src = src;
}

function formatWhen(createdAt: string | null): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeCard(item: Creation): HTMLElement {
  const card = document.createElement("article");
  card.className = "card loading";
  card.dataset.anim = item.anim;
  card.dataset.id = item.id;
  card.dataset.frameCount = String(item.frameCount ?? 1);
  card.dataset.speed = String(item.speed);

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = `Animation from ${formatWhen(item.createdAt) || item.id}`;
  if (item.width && item.height) {
    img.width = item.width;
    img.height = item.height;
    card.dataset.width = String(item.width);
    card.dataset.height = String(item.height);
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const when = document.createElement("span");
  when.textContent = formatWhen(item.createdAt);
  const frameCount = document.createElement("span");
  frameCount.textContent = item.frameCount ? `${item.frameCount} frames` : "";
  meta.append(when, frameCount);

  card.append(img, meta);
  card.addEventListener("click", () => {
    const id = card.dataset.id;
    if (!id) return;
    void openLightbox({
      id,
      alt: img.alt,
      frameCount: Number(card.dataset.frameCount) || 1,
      speed: Number(card.dataset.speed) || 8,
      width: card.dataset.width ? Number(card.dataset.width) : null,
      height: card.dataset.height ? Number(card.dataset.height) : null,
    });
  });
  return card;
}

async function loadPage(): Promise<void> {
  if (loading || done) return;
  loading = true;
  if (offset === 0) statusEl.textContent = "Loading…";

  try {
    const res = await fetch(`/api/creations?offset=${offset}&limit=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    const page: CreationsPage = await res.json();
    total = page.total;

    for (const item of page.items) {
      const card = makeCard(item);
      grid.appendChild(card);
      mediaObserver.observe(card);
    }

    offset += page.items.length;
    done = !page.hasMore || page.items.length === 0;

    if (total === 0) {
      statusEl.classList.add("empty");
      statusEl.textContent = "No creations yet — draw something and hit “Send to gallery”.";
    } else {
      statusEl.classList.remove("empty");
      statusEl.textContent = "";
    }
  } catch (err) {
    console.error("[gallery] load failed:", err);
    statusEl.textContent = "Couldn’t load the gallery. Scroll to retry.";
    loading = false;
    // allow the sentinel observer to retry on the next intersection
    return;
  }

  loading = false;
  // The sentinel may still be on-screen after a short page; keep filling.
  if (!done && isSentinelVisible()) void loadPage();
}

function isSentinelVisible(): boolean {
  const r = sentinel.getBoundingClientRect();
  return r.top < window.innerHeight + 400;
}

const sentinelObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting)) void loadPage();
  },
  { rootMargin: "600px 0px" },
);
sentinelObserver.observe(sentinel);

// Seamless scrolling blue gradient on the back link (canvas, no loop snap).
const TILE_CSS_PX = 296;
const SCROLL_CSS_PX_PER_SEC = 148;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const GRADIENT_DARK: Rgb = { r: 21, g: 58, b: 140 };
const GRADIENT_LIGHT: Rgb = { r: 60, g: 155, b: 235 };

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function waveColor(phase: number): string {
  const wave = (Math.sin(phase * Math.PI * 2) + 1) * 0.5;
  const c = lerpRgb(GRADIENT_DARK, GRADIENT_LIGHT, wave);
  return `rgb(${c.r | 0},${c.g | 0},${c.b | 0})`;
}

function wireBackLinkGradient(): void {
  const link = document.querySelector(".back-link") as HTMLAnchorElement | null;
  const canvas = link?.querySelector(".back-link__bg") as HTMLCanvasElement | null;
  const ctx = canvas?.getContext("2d");
  if (!link || !canvas || !ctx) return;

  let phase = 0;
  let last = performance.now();

  const resize = (): void => {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = link.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const draw = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const period = TILE_CSS_PX * dpr;

    phase += (dt * SCROLL_CSS_PX_PER_SEC * dpr) / period;
    if (phase >= 1) phase -= Math.floor(phase);

    resize();
    const w = canvas.width;
    const h = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let x = 0; x < w; x++) {
      const t = x / period + phase;
      ctx.fillStyle = waveColor(t);
      ctx.fillRect(x, 0, 1, h);
    }

    requestAnimationFrame(draw);
  };

  resize();
  new ResizeObserver(resize).observe(link);
  requestAnimationFrame(draw);
}

wireBackLinkGradient();

void loadPage();
