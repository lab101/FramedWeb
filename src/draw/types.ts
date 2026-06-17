// Shared drawing types + the network protocol.
//
// The protocol intentionally mirrors the original OSC messages
// (/points, /shape, /erase, /nrOfFrames, /frameSpeed, /frameSize) so that
// external sources can feed drawings in over a WebSocket using a simple,
// stable JSON schema.

export type Tool = "brush" | "rectangle" | "circle";

export interface RGB {
  r: number; // 0..1
  g: number; // 0..1
  b: number; // 0..1
}

// A single brush sample: x, y in frame-pixel space, size = brush diameter (px).
export type BrushPoint = [number, number, number];

// ---- Network messages ----------------------------------------------------

export interface PointsMessage {
  type: "points";
  frameId: number;
  color: RGB;
  points: BrushPoint[];
}

export interface ShapeMessage {
  type: "shape";
  shape: "rectangle" | "circle";
  frameId: number;
  color: RGB;
  p1: [number, number];
  p2: [number, number];
}

export interface EraseMessage {
  type: "erase";
}

export interface FramesMessage {
  type: "nrOfFrames";
  value: number;
}

export interface SpeedMessage {
  type: "frameSpeed";
  value: number;
}

export interface SizeMessage {
  type: "frameSize";
  width: number;
  height: number;
}

export type DrawMessage =
  | PointsMessage
  | ShapeMessage
  | EraseMessage
  | FramesMessage
  | SpeedMessage
  | SizeMessage;
