/**
 * WHAT IS ON THE SD CARD -- measured by walking it, and silent about what cannot be measured.
 *
 * `Details.dc.html` draws Storage as a card label, a stacked Games/Covers/Saves bar, and the
 * legend "12.4 GB free of 29.7 GB". Three of those four things are real. One is not, and the
 * board says so itself: its header comment ends "Numbers are plausible, not measured", and its
 * own Sources table lists nothing at all against Storage except `device.targetMedia, sdHandle`.
 *
 * CAPACITY IS NOT KNOWABLE HERE, and nothing in this file estimates it.
 * A `FileSystemDirectoryHandle` exposes a name and its entries. It does not expose the volume
 * it came from, so there is no supported way to ask a picked SD card how big it is.
 * `navigator.storage.estimate()` is the API that looks like the answer and is not: it reports
 * the quota of THIS ORIGIN's sandboxed storage, a number about the browser profile that has no
 * relationship whatsoever to the card. Printing it beside "SD card" would be a fabrication
 * wearing the costume of a measurement, which is worse than an absent row, because a reader
 * cannot tell it is absent. So: no capacity, no free space, and no bar drawn against a total
 * nobody measured.
 *
 * WHAT THE BAR IS INSTEAD. Every byte this walk finds is bucketed, and the segments are
 * proportions OF WHAT IS THERE rather than of the card. That is a different statement from the
 * board's, and the pane has to say so in words -- a bar the reader takes for "how full the card
 * is" would be the same lie by another route. `other` exists for exactly this reason: without
 * it a card holding a large `cores/` tree would draw Games at nearly the full width, which
 * reads as "nearly full" to anyone glancing at it.
 *
 * WHY THE ROM WALK IS NOT REUSED. `romScan.ts`'s `walk()` does
 * `out.set(rel, new Uint8Array(await file.arrayBuffer()))` at line 116 -- it reads every file's
 * full contents into memory, because its job is to hand the Library real bytes. Pointing that at
 * a 32 GB card to add up sizes would try to load the card into RAM. What IS reused is the part
 * that matters for agreement: the bucket boundaries come from `deviceInstallPaths()`, the same
 * `InstallPaths` roles `sdDestPath()` writes to, so what this counts as "Covers" is by
 * construction the directory the sync actually puts covers in. This walk reads `File.size` and
 * nothing else.
 *
 * SAVES ARE `data/`. Not a guess: retro-go's `ODROID_BASE_PATH_SAVES` is `ODROID_BASE_PATH
 * "/data"` (`retro-go-stm32/components/odroid/config.h:57`), and `InstallPaths.data` is the role
 * this codebase already resolves for it.
 *
 * FOUR STATES, and the middle two are the point:
 *   unknown      nothing has walked yet
 *   unavailable  not in SD mode, or no folder connected -- there is nothing to report, which
 *                is not the same as a card with nothing on it
 *   unreadable   a folder we were given and could not read; never reported as an empty card
 *   ready        walked, with real totals, and `truncated` when the walk hit its own limit
 *
 * `truncated` is not cosmetic. A partial walk under-reports, so a pane that draws it without
 * saying it is partial is presenting a floor as a total.
 */
import { deviceInstallPaths, homebrewDirs } from "./engine/devicePaths.js";
import type { InstallPaths } from "@gnw/fs-builders";

/**
 * The buckets the card page draws.
 *
 * NINE plus `other`, and the owner set both the membership and the order: alphabetical by the
 * DISPLAYED LABEL with `other` pinned last, because `other` is the catch-all rather than a peer
 * and keeps the end of the list whatever letter its label starts with.
 *
 * The ids here are stable identifiers, NOT the order and NOT the labels. Ordering is
 * `sortedCategories()` below, which takes the localized labels, because `lang/` displays as
 * "Language" and sorts under L, and because fifteen locales sort their own words differently.
 * A hardcoded English order would look arbitrary in fourteen of them.
 */
export type SdCategory =
  | "bios"
  | "covers"
  | "fonts"
  | "homebrew"
  | "language"
  | "roms"
  | "saves"
  | "screenshots"
  | "other";

/** Every bucket, in id order. NOT a display order -- see `sortedCategories()`. */
export const SD_CATEGORIES: readonly SdCategory[] = [
  "bios",
  "covers",
  "fonts",
  "homebrew",
  "language",
  "roms",
  "saves",
  "screenshots",
  "other",
];

/** The catch-all, pinned last by `sortedCategories()` however its label sorts. */
export const SD_CATCH_ALL: SdCategory = "other";

/**
 * The display order: labels sorted in the ACTIVE locale, with the catch-all pinned last.
 *
 * Takes the labels rather than reading them, so this module stays free of the i18n store and
 * the rule is exercised by the suite without a locale runtime. Callers pass what they draw.
 *
 * `localeCompare` rather than `<`: `<` compares UTF-16 code units, which puts every accented or
 * non-Latin label after every ASCII one and gets German, Russian and Arabic wrong.
 */
export function sortedCategories(
  labels: Readonly<Record<SdCategory, string>>,
  locale?: string,
): readonly SdCategory[] {
  const rest = SD_CATEGORIES.filter((c) => c !== SD_CATCH_ALL);
  rest.sort((a, b) => labels[a].localeCompare(labels[b], locale));
  return [...rest, SD_CATCH_ALL];
}

export interface SdUsage {
  /** Bytes per bucket. Always holds every key; a bucket with nothing in it is 0, not absent. */
  bytes: Readonly<Record<SdCategory, number>>;
  /** Files counted per bucket, for a pane that wants "412 files" beside a size. */
  files: Readonly<Record<SdCategory, number>>;
  /** Sum of `bytes`. The only total this module has; it is USED, never CAPACITY. */
  total: number;
  /** The picked folder's own name -- the closest honest thing to the board's card label. */
  folderName: string;
  /** True when the walk stopped early for any reason, so `bytes` is a floor. */
  truncated: boolean;
  /**
   * WHICH limit ended it, or `null` when the walk was complete.
   *
   * `truncated` alone conflates three different facts, and a pane that says "too many files"
   * over a deep tree or one unreadable file is telling the user to go and delete things that
   * are not the problem. The walk already knows which it hit; this reports it rather than
   * making the pane guess.
   *
   * First cause wins: once the walk is bounded the later ones are consequences, not findings.
   */
  truncatedBy: SdTruncation | null;
}

/** Why a walk stopped short. See `SdUsage.truncatedBy`. */
export type SdTruncation = "entries" | "depth" | "file";

/**
 * What to SHOW for a card whose volume name is useless.
 *
 * Windows commonly hands back nothing usable for a removable volume, so `root.name` renders
 * blank or as bare punctuation and the row reads as a bug. This is the one helper for that, so
 * the card page and the rail entry cannot drift into two different tests.
 *
 * THE RULE IS "NO ALPHANUMERIC CHARACTER", NOT "EMPTY". `-` and `___` fail a reader exactly the
 * way `""` does; an empty string is one case of the rule, not the rule.
 *
 * IT MUST STAY UNICODE-AWARE. `\p{L}` and `\p{N}` are a letter or digit in ANY script. The
 * tempting `/[a-z0-9]/i` would silently rename every Japanese, Russian or Arabic card to `SD`
 * and would pass review, because the English case looks right. That is the failure worth
 * guarding loudest, and the suite drives a non-Latin name for exactly this reason.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH: `(E:)` keeps its name, because `E` is a letter. The
 * owner's example and the rule he stated diverge here; the rule is implemented as stated.
 * Widening it to "fewer than two" would start discarding real one-character names, including
 * single-glyph CJK ones.
 *
 * `SD` is a CONSTANT, not copy. It stands in for the volume's NAME, and a name that changed per
 * locale would be a different card to every reader -- the same reasoning that keeps version
 * strings and model names out of the string tables.
 */
export const UNNAMED_CARD = "SD";

const HAS_ALNUM = /[\p{L}\p{N}]/u;

/** The card's name, or `SD` when it has nothing a reader could use. */
export function cardDisplayName(folderName: string | null | undefined): string {
  return folderName && HAS_ALNUM.test(folderName) ? folderName : UNNAMED_CARD;
}

export type SdStorageState =
  | { kind: "unknown" }
  | { kind: "unavailable" }
  | { kind: "unreadable"; folderName: string }
  | ({ kind: "ready" } & SdUsage);

/**
 * A directory handle, structurally. Deliberately not imported from `romScan.ts`: that module
 * pulls in the core registry and the homebrew store, and this walk needs neither.
 */
export interface SdDirLike {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, SdDirLike | SdFileLike]>;
}
export interface SdFileLike {
  kind: "file";
  name: string;
  getFile(): Promise<{ size: number }>;
}

/**
 * Walk limits. A card is user-supplied and can be arbitrarily deep or wide, so the walk is
 * bounded rather than trusting it. Both limits set `truncated` instead of throwing: a floor the
 * pane admits is a floor is more useful than an error.
 *
 * 40000 entries is far above a full retro-go card (a few thousand ROMs plus covers) and far
 * below anything that would hang the tab. Depth 8 clears `roms/<system>/<file>` and the deepest
 * real layout, `covers/homebrew/<title>.img`, with room to spare.
 */
export const MAX_ENTRIES = 40000;
export const MAX_DEPTH = 8;

/**
 * Directories the firmware owns that have NO manifest role, so they can only be literals here.
 *
 * `lang` is not invented for this walk: `flashImage.ts` already hardcodes `lang/` with a
 * documented reason (the firmware's `paths` object declares no such role, and `rg_i18n.c` opens
 * the blob with a plain `fopen("/lang/de_de.bin")`). This reuses that spelling rather than
 * adding a second one.
 *
 * `fonts` AND `font` are BOTH real. `syscalls.c`'s `is_frogfs_path()` lists them separately
 * (`path_has_prefix_dir(path, "fonts") || path_has_prefix_dir(path, "font")`), so a bucket
 * matching only the plural silently drops whatever the singular holds into `other`.
 *
 * `screenshots` is written by the FIRMWARE, never by this app: `odroid_system.c` composes
 * `ODROID_BASE_PATH_SCREENSHOTS "/%04d-%02d-%02d-...bmp"`. Nothing in this codebase produces
 * one, which is exactly why it needs a literal -- there is no role to resolve and no install
 * path to follow, but a card that has been used WILL have files there.
 */
const LITERAL_DIRS: Readonly<Record<string, SdCategory>> = Object.freeze({
  lang: "language",
  fonts: "fonts",
  font: "fonts",
  screenshots: "screenshots",
});

/**
 * Which bucket a path belongs to, longest prefix first.
 *
 * HOMEBREW IS A PEER OF ROMS, NOT NESTED UNDER IT. The live manifest says
 * `"homebrew": "/homebrews"` (`fs-builders/src/installPaths.ts:7`), a sibling of `/roms`.
 * What IS nested is `DEFAULT_INSTALL_PATHS.homebrew`, `roms/homebrew` (`:65`) -- the literal
 * this code used before the manifest existed, which a card written by an older firmware still
 * has on it.
 *
 * So BOTH directories have to be recognised, and `homebrewDirs()` is the repo's existing answer
 * to exactly that: it returns the manifest's directory plus the pre-manifest default whenever
 * they differ, because (its own words) "a read must recognise both or that content goes
 * invisible". Reading only `paths.homebrew` misfiled one layout or the other in every case:
 * with the live manifest learned, `roms/homebrew/*` fell through to `roms` and was counted as
 * ROMs; with the legacy paths learned, `homebrews/*` matched nothing and landed in `other`.
 *
 * The ordering the old comment defended therefore still matters, but for the LEGACY directory
 * rather than the live one: `roms/homebrew` sits inside `roms`, so it must be tested first.
 * `/homebrews` would be safe in any order, which is precisely why testing only it looked
 * correct while the nested case was silently wrong.
 */
function bucketFor(path: string, paths: InstallPaths): SdCategory {
  const p = path.toLowerCase();
  const under = (dir: string) => {
    const d = dir.toLowerCase();
    return d !== "" && (p === d || p.startsWith(d + "/"));
  };
  // Covers, saves and bios before roms: none is nested under it today, but a manifest is free
  // to say otherwise, and a role that IS nested must still count as itself.
  if (under(paths.covers)) return "covers";
  if (under(paths.data)) return "saves";
  if (under(paths.bios)) return "bios";
  // Every homebrew directory before roms, for the nested legacy one's sake.
  if (homebrewDirs(paths).some(under)) return "homebrew";
  if (under(paths.roms)) return "roms";
  for (const [dir, bucket] of Object.entries(LITERAL_DIRS)) {
    if (under(dir)) return bucket;
  }
  // `cores/` and `cheats/` are declared roles that are deliberately NOT among the nine, so they
  // land here with everything else. On a real card `cores/` is not small, which is most of why
  // `other` is large; giving either its own row is a question the owner has not been asked.
  return "other";
}

/**
 * Add up the card by bucket, reading metadata only.
 *
 * Exported for the suite, and taking its paths injected, so it can be driven against a fake
 * handle with no browser, no device and no card.
 */
export async function walkSdUsage(
  root: SdDirLike,
  paths: InstallPaths = deviceInstallPaths(),
): Promise<SdUsage> {
  // Built FROM `SD_CATEGORIES` rather than written out: a literal here is a list that has to be
  // kept in step with the type by hand, and a bucket missing from it would read `undefined` and
  // produce `NaN` on its first `+=` -- a total that is silently not a number.
  const zeroed = () =>
    Object.fromEntries(SD_CATEGORIES.map((c) => [c, 0])) as Record<SdCategory, number>;
  const bytes = zeroed();
  const files = zeroed();
  let seen = 0;
  let truncatedBy: SdTruncation | null = null;
  /** First cause wins; see `SdUsage.truncatedBy`. */
  const stopped = (why: SdTruncation) => {
    if (truncatedBy === null) truncatedBy = why;
  };

  const visit = async (dir: SdDirLike, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      stopped("depth");
      return;
    }
    for await (const [name, handle] of dir.entries()) {
      if (seen >= MAX_ENTRIES) {
        stopped("entries");
        return;
      }
      const path = prefix === "" ? name : prefix + "/" + name;
      if (handle.kind === "directory") {
        await visit(handle, path, depth + 1);
        if (seen >= MAX_ENTRIES) return;
        continue;
      }
      seen++;
      // `getFile()` resolves metadata; `.size` costs no read. Anything that touches
      // `arrayBuffer()` here would be loading the card into memory (see the header note).
      let size = 0;
      try {
        size = (await handle.getFile()).size;
      } catch {
        // One unreadable file must not lose the other 39,999. It contributes nothing, which
        // makes the total a floor -- the same claim `truncated` makes, so say so.
        stopped("file");
        continue;
      }
      const bucket = bucketFor(path, paths);
      bytes[bucket] += size;
      files[bucket]++;
    }
  };

  await visit(root, "", 0);

  const total = SD_CATEGORIES.reduce((n, c) => n + bytes[c], 0);
  return { bytes, files, total, folderName: root.name, truncated: truncatedBy !== null, truncatedBy };
}

class SdStorageStore {
  /** The cached answer. `unknown` until a walk has completed once. */
  state = $state<SdStorageState>({ kind: "unknown" });

  /**
   * True while a walk is in flight, so overlapping calls collapse into one. Deliberately NOT
   * `$state`, and the reason is a bug another store here shipped and had to unpick: `refresh()`
   * reads and writes this before its first `await`, so a tracked `$effect` calling it would
   * depend on what the call sets and re-run forever. Every suite in this repo stubs the runes as
   * identity functions, so no node test can catch that -- it has to be right by construction.
   */
  private busy = false;

  /**
   * Re-walk the connected card and update `state`.
   *
   * Never prompts. It reads only a handle the app already holds, so opening the Overview tab
   * cannot raise a permission dialog out of nowhere; connecting a card stays the job of the
   * folder pick the user drives.
   */
  async refresh(handle: SdDirLike | null, inSdMode: boolean): Promise<void> {
    if (this.busy) return;
    if (!inSdMode || !handle) {
      this.state = { kind: "unavailable" };
      return;
    }
    this.busy = true;
    try {
      const usage = await walkSdUsage(handle);
      this.state = { kind: "ready", ...usage };
    } catch {
      // A card pulled out mid-walk, or a permission revoked since it was picked. We cannot see
      // it, which is `unreadable` -- never a `ready` state of zeroes, which would assert the
      // card is empty when we simply failed to read it.
      this.state = { kind: "unreadable", folderName: handle.name };
    } finally {
      this.busy = false;
    }
  }

  /** Drop the cached answer, for a flow that changed the card behind us. */
  forget(): void {
    this.state = { kind: "unknown" };
  }
}

export const sdStorage = new SdStorageStore();
