import { createSHA1 } from "hash-wasm/dist/index.esm.js";

/** The browser File and Electron's range-reading File shim share this surface. */
export interface HashableFile {
  readonly size: number;
  stream?(): ReadableStream<Uint8Array>;
  slice?(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** Hash direct files without retaining their complete payload in the renderer. */
export async function sha1File(file: HashableFile): Promise<string> {
  const hasher = await createSHA1();
  hasher.init();
  if (typeof file.stream === "function") {
    const reader = file.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hasher.update(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    if (!file.slice) throw new Error("File does not support bounded reads");
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = new Uint8Array(await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer());
      hasher.update(chunk);
    }
  }
  return hasher.digest("hex");
}
