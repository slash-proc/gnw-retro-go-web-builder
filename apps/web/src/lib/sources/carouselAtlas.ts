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
      const bitmap = await createImageBitmap(new Blob([input.bytes as BlobPart], { type: input.mime || "image/png" }));
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

