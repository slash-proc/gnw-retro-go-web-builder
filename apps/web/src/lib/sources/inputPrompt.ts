/**
 * Presentation helpers for the manifest-driven file prompt (`ui/FilePromptModal.svelte`).
 *
 * The RULES all live in `inputGate.ts` — hashing, `maxBytes`, `strict`, arity — and nothing
 * here re-implements any of them. What is here is the small amount of logic the gate cannot
 * do because it has no UI: picking one localised string out of a manifest's language map,
 * turning `extensions[]` into an `<input accept>` hint, and refusing an over-sized file from
 * its `File.size` alone so a 4 GB pick is never read into memory in the first place.
 *
 * Everything a manifest supplies (`label`, `description`, extension strings, filenames) is
 * third-party text. It is returned as plain strings for a template to render as TEXT, and the
 * one value that reaches an HTML attribute (`accept`) is filtered down to a conservative
 * character set here rather than trusted.
 */
import type { ConverterInput } from "./converterTypes.js";

/**
 * Pick the best string out of a manifest language map for the active UI locale.
 *
 * Exact match, then the base language (`pt-BR` -> `pt`, and a map keyed `pt` serving a UI set
 * to `pt-BR`), then English, then whatever the map does have — a prompt with SOME text beats a
 * blank label, and the manifest is not obliged to speak our locale. Returns undefined only
 * for an absent or empty map, so callers can fall back to their own copy.
 */
export function pickText(map: Record<string, string> | undefined, locale: string): string | undefined {
  if (!map) return undefined;
  const nonEmpty = (k: string | undefined): string | undefined => {
    if (k === undefined) return undefined;
    const v = map[k];
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  const base = locale.split("-")[0];
  const direct = nonEmpty(locale) ?? nonEmpty(base);
  if (direct) return direct;
  // A map keyed with a region ("pt-BR") for a UI asking about the base language ("pt").
  const regional = Object.keys(map).find((k) => k.split("-")[0].toLowerCase() === base.toLowerCase());
  return nonEmpty(regional) ?? nonEmpty("en") ?? nonEmpty(Object.keys(map)[0]);
}

/** A conservative filename extension: a dot plus alphanumerics/-/_ only. */
const EXT_OK = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * Build the `accept` attribute for one input's `extensions[]`.
 *
 * Spec/03: extensions are "a hint, never a check" — the gate decides, this only steers the
 * OS picker. Entries are accepted with or without a leading dot, lowercased, de-duplicated,
 * and anything that is not a plain extension token is DROPPED rather than escaped: a manifest
 * that writes `*` or `../x` gets a slightly less helpful picker, never an attribute we did
 * not intend. An empty result means "no hint", which is a valid state (an omitted attribute).
 */
export function acceptAttr(extensions: readonly string[]): string {
  const out: string[] = [];
  for (const raw of extensions) {
    if (typeof raw !== "string") continue;
    const token = raw.trim().replace(/^\./, "").toLowerCase();
    if (!EXT_OK.test(token)) continue;
    const ext = `.${token}`;
    if (!out.includes(ext)) out.push(ext);
  }
  return out.join(",");
}

/**
 * Would this file be refused on size alone?
 *
 * The gate checks `maxBytes` before it hashes, but it can only do that once it HAS the bytes.
 * A picker knows `File.size` without reading a thing, so the same ceiling is applied one step
 * earlier and the read never happens. Same rule, same number, no second opinion: a file that
 * passes here still goes through the gate.
 */
export function oversize(spec: Pick<ConverterInput, "maxBytes">, size: number): boolean {
  return size > spec.maxBytes;
}

/** Inputs in the order they should be prompted for: required ones first, else manifest order. */
export function promptOrder(inputs: readonly ConverterInput[]): ConverterInput[] {
  return [...inputs].sort((a, b) => Number(b.required) - Number(a.required));
}

/**
 * The prompt's two groups: what must be answered, and what may be.
 *
 * The modal shows every REQUIRED input outright and puts every OPTIONAL one behind a single
 * disclosure — all of them or none of them. A partial tail ("the first two optional inputs,
 * then N more") was rejected: a count describing only the remainder tells the user nothing
 * about what the tail holds, and splitting one kind of input across two places is arbitrary.
 * So `optional` is either empty (the modal renders no tail at all) or complete.
 *
 * Order inside each group is manifest order, which `promptOrder` also preserves.
 */
export function splitPrompt(inputs: readonly ConverterInput[]): {
  required: ConverterInput[];
  optional: ConverterInput[];
} {
  return {
    required: inputs.filter((i) => i.required),
    optional: inputs.filter((i) => !i.required),
  };
}

/**
 * Does the optional disclosure start OPEN?
 *
 * The disclosure earns its keep by keeping a prompt focused on what MUST be supplied: with
 * required inputs on screen, folding the optional ones away is what makes the required set read
 * as the job. A prompt with nothing required has no such focus to protect, and folding its only
 * content away leaves a dialog whose entire body is one closed row. The owner opened the GBA
 * BIOS prompt, whose single input is optional, and found nothing to act on until he expanded a
 * section to reach the one control the modal contains.
 *
 * THE KEY IS `required` BEING EMPTY, not the optional count. He named both conditions -- "it's
 * the only optional button [...] and there are no mandatory files in the modal" -- and the
 * second is the one doing the work: one optional input among five is still the only thing that
 * can be acted on, and hiding eight optional inputs behind a chevron leaves exactly as little
 * to do as hiding one. The single-item case he hit is a consequence of the empty-required case,
 * not a separate rule.
 *
 * This does NOT replace the disclosure. With anything required the tail still starts closed,
 * which is the whole point of having one.
 *
 * The `optional.length` guard keeps the name honest: a prompt with no optional inputs renders
 * no tail at all (`splitPrompt` above), so there is nothing that could be open.
 */
export function optionalTailStartsOpen(inputs: readonly ConverterInput[]): boolean {
  const { required, optional } = splitPrompt(inputs);
  return required.length === 0 && optional.length > 0;
}

/**
 * How many more files this input will accept given how many it already holds.
 *
 * `allowMultiple: false` means exactly one; the gate refuses a second, so the UI never offers
 * it. `allowMultiple` with a `maxCount` means that many — the gate refuses the whole set past
 * the ceiling (`input-too-many`, checked BEFORE any run because with `runPerFile` the run
 * count is the file count), so a picker that kept accepting files past it would only be
 * arranging a refusal the user then has to undo. `allowMultiple` with no ceiling is genuinely
 * unbounded, and says so.
 */
export function slotsLeft(spec: Pick<ConverterInput, "allowMultiple" | "maxCount">, held: number): number {
  if (!spec.allowMultiple) return Math.max(0, 1 - held);
  return spec.maxCount === undefined ? Infinity : Math.max(0, spec.maxCount - held);
}

/**
 * May this input be answered by pointing at a WHOLE DIRECTORY rather than at files?
 *
 * The owner, having added OpenLara: "I wanted to be able to add a folder so it would recursively
 * look for all the files it needs... could you also derive the fact that adding a directory would
 * be fine?" It is derivable, and this is the derivation: **`allowMultiple: true` IS the manifest
 * saying this input takes many files**, and a directory is many files. Nothing about OpenLara is
 * special — DOOM's `base` and zelda3's `language` are the same shape and get the same option.
 *
 * The converse matters just as much: an input that takes exactly ONE file must not offer a
 * folder, because "everything in here" cannot answer "the one file". `slotsLeft` already stops
 * such an input at one, so a folder option there could only ever arrange a refusal.
 *
 * `extensions[]` is not consulted here even though the walk needs it: an input declaring none is
 * refused by `extensionCandidates` at the discovery step, where the same rule already governs
 * the automatic case. One rule, one place.
 */
export function acceptsFolder(spec: Pick<ConverterInput, "allowMultiple">): boolean {
  return spec.allowMultiple;
}

/**
 * What a tool's `inputs[]` asks of the user, as the two separate questions the callers
 * actually have — which are NOT the same question:
 *
 *   - "must the user supply a file before this can run?"  -> "required"
 *   - "is there anything worth opening the prompt for?"   -> anything but "none"
 *
 * Collapsing the two (classifying a tool whose inputs are ALL optional as needing nothing)
 * makes its prompt unreachable, so an optional input could never be supplied at all.
 */
export function inputNeed(inputs: readonly ConverterInput[]): "none" | "optional" | "required" {
  if (inputs.length === 0) return "none";
  return inputs.some((i) => i.required) ? "required" : "optional";
}
