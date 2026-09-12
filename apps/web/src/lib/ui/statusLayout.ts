/**
 * The Overview Status pane's `Layout` row: which of the four internal-flash configurations a
 * device is in, derived from the two banks' real shapes.
 *
 * WHY IT IS A MODULE. The pane is a `.svelte` file, and every suite in this repo stubs runes
 * as identity functions, so a rendered DOM is not reachable from a test. The one part of the
 * pane that is a decision rather than markup lives here so it can be exercised against real
 * bank shapes instead of asserted about as source text.
 *
 * The four states come from `docs/design/proposals/overview-v2/Status.dc.html`, whose header
 * names both banks' `IntflashBank.type` (engine/intflashscan.ts) as the source. We read the
 * two structured fields rather than that display string: `ofw` is set only when the scan
 * recognised official firmware in the bank, and `retroGoVersion` only when it found the
 * Retro-Go signature. Anything else -- empty, unreadable, an app we do not recognise -- is
 * `other`, which is a statement about our knowledge and not a claim about the device.
 */
import type { IntflashBank } from "../engine/intflashscan.js";

export type BankLayout = "dual" | "retrogo" | "stock" | "other";

export function bankLayout(banks: readonly IntflashBank[]): BankLayout {
  const stock = banks.some((b) => b.ofw != null);
  const app = banks.some((b) => b.retroGoVersion != null);
  if (stock && app) return "dual";
  if (app) return "retrogo";
  if (stock) return "stock";
  return "other";
}
