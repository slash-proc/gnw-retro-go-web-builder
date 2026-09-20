/**
 * Browser carousel atlas builder.
 *
 * The device `.img` format is still a compressed image and therefore not a zero-decode display
 * format. This module moves that decode cost to cache construction: many covers are rasterized
 * into a small number of atlas pages, so the carousel later decodes pages rather than individual
 * images while the user is moving.
 */

import { scoped } from "../storageScope.js";

export interface CarouselAtlasInput {
  key: string;
  bytes: Uint8Array;
  mime?: string;
}

/** Minimal lazy-file shape accepted by the collector; avoids coupling the atlas to romScan. */
export interface CarouselAtlasSourceFile {
  length: number;
  lastModified?: number;
  bytes(): Promise<Uint8Array>;
}

/**
 * Select existing device-format cover entries from the library scan. This only inspects map keys;
 * payloads remain lazy until the caller deliberately starts atlas construction.
 */
export function carouselAtlasFiles(
  files: ReadonlyMap<string, CarouselAtlasSourceFile | Uint8Array>,
  fileOrigin: ReadonlyMap<string, string> = new Map(),
): { sourceId: string; key: string; file: CarouselAtlasSourceFile | Uint8Array }[] {
  const result: { sourceId: string; key: string; file: CarouselAtlasSourceFile | Uint8Array }[] = [];
  for (const [key, file] of files) {
    if (!/\.img$/i.test(key) || !key.toLowerCase().startsWith("covers/")) continue;
    result.push({ sourceId: fileOrigin.get(key) ?? "unknown-source", key, file });
  }
  return result;
}

/** Build one atlas per source from already-discovered scan entries. */
export async function buildCarouselAtlasesFromFiles(
  files: ReturnType<typeof carouselAtlasFiles>,
  options: CarouselAtlasOptions = {},
): Promise<Map<string, CarouselAtlas>> {
  const bySource = new Map<string, typeof files>();
  for (const entry of files) {
    const list = bySource.get(entry.sourceId) ?? [];
    list.push(entry);
    bySource.set(entry.sourceId, list);
  }
  const result = new Map<string, CarouselAtlas>();
  for (const [sourceId, sourceFiles] of bySource) {
    const inputs: CarouselAtlasInput[] = [];
    const signatureEntries: { key: string; size: number; lastModified?: number }[] = [];
    for (const entry of sourceFiles) {
      const file = entry.file;
      const bytes = file instanceof Uint8Array ? file : await file.bytes();
      inputs.push({ key: entry.key, bytes });
      signatureEntries.push({
        key: entry.key,
        size: file.length,
        lastModified: file instanceof Uint8Array ? undefined : file.lastModified,
      });
    }
    result.set(sourceId, await buildCarouselAtlas(inputs, {
      ...options,
      sourceSignature: carouselAtlasSignature(sourceId, signatureEntries),
    }));
  }
  return result;
}

export interface CarouselAtlasPlacement {
  key: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CarouselAtlasPage {
  index: number;
  blob: Blob;
  width: number;
  height: number;
}

export interface CarouselAtlas {
  sourceSignature: string;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  placements: CarouselAtlasPlacement[];
  pages: CarouselAtlasPage[];
}

export interface CarouselAtlasOptions {
  /** Lazy metadata signature for the source that supplied these covers. */
  sourceSignature?: string;
  /** Fixed cell size is intentional: scrubbing becomes a coordinate lookup. */
  cellWidth?: number;
  cellHeight?: number;
  columns?: number;
  rows?: number;
  quality?: number;
}

/** Cheap metadata-only signature; it never opens a cover or ROM payload. */
export function carouselAtlasSignature(
  sourceId: string,
  entries: readonly { key: string; size: number; lastModified?: number }[],
): string {
  const ordered = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  let hash = 0xcbf29ce484222325n;
  const text = `${sourceId}\n${ordered.map((entry) => `${entry.key}\0${entry.size}\0${entry.lastModified ?? 0}`).join("\n")}`;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

const ATLAS_MAGIC = new Uint8Array([0x47, 0x4e, 0x57, 0x41, 0x54, 0x4c, 0x31, 0x00]); // GNWATL1\0
const ATLAS_VERSION = 1;
const atlasEncoder = new TextEncoder();
const atlasDecoder = new TextDecoder();

function atlasU32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true);
  return offset + 4;
}

function readAtlasU32(view: DataView, offset: number): [number, number] {
  return [view.getUint32(offset, true), offset + 4];
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") throw new Error("carousel atlas requires a browser");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function imageBox(sourceWidth: number, sourceHeight: number, cellWidth: number, cellHeight: number) {
  const scale = Math.min(cellWidth / sourceWidth, cellHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((cellWidth - width) / 2),
    y: Math.floor((cellHeight - height) / 2),
    width,
    height,
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("could not encode carousel atlas")), "image/webp", quality);
  });
}

/** Build atlas pages, decoding each input exactly once during cache construction. */
export async function buildCarouselAtlas(
  inputs: readonly CarouselAtlasInput[],
  options: CarouselAtlasOptions = {},
): Promise<CarouselAtlas> {
  const cellWidth = options.cellWidth ?? 96;
  const cellHeight = options.cellHeight ?? 128;
  const columns = options.columns ?? 16;
  const rows = options.rows ?? 16;
  const quality = options.quality ?? 0.86;
  if (cellWidth <= 0 || cellHeight <= 0 || columns <= 0 || rows <= 0) {
    throw new RangeError("carousel atlas dimensions must be positive");
  }

  const pageWidth = cellWidth * columns;
  const pageHeight = cellHeight * rows;
  const perPage = columns * rows;
  const placements: CarouselAtlasPlacement[] = [];
  const pages: CarouselAtlasPage[] = [];

  for (let start = 0; start < inputs.length; start += perPage) {
    const canvas = canvasFor(pageWidth, pageHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("could not create carousel atlas context");
    context.clearRect(0, 0, pageWidth, pageHeight);
    const page = pages.length;
    const slice = inputs.slice(start, start + perPage);
    for (let i = 0; i < slice.length; i++) {
      const input = slice[i];
      // `.img` is an extension, not a MIME declaration. Leave the type empty when the caller
      // does not know whether the payload is PNG or JPEG so the browser can sniff the bytes.
      const bitmap = await createImageBitmap(new Blob([input.bytes as BlobPart], { type: input.mime || "" }));
      try {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const box = imageBox(bitmap.width, bitmap.height, cellWidth, cellHeight);
        const x = col * cellWidth;
        const y = row * cellHeight;
        context.drawImage(bitmap, x + box.x, y + box.y, box.width, box.height);
        placements.push({ key: input.key, page, x, y, width: cellWidth, height: cellHeight });
      } finally {
        bitmap.close();
      }
    }
    pages.push({ index: page, blob: await canvasBlob(canvas, quality), width: pageWidth, height: pageHeight });
  }

  return { sourceSignature: options.sourceSignature ?? "", cellWidth, cellHeight, columns, rows, placements, pages };
}

/** Serialize the atlas as one binary file: manifest first, then page blobs. */
export async function encodeCarouselAtlas(atlas: CarouselAtlas): Promise<Uint8Array> {
  const manifest = atlasEncoder.encode(JSON.stringify({
    sourceSignature: atlas.sourceSignature,
    cellWidth: atlas.cellWidth,
    cellHeight: atlas.cellHeight,
    columns: atlas.columns,
    rows: atlas.rows,
    placements: atlas.placements,
  }));
  const pages = await Promise.all(atlas.pages.map(async (page) => new Uint8Array(await page.blob.arrayBuffer())));
  const total = ATLAS_MAGIC.byteLength + 12 + manifest.byteLength + pages.reduce((n, page) => n + 12 + page.byteLength, 0);
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let offset = 0;
  output.set(ATLAS_MAGIC, offset); offset += ATLAS_MAGIC.byteLength;
  offset = atlasU32(view, offset, ATLAS_VERSION);
  offset = atlasU32(view, offset, manifest.byteLength);
  output.set(manifest, offset); offset += manifest.byteLength;
  offset = atlasU32(view, offset, pages.length);
  for (let i = 0; i < pages.length; i++) {
    offset = atlasU32(view, offset, atlas.pages[i].width);
    offset = atlasU32(view, offset, atlas.pages[i].height);
    offset = atlasU32(view, offset, pages[i].byteLength);
    output.set(pages[i], offset); offset += pages[i].byteLength;
  }
  return output;
}

/** Decode a complete atlas file. Page blobs remain one blob per atlas page, never one per cover. */
export function decodeCarouselAtlas(bytes: Uint8Array): CarouselAtlas | null {
  try {
    if (bytes.byteLength < ATLAS_MAGIC.byteLength + 12 || !ATLAS_MAGIC.every((b, i) => bytes[i] === b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = ATLAS_MAGIC.byteLength;
    let value: number;
    [value, offset] = readAtlasU32(view, offset);
    if (value !== ATLAS_VERSION) return null;
    let manifestLength: number;
    [manifestLength, offset] = readAtlasU32(view, offset);
    if (manifestLength > bytes.byteLength - offset) return null;
    const manifest = JSON.parse(atlasDecoder.decode(bytes.subarray(offset, offset + manifestLength))) as Omit<CarouselAtlas, "pages">;
    offset += manifestLength;
    let pageCount: number;
    [pageCount, offset] = readAtlasU32(view, offset);
    const pages: CarouselAtlasPage[] = [];
    for (let index = 0; index < pageCount; index++) {
      let width: number; let height: number; let length: number;
      [width, offset] = readAtlasU32(view, offset);
      [height, offset] = readAtlasU32(view, offset);
      [length, offset] = readAtlasU32(view, offset);
      if (length > bytes.byteLength - offset) return null;
      // Copy the page out of the bundle so the caller can release the full bundle after startup.
      const pageBytes = bytes.slice(offset, offset + length);
      offset += length;
      pages.push({ index, width, height, blob: new Blob([pageBytes], { type: "image/webp" }) });
    }
    return { ...manifest, pages };
  } catch {
    return null;
  }
}

const ATLAS_DIRECTORY = scoped("carousel-atlases");

function atlasFileName(sourceId: string): string {
  return `${encodeURIComponent(sourceId).replace(/%/g, "_")}.bin`;
}

async function atlasDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(ATLAS_DIRECTORY, { create });
  } catch {
    return null;
  }
}

/** Read one complete atlas bundle. A miss/corrupt file is a normal cache miss. */
export async function readCarouselAtlas(sourceId: string): Promise<CarouselAtlas | null> {
  try {
    const directory = await atlasDirectory(false);
    if (!directory) return null;
    const file = await (await directory.getFileHandle(atlasFileName(sourceId))).getFile();
    return decodeCarouselAtlas(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Write a complete atlas bundle only after serialization has succeeded. */
export async function writeCarouselAtlas(sourceId: string, atlas: CarouselAtlas): Promise<boolean> {
  try {
    const directory = await atlasDirectory(true);
    if (!directory) return false;
    const bytes = await encodeCarouselAtlas(atlas);
    const name = atlasFileName(sourceId);
    const tempName = `${name}.tmp-${Date.now()}`;
    const temp = await directory.getFileHandle(tempName, { create: true });
    const tempWriter = await temp.createWritable();
    await tempWriter.write(bytes);
    await tempWriter.close();
    // FileSystem Access does not expose a portable file rename. Copy only after the complete
    // temporary write succeeds, then remove the temporary artifact.
    const targetWriter = await (await directory.getFileHandle(name, { create: true })).createWritable();
    await targetWriter.write(bytes);
    await targetWriter.close();
    await directory.removeEntry(tempName);
    return true;
  } catch {
    return false;
  }
}
