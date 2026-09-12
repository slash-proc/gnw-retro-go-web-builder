/**
 * BIOS discovery and status (gwrg-dist-spec spec/07-cores.md, "BIOS").
 *
 * A core declares, per launcher tab, exactly which non-game files the user must
 * supply: `systems[].bios[]` with a filename (or a list of accepted names), a hash, a size,
 * `strict`, and localised copy. Until now the app parsed all of that and consumed none of it,
 * so a user found out a BIOS was missing when a game failed to boot — and on ColecoVision it
 * does not even fail loudly (spec/07: the core allocates 8 KiB and calls
 * `odroid_sdcard_read_file` ignoring the return value, so a missing file boots into
 * uninitialised heap).
 *
 * This module answers three questions:
 *
 *   1. WHICH BIOS files do the active sources ask for, and how hard? — `collectBiosNeeds`
 *   2. Is each one PRESENT, and does it match what was published? — `resolveBiosStatus`
 *   3. WHERE on the device does each file go? — `biosDestKey`, from the declared `biosDir`.
 *
 * ## Placement is declared, not derived
 *
 * Verified against `references/game-and-watch-retro-go-sd`:
 *
 *   - `RG_BASE_PATH_BIOS` (`Core/Inc/retro-go/rg_storage.h:10`) is defined and has ZERO call
 *     sites. Nothing composes a BIOS path from it.
 *   - Every core opens a hardcoded string literal instead, and the subdirectory is the CORE's
 *     name, not the system's ROM `dirname`. ColecoVision settles it: it registers as
 *     `add_emulator("Colecovision", "col", …)` (`Core/Src/retro-go/rg_emulators.c:1351`) so
 *     its ROMs live in `roms/col/`, but its BIOS is read from `/bios/coleco/coleco.bin`
 *     (`Core/Src/porting/smsplusgx/main_smsplusgx.c:127`).
 *   - Out-of-tree cores (the gpSP GBA core, blueMSX) are not in this reference tree at all,
 *     so the host could not know their literals even if it wanted to hardcode a table.
 *
 * So the directory cannot be derived, and the spec now declares it: `systems[].biosDir` names
 * the directory under `/bios`, and is OMITTED when it equals the system's `id` — which is the
 * common case (`nes`, `msx`, `gba`, …). `biosDestKey` at the foot of this file resolves
 * `biosDir ?? id` and never consults a table. See `docs/proposals/bios-placement.md`.
 */
import { isPlainFilename } from "./converterRun.js";
import { checkBiosFile } from "./inputGate.js";
import type { BiosEntry, Manifest, SystemEntry } from "./types.js";
import { isCoreKind } from "./types.js";

/**
 * How hard a BIOS is needed, once the user's actual content is taken into account.
 *
 * `requiredFor` is why this is three states and not a boolean: `disksys.rom` is mandatory for
 * `.fds` images and irrelevant to the `.nes` cartridges sitting in the same system folder
 * (spec/07, "Required by extension"). Reporting it as a blanket requirement would over-state
 * it for everyone who only has cartridges.
 */
import { resolveBytes, type MaybeLazy } from "../lazyBytes.js";
export type BiosNeed =
  /** `required: true` — the system does not work without it. */
  | "required"
  /** `requiredFor` matched one of the user's games — required, for those games. */
  | "conditional-hit"
  /** `requiredFor` matched nothing the user has — not needed right now. */
  | "conditional-idle"
  /** `required: false` — the core runs without it. */
  | "optional";

/** One BIOS slot a source asks for, with everything needed to render and check it. */
export interface BiosNeedEntry {
  /** `owner/repo` of the source that declared it. Untrusted text, display only. */
  repo: string;
  /** The source's title, as the manifest gives it. Untrusted text. */
  sourceTitle: string;
  systemId: string;
  /** `longName` — deliberately not localised (spec/07: region, not language). */
  systemName: string;
  /**
   * Directory under `/bios` this slot's files go in: the system's `biosDir`, or its `id` when
   * that field is omitted. Resolved here so `biosDestKey` never needs a lookup of its own.
   */
  biosDir: string;
  /** Stable within a source+system. */
  id: string;
  /** Accepted filenames, in declaration order; the first is the canonical one. */
  filenames: string[];
  need: BiosNeed;
  /** For a conditional entry: the extensions that trigger it, lowercased with the dot. */
  requiredFor?: string[];
  /** The declared entry, for hash/size/strict/label/description. */
  entry: BiosEntry;
}

/** Unique key for a slot across every source. */
export const biosKey = (n: { repo: string; systemId: string; id: string }): string =>
  `${n.repo}/${n.systemId}/${n.id}`;

const filenamesOf = (e: BiosEntry): string[] =>
  (Array.isArray(e.filename) ? e.filename : [e.filename]).filter((f) => typeof f === "string" && f !== "");

/** Lowercased extension INCLUDING the dot, or "" when the name has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** A game the user has, from either side (folder or device). Only these two fields matter. */
export interface GameRef {
  /** `roms/<system>` folder key. */
  system: string;
  /** File name with extension. */
  name: string;
}

/**
 * The Game & Watch target of a manifest, or undefined. Mirrors `store.svelte.ts`'s `toCard`:
 * prefer the `game-and-watch` platform, fall back to the first target rather than treating a
 * multi-platform manifest as an error.
 */
function gnwTarget(m: Manifest) {
  return m.targets.find((t) => t.platform === "game-and-watch") ?? m.targets[0];
}

/** One active source, as the caller has it. `manifest` is the in-memory (fresh) copy. */
export interface BiosSourceRef {
  repo: string;
  manifest: Manifest;
}

/**
 * Collect every BIOS slot the active core sources ask for, resolving `requiredFor`
 * against the games the user actually has.
 *
 * `games` is the union of the folder scan and the device's installed list — a BIOS needed by
 * a game already on the device is needed whether or not that game is in the folder today.
 *
 * A slot with neither `required` nor `requiredFor` is malformed per spec/07 ("exactly one of
 * `required` and `requiredFor` — never both, never neither"). We do not refuse the whole
 * source over it: an unusable manifest field is reported as `optional`, which understates
 * rather than invents a requirement.
 */
export function collectBiosNeeds(sources: BiosSourceRef[], games: GameRef[]): BiosNeedEntry[] {
  const extsBySystem = new Map<string, Set<string>>();
  for (const g of games) {
    let set = extsBySystem.get(g.system);
    if (!set) extsBySystem.set(g.system, (set = new Set()));
    set.add(extensionOf(g.name));
  }

  const out: BiosNeedEntry[] = [];
  for (const src of sources) {
    const target = gnwTarget(src.manifest);
    if (!target || !isCoreKind(target.kind)) continue;
    for (const system of target.systems ?? []) {
      for (const entry of system.bios ?? []) {
        const need = needOf(entry, system, extsBySystem.get(system.id));
        out.push({
          repo: src.repo,
          sourceTitle: src.manifest.title,
          systemId: system.id,
          systemName: system.longName,
          biosDir: system.biosDir ?? system.id,
          id: entry.id,
          filenames: filenamesOf(entry),
          need,
          ...(entry.requiredFor
            ? { requiredFor: entry.requiredFor.map((e) => e.toLowerCase()) }
            : {}),
          entry,
        });
      }
    }
  }
  return out;
}

function needOf(entry: BiosEntry, _system: SystemEntry, present: Set<string> | undefined): BiosNeed {
  if (entry.required === true) return "required";
  if (entry.requiredFor && entry.requiredFor.length > 0) {
    const wanted = entry.requiredFor.map((e) => e.toLowerCase());
    const hit = present ? wanted.some((e) => present.has(e)) : false;
    return hit ? "conditional-hit" : "conditional-idle";
  }
  return "optional";
}

// --- Status ------------------------------------------------------------------------------

/** Where a candidate file for a slot was found. */
export type BiosWhere = "device" | "folder";

/**
 * A file that might fill a slot. The caller supplies these from the two places a BIOS can
 * already be: the device's FrogFS image, and the user's selected folder.
 *
 * `path` is the full key as that side spells it (`bios/msx/MSX.rom`, `bios/coleco/coleco.bin`)
 * and is used for display and for nothing else — we deliberately do not derive a target
 * directory from it (see the module header).
 */
export interface BiosCandidate {
  where: BiosWhere;
  path: string;
  /** Present for the folder side; absent for a device listing, which is metadata-only. */
  bytes?: MaybeLazy;
  /** Size in bytes, known for both sides. */
  size: number;
}

export type BiosVerified =
  /** Bytes hashed and matched the declared `sha1` (and `bytes`, when declared). */
  | "ok"
  /** Bytes hashed and disagreed. */
  | "mismatch"
  /** Nothing declared to check against, or no bytes available to hash (device side). */
  | "unchecked";

export interface BiosStatus extends BiosNeedEntry {
  key: string;
  /** Every place this slot's filename was found. Empty ⇒ missing. */
  found: BiosCandidate[];
  present: boolean;
  verified: BiosVerified;
  /** The candidate that was hashed, when one was. */
  checkedPath?: string;
  /** The hash we computed, when we computed one. Lowercase hex. */
  sha1?: string;
  /**
   * `strict` and the hash disagreed: the file must NOT be installed (spec/07, "The host checks
   * the hash"). A non-strict mismatch is accepted and merely reported.
   */
  blocked: boolean;
}

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/**
 * Match candidates to slots by FILENAME, case-insensitively.
 *
 * Case-insensitively because the declared names are mixed-case (`MSX2PEXT.rom`,
 * `gba_bios.bin`) and a user's copy routinely is not; the device's own filesystem is
 * case-sensitive, but that is an install-time concern, and telling a user "missing" about a
 * file that is plainly sitting in their folder would be a worse answer than telling them the
 * truth about which file it is.
 *
 * Nothing here looks at the DIRECTORY a candidate sits in. That is not an oversight: the
 * correct directory is not knowable from the manifest (module header), so matching on it
 * would be matching on a guess.
 */
export function matchCandidates(need: BiosNeedEntry, pool: BiosCandidate[]): BiosCandidate[] {
  const wanted = new Set(need.filenames.map((f) => f.toLowerCase()));
  return pool.filter((c) => wanted.has(basename(c.path).toLowerCase()));
}

/**
 * Resolve presence + verification for every slot.
 *
 * Verification reuses `inputGate.ts`'s `checkBiosFile` unchanged — it already implements
 * exactly this rule (size first, then `sha1`, `strict` decides whether a mismatch is a
 * refusal) and it was written for this case. The one thing it does not decide is
 * `requiredFor`, which "is knowledge the install path has and this does not"; that is
 * `collectBiosNeeds`'s job above, so the two compose without either growing.
 *
 * Only the FOLDER side is hashed. The device side is a FrogFS metadata listing with no bytes,
 * and re-reading a BIOS off the device over SWD to hash it would be a real transfer for a
 * file the user cannot act on anyway. Those come back `unchecked`, which is what they are.
 */
export async function resolveBiosStatus(
  needs: BiosNeedEntry[],
  pool: BiosCandidate[],
): Promise<BiosStatus[]> {
  const out: BiosStatus[] = [];
  for (const need of needs) {
    const found = matchCandidates(need, pool);
    const hashable = found.find((c) => c.bytes !== undefined);

    let verified: BiosVerified = "unchecked";
    let blocked = false;
    let sha1: string | undefined;
    let checkedPath: string | undefined;

    if (hashable) {
      checkedPath = hashable.path;
      const r = await checkBiosFile(need.entry, await resolveBytes(hashable.bytes!), basename(hashable.path));
      sha1 = r.sha1 || undefined;
      // "unchecked" is the honest answer when nothing DISAGREED and nothing was checkable.
      // `checkBiosFile` returns `recognised: false` both for "the hash was wrong" and for "no
      // hash was published", so the entry — not the verdict — decides which of those it was.
      // A `bytes`-only entry whose size matched is unchecked, not a mismatch.
      if (r.recognised) verified = "ok";
      else if (need.entry.sha1 !== undefined || r.error !== undefined) verified = "mismatch";
      blocked = r.error !== undefined;
    }

    out.push({
      ...need,
      key: biosKey(need),
      found,
      present: found.length > 0,
      verified,
      blocked,
      ...(sha1 ? { sha1 } : {}),
      ...(checkedPath ? { checkedPath } : {}),
    });
  }
  return out;
}

/** Slots the user must act on: needed now, and either absent or refused by `strict`. */
export const outstanding = (all: BiosStatus[]): BiosStatus[] =>
  all.filter(
    (s) => (s.need === "required" || s.need === "conditional-hit") && (!s.present || s.blocked),
  );

/** Sort for display: what is wrong first, then by system, then by declaration order. */
export function sortForDisplay(all: BiosStatus[]): BiosStatus[] {
  const rank = (s: BiosStatus): number => {
    if (s.blocked) return 0;
    if (!s.present && (s.need === "required" || s.need === "conditional-hit")) return 1;
    if (s.verified === "mismatch") return 2;
    if (!s.present) return 4;
    return 3;
  };
  return [...all].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.systemName.localeCompare(b.systemName) ||
      a.key.localeCompare(b.key),
  );
}

// --- Placement ----------------------------------------------------------------------------

/**
 * Where a user-supplied file for this slot is stored, as a folder-scan key.
 *
 * `bios/…` keys pass through `flashImage.ts`'s `userDest` unchanged and are copied verbatim by
 * the SD path (`RomManagementTab`'s `sdPathFor`), so the same key serves both media — which is
 * what the firmware expects (`syscalls.c:441-448` routes top-level `bios` to FrogFS on flash
 * and to FatFs on a card; one declared path, two media).
 *
 * The LEAF NAME is the manifest's, not the user's, whenever the two differ only by case: the
 * cores open exact literals (`MSX2PEXT.rom`) on a case-sensitive filesystem, so a user's
 * `msx2pext.rom` must be written under the declared spelling or it will not be found.
 *
 * `biosDir` is checked again here even though `client.ts` validated it at the parse boundary:
 * both checks are cheap, and a hostile value must never escape `/bios`. A rejected or empty
 * directory falls back to the `/bios` root, which is a real firmware location
 * (`rg_logos.c:49` opens `/bios/logo.bin`) rather than a guess.
 */
export function biosDestKey(need: Pick<BiosNeedEntry, "biosDir" | "filenames">, filename: string): string {
  const offered = basename(filename).replace(/^\.+/, "");
  const canonical = need.filenames.find((f) => f.toLowerCase() === offered.toLowerCase()) ?? offered;
  const dir = isPlainFilename(need.biosDir) ? need.biosDir : undefined;
  return dir ? `bios/${dir}/${canonical}` : `bios/${canonical}`;
}

// --- Install policy (SD vs Flash) ----------------------------------------------------------

/** Which medium an install is writing to. Mirrors `device.targetMedia`. */
export type BiosMedium = "flash" | "sd";

/**
 * Whether a declared slot's file should be WRITTEN, for one medium. Presence/status is a
 * separate question — this only decides what an install packs.
 *
 * The two media differ on purpose:
 *
 *   - **SD**: an active core source gets its BIOS whether or not the user has games for it
 *     today. A card is open — ROMs land on it outside this app — and a BIOS that is not there
 *     means those games silently do not boot (ColecoVision does not even fail loudly; see the
 *     module header). Space on a card is not the scarce resource.
 *   - **Flash**: the content set is closed (nothing reaches the FrogFS image except through an
 *     install) and the gap between the image and LittleFS is the scarce resource, so a BIOS for
 *     a system with no games is dead weight and is left out.
 *
 * The Flash rule is the general form of the one `packages/fs-builders/src/flashImage.ts`
 * already applies to `bios/msx` ("omit when no MSX games present"): same predicate, driven by
 * what the sources declare instead of a single hardcoded system. The two agree, so the builder's
 * own omission stays a no-op rather than a second, conflicting opinion.
 *
 * `conditional-idle` is excluded on Flash even when the system does have games: `disksys.rom`
 * is dead weight for a folder of `.nes` cartridges, which is exactly what `requiredFor` says.
 */
export function installsBios(need: BiosNeed, medium: BiosMedium, systemHasGames: boolean): boolean {
  if (medium === "sd") return true;
  return systemHasGames && need !== "conditional-idle";
}

/** Systems (`roms/<system>` folder keys) the user has at least one game for. */
const systemsWithGames = (games: GameRef[]): Set<string> => new Set(games.map((g) => g.system));

/**
 * Filenames an install on this medium must NOT write, lowercased.
 *
 * Only slots the active sources actually declared, and that `installsBios` rejects, are named
 * here. A file matching no declared slot is handled by `biosAllowedFilenames` instead, which is
 * the other half of the same rule.
 *
 * A filename wanted by one kept slot is never omitted for another's sake — two sources can
 * declare the same file, and one of them wanting it is enough.
 */
export function biosOmittedFilenames(
  needs: BiosNeedEntry[],
  games: GameRef[],
  medium: BiosMedium,
): Set<string> {
  const has = systemsWithGames(games);
  const keep = new Set<string>();
  const drop = new Set<string>();
  for (const n of needs) {
    const target = installsBios(n.need, medium, has.has(n.systemId)) ? keep : drop;
    for (const f of n.filenames) target.add(f.toLowerCase());
  }
  for (const f of keep) drop.delete(f);
  return drop;
}

/**
 * Every filename any declared slot names, lowercased — the set an install is allowed to write
 * from a `bios/` folder at all.
 *
 * THIS IS AN ALLOW-LIST, AND IT REPLACES AN EXPLICIT DECISION TO THE CONTRARY. The omission set
 * above used to be the whole policy, on the reasoning that a file no manifest mentioned "is not
 * something we know anything about" and dropping it would be a guess. That reasoning was wrong
 * in one direction that mattered: a general, RetroArch-style `bios/` collection is a perfectly
 * ordinary thing to point this app at, and the marking placed all of it under `bios/`. The owner
 * pointed one at a Game & Watch and the install projected **42 files, 19,521,849 bytes** —
 * PlayStation, PS2, Saturn, DS, Lynx and PC-FX firmware, a `.7z` archive, a `README.md` and an
 * `msxromdb.xml` — none of which anything on this device can open.
 *
 * The rule the owner stated is narrower than "matches a slot name": a BIOS rides in behind the
 * core that needs it, and behind nothing else. That narrowing lives in `installsBios` and the
 * omission set; this function is the outer bound, refusing anything no active source declares
 * under any condition. An empty `needs` therefore allows NOTHING, which is the honest answer:
 * if no active core declares a BIOS slot, no BIOS file has a core to ride in behind.
 *
 * Discovery is untouched. `biosState.all`/`sorted` still resolve and still show the user every
 * file the folder holds against every slot — knowing you have `syscard2.pce` and that nothing
 * wants it is useful; shipping it is not.
 */
export function biosAllowedFilenames(needs: BiosNeedEntry[]): Set<string> {
  const out = new Set<string>();
  for (const n of needs) for (const f of n.filenames) out.add(f.toLowerCase());
  return out;
}

/**
 * Filenames under `bios/` that belong to the FIRMWARE, and that an install never writes from a
 * user's folder -- whatever any manifest declares. Lowercased.
 *
 * `logo.bin` is Retro-Go's boot logo. The firmware opens it by that exact name
 * (`rg_logos.c:49`) and ships its own copy in the bundle, which is where the device's comes
 * from: `planFlashImage` seeds the tree from `defaultContent` and only then merges `userRoms`,
 * so the bundle's file is already in place before a folder is consulted. A same-named file in
 * a user's `bios/` collection would land on the same destination key and overwrite it.
 *
 * The owner, on exactly this: "bios/logo.bin isn't changeable for now. That's provided by the
 * firmware and we don't mess with it and we certainly don't override it with something from a
 * bios dir."
 *
 * THIS IS NOT THE SAME RULE AS THE ALLOW-LIST, and it is deliberately not expressed through it.
 * `biosAllowedFilenames` admits what an active source declares, so it refuses `logo.bin` today
 * only because no manifest happens to name it -- a publisher who declared a `logo.bin` slot
 * tomorrow would reopen the override with nothing in the code to stop it. This set is checked
 * independently and wins over both halves of the policy, so the answer does not depend on what
 * anybody publishes.
 *
 * Discovery is untouched, as everywhere else in this module: the file is still listed as a
 * candidate and still shown. Being visible is not being installed.
 */
export const FIRMWARE_OWNED_BIOS = new Set(["logo.bin"]);

/** A folder key holding a BIOS asset: `bios/…`, or `<system>_bios/…`. */
export function isBiosFolderKey(key: string): boolean {
  if (key.startsWith("bios/")) return true;
  const slash = key.indexOf("/");
  return slash > 0 && key.slice(0, slash).endsWith("_bios");
}

/**
 * Drop the `bios/` entries this medium should not write from a userRoms-shaped map.
 *
 * Keys are folder-scan keys; a BIOS asset is spelled either `bios/msx/MSX.rom` or
 * `msx_bios/MSX.rom` — both shapes `flashImage.ts`'s `userDest` accepts, and both are matched
 * here so the policy does not depend on which one the user's folder happens to use. Anything
 * that is not a `bios/` key passes through untouched.
 *
 * A `bios/` key survives only when it clears all THREE tests: its filename is not in
 * `FIRMWARE_OWNED_BIOS`, it is in `allow` (some active source declares it), and it is not in
 * `omit` (this medium is installing the core that wants it). `allow` is optional so the
 * existing two-argument shape still means "omission only"; the firmware-owned refusal is NOT
 * optional and applies to every call, which is why it is checked before the early return.
 */
export function applyBiosPolicy<T>(
  userRoms: Map<string, T>,
  omit: Set<string>,
  allow: Set<string> | undefined = undefined,
): Map<string, T> {
  if (omit.size === 0 && allow === undefined && FIRMWARE_OWNED_BIOS.size === 0) return userRoms;
  let out: Map<string, T> | null = null;
  for (const key of userRoms.keys()) {
    if (!isBiosFolderKey(key)) continue;
    const name = basename(key).toLowerCase();
    const drop =
      FIRMWARE_OWNED_BIOS.has(name) || omit.has(name) || (allow !== undefined && !allow.has(name));
    if (!drop) continue;
    if (!out) out = new Map(userRoms);
    out.delete(key);
  }
  return out ?? userRoms;
}
