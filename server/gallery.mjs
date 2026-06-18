// Gallery storage + thumbnail generation for Framed.
//
// Saves uploaded animation frames into a per-creation folder named after the
// current date/time (no spaces), then renders a small, well-compressed
// animated WebP thumbnail (max 200px tall) that plays the whole loop.

import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const THUMB_MAX_HEIGHT = 200;
const THUMB_QUALITY = 70; // good compression, small files
const THUMB_EFFORT = 4;

// "2026-06-18_12-51-03-742" — sortable and free of spaces.
function timestampFolderName(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}` +
    `-${p(date.getMilliseconds(), 3)}`
  );
}

// frameSpeed advances the playback at (0.4 * speed) frames per second in the
// app, so a single loop frame lasts 1000 / (0.4 * speed) ms.
function frameDelayMs(speed) {
  const fps = 0.4 * Math.max(1, Number(speed) || 8);
  return Math.max(20, Math.round(1000 / fps));
}

function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(base64, "base64");
}

// payload: { frames: string[] (PNG data URLs or base64), speed, width, height }
export async function saveCreation(galleryDir, payload) {
  const frames = Array.isArray(payload?.frames) ? payload.frames : [];
  if (frames.length === 0) throw new Error("no frames provided");

  const id = timestampFolderName();
  const dir = join(galleryDir, id);
  await mkdir(dir, { recursive: true });

  const buffers = frames.map(decodeDataUrl);

  // Save the full-resolution frames untouched.
  await Promise.all(
    buffers.map((buf, i) =>
      writeFile(join(dir, `frame_${String(i).padStart(3, "0")}.png`), buf),
    ),
  );

  // Downscale every frame to the thumbnail height first (all frames share the
  // same aspect, so they end up identically sized — required for an animation).
  const resized = await Promise.all(
    buffers.map((buf) =>
      sharp(buf)
        .resize({ height: THUMB_MAX_HEIGHT, withoutEnlargement: true })
        .toBuffer(),
    ),
  );

  const delay = frameDelayMs(payload?.speed);
  const animFile = join(dir, "anim.webp");
  if (resized.length === 1) {
    await sharp(resized[0])
      .webp({ quality: THUMB_QUALITY, effort: THUMB_EFFORT })
      .toFile(animFile);
  } else {
    await sharp(resized, { join: { animated: true } })
      .webp({
        quality: THUMB_QUALITY,
        effort: THUMB_EFFORT,
        loop: 0,
        delay: resized.map(() => delay),
      })
      .toFile(animFile);
  }

  // A still poster of the first frame for fast first paint / fallbacks.
  await sharp(resized[0])
    .webp({ quality: THUMB_QUALITY, effort: THUMB_EFFORT })
    .toFile(join(dir, "poster.webp"));

  const meta = {
    id,
    createdAt: new Date().toISOString(),
    frameCount: frames.length,
    speed: Number(payload?.speed) || 8,
    width: Number(payload?.width) || null,
    height: Number(payload?.height) || null,
  };
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  return meta;
}

function metaToEntry(meta, id) {
  return {
    id,
    createdAt: meta?.createdAt ?? null,
    frameCount: meta?.frameCount ?? null,
    speed: meta?.speed ?? 8,
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    anim: `/media/${id}/anim.webp`,
    poster: `/media/${id}/poster.webp`,
  };
}

// Newest creations first, sliced for infinite scroll.
export async function listCreations(galleryDir, offset = 0, limit = 12) {
  let names = [];
  try {
    const entries = await readdir(galleryDir, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { items: [], total: 0, offset, limit, hasMore: false };
  }

  // Folder names are timestamps, so reverse-lexical order == newest first.
  names.sort().reverse();
  const total = names.length;
  const slice = names.slice(offset, offset + limit);

  const items = [];
  for (const id of slice) {
    try {
      const raw = await readFile(join(galleryDir, id, "meta.json"), "utf8");
      items.push(metaToEntry(JSON.parse(raw), id));
    } catch {
      // Fall back to folder mtime if meta.json is missing/corrupt.
      try {
        const s = await stat(join(galleryDir, id));
        items.push(metaToEntry({ createdAt: s.mtime.toISOString() }, id));
      } catch {
        /* skip unreadable entry */
      }
    }
  }

  return { items, total, offset, limit, hasMore: offset + limit < total };
}
