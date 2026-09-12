/**
 * The PRECEDENCE rule for a Sources row's short factual notes — which fact a row shows, and
 * in what order. The companion to `metaLine.ts`, which owns the ordering of the whole line.
 *
 * This lives here, not in `views/Sources.svelte`, for one reason: the rule that a source the
 * device cannot load says SO INSTEAD OF counting ROMs is a real rule and was previously
 * unguardable. A row that needs newer firmware must never also advertise "4 ROMs matched" as
 * if it were installable.
 *
 * Pure and rune-free ON PURPOSE: no `$state`, no store import, no `locale`. The caller
 * resolves the raw inputs (device ABI, the picked ROM folder, the row's status) into the
 * plain record below and maps each returned token to its own localised string, so every
 * string and every store read stays in the component and a plain node test can pin the rule.
 */

/** Everything the rule reads, resolved by the caller from the row, the device and the scan. */
export interface MetaFactInputs {
  /** The row is still resolving its manifest. */
  loading: boolean;
  /** The row failed to resolve. */
  error: boolean;
  /** A resolved card is available. */
  hasCard: boolean;
  /** The card is a core (only cores count ROMs). */
  isCore: boolean;
  /**
   * Can the connected device's firmware load this build? Three-valued: `null` is "we do not
   * know" (nothing connected, no ABI table) and must make NO claim — only an explicit
   * `false` replaces the ROM count.
   */
  abiCompatible: boolean | null;
  /** How many files in the picked folder this source's extensions match, or `null`. */
  romsMatched: number | null;
  /** The user has picked a ROM folder at all. */
  hasRomFolder: boolean;
  /** The card needs files the user must supply. */
  needsUserFiles: boolean;
  /** The card is a prerelease. */
  prerelease: boolean;
}

/** One fact a row can state. The component turns each of these into localised text. */
export type MetaFact =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "needs-newer-firmware" }
  | { kind: "no-rom-folder" }
  | { kind: "no-roms" }
  | { kind: "one-rom-matched" }
  | { kind: "roms-matched"; count: number }
  | { kind: "needs-user-files" }
  | { kind: "prerelease" };

/**
 * The facts a row states, in order.
 *
 * The rules, in precedence order:
 *  1. Loading and error are EXCLUSIVE — either one is the row's only fact.
 *  2. With no resolved card there is nothing to say.
 *  3. A device that explicitly cannot load the build says so INSTEAD OF a ROM count; the
 *     count only appears when the ABI is compatible or unknown, and only for a core.
 *  4. `needsUserFiles` and `prerelease` are ADDITIVE — they append to whatever rule 3 chose,
 *     including to the needs-newer-firmware note and including on a non-core card.
 */
export function metaFacts(input: MetaFactInputs): MetaFact[] {
  if (input.loading) return [{ kind: "loading" }];
  if (input.error) return [{ kind: "error" }];
  if (!input.hasCard) return [];
  const facts: MetaFact[] = [];
  if (input.abiCompatible === false) {
    facts.push({ kind: "needs-newer-firmware" });
  } else if (input.isCore) {
    const n = input.romsMatched;
    if (n === null) facts.push({ kind: input.hasRomFolder ? "no-roms" : "no-rom-folder" });
    else if (n === 0) facts.push({ kind: "no-roms" });
    else if (n === 1) facts.push({ kind: "one-rom-matched" });
    else facts.push({ kind: "roms-matched", count: n });
  }
  if (input.needsUserFiles) facts.push({ kind: "needs-user-files" });
  if (input.prerelease) facts.push({ kind: "prerelease" });
  return facts;
}
