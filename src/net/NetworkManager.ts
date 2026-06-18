import { Signal } from "../util/signal";
import type { DrawMessage } from "../draw/types";

export type NetStatus = "offline" | "connecting" | "online" | "error";

const PING_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

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
  private url = "";
  private shouldStayConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.addEventListener("online", () => this.tryReconnect("network online"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.tryReconnect("tab visible");
    });
  }

  connect(url: string): void {
    this.shouldStayConnected = true;
    this.url = url;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.closeSocket();
    this.openSocket();
  }

  disconnect(): void {
    this.shouldStayConnected = false;
    this.url = "";
    this.clearReconnectTimer();
    this.stopPing();
    this.closeSocket();
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

  private openSocket(): void {
    this.setStatus("connecting", this.url);

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.setStatus("error", String(err));
      if (this.shouldStayConnected) this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus("online", this.url);
      this.startPing();
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.ws === ws) {
        this.ws = null;
        if (this.shouldStayConnected) {
          this.scheduleReconnect();
        } else {
          this.setStatus("offline", "disconnected");
        }
      }
    };
    ws.onerror = () => {
      if (this.shouldStayConnected) {
        this.setStatus("connecting", "connection lost, retrying…");
      } else {
        this.setStatus("error", "connection error");
      }
    };
    ws.onmessage = (ev) => this.handleRaw(ev.data);
  }

  private closeSocket(): void {
    if (!this.ws) return;
    const ws = this.ws;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (!this.shouldStayConnected || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.setStatus("connecting", `reconnecting in ${Math.round(delay / 1000)}s…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldStayConnected) this.openSocket();
    }, delay);
  }

  private tryReconnect(reason: string): void {
    if (!this.shouldStayConnected || !this.url) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer) {
      this.clearReconnectTimer();
    }
    this.reconnectAttempt = 0;
    this.setStatus("connecting", reason);
    this.openSocket();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ping" }));
    }
  }

  private handleRaw(data: unknown): void {
    const apply = (text: string) => {
      try {
        const msg = JSON.parse(text) as { type?: string };
        if (!msg || typeof msg.type !== "string") return;
        if (msg.type === "ping" || msg.type === "pong") return;
        this.onMessage.emit(msg as DrawMessage);
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
