import {
  carouselAtlasSignature,
  type CarouselAtlas,
  type CarouselAtlasInput,
  type CarouselAtlasOptions,
  type CarouselAtlasPage,
  type CarouselAtlasSourceFile,
} from "./carouselAtlas.js";
import { readCarouselAtlas, writeCarouselAtlas } from "./carouselAtlas.js";

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

export interface CarouselAtlasBuildEntry {
  sourceId: string;
  key: string;
  file: CarouselAtlasSourceFile | Uint8Array;
}

/**
 * Reuse/build/persist atlas bundles one source at a time. The signal is checked between sources
 * and before the worker starts; stale work never replaces a newer source snapshot.
 */
export async function prepareCarouselAtlases(
  entries: readonly CarouselAtlasBuildEntry[],
  options: CarouselAtlasOptions = {},
  signal?: AbortSignal,
): Promise<Map<string, CarouselAtlas>> {
  const bySource = new Map<string, CarouselAtlasBuildEntry[]>();
  for (const entry of entries) {
    const list = bySource.get(entry.sourceId) ?? [];
    list.push(entry);
    bySource.set(entry.sourceId, list);
  }
  const result = new Map<string, CarouselAtlas>();
  for (const [sourceId, sourceEntries] of bySource) {
    if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
    const signature = carouselAtlasSignature(sourceId, sourceEntries.map(({ key, file }) => ({
      key,
      size: file.length,
      lastModified: file instanceof Uint8Array ? undefined : file.lastModified,
    })));
    const cached = await readCarouselAtlas(sourceId);
    if (cached?.sourceSignature === signature) {
      result.set(sourceId, cached);
      continue;
    }
    const inputs: CarouselAtlasInput[] = [];
    for (const { key, file } of sourceEntries) {
      if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
      inputs.push({ key, bytes: file instanceof Uint8Array ? file : await file.bytes() });
    }
    if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
    const atlas = await buildCarouselAtlasOffThread(inputs, { ...options, sourceSignature: signature });
    if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
    await writeCarouselAtlas(sourceId, atlas);
    result.set(sourceId, atlas);
  }
  return result;
}
