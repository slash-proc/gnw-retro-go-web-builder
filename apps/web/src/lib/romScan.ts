/**
 * ROM folder scan — turns a user-picked directory into the `userRoms` map that
 * feeds the flash-install pipeline (engine/flashInstall.ts → @gnw/fs-builders).
 *
 * The map is keyed by the path RELATIVE to the picked folder ("nes/mario.nes",
 * "bios/pce/syscard3.pce"): the top segment is the system (retro-go `/roms/<system>`),
 * and a top-level `bios/` folder merges into `/bios`. That's exactly what
 * planFlashImage expects (it routes `bios/*` → /bios, everything else → /roms/*).
 *
 * Supports two folder-picking strategies:
 *   1. File System Access API (`showDirectoryPicker`) — Chromium; read + write-back
 *   2. `<input webkitdirectory>` fallback — Firefox/Safari; read-only
 */

export interface SystemSummary {
  system: string; // top-level folder name ("nes", "md", "bios", …)
  files: number;
  bytes: number;
}

export interface RomScanSummary {
  /** Per top-level folder (systems + a "bios" entry if the user supplied BIOS). */
  systems: SystemSummary[];
  totalFiles: number;
  totalBytes: number;
}

export interface RomScanResult {
  /** "<system>/<file>" → bytes; "bios/*" entries merge into /bios downstream. */
  userRoms: Map<string, LibraryFile>;
  summary: RomScanSummary;
  /** The picked directory handle — kept so the location can be remembered + re-scanned later.
   *  May be a read-only shim (InputDirHandle) in Firefox. */
  dir: RomDirHandle;
  /** Whether the user picked the SD root containing a 'roms/' folder */
  hasRomsPrefix?: boolean;
}

// Minimal File System Access API surface (not all in lib.dom yet).
/** A picked ROM directory handle (re-usable to remember + re-scan the location). */
export type RomDirHandle = FsDirHandle;
interface FsDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]>;
  /** True for native FSAA handles that support write-back (getDirectoryHandle, getFileHandle, createWritable). */
  readonly writable?: boolean;
}
interface FsFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FsDirHandle>;
  }
}

import { homebrew, isHomebrewSourceFile } from "./sources/homebrewTitles.svelte.js";
import { zipList, zipExtractOne, CentralDirectoryOutOfRange, type ZipEntry } from "./unzip.js";
import { isLazy, resolveBytes, type LazyBytes, type MaybeLazy } from "./lazyBytes.js";
import { coreRegistry } from "./sources/coreRegistry.svelte.js";
import { isKnownConsoleDir, type CoreRegistry } from "./sources/coreRegistry.js";
import { homebrewDirs } from "./engine/devicePaths.js";
import { download } from "./util.js";
import { dbg } from "./debug.js";
import {
  parseCoreHeader,
  evaluateCoreVersions,
  CORE_HEADER_PROBE_BYTES,
  type CoreVersionCheck,
} from "./engine/coreVersion.js";

const isHidden = (name: string): boolean => name.startsWith(".");

/**
 * A library file whose BYTES have not been read yet.
 *
 * The scan reads a zip's central directory and stops: it learns the inner name and the
 * UNCOMPRESSED size, which is everything the library list, the size columns, the budget and the
 * cheap dedup tiers need, and it reads none of the ROM. The bytes are inflated only when
 * something actually asks for them, which in practice means an install.
 *
 * WHY A `length` GETTER. The scan map's value type was `Uint8Array` and 32 call sites across 8
 * files read it. Almost all of them only want the size. Exposing `length` and `byteLength` means
 * every one of those keeps working untouched, and only the handful that genuinely need bytes has
 * to say so (`romBytes`). That is the whole reason this is a class rather than a plain record.
 */
export class LazyRom implements LazyBytes {
  /** UNCOMPRESSED length. Never the archive's size, which is meaningless for a flash budget. */
  readonly length: number;
  private cached: Uint8Array | null = null;
  private inflight: Promise<Uint8Array> | null = null;

  constructor(
    length: number,
    private readonly load: () => Promise<Uint8Array>,
    /** For diagnostics: the archive this came out of. */
    readonly archive: string,
  ) {
    this.length = length;
  }

  /** Alias, because `UintFuncs` callers reach for either name. */
  get byteLength(): number {
    return this.length;
  }

  /** Inflate once. Concurrent callers share the one read rather than racing the file. */
  async bytes(): Promise<Uint8Array> {
    if (this.cached) return this.cached;
    if (!this.inflight) {
      this.inflight = this.load().then((b) => {
        this.cached = b;
        this.inflight = null;
        return b;
      });
    }
    return this.inflight;
  }

  release(): void {
    this.cached = null;
  }
}

/** Anything the library map can hold: bytes already read, or a zip entry not yet inflated. */
export type LibraryFile = MaybeLazy;

/** The bytes of a library file, inflating it if that has not happened yet. */
export const romBytes = resolveBytes;

/**
 * Inflate a whole map at once, for the moment an install actually needs bytes.
 *
 * This is the seam the lazy design turns on: everything upstream of it -- the library list, the
 * size columns, the budget, the name plan, the cheap dedup tiers -- runs on metadata and stays
 * synchronous. Only what the user selected is ever read, and only here.
 */
export async function materialize(files: Map<string, LibraryFile>): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of files) out.set(k, await romBytes(v));
  return out;
}

/** Synchronously available bytes, or null for an entry that has not been inflated. */
export function romBytesIfLoaded(v: LibraryFile): Uint8Array | null {
  return isLazy(v) ? null : v;
}

/**
 * How much of an archive's tail to read, smallest first.
 *
 * A one-entry archive's end-of-central-directory record and its directory come to roughly 100
 * bytes, so 4 KiB covers the shape this exists for with room to spare, and 375 of them cost
 * about 1.5 MiB rather than the 24 MiB a flat 64 KiB tail would. The second step covers the
 * worst-case 65535-byte archive comment; beyond that the archive says where its directory starts
 * (`CentralDirectoryOutOfRange`) and gets one exact read.
 */
const ZIP_TAIL_STEPS = [4_096, 66_000] as const;

/** The central directory of an archive, reading as little of it as possible. */
async function readZipDirectory(handle: FsFileHandle): Promise<ZipEntry[]> {
  const file = await handle.getFile();
  const size = file.size;

  for (let step = 0; step < ZIP_TAIL_STEPS.length; step++) {
    const want = ZIP_TAIL_STEPS[step];
    const from = Math.max(0, size - want);
    const tail = new Uint8Array(await file.slice(from).arrayBuffer());
    try {
      return zipList(tail, from);
    } catch (e) {
      if (e instanceof CentralDirectoryOutOfRange) {
        // The archive told us where to look. One exact read, still far less than the payload.
        const rest = new Uint8Array(await file.slice(e.centralDirectoryOffset).arrayBuffer());
        return zipList(rest, e.centralDirectoryOffset);
      }
      // No end-of-central-directory in this slice. If the slice was the whole file, that is the
      // verdict; otherwise it may simply be further back, so try a longer tail before deciding.
      const sawWholeFile = from === 0;
      const lastStep = step === ZIP_TAIL_STEPS.length - 1;
      if (sawWholeFile || lastStep) throw e;
    }
  }
  // Unreachable: the loop either returns or throws on its last step.
  throw new Error("not a zip (no end-of-central-directory)");
}

/**
 * ZIPPED ROMS: one archive, one ROM, and the INNER name is the identity.
 *
 * The owner's library is 375 archives that each hold exactly one `.gb`, and the archive name is
 * not the ROM name -- `Aladdin.zip` holds `Disney's Aladdin (USA) (SGB Enhanced).gb`. The inner
 * name is the No-Intro one, which is what cover art and cheat databases key on, so that is the
 * name the library takes. A zipped ROM then behaves exactly like a loose one of the same name:
 * same dedup, same collision refusal, same console classification, same size.
 *
 * WHICH ARCHIVES ARE ROMS is deliberately NOT asked here. A dedicated folder (`Gameboy/*.zip`,
 * his actual layout) is mapped onto its console AFTER the scan by `libraryScan.ts`'s
 * `applyPlacement`, so at this point there is no folder to classify against and a registry lookup
 * would have to guess. Unpacking to the inner name and letting the normal rules judge it is both
 * simpler and more accurate: an archive holding `notes.txt` yields `notes.txt`, which is dropped
 * exactly where a loose `notes.txt` is dropped. No fourth console table, per CLAUDE.md.
 */
export type ZipRomVerdict =
  | { ok: true; entry: ZipEntry; name: string }
  | { ok: false; reason: string };

/**
 * Decide what a zip archive contributes, from its central directory alone.
 *
 * Every refusal names what was found. The owner's library contains none of these cases, which
 * is exactly why they must fail loudly: an untested path that silently picks entry 0 would
 * install the wrong file with no way to notice.
 */
export function resolveZipRom(entries: readonly ZipEntry[]): ZipRomVerdict {
  const files = entries.filter((e) => !e.isDirectory);
  if (files.length === 0) return { ok: false, reason: "holds no files" };
  if (files.length > 1) {
    const names = files.slice(0, 3).map((f) => f.name).join(", ");
    return {
      ok: false,
      reason: `holds ${files.length} files (${names}${files.length > 3 ? ", …" : ""}); a ROM archive must hold exactly one`,
    };
  }
  const only = files[0];
  if (only.encrypted) return { ok: false, reason: `holds ${only.name}, which is encrypted` };
  if (only.method !== 0 && only.method !== 8) {
    return { ok: false, reason: `holds ${only.name}, compressed with method ${only.method} (only stored and deflate are supported)` };
  }
  // A single entry may still carry a directory component. The destination is `<system>/<name>`
  // either way, so the basename is the identity; an entry that is all path and no name is not a
  // file we can place.
  const base = only.name.slice(only.name.lastIndexOf("/") + 1);
  if (!base) return { ok: false, reason: `holds ${only.name}, which has no file name` };
  return { ok: true, entry: only, name: base };
}


/**
 * Reports the relative path of each file as it is read, so a long first scan can say what it is
 * currently processing. Runtime-derived text (a path), never UI copy.
 */
export type ScanProgressFn = (relativePath: string) => void;

/**
 * The homebrew directories to assume when a caller does not say.
 *
 * This is the PRE-MANIFEST layout -- `DEFAULT_INSTALL_PATHS.homebrew` (`roms/homebrew`) and its
 * roms-relative form, which is what a locally picked ROM folder has. It is spelled here rather
 * than imported because `engine/devicePaths.ts` resolves paths through `@gnw/fs-builders`, and
 * that barrel re-exports the littlefs WASM vendor, which imports node's `module`. Reaching for
 * it from this browser-only module breaks every suite that bundles the scan under
 * `platform: "neutral"` -- `sources/discoveryWire.svelte.ts:145-147` records the same hazard
 * about this same module ("its build broke the moment this module reached for it"), and a
 * dynamic import is no escape: esbuild bundles those too (`sources/biosState.svelte.ts:245`).
 *
 * A caller that HAS the manifest passes the resolved set instead -- see `device.svelte.ts`'s
 * `scanSdCardGames`, where the live `/homebrews` only ever appears.
 */
export const LEGACY_HOMEBREW_PREFIXES: readonly string[] = ["homebrew", "roms/homebrew"];

async function walk(
  dir: FsDirHandle,
  prefix: string,
  out: Map<string, LibraryFile>,
  onFile: ScanProgressFn | null,
  hbPrefixes: readonly string[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (isHidden(name)) continue; // .DS_Store, .git, … (the pipeline also drops .DS_Store)
    const rel = prefix ? `${prefix}/${name}` : name;
    // Which directories are homebrew is the CALLER's to say: on a real card it is the
    // manifest's `/homebrews`, and testing two literals here meant the whitelist below never
    // applied there, so every file in it was read whole into memory.
    const isInsideHomebrew = hbPrefixes.includes(prefix);

    if (handle.kind === "directory") {
      // Do not recurse into subdirectories inside homebrew
      await walk(handle, rel, out, onFile, hbPrefixes);
    } else {
      if (isInsideHomebrew || hbPrefixes.some((p) => rel.startsWith(`${p}/`))) {
        // Cover art (celeste.png, "Zelda 3.png", …) also lives directly in homebrew/ (see
        // GameDetailsPanel.svelte's applyPreview()/getCoverUrl() in RomManagementTab.svelte)
        // — it's neither a device file nor a source ROM, so the exact-name whitelist below
        // was silently dropping it from every scan, regardless of whether it was placed
        // manually or written here by our own UI. Without this, a homebrew cover could never
        // survive a rescan/reload no matter how it got there.
        // Device files and converter sources both come from the ACTIVE sources' manifests
        // (sources/homebrewTitles.svelte.ts), not from a hardcoded list. A source file is
        // matched by EXTENSION, not by name: a manifest identifies a user file by hash and
        // extension, never by whatever the user happened to call it. With no homebrew source
        // added, both sets are empty and only cover art survives the walk — which is correct,
        // since nothing can be built from those files anyway.
        const isCoverImage = /\.(png|jpe?g|img)$/i.test(name);
        const hbRoot = hbPrefixes.find((p) => rel === p || rel.startsWith(`${p}/`));
        const hbKey = hbRoot ? rel.slice(hbRoot.length + 1) : name;
        const isWhitelisted =
          isCoverImage || homebrew.deviceFiles.has(hbKey) || isHomebrewSourceFile(name) || !!homebrew.owning(hbKey);
        if (!isWhitelisted) continue;
      }
      if (/\.zip$/i.test(name)) {
        let verdict: ZipRomVerdict;
        try {
          verdict = resolveZipRom(await readZipDirectory(handle));
        } catch (e) {
          verdict = { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
        if (!verdict.ok) {
          dbg(`[scan] ${rel} skipped: ${verdict.reason}`);
          continue;
        }
        const innerRel = prefix ? `${prefix}/${verdict.name}` : verdict.name;
        // Two archives can hold the same ROM under different archive names, and a Map would
        // take the last one silently. First wins (directory order is stable) and the loser is
        // named, which is the same posture as the cross-folder duplicate rule in
        // `sources/libraryScan.ts`: never renamed around, never quietly dropped.
        if (out.has(innerRel)) {
          dbg(`[scan] ${rel} skipped: ${innerRel} already came from another archive`);
          continue;
        }
        // The size is the central directory's; the bytes are read if and when someone installs
        // this ROM. Nothing of the payload has been touched at this point.
        const entry = verdict.entry;
        out.set(
          innerRel,
          new LazyRom(
            entry.size,
            async () => zipExtractOne(new Uint8Array(await (await handle.getFile()).arrayBuffer()), entry),
            rel,
          ),
        );
        onFile?.(innerRel);
        continue;
      }

      // Keep regular files lazy as well. Scanning only needs their name and size; reading every
      // ROM into JS memory here made a large library consume gigabytes before the user selected
      // anything to install. The same LazyRom path already protects ZIP payloads.
      const file = await handle.getFile();
      // Test/node shims that already hold bytes in memory may opt in via eager: true.
      // Native File System Access handles and browser InputFileHandle shims remain lazy so
      // scanning only inspects metadata without reading files into the JS heap.
      if ((handle as FsFileHandle & { eager?: boolean }).eager === true) {
        out.set(rel, new Uint8Array(await file.arrayBuffer()));
        onFile?.(rel);
        continue;
      }
      out.set(
        rel,
        new LazyRom(
          file.size,
          async () => new Uint8Array(await (await handle.getFile()).arrayBuffer()),
          rel,
        ),
      );
      onFile?.(rel);
    }
  }
}

/** Build the per-system summary from a userRoms map (top segment = system). */
export function summarize(userRoms: Map<string, LibraryFile>): RomScanSummary {
  const bySystem = new Map<string, SystemSummary>();
  let totalBytes = 0;
  for (const [path, data] of userRoms) {
    const system = path.split("/")[0] || "(root)";
    const s = bySystem.get(system) ?? { system, files: 0, bytes: 0 };
    s.files += 1;
    s.bytes += data.length;
    bySystem.set(system, s);
    totalBytes += data.length;
  }
  return {
    systems: [...bySystem.values()].sort((a, b) => a.system.localeCompare(b.system)),
    totalFiles: userRoms.size,
    totalBytes,
  };
}

/** Recursively read a picked directory into a userRoms map + summary. */
/**
 * Count the files a scan WILL read, without reading any of them.
 *
 * The library's progress bar had folders as its denominator, so with one ROM folder it sat at
 * 0% while filenames streamed past and then jumped to 100%. Files are the honest unit, and the
 * count has to come from somewhere before the walk starts.
 *
 * Enumerating directory entries is cheap next to reading them: this opens nothing and calls
 * `getFile()` on nothing. It applies the SAME homebrew whitelist as `walk`, so the count it
 * returns is the number of files the scan will actually read, not the number on disk -- a
 * denominator the progress can reach exactly.
 */
export async function countRomDirectory(
  dir: FsDirHandle,
  hbPrefixes: readonly string[] = LEGACY_HOMEBREW_PREFIXES,
): Promise<number> {
  let n = 0;
  const walkCount = async (d: FsDirHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of d.entries()) {
      if (isHidden(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const isInsideHomebrew = hbPrefixes.includes(prefix);
      if (handle.kind === "directory") {
        await walkCount(handle as FsDirHandle, rel);
      } else {
        if (isInsideHomebrew || hbPrefixes.some((p) => rel.startsWith(`${p}/`))) {
          const isCoverImage = /\.(png|jpe?g|img)$/i.test(name);
          const hbRoot = hbPrefixes.find((p) => rel === p || rel.startsWith(`${p}/`));
          const hbKey = hbRoot ? rel.slice(hbRoot.length + 1) : name;
          if (!(isCoverImage || homebrew.deviceFiles.has(hbKey) || isHomebrewSourceFile(name) || !!homebrew.owning(hbKey))) continue;
        }
        n++;
      }
    }
  };
  await walkCount(dir, "");
  return n;
}

export async function scanRomDirectory(
  dir: FsDirHandle,
  onFile: ScanProgressFn | null = null,
  hbPrefixes: readonly string[] = LEGACY_HOMEBREW_PREFIXES,
): Promise<RomScanResult> {
  const raw = new Map<string, LibraryFile>();
  await walk(dir, "", raw, onFile, hbPrefixes);
  
  const userRoms = new Map<string, LibraryFile>();
  let hasRomsPrefix = false;
  for (const [key, val] of raw) {
    if (key.startsWith("roms/")) {
      hasRomsPrefix = true;
      userRoms.set(key.slice(5), val);
    } else {
      userRoms.set(key, val);
    }
  }

  const summary = summarize(userRoms);
  return { userRoms, summary, dir, hasRomsPrefix };
}

/** True when the native File System Access API is available (Chromium). */
export const nativeFolderPickerSupported = (): boolean =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

/** Folder picking is always supported — native FSAA in Chromium, <input webkitdirectory> fallback elsewhere. */
export const folderPickerSupported = (): boolean => true;

/** True when the dir handle supports write-back (getDirectoryHandle / getFileHandle / createWritable). */
export function dirSupportsWriteBack(dir: RomDirHandle | null | undefined): boolean {
  if (!dir) return false;
  // Native FSAA handles have getDirectoryHandle; our InputDirHandle shim does not.
  return typeof (dir as any).getDirectoryHandle === "function";
}

/**
 * Root detection now lives in `sources/coreRegistry.ts` as one pure rule (`isKnownConsoleDir`),
 * so a node suite can drive it. It used to consult ACTIVE cores only, which meant a ROM folder
 * holding just `gb/` and `gbc/` was refused here whenever tgb-dual was switched off — and the
 * folder was then never registered, so switching the core on afterwards had nothing to rescan.
 */

export async function getValidRoot(
  dir: FsDirHandle,
  reg: CoreRegistry = coreRegistry.current,
): Promise<FsDirHandle | null> {
  let hasConsoleDir = false;
  let hasHomebrewDir = false;
  let romsFolder: FsDirHandle | null = null;
  const hbDirs = [...new Set([...homebrewDirs(), "homebrews"])]

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      if (isKnownConsoleDir(name, reg)) {
        hasConsoleDir = true;
      } else if (name.toLowerCase() === "roms") {
        romsFolder = handle as FsDirHandle;
      } else if (hbDirs.some((d) => !d.includes("/") && d.toLowerCase() === name.toLowerCase())) {
        hasHomebrewDir = true;
      }
    }
  }

  // If we found actual console folders (nes, md, doom, …) at the root, it's valid.
  if (hasConsoleDir || hasHomebrewDir) return dir;

  // Otherwise, if there is a 'roms' folder, check inside it for console folders.
  if (romsFolder) {
    for await (const [name, handle] of romsFolder.entries()) {
      if (handle.kind === "directory" && (isKnownConsoleDir(name, reg) || hbDirs.some((d) => d.toLowerCase() === `roms/${name.toLowerCase()}`))) {
        return dir;
      }
    }
  }

  return null;
}

// ── <input webkitdirectory> fallback ─────────────────────────────────────────
// Builds an in-memory FsDirHandle tree from a FileList so the rest of the
// codebase can consume it identically to a native FSAA handle.

/** A read-only directory handle shim built from <input webkitdirectory> FileList. */
class InputDirHandle implements FsDirHandle {
  kind = "directory" as const;
  name: string;
  private children = new Map<string, InputDirHandle | InputFileHandle>();
  /**
   * Stable identity fingerprint, set by `buildTreeFromFileList` on the root handle.
   *
   * Firefox has no `FileSystemHandle.isSameEntry()` — every pick returns a new in-memory
   * object, so the default `nativeIsSameEntry` (which calls `a.isSameEntry(b)`) always
   * returns `false`. Without this, picking the same folder twice registers it as two separate
   * entries in `localFolders` and then walks it twice in `dedupeSources`, doubling memory use
   * and freezing the main thread.
   *
   * The fingerprint is a sorted list of "relPath|size" entries for every file in the original
   * FileList. Sorting removes any dependency on browser-specific enumeration order.
   * Two picks of the same folder on disk produce identical lists; a different folder or a
   * change to the contents produces a different one.
   *
   * Not `private`: `buildTreeFromFileList` (same module) sets it directly after construction.
   */
  _fingerprint: string | null = null;

  constructor(name: string) {
    this.name = name;
  }

  /** Insert a file at a relative path, creating intermediate directories. */
  insert(relPath: string, file: File): void {
    const parts = relPath.split("/");
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let cur: InputDirHandle = this;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let child = cur.children.get(seg);
      if (!child || child.kind !== "directory") {
        child = new InputDirHandle(seg);
        cur.children.set(seg, child);
      }
      cur = child as InputDirHandle;
    }
    const fileName = parts[parts.length - 1];
    cur.children.set(fileName, new InputFileHandle(fileName, file));
  }

  async *entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]> {
    for (const [name, handle] of this.children) {
      yield [name, handle];
    }
  }

  /**
   * Mirrors `FileSystemHandle.isSameEntry()` so that `nativeIsSameEntry` in
   * `sources/libraryScan.ts` can recognise two picks of the same folder as identical.
   *
   * Only meaningful when both handles carry a fingerprint (i.e. both are root handles
   * returned by `buildTreeFromFileList`). A sub-directory handle has no fingerprint and
   * will always return `false`, matching the native API's semantics for handles that are
   * not the SAME entry.
   */
  async isSameEntry(other: unknown): Promise<boolean> {
    if (!(other instanceof InputDirHandle)) return false;
    if (!this._fingerprint || !other._fingerprint) return false;
    return this._fingerprint === other._fingerprint;
  }
}

class InputFileHandle implements FsFileHandle {
  kind = "file" as const;
  name: string;
  private file: File;
  constructor(name: string, file: File) {
    this.name = name;
    this.file = file;
  }
  async getFile(): Promise<File> {
    return this.file;
  }
}

/**
 * Firefox/macOS keeps the last directory on the native file-input control. Keep one hidden
 * control per logical picker so the ROM and SD flows retain separate picker locations.
 */
const fallbackInputs = new Map<string, HTMLInputElement>();

/** Pick a folder via a hidden <input webkitdirectory> element. Returns null on cancel. */
function pickFolderViaInput(id: string): Promise<FileList | null> {
  return new Promise((resolve) => {
    let input = fallbackInputs.get(id);
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      // @ts-ignore — webkitdirectory is non-standard but widely supported
      input.webkitdirectory = true;
      input.multiple = true;
      input.id = id;
      input.name = id;
      input.style.display = "none";
      document.body.appendChild(input);
      fallbackInputs.set(id, input);
    }
    let resolved = false;
    const finish = (files: FileList | null) => {
      if (resolved) return;
      resolved = true;
      resolve(files);
    };

    // `change` is dispatched after Firefox finishes its directory-upload confirmation.
    // A focus-based timeout races that confirmation and can turn a successful pick into a
    // silent cancel. The input's `cancel` event is the browser-provided no-selection signal.
    input.onchange = () => finish(input.files);
    input.oncancel = () => finish(null);

    input.click();
  });
}

/**
 * Build an InputDirHandle tree from a webkitdirectory FileList.
 *
 * Exported for `test/fsnode.mjs`, not as API: it is the read-only implementation of the
 * directory seam that Firefox and Safari already ship, so it is the reference a node-backed
 * handle is compared against. Anything indexable with a `length` satisfies the parameter.
 */
export function buildTreeFromFileList(files: ArrayLike<File>): InputDirHandle {
  // webkitRelativePath gives us "folderName/sub/file.ext" — the first segment
  // is the folder the user picked.
  const root = new InputDirHandle("roms");
  let rootName = "";
  // Fingerprint entries: collected alongside the tree build so we do one loop, not two.
  // Each entry is "relPath|size" (using the FULL webkitRelativePath, which includes the
  // top-level folder name, so two folders with the same contents but different names produce
  // different fingerprints — even though both are read-only shims with no handle identity).
  const fpEntries: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relPath = (file as any).webkitRelativePath as string;
    if (!relPath) continue;

    // Strip the top-level folder name (the folder the user actually picked)
    const firstSlash = relPath.indexOf("/");
    if (firstSlash < 0) continue; // shouldn't happen with webkitdirectory
    if (!rootName) rootName = relPath.slice(0, firstSlash);
    const inner = relPath.slice(firstSlash + 1);
    if (!inner) continue;
    root.insert(inner, file);
    // Include the full path (before stripping the top-level folder) and the file's size so
    // that the same folder picked twice yields the same fingerprint and a different folder
    // (or a changed file) yields a different one.
    fpEntries.push(`${relPath}|${file.size}`);
  }
  // Use the actual folder name the user picked
  if (rootName) (root as any).name = rootName;
  // Assign the fingerprint: sort for stability (browser enumeration order is not guaranteed
  // to be consistent across picks) and join into one string.
  root._fingerprint = fpEntries.sort().join("\n");
  return root;
}

export async function pickFolder(id: string = "gnw-roms"): Promise<FsDirHandle | null> {
  if (nativeFolderPickerSupported()) {
    try {
      return await window.showDirectoryPicker!({ id, mode: "readwrite" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  }

  const files = await pickFolderViaInput(id);
  if (!files) return null;
  return buildTreeFromFileList(files);
}

/** Pick the SD card folder and store it on the device store — the SAME picker used by
 *  FolderGateModal.svelte (ROMs tab) and Wizard.svelte's SD-mode Install Retro-Go gate, so the
 *  user is never asked to pick it twice.
 *
 *  Outcomes, kept strictly apart (see sdFolderPick.svelte.ts, which holds the state machine):
 *  a CANCEL is a silent no-op (`pickFolder()` returns null for it); a genuine pick/scan failure
 *  is recorded on `sdFolderPick` and drawn on the gate row that raised the picker
 *  (ModalFolderSdUnreadable.dc.html). It used to be logged only, leaving the user with a button
 *  that visibly did nothing. */
export async function pickSdCardFolder(): Promise<void> {
  const { device } = await import("./device.svelte.js");
  const { runSdCardFolderPick } = await import("./sdFolderPick.svelte.js");
  await runSdCardFolderPick<FsDirHandle>({
    pick: () => pickFolder("gnw-sd-card"),
    adopt: async (handle) => {
      device.sdHandle = handle;
      // PICKING A CARD IS DECLARING THE TARGET, and this line is what makes that true.
      //
      // `targetMedia` is persisted and defaults to "flash", and until the SD card became a
      // SOURCE its only writer was the Landing page -- so every caller of this picker was
      // already in SD mode and this assignment is a no-op for them (FolderGateModal only
      // draws the SD row when `ensureFolders(sd)` was passed true, and the Wizard's gate is
      // its SD branch). The Sources pane's SD entry is the first caller that can run while
      // the app still thinks it is flashing, and without this the two notions of "SD" drift:
      //
      //  - the Library's dock keeps rendering the FLASH button, which carries the SAME
      //    `syncLibraryButton` label as the SD one, so "Sync Library" silently means "connect
      //    and flash the device" -- it calls ensureConnectGate() then boots the RAM stub,
      //    resetting a running Retro-Go, when the user asked to write files to a card;
      //  - `scanSdCardGames()` below early-returns on `targetMedia !== "sd"` and CLEARS
      //    `installedGames`, so the card is never read, and the next sync sees an empty
      //    baseline, calls itself a fresh target and rewrites the entire selection.
      //
      // Reversible from the Landing page, which is still the only other writer.
      device.targetMedia = "sd";
      await device.scanSdCardGames();
    },
    onError: (e) => {
      // `dbg()` alone: it reaches the Activity log, which a deployed build can show and a
      // bug report can carry. The console copy went only to devtools.
      dbg(`[sd] picking/scanning the SD card folder failed: ${e instanceof Error ? e.message : String(e)}`);
    },
  });
}

/**
 * Prompt for a folder and return its validated root handle. Returns null if cancelled.
 * Validates that the folder contains console subfolders, a 'roms/' folder, or homebrew.
 */
export async function pickRomFolder(id: string = "gnw-roms"): Promise<RomDirHandle | null> {
  const dir = await pickFolder(id);
  if (!dir) return null;

  const validRoot = await getValidRoot(dir);
  if (!validRoot) {
    throw new Error("Invalid folder selected. Please select your 'roms' folder containing console subfolders (e.g., nes, gbc, md).");
  }

  return validRoot;
}

/**
 * Prompt for a folder then scan it. Returns null if the user cancels the picker.
 * Uses the native File System Access API when available, otherwise falls back to
 * <input webkitdirectory>.
 */
export async function pickAndScanRomFolder(id: string = "gnw-roms"): Promise<RomScanResult | null> {
  const validRoot = await pickRomFolder(id);
  if (!validRoot) return null;

  return scanRomDirectory(validRoot);
}

/**
 * Save a file to the user's picked ROM directory. Falls back to a browser
 * download if the directory handle doesn't support write-back (Firefox fallback).
 */
export async function saveFileToDirOrDownload(
  dir: RomDirHandle | null | undefined,
  relativePath: string,
  data: Blob | Uint8Array,
): Promise<void> {
  // Try native FSAA write-back first
  if (dir && dirSupportsWriteBack(dir)) {
    const parts = relativePath.split("/");
    let currentDir: any = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileName = parts[parts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data instanceof Uint8Array ? new Blob([data as unknown as BlobPart]) : data);
    await writable.close();
    return;
  }

  // Fallback: trigger a browser download
  download(relativePath.split("/").pop() || "cover.png", data);
}

/** Delete a file at `relativePath` from `dir` via FSAA's removeEntry. No-op (not an error) if
 *  the file is already gone, or if `dir` doesn't support write-back (Firefox — nothing is
 *  actually persisted there to delete). */
/** Validate that every core file directly on the SD card (`cores/*.bin`) agrees with the given
 *  firmware version (and with each other, if no firmware version is known — e.g. validating a
 *  bare SD card with no connected/booted device to read a live firmware version from). Unlike
 *  the Flash/LittleFS path, plain `File` objects support `.slice()`, so this only ever reads
 *  the first `CORE_HEADER_PROBE_BYTES` of each core — cheap regardless of core count/size. */
export async function checkSdCoreVersions(
  dir: RomDirHandle | null | undefined,
  firmwareVersion: string | null,
): Promise<CoreVersionCheck> {
  const cores: Record<string, string | null> = {};
  if (dir) {
    for await (const [name, handle] of dir.entries()) {
      if (name !== "cores" || handle.kind !== "directory") continue;
      for await (const [coreName, coreHandle] of handle.entries()) {
        if (coreHandle.kind !== "file" || isHidden(coreName)) continue;
        const path = `cores/${coreName}`;
        try {
          const file = await coreHandle.getFile();
          const head = new Uint8Array(await file.slice(0, CORE_HEADER_PROBE_BYTES).arrayBuffer());
          cores[path] = parseCoreHeader(head)?.tag ?? null;
        } catch {
          cores[path] = null;
        }
      }
    }
  }
  return evaluateCoreVersions(firmwareVersion, cores);
}

/**
 * Read one file's text from a picked directory, or `""` when it is not there.
 *
 * Only used for a file the DEVICE also writes, where the existing contents are data we did not
 * author and must fold into rather than replace. Absent is not an error: the first star on a
 * fresh card has nothing to merge with.
 */
export async function readTextFromDir(
  dir: RomDirHandle | null | undefined,
  relativePath: string,
): Promise<string> {
  if (!dir) return "";
  const parts = relativePath.split("/");
  let currentDir: any = dir;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    const fh = await currentDir.getFileHandle(parts[parts.length - 1]);
    return await (await fh.getFile()).text();
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return "";
    throw e;
  }
}

export async function deleteFileFromDir(dir: RomDirHandle | null | undefined, relativePath: string): Promise<void> {
  if (!dir || !dirSupportsWriteBack(dir)) return;
  const parts = relativePath.split("/");
  let currentDir: any = dir;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    await currentDir.removeEntry(parts[parts.length - 1]);
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return;
    throw e;
  }
}

/** Remove empty parent directories below the card's top-level directory. */
export async function pruneEmptyParents(dir: RomDirHandle | null | undefined, relativePath: string): Promise<void> {
  if (!dir || !dirSupportsWriteBack(dir)) return;
  const parts = relativePath.split("/");
  // Keep the top-level directory (homebrews, roms, etc.) as part of the card layout.
  for (let depth = parts.length - 2; depth >= 1; depth--) {
    let parent: any = dir;
    try {
      for (let i = 0; i < depth; i++) parent = await parent.getDirectoryHandle(parts[i]);
      const candidate = await parent.getDirectoryHandle(parts[depth]);
      let empty = true;
      for await (const _ of candidate.entries()) { empty = false; break; }
      if (!empty) break;
      await parent.removeEntry(parts[depth]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") break;
      throw e;
    }
  }
}
