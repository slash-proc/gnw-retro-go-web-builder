/**
 * The COMPOSITION rule for a source's "Additional files" list — which files a source is said
 * to need, and what each row claims about the one on disk.
 *
 * This lives here, not in `ui/AdditionalFiles.svelte`, for one reason: the three states are a
 * real rule about what the user is told, and inline in a `$derived` it was unguardable. `ok`
 * claims a PUBLISHED HASH MATCHED; `found` claims only presence; `add` asks for a file.
 * Confusing them either nags for a file that is already there or advertises a verification
 * that never happened.
 *
 * Pure and rune-free ON PURPOSE, like `metaFacts.ts`/`metaLine.ts`: no `$state`, no store
 * import, no `locale`. The caller resolves the stores into the plain inputs below and maps
 * each returned row back to its own object and its own localised strings, so every string and
 * every store read stays in the component and a plain node test can pin the rule.
 *
 * The MEDIUM POLICY is deliberately NOT restated here. Which slots a medium keeps is already
 * decided upstream, in `biosState.installable`; `selectBiosNeeds` takes that set as an input
 * and only intersects it with the display order and the selected source.
 */

/** What a BIOS slot's state is decided from. Structural, so a `BiosStatus` passes as-is. */
export interface BiosDecision {
  /** A file matching this slot exists somewhere in the scan. */
  present: boolean;
  /** `strict` and the hash disagreed — the file must not be installed, so it does not count. */
  blocked: boolean;
  /** `"ok"` means bytes were hashed and matched the declared `sha1`. */
  verified: string;
}

/** How a row is presented. The component turns each of these into its own localised text. */
export type FileRowState = "ok" | "found" | "add";

/** A converter input has no published hash to match, so `"ok"` is not among its options. */
export type ConverterRowState = Exclude<FileRowState, "ok">;

/**
 * A BIOS slot's state.
 *
 *  - `add`   — nothing usable is there: either no file at all, or one the hash BLOCKED. A
 *              blocked file is present on disk but will not be installed, so the user still
 *              has to supply one; saying "found" about it would be a lie of omission.
 *  - `ok`    — hashed against the declared `sha1` and matched.
 *  - `found` — present and not blocked, but nothing was proved about the bytes (`unchecked`,
 *              or a tolerated non-strict `mismatch`).
 */
export function biosRowState(b: BiosDecision): FileRowState {
  if (!b.present || b.blocked) return "add";
  return b.verified === "ok" ? "ok" : "found";
}

/**
 * A converter input's state. Two-valued BY CONSTRUCTION: the manifest publishes no hash for a
 * tool input, so the host can only ever say whether the gate accepted a file for it.
 */
export function converterRowState(supplied: boolean): ConverterRowState {
  return supplied ? "found" : "add";
}

/** One file a converter-input row is holding, and where it came from. */
export interface HeldFile {
  filename: string;
  /** Found in a folder the user registered, rather than picked through the prompt. */
  discovered: boolean;
  /**
   * The matched variant's label, ALREADY LOCALISED by the caller. Absent when the gate
   * attributed the file to no variant, which is a real state under `strict: false`.
   */
  label?: string;
}

/** A held file with the question "what does this row lead with" answered. */
export interface DrawnFile extends HeldFile {
  /**
   * The label, when it identifies this file and no other in the same row. Absent means the
   * filename leads instead — there is nothing better to say.
   */
  lead?: string;
}

/**
 * What each held file leads with: its variant's name where that name picks it out, its
 * filename where it does not.
 *
 * Two ways a label fails to identify a file, and both fall back to the same place:
 *
 *  - **Nothing attributed it.** A `strict: false` input accepts files matching no variant, so
 *    there is no name but the one on disk.
 *  - **The label is shared.** Several held files resolved to the same label, so leading with it
 *    would print one name twice over two different files. The owner named this case: "If the
 *    same label can be applied to multiple files, then we only show the filename because
 *    there's no other way to differentiate what we're seeing (OpenLara is like that)."
 *
 * Only the colliding files fall back, not the whole list: a row holding zelda3's `German` and
 * two files that share a label should still say `German` for the one that is unambiguous.
 */
export function drawnFiles(held: readonly HeldFile[]): DrawnFile[] {
  const count = new Map<string, number>();
  for (const f of held) {
    if (f.label !== undefined) count.set(f.label, (count.get(f.label) ?? 0) + 1);
  }
  return held.map((f) =>
    f.label !== undefined && count.get(f.label) === 1 ? { ...f, lead: f.label } : { ...f },
  );
}

/**
 * WHICH files a converter-input row is holding — the list the row draws, one visible row each.
 *
 * This returns names rather than a count on purpose, and that IS the rule the owner asked for:
 * a row that said "2 added" could not tell him which two, and its single `Remove` could only
 * take out both at once. The structure carries the fact; nothing here varies by how many there
 * are. See the memory `state-in-structure-not-wording`.
 *
 * The two stores are NOT additive: `run()` falls back to discovery only when the caller offered
 * nothing (see `prepareState.isSatisfied`), so a supplied list SUPERSEDES a discovered one
 * rather than concatenating. Merging them would list the same file twice in the common case
 * where the user picks the very file discovery had already found — and, worse, would offer two
 * different removals for one file on disk.
 *
 * An EMPTY list with the input still satisfied is a real state, not an error: a restored session
 * knows from the converted cache that an input was consumed but not by which files. The caller
 * draws the plain "found" there and lists nothing, because a fabricated name is worse than none.
 */
export function heldFileList(
  supplied: readonly string[],
  discovered: readonly string[],
  /** The matched variant's localised label for one filename, if the gate attributed it. */
  labelOf: (filename: string) => string | undefined = () => undefined,
): HeldFile[] {
  const one = (filename: string, wasDiscovered: boolean): HeldFile => {
    const label = labelOf(filename);
    return label === undefined
      ? { filename, discovered: wasDiscovered }
      : { filename, discovered: wasDiscovered, label };
  };
  if (supplied.length > 0) return supplied.map((f) => one(f, false));
  return discovered.map((f) => one(f, true));
}

/** Both kinds share one "how badly is it needed" rule. */
export function biosRequired(need: string): boolean {
  return need === "required" || need === "conditional-hit";
}

/**
 * The BIOS slots one source's section shows: `installable` ∩ `sorted`, narrowed to this
 * source's repo, in `sorted`'s order (what is wrong first).
 *
 * Membership is by IDENTITY, not by key — both arrays are views of the same `biosState`
 * objects, and comparing keys would silently re-admit a slot the medium policy dropped if the
 * two ever held distinct objects for one key.
 *
 * No repo selected ⇒ no rows: a section with no source cannot ask for that source's files.
 */
export function selectBiosNeeds<T extends { repo: string }>(
  sorted: readonly T[],
  installable: readonly T[],
  repo: string | undefined,
): T[] {
  if (!repo) return [];
  const keep = new Set<T>(installable);
  return sorted.filter((b) => b.repo === repo && keep.has(b));
}

/**
 * The converter inputs one source asks for: every input of every tool it declares, in
 * declaration order, DEDUPLICATED by `input.id` with the first occurrence winning.
 *
 * Deduplicated because two tools of one source routinely declare the same input (a shared
 * base ROM); one prompt asks for it once and the answer is dispatched to every tool that
 * wanted it, so listing it twice would ask the user for one file two times.
 *
 * Takes the already-extracted per-tool lists rather than the tools themselves: preparing a
 * tool can throw (unsupported or malformed), and skipping only that tool — instead of
 * emptying the section — is the caller's decision, not this rule's.
 */
export function dedupeInputsById<T extends { id: string }>(perTool: Iterable<readonly T[]>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const inputs of perTool) {
    for (const input of inputs) {
      if (seen.has(input.id)) continue;
      seen.add(input.id);
      out.push(input);
    }
  }
  return out;
}

/**
 * Is the file picker offered on a row in this state?
 *
 * ALWAYS — and that is the rule, not an oversight. For a long time the picker was drawn only
 * while `state === "add"`, which meant a file, once supplied, could never be changed: the
 * prompt is the only place a file for a BIOS slot or a converter input can be handed over, so
 * withholding its opener made the first choice permanent. A user who supplied the wrong dump,
 * or who now wants a different language patch, replaces it by choosing again.
 *
 * A boolean-valued function of the state rather than a bare `true` in the template because
 * this IS the guard: it is where the mistake lived, and it is what a test can pin.
 */
export function rowOffersPicker(_state: FileRowState | null): boolean {
  return true;
}

/**
 * Is `Remove` offered on a row in this state?
 *
 * TWO conditions, both required, and the second is the one that is easy to get wrong.
 *
 *  - The row must not be in `add`: there is nothing to take out of a row that is still asking
 *    for a file, and drawing the word there would read as an action with no object.
 *  - The file must be one the HOST is holding — supplied through the prompt, or discovered in a
 *    folder the user registered. `removable` carries that fact, because the two kinds answer it
 *    differently: a converter input is always host-held once satisfied, while a BIOS slot can be
 *    satisfied by a file sitting on the device or in the folder scan, which this app must never
 *    offer to "remove" (it does not own those bytes, and the word would promise a deletion that
 *    is not going to happen).
 *
 * A function rather than an inline `&&` for the same reason `rowOffersPicker` is one: this IS
 * the rule, and a node test pins it.
 */
export function rowOffersRemove(state: FileRowState | null, removable: boolean): boolean {
  return state !== null && state !== "add" && removable;
}
