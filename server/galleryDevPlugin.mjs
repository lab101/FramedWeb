// Vite dev-server plugin that mirrors the gallery API from server.mjs, so the
// "Send to gallery" button and the gallery page also work under `npm run dev`.
// It reuses the same storage module and the same `gallery/` folder, keeping
// dev and production behaviour identical.

import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { saveCreation, listCreations } from "./gallery.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const GALLERY_DIR = resolve(__dirname, "..", "gallery");
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

const MEDIA_MIME = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function resolveMedia(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = normalize(decoded.replace(/^\/media\/?/, "")).replace(/^(\.\.[/\\])+/, "");
  if (!rel || rel === "." || rel === sep) return null;
  const filePath = join(GALLERY_DIR, rel);
  if (filePath !== GALLERY_DIR && !filePath.startsWith(GALLERY_DIR + sep)) return null;
  return filePath;
}

export function galleryDevPlugin() {
  return {
    name: "framed-gallery-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "/";

        if (req.method === "POST" && url.startsWith("/api/gallery")) {
          try {
            const body = await readBody(req);
            const meta = await saveCreation(GALLERY_DIR, JSON.parse(body.toString("utf8")));
            sendJson(res, 201, { ok: true, ...meta });
          } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
          }
          return;
        }

        if (req.method === "GET" && url.startsWith("/api/creations")) {
          try {
            const params = new URL(url, "http://localhost").searchParams;
            const offset = Math.max(0, parseInt(params.get("offset") || "0", 10) || 0);
            const limit = Math.min(60, Math.max(1, parseInt(params.get("limit") || "12", 10) || 12));
            sendJson(res, 200, await listCreations(GALLERY_DIR, offset, limit));
          } catch (err) {
            sendJson(res, 500, { items: [], error: err.message });
          }
          return;
        }

        if (req.method === "GET" && url.startsWith("/media/")) {
          const mediaPath = resolveMedia(url);
          if (!mediaPath) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          try {
            const body = await readFile(mediaPath);
            res.statusCode = 200;
            res.setHeader("Content-Type", MEDIA_MIME[extname(mediaPath).toLowerCase()] || "application/octet-stream");
            res.end(body);
          } catch {
            res.statusCode = 404;
            res.end("Not found");
          }
          return;
        }

        next();
      });
    },
  };
}
