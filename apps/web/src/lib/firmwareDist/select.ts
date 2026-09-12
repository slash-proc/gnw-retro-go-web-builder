/**
 * Choosing one of a release's four builds — and refusing rather than guessing.
 *
 * Contract: `docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd, sections "Choosing a
 * build" and "Compatibility". The two axes are `storage` (`sd`/`flash`) and `bank` (`1`/`2`);
 * `findBuild()` in `parse.ts` does the lookup and returns `undefined` rather than guessing.
 * This module is the layer above it: it turns "no answer" into a NAMED outcome the UI can
 * branch on, and it adds the two checks the doc says an installer must make before it is
 * allowed to flash anything.
 *
 * Everything here is pure. No fetching, no zip, no superblock patching, no device access —
 * the caller supplies the device state (`dualBootBootloader`) and, when it has them, the
 * intflash image bytes. Deciding *whether* a bootloader is present is the device scan's job,
 * not this module's.
 *
 * There are no user-visible strings in here on purpose. A refusal is a typed value; the copy
 * that renders it is a separate (seven-locale) i18n change.
 */
import { parseFirmwareAbi, abiSatisfies, FIRMWARE_ABI_OFFSET } from "../engine/firmwareAbi.js";
import type { FirmwareAbi } from "../engine/firmwareAbi.js";
import { findBuild } from "./parse.js";
import type {
  FirmwareBank,
  FirmwareBuild,
  FirmwareManifest,
  FirmwareStorage,
  FirmwareVersionEntry,
  ProvidesAbi,
} from "./types.js";

/**
 * Why a build could not be chosen. Each value is a distinct, inspectable outcome — the point
 * of the exercise: a caller switches on `reason`, and every variant carries the specific
 * evidence needed to explain itself without re-deriving anything.
 *
 *   - `storage-unavailable`    the device's detected storage matches no published build
 *   - `bank-unavailable`       that storage is published, but not for the requested bank
 *   - `bank1-dual-boot`        bank 1 asked for on a device that already has the dual-boot
 *                              bootloader. `boot_bank2()` spins forever when bank 2 holds no
 *                              valid reset vector (`external/firmware_update/Core/Src/
 *                              firmware_update.c:97-114`), so a bank-1-only install under
 *                              that bootloader can leave a device that does not boot
 *   - `abi-offset-unsupported` the manifest puts the ABI struct somewhere this build of the
 *                              tool cannot read (we only know `0x400`)
 *   - `abi-mismatch`           the image's own ABI words disagree with (or are absent from)
 *                              what the manifest advertises. The manifest is advisory; the
 *                              image is the truth, so a disagreement means the release is
 *                              misdescribed and nothing downstream may be trusted
 */
export type BuildRefusalReason =
  | "storage-unavailable"
  | "bank-unavailable"
  | "bank1-dual-boot"
  | "abi-offset-unsupported"
  | "abi-mismatch";

interface RefusalBase {
  ok: false;
  reason: BuildRefusalReason;
  /** What was asked for, echoed back so a caller need not keep it. */
  requested: { storage: FirmwareStorage; bank: FirmwareBank };
}

export interface StorageUnavailableRefusal extends RefusalBase {
  reason: "storage-unavailable";
  /** Storages this release does publish, sorted and deduped. */
  availableStorage: FirmwareStorage[];
}

export interface BankUnavailableRefusal extends RefusalBase {
  reason: "bank-unavailable";
  /** Banks published for the requested storage, ascending. */
  availableBanks: FirmwareBank[];
}

export interface Bank1DualBootRefusal extends RefusalBase {
  reason: "bank1-dual-boot";
  /** The build that WOULD have been installed, so a caller can name it. */
  build: FirmwareBuild;
  /** The safe alternative, when the release publishes one. */
  bank2Build: FirmwareBuild | undefined;
}

export interface AbiOffsetRefusal extends RefusalBase {
  reason: "abi-offset-unsupported";
  build: FirmwareBuild;
  /** As published, e.g. `"0x800"`. */
  manifestOffset: string;
  /** The only offset this tool can read. */
  supportedOffset: number;
}

export interface AbiMismatchRefusal extends RefusalBase {
  reason: "abi-mismatch";
  build: FirmwareBuild;
  /** What the manifest claims. Advisory. */
  manifestAbi: ProvidesAbi;
  /** What the image actually says — `null` when the bytes are not a believable ABI header. */
  imageAbi: FirmwareAbi | null;
}

export type BuildRefusal =
  | StorageUnavailableRefusal
  | BankUnavailableRefusal
  | Bank1DualBootRefusal
  | AbiOffsetRefusal
  | AbiMismatchRefusal;

export interface BuildChoice {
  ok: true;
  build: FirmwareBuild;
  /**
   * The ABI to compare cores against. When `abiVerified` is true this came out of the image
   * bytes; otherwise it is the manifest's advisory copy and no image was supplied to check
   * it. A caller that flashes without ever verifying is choosing to trust the manifest — the
   * doc records a real shipped release where that would have been wrong.
   */
  abi: ProvidesAbi;
  abiVerified: boolean;
}

export type BuildSelection = BuildChoice | BuildRefusal;

/** What the caller knows about the device it is about to write to. */
export interface DeviceBuildContext {
  storage: FirmwareStorage;
  bank: FirmwareBank;
  /**
   * Does bank 1 already hold the dual-boot bootloader (`external/firmware_update`)? Supplied
   * by the caller — this module never probes a device. `false` when unknown is a deliberate
   * caller decision, not a default this module makes for it.
   */
  dualBootBootloader: boolean;
  /**
   * The intflash image bytes for the build being considered, starting at offset 0 of the
   * image (equivalently, at the bank base). Optional only because it lives inside the bundle
   * zip, which is fetched later; supply it as soon as it exists.
   */
  image?: Uint8Array;
}

const banksFor = (manifest: FirmwareManifest, storage: FirmwareStorage): FirmwareBank[] =>
  [...new Set(manifest.builds.filter((b) => b.storage === storage).map((b) => b.bank))].sort(
    (a, b) => a - b,
  );

/** Storages this release publishes at least one build for. */
export function availableStorage(manifest: FirmwareManifest): FirmwareStorage[] {
  return [...new Set(manifest.builds.map((b) => b.storage))].sort();
}

/**
 * Read the image's own ABI words and compare them with the manifest.
 *
 * Reuses `engine/firmwareAbi.ts` wholesale rather than re-decoding the two little-endian
 * `uint32` here: it already implements the doc's `abiOffset` (`0x400`) plus the plausibility
 * checks that stop an arbitrary pair of words in stock OFW or erased flash from being
 * reported as an ABI. There is exactly one ABI parser in this codebase.
 */
export function verifyImageAbi(
  manifest: FirmwareManifest,
  image: Uint8Array,
): { agrees: boolean; imageAbi: FirmwareAbi | null } {
  const imageAbi = parseFirmwareAbi(image);
  const claimed = manifest.firmware.providesAbi;
  const agrees =
    imageAbi !== null && imageAbi.version === claimed.version && imageAbi.size === claimed.size;
  return { agrees, imageAbi };
}

/**
 * Pick the build for `ctx`, or say precisely why not.
 *
 * The order of the checks is the doc's: the build must exist, the install must be safe, and
 * only then may its advertised ABI be believed.
 */
export function selectBuild(manifest: FirmwareManifest, ctx: DeviceBuildContext): BuildSelection {
  const requested = { storage: ctx.storage, bank: ctx.bank };

  const build = findBuild(manifest, ctx.storage, ctx.bank);
  if (!build) {
    const banks = banksFor(manifest, ctx.storage);
    if (banks.length === 0) {
      return { ok: false, reason: "storage-unavailable", requested, availableStorage: availableStorage(manifest) };
    }
    return { ok: false, reason: "bank-unavailable", requested, availableBanks: banks };
  }

  if (ctx.bank === 1 && ctx.dualBootBootloader) {
    return {
      ok: false,
      reason: "bank1-dual-boot",
      requested,
      build,
      bank2Build: findBuild(manifest, ctx.storage, 2),
    };
  }

  if (ctx.image) {
    if (manifest.firmware.abiOffsetBytes !== FIRMWARE_ABI_OFFSET) {
      return {
        ok: false,
        reason: "abi-offset-unsupported",
        requested,
        build,
        manifestOffset: manifest.firmware.abiOffset,
        supportedOffset: FIRMWARE_ABI_OFFSET,
      };
    }
    const { agrees, imageAbi } = verifyImageAbi(manifest, ctx.image);
    if (!agrees) {
      return {
        ok: false,
        reason: "abi-mismatch",
        requested,
        build,
        manifestAbi: manifest.firmware.providesAbi,
        imageAbi,
      };
    }
    return { ok: true, build, abi: imageAbi as FirmwareAbi, abiVerified: true };
  }

  return { ok: true, build, abi: manifest.firmware.providesAbi, abiVerified: false };
}

// --- compatibility ------------------------------------------------------------------------

/** What a core/homebrew overlay declares it needs, per the GWRG spec's `requiresAbi`. */
export interface CoreRequirement {
  /** `required_abi_version` — an EXACT match, not a floor. */
  abiVersion: number;
  /** `required_abi_min_size` — a floor: the struct is append-only within a version. */
  abiMinSize: number;
  /** `GNW_CORE_META_VERSION` the container was built for, when the caller knows it. */
  metaVersion?: number;
}

/** The parts of the rule, so a UI can say WHICH half failed rather than just "incompatible". */
export interface CoreCompatibility {
  /** The doc's rule: version equal AND size sufficient. Ignores `metaVersion`. */
  loads: boolean;
  abiVersionMatches: boolean;
  abiSizeSufficient: boolean;
  /**
   * `undefined` when the caller did not supply a `metaVersion`. False is a real warning: the
   * firmware cannot read that container format.
   */
  metaVersionMatches: boolean | undefined;
}

/**
 * `required_abi_version == providesAbi.version && required_abi_min_size <= providesAbi.size`
 * (doc, "Compatibility").
 *
 * NOTE the version half is EQUALITY here, where `engine/firmwareAbi.ts`'s `abiSatisfies()`
 * accepts a newer firmware (`>=`). Both are correct for their own contract — `gw_firmware_abi.h`
 * promises append-only growth WITHIN a version, and this format's rule is the stricter of the
 * two. `abiSatisfies()` still supplies the size floor (and the version floor that equality
 * implies), so there is one implementation of "the table is at least this big".
 */
export function coreCompatibility(
  provides: ProvidesAbi,
  coreMetaVersion: number,
  req: CoreRequirement,
): CoreCompatibility {
  const abiVersionMatches = provides.version === req.abiVersion;
  const abiSizeSufficient = abiSatisfies(
    { version: provides.version, size: provides.size },
    { version: req.abiVersion, minSize: req.abiMinSize },
  );
  return {
    loads: abiVersionMatches && abiSizeSufficient,
    abiVersionMatches,
    abiSizeSufficient,
    metaVersionMatches: req.metaVersion === undefined ? undefined : req.metaVersion === coreMetaVersion,
  };
}

/** Shorthand for the boolean alone. */
export function coreLoads(
  provides: ProvidesAbi,
  coreMetaVersion: number,
  req: CoreRequirement,
): boolean {
  return coreCompatibility(provides, coreMetaVersion, req).loads;
}

/**
 * The same answer from a `versions.json` entry ALONE — no manifest fetched.
 *
 * `providesAbi` and `coreMetaVersion` are duplicated into `versions.json` for exactly this:
 * a picker warns that an upgrade would stop a user's installed cores loading BEFORE it
 * downloads that version's manifest. The two files must agree, and the manifest wins — so
 * this is a pre-check to warn with, never the check an installer flashes on.
 */
export function coreCompatibilityPrecheck(
  entry: FirmwareVersionEntry,
  req: CoreRequirement,
): CoreCompatibility {
  return coreCompatibility(entry.providesAbi, entry.coreMetaVersion, req);
}

/** The authoritative version of the pre-check, once the manifest is in hand. */
export function coreCompatibilityFromManifest(
  manifest: FirmwareManifest,
  req: CoreRequirement,
): CoreCompatibility {
  return coreCompatibility(
    manifest.firmware.providesAbi,
    manifest.firmware.coreMetaVersion,
    req,
  );
}
