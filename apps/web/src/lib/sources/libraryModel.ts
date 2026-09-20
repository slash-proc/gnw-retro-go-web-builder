/**
 * SERIALIZABLE LIBRARY ENTITIES.
 *
 * A LibraryRom is metadata and relationships, never the ROM's bytes. Runtime byte providers,
 * directory handles, object URLs and decoded images stay outside this model. This is the seam that
 * lets the Library search thousands of files without making every consumer parse string paths or
 * accidentally materialize the collection.
 */

import type { FileRole } from "./coreRegistry.js";
import type { MaybeLazy } from "../lazyBytes.js";

/** The persisted half of a user-selected DirectorySource. */
export interface DirectorySourceRef {
  id: string;
  name: string;
  folderName: string;
}

/** A source that can publish a core, converter or homebrew artifacts. */
export interface CoreSourceRef {
  id: string;
  kind: "repository" | "bundle" | "raw-binary";
  owner?: string;
  repository?: string;
  targetId: string;
}

/** A user file's stable, browser-visible metadata. The path is relative to DirectorySource. */
export interface LibraryFileMeta {
  relativePath: string;
  filename: string;
  extension: string;
  size: number;
  lastModified?: number;
}

/** Converter recognition is separate from general ROM identity. */
export interface LibraryConversion {
  inputId: string;
  status: "unmatched" | "matched" | "prepared";
  matchedVariantId?: string;
  producedArtifactId?: string;
}

/** Cover metadata only; image bytes and runtime URLs do not belong here. */
export interface LibraryCover {
  originalPaths: string[];
  originalSize?: number;
  originalLastModified?: number;
  carouselPath: string;
  deviceImgPath: string;
}

/** The serializable representation of one Library file. */
export interface LibraryRom {
  id: string;
  file: LibraryFileMeta;
  directorySource?: DirectorySourceRef;
  system: {
    id: string;
    folder: string;
    shortName: string;
    longName: string;
    coreSourceIds: string[];
    primaryCoreSourceId?: string;
  };
  role: FileRole;
  conversion?: LibraryConversion;
  device: {
    installed: boolean;
    path?: string;
    size?: number;
  };
  cover?: LibraryCover;
}

/** Source-relative cover candidates for a ROM. The first tier is beside the ROM; the second
 * preserves the app's existing optional `covers/` mirror layout. */
export function coverPathsForRom(rom: Pick<LibraryRom, "file">, extension: string): string[] {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const path = rom.file.relativePath;
  const dot = path.lastIndexOf(".");
  const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  return [
    `${stem}${ext}`,
    `covers/${stem}${ext}`,
  ];
}

/** Cover relationship known from ROM metadata alone; existence is resolved by the source index. */
export function libraryCoverForPath(relativePath: string): LibraryCover {
  const dot = relativePath.lastIndexOf(".");
  const stem = dot > relativePath.lastIndexOf("/") ? relativePath.slice(0, dot) : relativePath;
  const originalPaths = [".png", ".jpg", ".jpeg"].flatMap((extension) => [
    `${stem}${extension}`,
    `covers/${stem}${extension}`,
  ]);
  const carouselPath = `${stem}.img`;
  return {
    originalPaths,
    carouselPath,
    deviceImgPath: `covers/${stem}.img`,
  };
}

/** Runtime-only byte access. Never serialize this into LibraryRom. */
export interface RomByteProvider {
  read(): Promise<Uint8Array>;
  release?(): void;
}

/** Stable identity for a source-relative file, case-folded like the card filesystem. */
export function libraryRomId(sourceId: string | undefined, relativePath: string): string {
  return `${sourceId ?? "device"}:${relativePath.toLowerCase()}`;
}

/** Create file metadata once, instead of repeatedly splitting/parsing the path in consumers. */
export function libraryFileMeta(relativePath: string, size: number, lastModified?: number): LibraryFileMeta {
  const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  return {
    relativePath,
    filename,
    extension: dot > 0 ? filename.slice(dot).toLowerCase() : "",
    size,
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

/** Build metadata directly from a scan entry without resolving a lazy ROM. */
export function libraryFileMetaFromScan(
  relativePath: string,
  entry: MaybeLazy,
): LibraryFileMeta {
  const lastModified = typeof entry === "object" && entry !== null && "lastModified" in entry
    ? (entry as { lastModified?: number }).lastModified
    : undefined;
  return libraryFileMeta(relativePath, entry.length, lastModified);
}

/** Indexes used by the Library model; values remain serializable when converted to arrays. */
export interface LibraryIndexes {
  byId: Map<string, LibraryRom>;
  byPath: Map<string, LibraryRom>;
  bySystem: Map<string, LibraryRom[]>;
}

export function indexLibraryRoms(roms: readonly LibraryRom[]): LibraryIndexes {
  const byId = new Map<string, LibraryRom>();
  const byPath = new Map<string, LibraryRom>();
  const bySystem = new Map<string, LibraryRom[]>();
  for (const rom of roms) {
    byId.set(rom.id, rom);
    byPath.set(rom.file.relativePath.toLowerCase(), rom);
    const list = bySystem.get(rom.system.folder) ?? [];
    list.push(rom);
    bySystem.set(rom.system.folder, list);
  }
  return { byId, byPath, bySystem };
}
