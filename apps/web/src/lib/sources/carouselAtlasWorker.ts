import type { CarouselAtlas, CarouselAtlasInput, CarouselAtlasOptions, CarouselAtlasPage } from "./carouselAtlas.js";

interface WorkerPage {
  index: number;
  width: number;
  height: number;
  blob: ArrayBuffer;
}

interface WorkerResult {
  type: "built";
  atlas: Omit<CarouselAtlas, "pages"> & { pages: WorkerPage[] };
}

/**
 * Build an atlas without running decode/rasterization on the main thread. The input buffers are
 * transferred to the worker and therefore must not be used by the caller after this call starts.
 */
export function buildCarouselAtlasOffThread(
  inputs: readonly CarouselAtlasInput[],
  options?: CarouselAtlasOptions,
): Promise<CarouselAtlas> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./carouselAtlas.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      action();
    };
    worker.onmessage = (event: MessageEvent<WorkerResult | { type: "error"; message: string }>) => {
      if (event.data.type === "error") {
        finish(() => reject(new Error(event.data.message)));
        return;
      }
      const pages: CarouselAtlasPage[] = event.data.atlas.pages.map((page) => ({
        index: page.index,
        width: page.width,
        height: page.height,
        blob: new Blob([page.blob], { type: "image/webp" }),
      }));
      finish(() => resolve({ ...event.data.atlas, pages }));
    };
    worker.onerror = (event) => finish(() => reject(event.error ?? new Error(event.message)));
    const transferableInputs = inputs.map((input) => ({
      key: input.key,
      // Slice so a Uint8Array view with a non-zero offset does not transfer unrelated bytes.
      bytes: input.bytes.slice().buffer,
      mime: input.mime,
    }));
    worker.postMessage({ type: "build", inputs: transferableInputs, options }, transferableInputs.map((input) => input.bytes));
  });
}
