import { Signal } from "../util/signal";
import type { DrawMessage } from "../draw/types";

export type NetStatus = "offline" | "connecting" | "online" | "error";

// WebSocket transport for drawing messages.
//
// Design goals (from the brief):
//  - The app is fully usable with NO connection (single user). Local drawing is
//    applied directly to the canvas; send() is simply a no-op while offline.
//  - It is trivial to plug in external incoming drawings: connect to any
//    WebSocket relay and every message received is emitted on `onMessage`, which
//    the app applies to the canvas exactly like a local action.
//
// The wire format is the JSON DrawMessage union in draw/types.ts, which mirrors
// the original OSC messages (/points, /shape, /erase, /nrOfFrames, ...).
//
// A relay is expected to broadcast each message to all OTHER clients (not echo
// it back to the sender) so we never double-draw our own strokes.
export class NetworkManager {
  readonly onMessage = new Signal<[DrawMessage]>();
  readonly onStatus = new Signal<[NetStatus, string]>();

  private ws: WebSocket | null = null;
  private status: NetStatus = "offline";

  connect(url: string): void {
    this.disconnect();
    this.setStatus("connecting", url);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.setStatus("error", String(err));
      return;
    }
    this.ws = ws;

    ws.onopen = () => this.setStatus("online", url);
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.setStatus("offline", "disconnected");
      }
    };
    ws.onerror = () => this.setStatus("error", "connection error");
    ws.onmessage = (ev) => this.handleRaw(ev.data);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("offline", "single user");
  }

  isOnline(): boolean {
    return this.status === "online";
  }

  // Broadcast a local action. No-op while offline.
  send(message: DrawMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleRaw(data: unknown): void {
    const apply = (text: string) => {
      try {
        const msg = JSON.parse(text) as DrawMessage;
        if (msg && typeof (msg as { type?: unknown }).type === "string") {
          this.onMessage.emit(msg);
        }
      } catch {
        /* ignore malformed messages */
      }
    };

    if (typeof data === "string") {
      apply(data);
    } else if (data instanceof Blob) {
      data.text().then(apply);
    } else if (data instanceof ArrayBuffer) {
      apply(new TextDecoder().decode(data));
    }
  }

  private setStatus(status: NetStatus, detail: string): void {
    this.status = status;
    this.onStatus.emit(status, detail);
  }
}
