import {
  CAROUSEL_ATLAS_DEFAULTS,
  carouselAtlasCacheSignature,
  carouselAtlasContentFingerprint,
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
  requestId: number;
  type: "built";
  atlas: Omit<CarouselAtlas, "pages"> & { pages: WorkerPage[] };
}

type WorkerResponse = WorkerResult
  | { type: "error"; requestId: number; message: string }
  | { type: "progress"; requestId: number; done: number; total: number };

let activeAtlasWorkers: Worker[] = [];
const atlasInteractionReasons = new Set<string>();

export function setCarouselAtlasInteraction(reason: string, active: boolean): void {
  const wasPaused = atlasInteractionReasons.size > 0;
  if (active) atlasInteractionReasons.add(reason);
  else atlasInteractionReasons.delete(reason);
  const isPaused = atlasInteractionReasons.size > 0;
  if (wasPaused !== isPaused) {
    for (const worker of activeAtlasWorkers) worker.postMessage({ type: isPaused ? "pause" : "resume" });
  }
}

export function getCarouselAtlasConcurrency(): number {
  return typeof navigator !== "undefined" && navigator.hardwareConcurrency >= 8 ? 4 : 2;
}

function createCarouselAtlasWorker(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
  const worker = new Worker(new URL("./carouselAtlas.worker.ts", import.meta.url), { type: "module" });
  let nextRequestId = 0;
  let closed = false;
  const pending = new Map<number, {
    resolve: (atlas: CarouselAtlas) => void;
    reject: (error: Error) => void;
    onProgress?: (done: number, total: number) => void;
  }>();

  const close = (reason = new DOMException("Atlas build cancelled", "AbortError")) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", onAbort);
    activeAtlasWorkers = activeAtlasWorkers.filter((activeWorker) => activeWorker !== worker);
    worker.terminate();
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
  };
  const onAbort = () => close();
  signal?.addEventListener("abort", onAbort, { once: true });
  activeAtlasWorkers.push(worker);
  if (atlasInteractionReasons.size) worker.postMessage({ type: "pause" });

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.requestId);
    if (!request) return;
    if (event.data.type === "progress") {
      request.onProgress?.(event.data.done, event.data.total);
      return;
    }
    pending.delete(event.data.requestId);
    if (event.data.type === "error") {
      request.reject(new Error(event.data.message));
      return;
    }
    const pages: CarouselAtlasPage[] = event.data.atlas.pages.map((page) => ({
      index: page.index,
      width: page.width,
      height: page.height,
      blob: new Blob([page.blob], { type: "image/webp" }),
    }));
    request.resolve({ ...event.data.atlas, pages });
  };
  worker.onerror = (event) => close(event.error ?? new Error(event.message));

  return {
    build(inputs: readonly CarouselAtlasInput[], options: CarouselAtlasOptions, onProgress?: (done: number, total: number) => void) {
      if (closed) return Promise.reject(new Error("Atlas worker is closed"));
      const requestId = ++nextRequestId;
      return new Promise<CarouselAtlas>((resolve, reject) => {
        pending.set(requestId, { resolve, reject, onProgress });
        const transferableInputs = inputs.map((input) => {
          const bytes = input.bytes.byteOffset === 0 && input.bytes.byteLength === input.bytes.buffer.byteLength
            ? input.bytes
            : input.bytes.slice();
          return { key: input.key, bytes: bytes.buffer as ArrayBuffer, mime: input.mime };
        });
        worker.postMessage({ type: "build", requestId, inputs: transferableInputs, options }, transferableInputs.map((input) => input.bytes));
      });
    },
    close,
  };
}

function createCarouselAtlasWorkerPool(size: number, signal?: AbortSignal) {
  const workers = new Set<ReturnType<typeof createCarouselAtlasWorker>>();
  return {
    build(inputs: readonly CarouselAtlasInput[], options: CarouselAtlasOptions, onProgress?: (done: number, total: number) => void) {
      if (workers.size >= size) throw new Error("Atlas worker pool is full");
      const worker = createCarouselAtlasWorker(signal);
      workers.add(worker);
      try {
        return worker.build(inputs, options, onProgress).finally(() => {
          worker.close();
          workers.delete(worker);
        });
      } catch (error) {
        worker.close();
        workers.delete(worker);
        throw error;
      }
    },
    close() {
      for (const worker of workers) worker.close();
      workers.clear();
    },
  };
}

export interface CarouselAtlasBuildEntry {
  sourceId: string;
  key: string;
  file: CarouselAtlasSourceFile | Uint8Array | null;
}

/**
 * Reuse/build/persist atlas bundles one source at a time. The signal is checked between sources
 * and before the worker starts; stale work never replaces a newer source snapshot.
 */
export async function prepareCarouselAtlases(
  entries: readonly CarouselAtlasBuildEntry[],
  options: CarouselAtlasOptions = {},
  signal?: AbortSignal,
  onProgress?: (stage: string, sourceId: string, done: number, total: number) => void,
  yieldForInteraction?: () => Promise<void>,
  existingAtlases?: ReadonlyMap<string, CarouselAtlas>,
): Promise<Map<string, CarouselAtlas>> {
  const bySource = new Map<string, CarouselAtlasBuildEntry[]>();
  for (const entry of entries) {
    const list = bySource.get(entry.sourceId) ?? [];
    list.push(entry);
    bySource.set(entry.sourceId, list);
  }
  const result = new Map<string, CarouselAtlas>();
  for (const [sourceId, sourceEntries] of bySource) {
    await yieldForInteraction?.();
    if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
    const signature = carouselAtlasCacheSignature(sourceId, sourceEntries.map(({ key, file }) => ({
      key,
      size: file!.length,
      lastModified: file instanceof Uint8Array ? undefined : file!.lastModified,
      contentFingerprint: file instanceof Uint8Array ? carouselAtlasContentFingerprint(file) : undefined,
    })), options);
    const existing = existingAtlases?.get(sourceId);
    if (existing?.sourceSignature === signature) {
      onProgress?.("Reusing browser covers", sourceId, 1, 1);
      result.set(sourceId, existing);
      for (const entry of sourceEntries) {
        const file = entry.file;
        if (file && !(file instanceof Uint8Array)) file.release();
        entry.file = null;
      }
      continue;
    }
    const cached = await readCarouselAtlas(sourceId);
    const canUseVersionZeroCache = sourceEntries.every(({ file }) => !(file instanceof Uint8Array));
    if (cached?.sourceSignature === signature || (canUseVersionZeroCache && cached?.sourceSignature === `${signature}:0`)) {
      onProgress?.("Loading saved browser covers", sourceId, 1, 1);
      result.set(sourceId, cached);
      for (const entry of sourceEntries) {
        const file = entry.file;
        if (file && !(file instanceof Uint8Array)) file.release();
        entry.file = null;
      }
      continue;
    }
    const columns = options.columns ?? CAROUSEL_ATLAS_DEFAULTS.columns;
    const rows = options.rows ?? CAROUSEL_ATLAS_DEFAULTS.rows;
    const batchSize = columns * rows;
    const maxBatchBytes = 24 * 1024 * 1024;
    const workerPoolSize = Math.min(getCarouselAtlasConcurrency(), Math.ceil(sourceEntries.length / batchSize));
    const placements: CarouselAtlas["placements"] = [];
    const pages: CarouselAtlas["pages"] = [];
    let atlasMetadata: Omit<CarouselAtlas, "placements" | "pages"> | null = null;
    const workerPool = createCarouselAtlasWorkerPool(workerPoolSize, signal);
    const batchProgress = new Map<number, number>();
    const pendingBatches: Array<{ start: number; result: Promise<CarouselAtlas> }> = [];
    onProgress?.("Preparing browser covers", sourceId, 0, sourceEntries.length);
    const reportProgress = () => {
      const completedCovers = Math.min(sourceEntries.length, [...batchProgress.values()].reduce((sum, count) => sum + count, 0));
      onProgress?.("Preparing browser covers", sourceId, completedCovers, sourceEntries.length);
    };
    const appendBatch = (start: number, atlasBatch: CarouselAtlas) => {
      atlasMetadata ??= {
        sourceSignature: signature,
        cellWidth: atlasBatch.cellWidth,
        cellHeight: atlasBatch.cellHeight,
        columns: atlasBatch.columns,
        rows: atlasBatch.rows,
      };
      const pageOffset = pages.length;
      placements.push(...atlasBatch.placements.map((placement) => ({ ...placement, page: placement.page + pageOffset })));
      pages.push(...atlasBatch.pages.map((page, index) => ({ ...page, index: pageOffset + index })));
      batchProgress.set(start, atlasBatch.placements.length);
      reportProgress();
    };
    try {
      for (let start = 0; start < sourceEntries.length;) {
        await yieldForInteraction?.();
        if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
        let end = start;
        let batchBytes = 0;
        while (end < sourceEntries.length && end - start < batchSize) {
          const nextBytes = sourceEntries[end].file?.length ?? 0;
          if (end > start && batchBytes + nextBytes > maxBatchBytes) break;
          batchBytes += nextBytes;
          end++;
        }
        const inputs: CarouselAtlasInput[] = [];
        for (let index = start; index < end; index++) {
          if ((index - start) % 8 === 0) await yieldForInteraction?.();
          if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
          const entry = sourceEntries[index];
          const file = entry.file;
          if (!file) continue;
          try {
            const bytes = file instanceof Uint8Array ? file : await file.bytes();
            inputs.push({ key: entry.key, bytes: bytes.slice() });
          } finally {
            if (!(file instanceof Uint8Array)) file.release();
            entry.file = null;
          }
        }
        const batchResult = workerPool.build(
          inputs,
          { ...options, columns, rows, sourceSignature: signature },
          (done) => {
            batchProgress.set(start, done);
            reportProgress();
          },
        );
        void batchResult.catch(() => {});
        inputs.length = 0;
        pendingBatches.push({ start, result: batchResult });
        if (pendingBatches.length >= workerPoolSize) {
          const oldest = pendingBatches.shift()!;
          appendBatch(oldest.start, await oldest.result);
        }
        start = end;
      }
      while (pendingBatches.length) {
        const next = pendingBatches.shift()!;
        appendBatch(next.start, await next.result);
      }
    } finally {
      workerPool.close();
      for (const entry of sourceEntries) {
        const file = entry.file;
        if (file && !(file instanceof Uint8Array)) file.release();
        entry.file = null;
      }
    }
    if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
    const atlas: CarouselAtlas = { ...atlasMetadata!, placements, pages };
    await yieldForInteraction?.();
    if (signal?.aborted) throw new DOMException("Atlas build cancelled", "AbortError");
    onProgress?.("Saving browser cover cache", sourceId, 0, 1);
    const saved = await writeCarouselAtlas(sourceId, atlas);
    if (!saved) throw new Error(`Could not save carousel cover cache for ${sourceId}`);
    onProgress?.("Saving browser cover cache", sourceId, 1, 1);
    result.set(sourceId, atlas);
  }
  return result;
}
