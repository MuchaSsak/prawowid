/**
 * Runs the backdrop renderer (src/lib/backdrop-gl.ts) on an OffscreenCanvas, off the main thread:
 * the first WebGL context of a page can block for hundreds of ms while the browser starts its GPU
 * process, and here that wait never freezes the page. Messages: the first carries the canvas, every
 * one carries the latest page state. Replies "ready" after the first frame, "software" when there is
 * no GPU (the page then keeps its CSS gradient and its other GPU-heavy effects off), "error" when
 * the shader failed or the context was lost.
 */
import { createBackdropRenderer, type BackdropState } from "./backdrop-gl.ts";

type Message = { canvas?: OffscreenCanvas; dpr?: number; state: BackdropState };
const scope = self as unknown as { postMessage(msg: string): void; onmessage: ((e: MessageEvent<Message>) => void) | null };

let update: ((s: BackdropState) => void) | null = null;
scope.onmessage = ({ data }) => {
  if (data.canvas) {
    update = createBackdropRenderer(data.canvas, data.dpr ?? 1, () => scope.postMessage("ready"), (reason) => scope.postMessage(reason));
  }
  update?.(data.state);
};
