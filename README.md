# Framed — WebGPU

A web port of **Framed**, the collaborative animation drawing app (originally
C++ / libcinder / OpenGL). You draw pressure-sensitive soft brush strokes (plus
circles and rectangles) onto a stack of animation frames that play back in a
loop, with onion-skinning of the previous frame. Strokes can be shared with
other people over a WebSocket.

This port keeps the core experience and drops the desktop-only bits from the
original (Syphon/Spout texture sharing, OSC, file saving, webcam overlay,
platform tablet drivers).

## Requirements

- A browser with **WebGPU** (recent Chrome / Edge, or Safari 18+). Served over
  `https` or `localhost`.
- Node.js 18+ (for the dev server and the optional relay).

## Run

```bash
cd web
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173).

### Build

```bash
npm run build      # type-check + production build into dist/
npm run preview
```

## Controls

- **Draw**: click/drag with mouse, touch, or pen. Pen pressure controls brush
  size (works with Wacom/Huion/etc. via the browser PointerEvents API).
- **Tools**: Brush / Rect / Circle buttons, or keys `B` / `R` / `C`.
- **Brush size**: the slider (combines with pen pressure).
- **Color**: the saturation/value square + hue strip. Released colors are saved
  as recent swatches.
- **Frames**: set the frame count and playback speed. `←` / `→` switch the
  active frame. The previous frame is shown as a faint onion skin. The top bar
  shows the live animation loop preview and clickable per-frame thumbnails.
- **Clear all**: button or key `X`.
- **Navigate the canvas**: scroll or `V` / `N` to zoom, hold `Space` and drag (or
  middle-mouse drag) to pan.
- **Frame speed**: `[` faster, `]` slower.
- **Fullscreen**: `F`. **Projector mode** (animation loop fullscreen, no UI):
  `P` (exit with `P` or `Esc`).

### Keyboard shortcuts

| Key       | Action                         |
| --------- | ------------------------------ |
| `B/R/C`   | Brush / Rectangle / Circle     |
| `← → ↑ ↓` | Previous / next frame          |
| `V` / `N` | Zoom in / out                  |
| `[` / `]` | Frame speed faster / slower    |
| `Space`   | Pan (hold + drag)              |
| `X`       | Clear all frames               |
| `F`       | Toggle fullscreen              |
| `P`       | Projector mode (loop, fullscreen) |

(The original's `S` save and `D` debug-panel keys are omitted — saving and the
ImGui debug overlay aren't part of this port.)

## Multi-user / external drawings

The app is fully usable **single-user with no server**. For collaboration there
are two options.

### Combined server (recommended — like the desktop app)

One Node process hosts the built web app over HTTP **and** the WebSocket relay
at `/ws` on the same origin/port:

```bash
npm start            # build, then serve on http://localhost:5201
# or, if dist/ is already built:
npm run serve        # set PORT / HOST to change (defaults 5201 / 0.0.0.0)
```

Open `http://localhost:5201` (or the LAN IP from another device). The web client
**auto-connects** to `ws://<same-host>/ws` by default, so every visitor lands on
the same shared canvas immediately — no manual connect step. Each message
carries its `frameId`, so strokes always arrive on the correct frame, and the
server broadcasts to all other connected clients (never echoing the sender).

### Standalone relay (for `vite dev`)

When developing with `npm run dev` (served from Vite on a different port) you can
run the WS-only relay separately and point the **Connection** box at it:

```bash
npm run relay        # ws://localhost:8080  (set PORT to change)
```

Then enter `ws://localhost:8080` in the sidebar **Connection** box and press
**Connect**. Any external program speaking the protocol can connect the same way
and draws onto the shared canvas.

### Wire protocol

Messages are JSON, sent as WebSocket text frames. The relay forwards each message
to all *other* clients. The schema mirrors the original OSC messages:

```jsonc
// a batch of brush samples; point = [x, y, size] in frame-pixel space
{ "type": "points", "frameId": 0, "color": { "r": 1, "g": 0.2, "b": 0.4 },
  "points": [[120, 80, 24], [126, 85, 26]] }

// a circle or rectangle (p1/p2 in frame-pixel space)
{ "type": "shape", "shape": "circle", "frameId": 0,
  "color": { "r": 1, "g": 1, "b": 1 }, "p1": [400, 300], "p2": [450, 320] }

{ "type": "erase" }
{ "type": "nrOfFrames", "value": 12 }
{ "type": "frameSpeed", "value": 8 }
{ "type": "frameSize", "width": 1920, "height": 1080 }
```

The default frame size is `1920 × 1080`; coordinates are in those frame pixels,
so any external source should use the same coordinate space (or send a
`frameSize` message first).

Feeding in external drawings is just: open a WebSocket to the relay and send
`points` / `shape` messages — they appear on every canvas immediately.

## Architecture

- `src/gpu/Renderer.ts` — WebGPU device, pipelines (brush, shape, blit,
  overlay), frame textures, premultiplied-alpha drawing.
- `src/gpu/FrameManager.ts` — the animation frame stack, playback loop, drawing
  ops (port of the original `FrameManager` / `Frame`).
- `src/draw/LineManager.ts` — pressure-based arc-length stroke resampling (port
  of the original `LineManager`).
- `src/net/NetworkManager.ts` — WebSocket transport; offline-capable. Local
  actions and remote actions go through the same code path.
- `src/ui/ColorPicker.ts`, `src/main.ts`, `src/View.ts` — UI, input, zoom/pan,
  and wiring.
- `server/server.mjs` — combined static host (serves `dist/`) + WebSocket relay
  at `/ws` on the same port. This is what `npm start` / `npm run serve` run.
- `server/relay.mjs` — tiny standalone WebSocket broadcast relay (no HTTP).
