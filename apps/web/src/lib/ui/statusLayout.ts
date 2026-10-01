/**
 * The Overview Status pane's `Layout` row: which of the four internal-flash configurations a
 * device is in, derived from scanned banks plus safe live firmware evidence when scans are
 * unavailable (for example, an ITCM stock signature while RDP blocks internal-flash reads).
 *
 * WHY IT IS A MODULE. The pane is a `.svelte` file, and every suite in this repo stubs runes
 * as identity functions, so a rendered DOM is not reachable from a test. The one part of the
 * pane that is a decision rather than markup lives here so it can be exercised against real
 * bank shapes instead of asserted about as source text.
 *
 * The four states come from `docs/design/proposals/overview-v2/Status.dc.html`, whose header
 * names both banks' `IntflashBank.type` (engine/intflashscan.ts) as the source. We read the
 * structured fields rather than that display string: `ofw` is set when the scan recognised
 * official firmware in a bank, and `retroGoVersion` when it found the Retro-Go signature.
 * Safe live hints fill a missing positive classification: ITCM's stock signature identifies
 * OFW even when RDP prevents reading banks, and the runtime probe can identify Retro-Go before
 * the bank scan finishes. Anything else -- empty, unreadable, an app we do not recognise -- is
 * `other`, which is a statement about our knowledge and not a claim about the device.
 */
import type { IntflashBank } from "../engine/intflashscan.js";

export type BankLayout = "dual" | "retrogo" | "stock" | "other";

export interface BankLayoutHints {
  /** Positive stock signature from ITCM, available even when RDP prevents reading flash. */
  stockModel?: "mario" | "zelda" | "unknown" | null;
  /** Live VTOR/PC classification can identify Retro-Go before its bank has been scanned. */
  retroGoRunning?: boolean;
}

export function bankLayout(
  banks: readonly IntflashBank[],
  hints: BankLayoutHints = {},
): BankLayout {
  const stock = banks.some((b) => b.ofw != null) ||
    (hints.stockModel != null && hints.stockModel !== "unknown");
  const app = banks.some((b) => b.retroGoVersion != null) || hints.retroGoRunning === true;
  if (stock && app) return "dual";
  if (app) return "retrogo";
  if (stock) return "stock";
  return "other";
}
