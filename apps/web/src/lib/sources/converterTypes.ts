/**
 * Types and errors for the WASM converter host (gwrg-dist-spec spec/04-processor.md,
 * spec/05-host.md — processor `wasm`/`1`).
 *
 * A converter is one `.wasm` binary that turns files the user supplies into files the
 * installer writes. It imports NOTHING, so the only thing that crosses the boundary is bytes
 * in its own linear memory.
 *
 * The whole of spec/05 reduces to one sentence: **everything the module hands back is a value
 * it chose.** Lengths, names, messages — all of it is untrusted input, and every type in here
 * exists to make that explicit at the boundary rather than implicit at each call site.
 *
 * Nothing in this file imports anything DOM- or node-specific: it is loaded by the browser,
 * by the Worker and by the plain-node validation script alike (spec/05's closing warning).
 */

/** The one processor ABI this host implements. Anything else is refused, never guessed at. */
export const SUPPORTED_ABI_VERSION = 1;

/** The one `processor.version` this host implements. Same number, separate concept. */
export const SUPPORTED_PROCESSOR_VERSION = 1;

/** `processor.type` we know how to run. A future non-WASM processor is a new type. */
export const SUPPORTED_PROCESSOR_TYPE = "wasm";

/** A WASM page is 64 KiB. `limits.maxMemoryPages` is counted in these. */
export const WASM_PAGE_BYTES = 65536;

export type ConverterErrorCode =
  // --- verification, before instantiating ---
  | "bad-binary" // not a WASM module, or a section we cannot parse
  | "imports-forbidden" // the module imports at least one thing
  | "missing-export" // an ABI export is absent
  | "bad-export" // an ABI export has the wrong kind or signature
  | "extra-export" // an exported function the ABI does not define
  | "unbounded-memory" // no declared maximum: the module may grow without limit
  | "memory-too-large" // declared maximum exceeds limits.maxMemoryPages
  | "binary-hash" // bytes disagree with tools[].binary.sha256
  // --- version gates ---
  | "unsupported-processor" // processor.type / processor.version we do not implement
  | "unsupported-abi" // abi_version() we do not implement
  // --- the input gate, before spending a run ---
  | "input-too-large" // over the input's maxBytes
  | "input-unrecognised" // matches no variant and the input is strict
  | "input-missing" // a required input got no file
  | "input-not-multiple" // more than one file for an input that is not `allowMultiple`
  | "input-too-many" // more files than the input's `maxCount`, refused BEFORE any run
  // --- names, before anything is written ---
  | "name-collision" // two files that are one file on a case-folding card
  // --- the run ---
  | "instantiate-failed"
  | "module-error" // run/run_begin/run_step returned non-zero
  | "timeout"
  | "worker-failed"
  | "no-progress" // run_step kept returning 1 past the step ceiling
  // --- reading results back ---
  | "alloc-failed"
  | "out-of-bounds" // ptr + len outside memory.buffer
  | "output-too-large" // a length claim over limits.maxOutputBytes
  | "output-name" // a string that is not a plain filename, or a derived name that is not one
  | "unknown-output" // an output id the manifest's outputs[] does not declare
  | "bad-utf8"; // a "UTF-8" string that is not

export class ConverterError extends Error {
  constructor(
    readonly code: ConverterErrorCode,
    /** Untrusted detail (a name, a length, a module message). Render as TEXT, never markup. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = "ConverterError";
  }
}

// --- The manifest shapes this host reads -------------------------------------------------
//
// `types.ts` models `Tool.inputs` as `unknown[]` because the resolve phase never looks
// inside it. These are the narrowed shapes, parsed (not cast) by `parseToolInputs`.

/** One known-good file for an input: spec/03's `inputs[].variants[]`. */
export interface InputVariant {
  id: string;
  /**
   * The canonical name a derived output takes when THIS variant matched (spec/03, "How a
   * derived name is resolved", rule 1) — how `DOOM2.WAD` becomes `Doom II - Hell on
   * Earth.whd` rather than `DOOM2.whd`. Publisher text: validated as a plain filename before
   * it is ever used, never interpolated into a path.
   */
  filename?: string;
  /** Uppercase or lowercase hex; compared case-insensitively. */
  sha1: string;
  bytes?: number;
  label?: Record<string, string>;
}

/** One `tools[].inputs[]` entry — what to ask the user for, and how to police the answer. */
export interface ConverterInput {
  id: string;
  required: boolean;
  allowMultiple: boolean;
  /**
   * Each file is converted separately, one run each (spec/03). Requires `allowMultiple`.
   * Parsed and carried here; the per-file run loop is not implemented yet.
   */
  runPerFile?: boolean;
  /**
   * Ceiling on how many files this slot accepts. Enforced by `gateInputs`, BEFORE a run —
   * with `runPerFile` the run count is one per file, and spec/05 calls it "the one unbounded
   * quantity in the model" for exactly that reason.
   */
  maxCount?: number;
  /** For the file picker. "A hint, never a check" (spec/03). */
  extensions: string[];
  maxBytes: number;
  variants: InputVariant[];
  /** Default TRUE. False means "try it, and tell the user it was not recognised". */
  strict: boolean;
  label?: Record<string, string>;
  description?: Record<string, string>;
}

/**
 * One `tools[].outputs[]` entry. The manifest decides what a legitimate run produces.
 *
 * `filename` XOR `extension`, and the schema says so with `oneOf` — presence carries the
 * meaning, so there is no boolean. `filename` is a fixed name (smw's asset pack is always
 * `smw_assets.dat`); `extension` means the name is DERIVED from the file that was converted
 * (one `.whd` per WAD). A manifest declaring both, or neither, is refused by
 * `parseToolOutputs` — a host does not get to assume the publisher ran the checker.
 *
 * `id` is also what the MODULE emits: `output_name_*` is an id, not a filename (spec/04). The
 * module has no say in any name, not even a proposed one.
 */
export interface ConverterOutputSpec {
  id: string;
  /** Fixed name on the card. Absent when the name is derived. */
  filename?: string;
  /** Leading-dot extension a derived name takes, REPLACING the input's own. */
  extension?: string;
  /**
   * Folder this file goes in, relative to its target's `dataDir` (gwrg-dist-spec `61d3726`).
   * How OpenLara's cutscenes reach `/homebrews/openlara/fmv/` while its levels stay in
   * `/homebrews/openlara/`.
   *
   * Meaningless without a `dataDir` to be relative to. The spec refuses that combination at
   * publish time; `placement.ts`'s `outputSubdir` simply ignores it, rather than placing the
   * file one level below the binary where nothing would look for it.
   */
  subdir?: string;
  maxBytes: number;
}

/** `tools[].limits` — the ceilings this host rejects a module's own claims against. */
export interface ConverterLimits {
  maxMemoryPages: number;
  maxOutputBytes: number;
}

// --- The run ------------------------------------------------------------------------------

/** One file the user supplied, after it has passed the input gate. */
export interface ConverterRunInput {
  /**
   * Which `inputs[].id` it was accepted for. Carried for reporting only: the MODULE resolves
   * roles by hashing content, and `input_add` takes no name and no role (spec/04).
   */
  inputId: string;
  /** As the user named it. Untrusted text. */
  filename: string;
  bytes: Uint8Array;
}

/** A file the module produced, after every name and length check has passed. */
export interface ConverterOutput {
  /**
   * The string the module emitted. Since spec/04's amendment this is the `id` of an
   * `outputs[]` entry, not a filename — kept verbatim for reporting, and still validated
   * against the strict plain-filename pattern before it is looked up.
   */
  name: string;
  /** The matched `outputs[].id`. The name on the card is resolved from its spec, not here. */
  outputId: string;
  bytes: Uint8Array;
}

export interface ConverterProgress {
  /** Stages completed, from `stage_index()`. */
  index: number;
  /** Total, from `stage_count()`. 0 when the module declares none. */
  count: number;
  /** `stage_name_ptr/len` of the CURRENT stage. Untrusted text, may be "". */
  stage: string;
}

export interface ConverterResult {
  outputs: ConverterOutput[];
  /** `warnings_ptr/len`, split on newlines, blanks dropped. Untrusted text. */
  warnings: string[];
  /** Wall-clock milliseconds the run itself took. */
  durationMs: number;
  /** How many `run_step` calls the stepped loop made. Diagnostic. */
  steps: number;
}

export interface ConverterRunOptions {
  /** The module bytes. Verified again inside the Worker; never trusted from the caller. */
  wasm: Uint8Array;
  inputs: ConverterRunInput[];
  /** The bitfield from `tools[].options[]`. Unlisted bits are reserved and must be zero. */
  flags?: number;
  limits: ConverterLimits;
  /** The manifest's declared outputs. A name matching none of these is refused. */
  outputs: ConverterOutputSpec[];
  /** Called between `run_step` calls. */
  onProgress?: (p: ConverterProgress) => void;
  /** Milliseconds before the Worker is terminated. Default 120_000. */
  timeoutMs?: number;
  /** Ceiling on `run_step` iterations, so a module that never returns 0 still ends. */
  maxSteps?: number;
}

/**
 * TRANSITIONAL — the ONE place that resolves a module's emitted output label to a declared
 * output, and the only thing that still answers to the pre-`4eb5a86` meaning of that string.
 *
 * spec/04's amendment (gwrg-dist-spec `4eb5a86`, "a module labels its outputs, it does not
 * name them") changed the string a module emits from a FILENAME to the output's `id`. Modules
 * built before it still emit the filename: `smw-retro-go-sd` v0.4.1 — published 2026-09-09,
 * conformant in its manifest — ships `smw_restool.wasm` emitting `"smw_assets.dat"` where its
 * own manifest declares `outputs[0].id === "assets"`. Refusing it produces
 * `Couldn't prepare: unknown-output` on a conversion that otherwise succeeds.
 *
 * This is the same accommodation already made for `repeatable` (`inputGate.ts`) and for
 * `kind: "emulator"` (`types.ts`) — one renamed key, a lagging publisher, a documented sunset.
 * Deleting the fallback is removing the second `find` below, here and nowhere else.
 *
 * The fallback is deliberately narrow:
 *   - `id` always wins, so a conformant module can never be re-routed;
 *   - only a `filename` output can answer, because a derived (`extension`) output has no name
 *     to have been emitted;
 *   - the match must be UNIQUE. Two outputs whose filenames collide are ambiguous, and a
 *     wrong guess would write one output's bytes under another's name.
 */
export function outputSpecFor(
  specs: readonly ConverterOutputSpec[],
  emitted: string,
): ConverterOutputSpec | undefined {
  const byId = specs.find((s) => s.id === emitted);
  if (byId) return byId;
  const byName = specs.filter((s) => s.filename === emitted);
  return byName.length === 1 ? byName[0] : undefined;
}
