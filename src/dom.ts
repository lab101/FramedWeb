export const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
export const labelCanvas = document.getElementById("frame-label-canvas") as HTMLCanvasElement;
export const loopPreviewCanvas = document.getElementById("loop-preview-canvas") as HTMLCanvasElement;
export const stage = document.getElementById("stage") as HTMLElement;
export const noWebGPU = document.getElementById("no-webgpu") as HTMLElement;
export const frameStripEl = document.getElementById("frame-strip") as HTMLElement;
export const frameStripSpacerEl = document.getElementById("frame-strip-spacer") as HTMLElement;
export const labelCtx = labelCanvas.getContext("2d")!;
