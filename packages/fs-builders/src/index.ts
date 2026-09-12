/**
 * L-FS — Client-side filesystem builders.
 *
 * Ports the ROM→image transforms currently done in Python.
 *  - SD-card mode: mostly file layout (staging /roms/<system>, core selection).
 *  - Flash mode: the real work — FrogFS image + LittleFS image + per-ROM LZMA.
 *
 * See PLAN.md §"L-FS".
 *
 * **This package is real; only the façade at the bottom of this file is not.** The re-exports
 * below are the working implementations: FrogFS builder and parser, LittleFS builder and
 * in-place writer, staging transforms, ROM LZMA, the `flashImage` orchestrator and
 * `installPaths`: roughly 2,500 lines, each with its own byte-exact oracle test in `test/`.
 *
 * The three `notImplemented` functions at the end (`buildSdLayout`, `buildFlashImages` and the
 * `buildFilesystem` that dispatches to them) are an unfinished alternative front door. **Both
 * modes are stubbed there, not just SD**, and a shorthand saying otherwise has misled before.
 * Nothing calls them: `apps/web` composes the real exports directly through
 * `engine/flashInstall.ts`. Grep `notImplemented` to find every stub in `packages/`.
 */

export {
  LittleFsImage,
  LittleFsError,
  readFileFromImage,
  listDirFromImage,
  readLittleFsTree,
  readLittleFsDir,
  readLittleFsFileLazy,
  writeIntoLittleFs,
  type LittlefsModuleOpts,
  type LittlefsDirEntry,
  type LittlefsTreeNode,
  type LittlefsDirtyBlock,
  type LittlefsWriteResult,
} from "./littlefs.js";

export { FrogFsImage, FrogFsError } from "./frogfs.js";

export {
  parseFrogfs,
  parseFrogfsHead,
  hashtableOffset,
  headersStart,
  FrogFsParseError,
  type FrogfsHead,
  type FrogfsFile,
} from "./frogfsParse.js";

export {
  relocateMappedInFrogfs,
  relocateWords,
  MappedRelocError,
  EXTFLASH_BASE,
  type MappedSpec,
  type MappedResult,
} from "./mappedReloc.js";

export {
  byteswap16,
  isMdRom,
  isPico8Cartridge,
  isDsStore,
  shouldSkipRomsFile,
  stageFrogfsTree,
  buildFrogfsImage,
  type StagedFile,
} from "./staging.js";

export {
  modeForPath,
  compressPayloadLzma,
  packStagedRoms,
  type LzmaRaw,
  type PackResult,
} from "./romLzma.js";

export {
  resolveInstallPaths,
  DEFAULT_INSTALL_PATHS,
  InstallPathError,
  under,
  type InstallPaths,
} from "./installPaths.js";

export {
  userDest,
  planFlashImage,
  planFlashLayout,
  buildFrogfsFromPlan,
  buildCoresLittlefs,
  reverseLfsBlocks,
  assembleFlashImages,
  LITTLEFS_FLOOR,
  SAVES_HEADROOM,
  DEFAULT_BLOCK_SIZE,
  type FlashImageInputs,
  type FlashAssemblyPlan,
  type LittlefsGeometry,
  type FlashImages,
  type FlashLayoutInputs,
  type FlashLayout,
} from "./flashImage.js";

export type InstallMode = "sd" | "flash";

export type ProgressFn = (done: number, total: number) => void;

export interface RomFile {
  name: string;
  system: string; // e.g. "nes", "gb", "md"
  data: Uint8Array;
}

/** Opaque build descriptor produced by builder-core.resolveBuild. */
export interface BuildDescriptor {
  variantKey: string;
  [k: string]: unknown;
}

export interface SdFilePlan {
  mode: "sd";
  files: { path: string; data: Uint8Array }[];
}

export interface FlashImagePlan {
  mode: "flash";
  frogfs: Uint8Array;
  littlefs: Uint8Array;
}

export type FilesystemPlan = SdFilePlan | FlashImagePlan;

const notImplemented = (what: string): never => {
  throw new Error(`[fs-builders] ${what} not implemented yet (scaffold stub)`);
};

/** SD-card mode: stage files + select cores. Port of sd_cores_pack.py et al. */
export async function buildSdLayout(
  _roms: RomFile[],
  _descriptor: BuildDescriptor,
  _onProgress?: ProgressFn,
): Promise<SdFilePlan> {
  return notImplemented("buildSdLayout");
}

/** Flash mode: build FrogFS + LittleFS images with per-ROM LZMA. */
export async function buildFlashImages(
  _roms: RomFile[],
  _descriptor: BuildDescriptor,
  _onProgress?: ProgressFn,
): Promise<FlashImagePlan> {
  return notImplemented("buildFlashImages");
}

export async function buildFilesystem(
  mode: InstallMode,
  roms: RomFile[],
  descriptor: BuildDescriptor,
  onProgress?: ProgressFn,
): Promise<FilesystemPlan> {
  return mode === "sd"
    ? buildSdLayout(roms, descriptor, onProgress)
    : buildFlashImages(roms, descriptor, onProgress);
}
