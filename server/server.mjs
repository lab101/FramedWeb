// Framed combined server.
//
// Hosts the built web app (the `dist/` folder) over HTTP at the root, AND a
// WebSocket relay at `/ws` on the SAME origin/port. This mirrors the desktop
// app: every drawing message a client sends is re-broadcast to all OTHER
// connected clients, so each peer applies remote strokes exactly once. Each
// message carries its own `frameId`, so strokes always land on the right frame.
//
// Run:  npm run serve            (after `npm run build`)
//   or:  npm start               (builds, then serves)
//
// Env:  PORT (default 8080), HOST (default 0.0.0.0)
//
// Open http://localhost:8080 — the web client auto-connects to ws://<host>/ws.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { saveCreation, listCreations } from "./gallery.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist");
const GALLERY_DIR = resolve(__dirname, "..", "gallery");
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024; // 128 MB ceiling for a full animation
const PORT = Number(process.env.PORT) || 5201;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function notFound(res, msg = "Not found") {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(msg);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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

// Resolve a /media/* request to a file inside GALLERY_DIR, guarding traversal.
function resolveMedia(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = normalize(decoded.replace(/^\/media\/?/, "")).replace(/^(\.\.[/\\])+/, "");
  if (!rel || rel === "." || rel === sep) return null;
  const filePath = join(GALLERY_DIR, rel);
  if (filePath !== GALLERY_DIR && !filePath.startsWith(GALLERY_DIR + sep)) return null;
  return filePath;
}

async function handleApi(req, res) {
  const url = req.url || "/";

  // Receive an animation and persist it as a new gallery creation.
  if (req.method === "POST" && url.startsWith("/api/gallery")) {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8"));
      const meta = await saveCreation(GALLERY_DIR, payload);
      sendJson(res, 201, { ok: true, ...meta });
    } catch (err) {
      console.error("[framed] gallery save failed:", err.message);
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // Paginated list of creations (newest first) for the gallery's infinite scroll.
  if (req.method === "GET" && url.startsWith("/api/creations")) {
    try {
      const params = new URL(url, "http://localhost").searchParams;
      const offset = Math.max(0, parseInt(params.get("offset") || "0", 10) || 0);
      const limit = Math.min(60, Math.max(1, parseInt(params.get("limit") || "12", 10) || 12));
      sendJson(res, 200, await listCreations(GALLERY_DIR, offset, limit));
    } catch (err) {
      console.error("[framed] gallery list failed:", err.message);
      sendJson(res, 500, { items: [], error: err.message });
    }
    return true;
  }

  return false;
}

// Resolve a request path to a file inside DIST_DIR, guarding against traversal.
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  let rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  if (rel === "/" || rel === "" || rel === "." || rel === sep) rel = "index.html";
  const filePath = join(DIST_DIR, rel);
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) return null;
  return filePath;
}

async function serveFile(res, filePath) {
  try {
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  // API routes (handle their own methods/responses).
  if (url.startsWith("/api/")) {
    if (await handleApi(req, res)) return;
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  // Serve stored creation media (thumbnails + frames) from the gallery folder.
  if (url.startsWith("/media/")) {
    const mediaPath = resolveMedia(url);
    if (!mediaPath) return notFound(res, "Forbidden");
    if (await serveFile(res, mediaPath)) return;
    return notFound(res);
  }

  if (!existsSync(DIST_DIR)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("dist/ not found — run `npm run build` first.");
    return;
  }

  const filePath = resolveSafe(url);
  if (!filePath) return notFound(res, "Forbidden");

  // Try the exact file, then fall back to index.html (SPA-style root serving).
  if (await serveFile(res, filePath)) return;
  if (await serveFile(res, join(DIST_DIR, "index.html"))) return;
  notFound(res);
});

// WebSocket relay on the same server, scoped to the /ws path.
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, req) => {
  const who = req.socket.remoteAddress;
  console.log(`[framed] client connected (${who}) — ${wss.clients.size} online`);

  socket.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (msg?.type === "pong") return;
      } catch {
        /* not JSON — broadcast as-is */
      }
    }
    for (const client of wss.clients) {
      if (client !== socket && client.readyState === 1 /* OPEN */) {
        client.send(data, { binary: isBinary });
      }
    }
  });

  socket.on("close", () => {
    console.log(`[framed] client disconnected — ${wss.clients.size} online`);
  });

  socket.on("error", (err) => console.error("[framed] socket error", err.message));
});

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`[framed] http  → http://${shown}:${PORT}`);
  console.log(`[framed] ws    → ws://${shown}:${PORT}/ws`);
  console.log(`[framed] serving ${DIST_DIR}`);
});
