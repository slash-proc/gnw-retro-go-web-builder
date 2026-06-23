// Flash-transfer compression. The device decompresses each chunk with a 16 KiB
// dictionary, so we use the patched LZMA-JS worker (loaded as a classic script →
// window.LZMA). Preload before flashing so the compress fn can stay synchronous.
// Relative path (not an alias) so the `?url` asset query resolves at build time.
import workerUrl from "../../../../../frontend/vendor/lzma/lzma_worker.js?url";

interface LzmaJs {
  compress(data: Uint8Array | number[], mode: number): number[];
}
declare global {
  interface Window {
    LZMA?: LzmaJs;
  }
}

let ready: Promise<LzmaJs> | undefined;

export function preloadLzma(): Promise<LzmaJs> {
  return (ready ??= new Promise<LzmaJs>((resolve, reject) => {
    if (window.LZMA) return resolve(window.LZMA);
    const s = document.createElement("script");
    s.src = workerUrl;
    s.onload = () => (window.LZMA ? resolve(window.LZMA) : reject(new Error("LZMA worker loaded but window.LZMA missing")));
    s.onerror = () => reject(new Error("failed to load LZMA worker"));
    document.head.appendChild(s);
  }));
}

/** Compress to a raw LZMA1 stream (drop LZMA-JS's 13-byte .lzma header). */
export function lzmaCompress(data: Uint8Array): Uint8Array {
  const LZMA = window.LZMA;
  if (!LZMA) throw new Error("LZMA not loaded — call preloadLzma() first");
  const out = LZMA.compress(data, 1);
  return Uint8Array.from(out, (b) => b & 0xff).subarray(13);
}
