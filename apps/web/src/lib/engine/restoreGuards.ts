// Restore-to-stock admissibility: given the facts about a scanned backup pair and the facts
// about the connected device, decide whether writing that backup back is allowed — and if
// not, WHICH guard refused.
//
// Extracted verbatim from views/Wizard.svelte's `restoreValid` / `restoreWrongHw` /
// `restoreTooBig` / `canRestore` deriveds so the decision can be tested offline (it used to
// live entirely inside a .svelte file, where nothing could reach it). This is a move, not a
// redesign: the predicates, their gating on `valid`, and their precedence are unchanged.
//
// The verdict deliberately does NOT decide what to DO about a refusal — the two callers
// differ there on purpose. Guided Setup (Wizard) treats every refusal as final; the expert
// path (advanced/OfficialFirmwareSection.svelte) lets the user acknowledge-and-override the
// wrong-hardware case. A caller that wants that override reads `refusal` and ignores the one
// it is willing to accept.

import type { OfwModel } from "./ofw.js";

/** The facts about a scanned backup pair that the decision depends on. */
export interface RestoreBackupFacts {
  model: OfwModel;
  /** Both dumps hash-matched a genuine stock ROM (engine/ofw.ts's DEVICES SHA-1s). */
  internalOk: boolean;
  externalOk: boolean;
  /** Byte length of the external image that would be written to bank 0. */
  externalLength: number;
}

/** The facts about the connected device that the decision depends on. */
export interface RestoreDeviceFacts {
  model: OfwModel | "unknown";
  /** External flash capacity in bytes; 0 = unknown (the capacity guard is then skipped). */
  extFlashBytes: number;
}

/**
 * Which guard refused, or null when nothing did.
 *  - `no-backup`      — no pair selected, or it only half-validates (a corrupt backup, not a
 *                       partial restore we could complete).
 *  - `wrong-hardware` — a Zelda backup onto Mario hardware. Mario physically lacks two of the
 *                       buttons Zelda's firmware needs.
 *  - `too-big`        — the external image is larger than this device's external flash chip.
 */
export type RestoreRefusal = "no-backup" | "wrong-hardware" | "too-big";

export interface RestoreVerdict {
  /** A usable backup pair is selected (both dumps genuine stock). */
  valid: boolean;
  /** The refusing guard, in the same precedence the UI has always rendered them in. */
  refusal: RestoreRefusal | null;
  /** Nothing refused — the restore may be offered/started. */
  allowed: boolean;
}

/** Wizard's `device.fitsExtFlash` predicate, restated so this module stays store-free. */
const fitsExtFlash = (bytes: number, cap: number): boolean => cap > 0 && bytes <= cap;

/**
 * Evaluate the restore guards. `backup` is null when no folder has been scanned yet or the
 * scan found no pair.
 *
 * Precedence is `no-backup` > `wrong-hardware` > `too-big`, matching the Wizard's existing
 * else-if chain (both in the rendered caution block and in `runRestore`'s re-assertion). A
 * Zelda backup on Mario hardware trips both of the latter two; it has always reported as
 * wrong-hardware, and still does.
 */
export function evaluateRestore(
  backup: RestoreBackupFacts | null,
  device: RestoreDeviceFacts,
): RestoreVerdict {
  const valid = !!backup && backup.internalOk && backup.externalOk;
  if (!valid) return { valid: false, refusal: "no-backup", allowed: false };
  if (device.model === "mario" && backup!.model === "zelda") {
    return { valid: true, refusal: "wrong-hardware", allowed: false };
  }
  if (device.extFlashBytes > 0 && !fitsExtFlash(backup!.externalLength, device.extFlashBytes)) {
    return { valid: true, refusal: "too-big", allowed: false };
  }
  return { valid: true, refusal: null, allowed: true };
}
