// Minimal WebSocket relay for Framed.
//
// Every message a client sends is re-broadcast to all OTHER connected clients
// (never echoed back to the sender), so each peer applies remote strokes once.
// The relay is intentionally dumb: it does not parse or validate the JSON
// DrawMessage payloads, it just forwards bytes. This makes it trivial to feed
// in external incoming drawings — anything that speaks the JSON protocol and
// connects to this socket will appear on every canvas.
//
// Run:  npm run relay   (defaults to port 8080, override with PORT=9000)

import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`[framed-relay] listening on ws://localhost:${PORT}`);

wss.on("connection", (socket, req) => {
  const who = req.socket.remoteAddress;
  console.log(`[framed-relay] client connected (${who}) — ${wss.clients.size} online`);

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
    console.log(`[framed-relay] client disconnected — ${wss.clients.size} online`);
  });

  socket.on("error", (err) => console.error("[framed-relay] socket error", err.message));
});
