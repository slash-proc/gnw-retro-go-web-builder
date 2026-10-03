/**
 * "Bytes, or something that can produce them" — and nothing else.
 *
 * A zipped ROM is listed from its central directory and inflated only if something installs it,
 * so the library map holds a mix of real bytes and un-read handles. Several modules need to
 * accept that mix, and they are exactly the modules that must stay cheap to import:
 * `sources/libraryScan.ts` and `sources/inputDiscovery.ts` are pure and node-testable, and
 * `romScan.ts` reaches the reactive stores. Importing the scan into the pure ones to borrow a
 * type breaks every suite that bundles them under `platform: "neutral"` (the WASM vendor in
 * `@gnw/fs-builders` imports node's `module`) -- the same hazard `discoveryWire.ts` and
 * `romScan.ts` both already record about `engine/devicePaths.ts`.
 *
 * So the shared vocabulary lives here, with no imports at all.
 */

/** An entry whose bytes have not been read yet. `romScan.ts`'s `LazyRom` is the implementation. */
export interface LazyBytes {
  /** UNCOMPRESSED length, known without reading the payload. */
  readonly length: number;
  bytes(): Promise<Uint8Array>;
  /** Optional bounded-memory hash path for large direct files. */
  hashSha1?(): Promise<string>;
  /** Release an optional decoded cache when a caller has finished a one-shot transform. */
  release?(): void;
}

/** Either already-read bytes, or a handle that can produce them. */
export type MaybeLazy = Uint8Array | LazyBytes;

interface LazyBytesStats {
  reads: number;
  readBytes: number;
  releases: number;
  releasedBytes: number;
  byCaller: Map<string, { reads: number; bytes: number }>;
}

const stats: LazyBytesStats = {
  reads: 0,
  readBytes: 0,
  releases: 0,
  releasedBytes: 0,
  byCaller: new Map(),
};

/** Runtime diagnostics for large-library investigations; intentionally does not retain ROM data. */
export function lazyBytesReport(): {
  reads: number;
  readBytes: number;
  releases: number;
  releasedBytes: number;
  byCaller: { caller: string; reads: number; bytes: number }[];
} {
  return {
    reads: stats.reads,
    readBytes: stats.readBytes,
    releases: stats.releases,
    releasedBytes: stats.releasedBytes,
    byCaller: [...stats.byCaller.entries()]
      .map(([caller, v]) => ({ caller, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

function lazyCaller(): string {
  // Stack capture is cheap compared with reading a ROM and gives us the call site that caused
  // the read. Strip this module's frames so the report groups by the application caller.
  const stack = new Error().stack?.split("\n").slice(3).find((line) =>
    !line.includes("lazyBytes") && !line.includes("romScan")
  );
  return stack?.trim() || "unknown";
}

export function noteLazyRead(bytes: number, caller = lazyCaller()): void {
  stats.reads++;
  stats.readBytes += bytes;
  const row = stats.byCaller.get(caller) ?? { reads: 0, bytes: 0 };
  row.reads++;
  row.bytes += bytes;
  stats.byCaller.set(caller, row);
}

export function noteLazyRelease(bytes: number): void {
  stats.releases++;
  stats.releasedBytes += bytes;
}

if (typeof window !== "undefined") {
  (window as Window & { gnwLazyBytesReport?: () => ReturnType<typeof lazyBytesReport> }).gnwLazyBytesReport = lazyBytesReport;
}

/**
 * STRUCTURAL, never `instanceof`.
 *
 * A bundler gives each test bundle its own copy of a module, so a class built in one fails
 * `instanceof` against the same class in another and is silently treated as raw bytes. That is
 * not hypothetical: it made the dedup hash tier hash the HANDLE rather than the ROM, so two
 * different ROMs hashed alike and one was dropped as a duplicate. A duck test crosses the
 * boundary; a class identity does not.
 */
export function isLazy(v: MaybeLazy): v is LazyBytes {
  return typeof v === "object" && v !== null && typeof (v as LazyBytes).bytes === "function";
}

/** The bytes, reading them if that has not happened yet. */
export async function resolveBytes(v: MaybeLazy): Promise<Uint8Array> {
  return isLazy(v) ? v.bytes() : v;
}
