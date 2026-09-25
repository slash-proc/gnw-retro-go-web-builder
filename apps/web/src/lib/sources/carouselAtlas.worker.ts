/** Worker entry point for atlas construction. No DOM or Svelte state is touched here. */
import { buildCarouselAtlas, type CarouselAtlasInput, type CarouselAtlasOptions } from "./carouselAtlas.js";

interface BuildMessage {
  type: "build";
  requestId: number;
  inputs: { key: string; bytes: ArrayBuffer; mime?: string }[];
  options?: CarouselAtlasOptions;
}

let paused = false;
let processing = false;
const buildQueue: BuildMessage[] = [];
const resumeWaiters: (() => void)[] = [];

async function yieldForWorkerControl(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  while (paused) await new Promise<void>((resolve) => resumeWaiters.push(resolve));
}

self.onmessage = (event: MessageEvent<BuildMessage | { type: "pause" | "resume" }>) => {
  if (event.data.type === "pause") {
    paused = true;
    return;
  }
  if (event.data.type === "resume") {
    paused = false;
    for (const resume of resumeWaiters.splice(0)) resume();
    return;
  }
  if (event.data.type !== "build") return;
  buildQueue.push(event.data);
  void processBuildQueue();
};

async function processBuildQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (buildQueue.length) {
      const request = buildQueue.shift()!;
      try {
        const inputs: CarouselAtlasInput[] = request.inputs.map((input) => ({
          key: input.key,
          bytes: new Uint8Array(input.bytes),
          mime: input.mime,
        }));
        request.inputs.length = 0;
        const atlas = await buildCarouselAtlas(
          inputs,
          request.options,
          (done, total) => {
            if (done === total || done % 8 === 0) self.postMessage({ type: "progress", requestId: request.requestId, done, total });
          },
          yieldForWorkerControl,
          (index) => { inputs[index].bytes = new Uint8Array(0); },
        );
        const pages = await Promise.all(atlas.pages.map(async (page) => new Uint8Array(await page.blob.arrayBuffer())));
        self.postMessage({ type: "built", requestId: request.requestId, atlas: { ...atlas, pages: atlas.pages.map((page, index) => ({ ...page, blob: pages[index].buffer })) } }, pages.map((page) => page.buffer));
      } catch (error) {
        self.postMessage({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    processing = false;
    if (buildQueue.length) void processBuildQueue();
  }
}
