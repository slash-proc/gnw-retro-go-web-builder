/**
 * The Guided Setup chooser's two decisions, extracted so the MATRIX can be tested.
 *
 * Same move, and for the same reason, as `engine/unlockGate.ts`: the rules are small, they are
 * stated in several places, and the only way to know they agree is to drive them. Written inline
 * in `Wizard.svelte` the matrix is a `{#if}` ladder nothing can enumerate; written here it is
 * `chooserstates.mjs`, which walks every row of
 * `docs/design/proposals/guided-v2/chooseandsee/LOGIC.md` and fails when a row moves.
 *
 * Nothing here reads a store or a string table. It takes the three facts the chooser gates on and
 * returns what to draw.
 *
 * THE THREE GATES, and the one that is routinely got wrong:
 *
 *     canDualBoot = extMB === null || extMB >= 16
 *     canRetroGo  = extMB === null || extMB >= 8
 *     isStock     = bank 1 holds unpatched original firmware
 *
 * `extMB === null` is PERMISSIVE in both. Unknown size is a third state, not a small one: the
 * size needs the stub to have read the chip, so it is null before a scan completes, and hiding
 * choices on "we have not looked yet" would be a worse lie than showing one the device turns out
 * not to support. The floor note follows the same rule from the other side -- both branches
 * require `extMB !== null`, so an unmeasured device draws NO note, not a reassuring one.
 *
 * THE DEGENERATE PAGE IS NOT AN EDGE CASE. Stock Zelda ships with 4 MB of external flash and
 * stock Mario with 1 MB, both under the 8 MB floor, and pristine stock in bank 1 gates
 * `Return to Stock` away as well (there is nothing to return from). So an unmodified Game and
 * Watch draws a chooser with NO cards and the floor note standing alone. That is what a
 * brand-new device does, and `cards()` returning empty is the normal path through it.
 */

/** The three paths a card commits to. Mirrors `WizardPath` in `Wizard.svelte`. */
export type ChooserCard = "dual" | "rgo" | "stock";

/** Which floor note to draw, or `null` for none. At most one is ever drawn. */
export type FloorNote = "retrogo" | "dualboot" | null;

export interface ChooserFacts {
  /** `device.extSizeMB`: external flash in MB, or `null` when the chip has not been read. */
  extMB: number | null;
  /** `device.deviceClass?.kind === "stock"`: bank 1 holds UNPATCHED original firmware. */
  isStock: boolean;
}

/** Below this the chip is not fit for modern Retro-Go. Owner's rule, a hardware floor. */
export const RETRO_GO_FLOOR_MB = 8;
/** Below this it is not fit for dual boot: two firmwares plus assets do not fit. */
export const DUAL_BOOT_FLOOR_MB = 16;

export function canRetroGo(extMB: number | null): boolean {
  return extMB === null || extMB >= RETRO_GO_FLOOR_MB;
}

export function canDualBoot(extMB: number | null): boolean {
  return extMB === null || extMB >= DUAL_BOOT_FLOOR_MB;
}

/**
 * Which cards the chooser draws, in draw order.
 *
 * Returns `[]` for the degenerate page. A caller must handle that rather than assuming at least
 * one: see the header above for why it is the ordinary state of an unmodified device.
 */
export function cards(facts: ChooserFacts): ChooserCard[] {
  const out: ChooserCard[] = [];
  if (canDualBoot(facts.extMB)) out.push("dual");
  if (canRetroGo(facts.extMB)) out.push("rgo");
  // Never offer returning to stock when the device still HAS unpatched stock firmware.
  if (!facts.isStock) out.push("stock");
  return out;
}

/**
 * Which floor note to draw. Mutually exclusive, and `null` on an unmeasured device.
 *
 * Note this does NOT depend on `isStock`: the note explains the chip, not the bank, and it is
 * drawn whether or not any card survived.
 */
export function floorNote(extMB: number | null): FloorNote {
  if (extMB === null) return null;
  if (!canRetroGo(extMB)) return "retrogo";
  if (!canDualBoot(extMB)) return "dualboot";
  return null;
}

/** The spine ids, in order. Mirrors `SpineId` in `Wizard.svelte`. */
export type SpineId =
  | "backup"
  | "install"
  | "sources"
  | "roms"
  | "select-backup"
  | "restore"
  | "remove-rgo"
  | "remove-bank2";

/**
 * The steps a path produces.
 *
 * `showBackupStep` is passed in rather than derived, because in the live component it is LATCHED
 * at the moment of choosing and must not be re-derived: taking the backup flips `backupTaken`,
 * and a live derivation would delete the step the user is standing on and renumber the spine
 * underneath them. The preview column is the one place it IS derived live, because nobody is
 * standing on a plan they have not chosen yet.
 */
export function spineFor(path: ChooserCard, showBackupStep: boolean, removeBank2 = false): SpineId[] {
  if (path === "stock") return ["select-backup", "restore", "remove-rgo"];
  return [
    ...(showBackupStep ? (["backup"] as SpineId[]) : []),
    "install",
    ...(removeBank2 ? (["remove-bank2"] as SpineId[]) : []),
    "sources",
    "roms",
  ];
}

/**
 * Whether the plan for `path` includes a backup step, for a device in this state.
 *
 * The dual-boot path can NEVER drop it: the patch is computed FROM the dumped stock image, so
 * there is nothing to patch without the dump. The Retro-Go-only path needs it only while
 * unpatched stock is still in bank 1 with no backup of this unit recorded.
 */
export function needsBackupStep(
  path: ChooserCard,
  facts: { isStock: boolean; backupTaken: boolean },
): boolean {
  if (path === "dual") return true;
  return path === "rgo" && facts.isStock && !facts.backupTaken;
}
