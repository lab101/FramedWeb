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

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist");
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  if (!existsSync(DIST_DIR)) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("dist/ not found — run `npm run build` first.");
    return;
  }

  const filePath = resolveSafe(req.url || "/");
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
