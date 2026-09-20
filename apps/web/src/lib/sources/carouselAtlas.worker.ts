/** Worker entry point for atlas construction. No DOM or Svelte state is touched here. */
import { buildCarouselAtlas, type CarouselAtlasInput, type CarouselAtlasOptions } from "./carouselAtlas.js";

interface BuildMessage {
  type: "build";
  inputs: { key: string; bytes: ArrayBuffer; mime?: string }[];
  options?: CarouselAtlasOptions;
}

self.onmessage = async (event: MessageEvent<BuildMessage>) => {
  if (event.data.type !== "build") return;
  try {
    const inputs: CarouselAtlasInput[] = event.data.inputs.map((input) => ({
      key: input.key,
      bytes: new Uint8Array(input.bytes),
      mime: input.mime,
    }));
    const atlas = await buildCarouselAtlas(inputs, event.data.options);
    const pages = await Promise.all(atlas.pages.map(async (page) => new Uint8Array(await page.blob.arrayBuffer())));
    self.postMessage({ type: "built", atlas: { ...atlas, pages: atlas.pages.map((page, index) => ({ ...page, blob: pages[index].buffer })) } }, pages.map((page) => page.buffer));
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

