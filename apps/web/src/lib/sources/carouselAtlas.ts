/**
 * Browser carousel atlas builder.
 *
 * The device `.img` format is still a compressed image and therefore not a zero-decode display
 * format. This module moves that decode cost to cache construction: many covers are rasterized
 * into a small number of atlas pages, so the carousel later decodes pages rather than individual
 * images while the user is moving.
 */

export interface CarouselAtlasInput {
  key: string;
  bytes: Uint8Array;
  mime?: string;
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
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  placements: CarouselAtlasPlacement[];
  pages: CarouselAtlasPage[];
}

export interface CarouselAtlasOptions {
  /** Fixed cell size is intentional: scrubbing becomes a coordinate lookup. */
  cellWidth?: number;
  cellHeight?: number;
  columns?: number;
  rows?: number;
  quality?: number;
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

  return { cellWidth, cellHeight, columns, rows, placements, pages };
}

/** Serialize the atlas as one binary file: manifest first, then page blobs. */
export async function encodeCarouselAtlas(atlas: CarouselAtlas): Promise<Uint8Array> {
  const manifest = atlasEncoder.encode(JSON.stringify({
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
