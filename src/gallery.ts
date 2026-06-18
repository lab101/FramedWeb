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

let offset = 0;
let loading = false;
let done = false;
let total = 0;

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

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = `Animation from ${formatWhen(item.createdAt) || item.id}`;
  if (item.width && item.height) {
    img.width = item.width;
    img.height = item.height;
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const when = document.createElement("span");
  when.textContent = formatWhen(item.createdAt);
  const frameCount = document.createElement("span");
  frameCount.textContent = item.frameCount ? `${item.frameCount} frames` : "";
  meta.append(when, frameCount);

  card.append(img, meta);
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
