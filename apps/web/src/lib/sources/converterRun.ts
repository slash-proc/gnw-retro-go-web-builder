/**
 * The converter driver: verify, instantiate, feed, step, read back
 * (gwrg-dist-spec spec/04-processor.md, spec/05-host.md).
 *
 * This is the whole ABI in one file, and it runs SYNCHRONOUSLY on whatever thread calls it.
 * In the app that thread is a Worker (`converterWorker.ts`), because the ABI has no
 * cancellation flag and terminating the Worker is the only way to stop a run and reclaim its
 * memory. Keeping the driver separate from the Worker is what lets the plain-node validation
 * script exercise every one of these rules without a Worker at all.
 *
 * Two invariants run through the whole file and are the easiest things here to get wrong:
 *
 *   1. **Re-read `memory.buffer` after any call that can grow memory.** Growing DETACHES
 *      every ArrayBuffer captured beforehand, so a view taken before `alloc` is unusable
 *      after it. Nothing in this file holds a view across a module call — every access goes
 *      through `view()`, which builds a fresh one from the live buffer.
 *   2. **Every length is a number the module chose.** Bound it before allocating, and check
 *      `ptr + len` against `memory.buffer.byteLength` before constructing any view.
 *
 * No DOM, no node built-ins.
 */
import {
  ConverterError,
  SUPPORTED_ABI_VERSION,
  outputSpecFor,
  type ConverterOutput,
  type ConverterOutputSpec,
  type ConverterProgress,
  type ConverterResult,
  type ConverterRunOptions,
} from "./converterTypes.js";
import { verifyConverterModule } from "./wasmVerify.js";

/** Longest a stage or output name may be. Filenames on the card are short; this is generous. */
const MAX_NAME_BYTES = 255;

/**
 * Longest a FILENAME may be, from `$defs/filename`'s `maxLength` (gwrg-dist-spec `fb4c8be`).
 * Separate from `MAX_NAME_BYTES`, which bounds what a module may hand back over the ABI before
 * that name is known to be a filename at all.
 */
const MAX_FILENAME_CHARS = 200;

/** Longest an error or warnings blob may be. A module cannot flood the host with a message. */
const MAX_MESSAGE_BYTES = 64 * 1024;

/** Refuse a module claiming an implausible number of outputs before reading any of them. */
const MAX_OUTPUT_COUNT = 256;

/** Refuse an implausible stage count before asking for names. */
const MAX_STAGE_COUNT = 1024;

/** Default ceiling on `run_step` calls, so a module that never returns 0 still terminates. */
const DEFAULT_MAX_STEPS = 1_000_000;

/** Default wall-clock ceiling for a whole run. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * A name the destination card can actually hold, matching `$defs/filename` in
 * `schema/manifest.schema.json` (gwrg-dist-spec `fb4c8be`, "Let a filename be a name people
 * actually write").
 *
 * The spec inverted this rule: it used to be a whitelist of letters, digits, space, dot,
 * hyphen and underscore, which cannot express `Doom (Shareware).whd` or `Kirby's Adventure`
 * or anything else following the No-Intro and GoodTools conventions every variant name uses.
 * What is excluded now is what FAT and exFAT refuse, plus the one exclusion that was ever
 * about safety: a separator, which would let a name escape its directory.
 *
 * OUR rule was never the old whitelist, so the relaxation cost us nothing. It was, however,
 * looser than the card in three ways that would each have produced a name we accept and the
 * filesystem then rejects: the exFAT-illegal set `" * : < > ? |`, a leading or trailing dot,
 * and a 255-character ceiling where the spec says 200.
 *
 * `\x7f` (DEL) is excluded here and not by the spec's pattern. It is deliberate and stricter:
 * DEL in a filename is never something a publisher means.
 *
 * Note the deliberate absence of a Unicode escape: `\x00-\x1f` is the C0 range.
 */
// eslint-disable-next-line no-control-regex
const PLAIN_FILENAME = /^[^\x00-\x1f\x7f"*/:<>?\\|. ](?:[^\x00-\x1f\x7f"*/:<>?\\|]*[^\x00-\x1f\x7f"*/:<>?\\|. ])?$/;

/**
 * Names that are a plain filename by the regex but must still never reach a filesystem.
 * Both are already refused by the leading-dot rule above; this is belt and braces, and it is
 * what keeps the intent legible when someone next reads the regex.
 */
const RESERVED_NAMES = new Set([".", ".."]);

export function isPlainFilename(name: string): boolean {
  if (name.length === 0 || name.length > MAX_FILENAME_CHARS) return false;
  if (!PLAIN_FILENAME.test(name)) return false;
  if (RESERVED_NAMES.has(name)) return false;
  // A `..` in the MIDDLE of a name (`Doom..whd`) is legal on the card and the spec allows it:
  // "A separator still cannot appear, which is the only exclusion that was ever about safety."
  // The class above excludes both separators, so `..` can never be a path segment here, and a
  // bare `..` is refused by the leading-dot rule. Refusing it anywhere else was over-strict.
  return true;
}

/** The exports this driver calls, once they have been checked out of the instance. */
interface AbiFns {
  memory: WebAssembly.Memory;
  abi_version(): number;
  alloc(len: number): number;
  input_clear(): void;
  input_add(ptr: number, len: number): number;
  run_begin(flags: number): number;
  run_step(): number;
  stage_count(): number;
  stage_index(): number;
  stage_name_ptr(i: number): number;
  stage_name_len(i: number): number;
  output_count(): number;
  output_name_ptr(i: number): number;
  output_name_len(i: number): number;
  output_ptr(i: number): number;
  output_len(i: number): number;
  error_ptr(): number;
  error_len(): number;
  warnings_ptr(): number;
  warnings_len(): number;
}

/**
 * A live window onto the module's memory, built fresh on every access.
 *
 * This exists so that no call site can hold a view across a module call. Do not be tempted to
 * hoist it: `memory.buffer` is a different ArrayBuffer after any growth, and the old one is
 * detached, which surfaces as a zero-length read rather than an exception on some paths.
 */
function view(fns: AbiFns, ptr: number, len: number): Uint8Array {
  const buf = fns.memory.buffer;
  // >>> 0 because the ABI's pointers and lengths are u32 and JS hands us signed i32 results.
  const p = ptr >>> 0;
  const l = len >>> 0;
  if (p + l > buf.byteLength) {
    throw new ConverterError("out-of-bounds", `${p}+${l} > ${buf.byteLength}`);
  }
  return new Uint8Array(buf, p, l);
}

/** Copy bytes OUT of module memory. The copy is what the caller keeps; the view is not. */
function copyOut(fns: AbiFns, ptr: number, len: number): Uint8Array {
  return new Uint8Array(view(fns, ptr, len));
}

/** Decode a module string strictly. It is TEXT — never markup, never a path. */
function readString(fns: AbiFns, ptr: number, len: number, cap: number, what: string): string {
  const l = len >>> 0;
  if (l > cap) throw new ConverterError("output-too-large", `${what}: ${l} > ${cap}`);
  const bytes = view(fns, ptr, l);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ConverterError("bad-utf8", what);
  }
}

/** Pull the module's own error message after a non-zero return. Never rendered as markup. */
function readModuleError(fns: AbiFns, code: number): ConverterError {
  let message = "";
  try {
    message = readString(fns, fns.error_ptr(), fns.error_len(), MAX_MESSAGE_BYTES, "error");
  } catch {
    // A module that fails and then lies about where its message is gets the code alone.
    message = "";
  }
  return new ConverterError("module-error", message ? `${code}: ${message}` : `${code}`);
}

/** Check the instance actually exports callables of the shapes the verifier promised. */
function bindAbi(instance: WebAssembly.Instance): AbiFns {
  const e = instance.exports as Record<string, unknown>;
  const memory = e.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new ConverterError("bad-export", "memory");
  }
  const fn = (name: string): ((...a: number[]) => number) => {
    const f = e[name];
    if (typeof f !== "function") throw new ConverterError("missing-export", name);
    return f as (...a: number[]) => number;
  };
  return {
    memory,
    abi_version: fn("abi_version"),
    alloc: fn("alloc"),
    input_clear: fn("input_clear") as unknown as () => void,
    input_add: fn("input_add"),
    run_begin: fn("run_begin"),
    run_step: fn("run_step"),
    stage_count: fn("stage_count"),
    stage_index: fn("stage_index"),
    stage_name_ptr: fn("stage_name_ptr"),
    stage_name_len: fn("stage_name_len"),
    output_count: fn("output_count"),
    output_name_ptr: fn("output_name_ptr"),
    output_name_len: fn("output_name_len"),
    output_ptr: fn("output_ptr"),
    output_len: fn("output_len"),
    error_ptr: fn("error_ptr"),
    error_len: fn("error_len"),
    warnings_ptr: fn("warnings_ptr"),
    warnings_len: fn("warnings_len"),
  };
}

/** Read the name of one stage, tolerating a module that has none. */
function stageName(fns: AbiFns, i: number): string {
  try {
    return readString(fns, fns.stage_name_ptr(i), fns.stage_name_len(i), MAX_NAME_BYTES, "stage name");
  } catch {
    // A missing or malformed stage name is cosmetic. It must not abort a healthy run.
    return "";
  }
}

/**
 * Run a verified module to completion on the current thread.
 *
 * `opts.wasm` is verified again here rather than trusted from the caller — this function is
 * the last place before `WebAssembly.instantiate`, and the caller may be a Worker message.
 * The instantiate itself passes NO import object, which is what makes the ENGINE enforce
 * what the verifier asserted (spec/05).
 */
export async function runConverterModule(opts: ConverterRunOptions): Promise<ConverterResult> {
  const started = Date.now();
  const flags = opts.flags ?? 0;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  // 1. Verify the binary from its own bytes, before anything is instantiated.
  verifyConverterModule(opts.wasm, opts.limits);

  // 2. Instantiate with no import object at all. Not `{}` — nothing.
  let instance: WebAssembly.Instance;
  try {
    const module = await WebAssembly.compile(opts.wasm as unknown as BufferSource);
    instance = await WebAssembly.instantiate(module);
  } catch (e) {
    throw new ConverterError("instantiate-failed", e instanceof Error ? e.message : String(e));
  }
  const fns = bindAbi(instance);

  // 3. The module's own claim about which ABI it implements. Refuse an unknown one rather
  //    than guessing: every export's meaning hangs off this number.
  const abi = fns.abi_version() >>> 0;
  if (abi !== SUPPORTED_ABI_VERSION) throw new ConverterError("unsupported-abi", String(abi));

  // 4. Feed the inputs. The host never picks an address; it asks.
  fns.input_clear();
  for (const input of opts.inputs) {
    const len = input.bytes.byteLength;
    const ptr = fns.alloc(len) >>> 0;
    if (ptr === 0 && len > 0) throw new ConverterError("alloc-failed", input.filename);
    // `alloc` is exactly the call that grows memory, so this view is built AFTER it and is
    // never reused. Re-deriving it here is the entire point.
    view(fns, ptr, len).set(input.bytes);
    fns.input_add(ptr, len);
    // `input_add`'s return is an index, not a status. Nothing to check: the module resolves
    // roles by hashing content, so an index the host does not use is an index it cannot
    // misuse.
  }

  // 5. Drive the STEPPED path even though nothing here needs progress — "so the incremental
  //    route is the one your tests cover rather than a second, less-travelled one" (spec/05,
  //    Recommended). `run()` is exactly this loop and is deliberately never called.
  const beginCode = fns.run_begin(flags) >>> 0;
  if (beginCode !== 0) throw readModuleError(fns, beginCode);

  let count = fns.stage_count() >>> 0;
  if (count > MAX_STAGE_COUNT) count = 0; // An absurd claim is reported as "no stages".

  let steps = 0;
  for (;;) {
    if (steps >= maxSteps) throw new ConverterError("no-progress", `${steps} steps`);
    const code = fns.run_step() >>> 0;
    steps++;
    if (code === 0) break;
    if (code !== 1) throw readModuleError(fns, code);
    if (opts.onProgress) {
      const index = fns.stage_index() >>> 0;
      const progress: ConverterProgress = {
        index,
        count,
        stage: index < count ? stageName(fns, index) : "",
      };
      opts.onProgress(progress);
    }
  }

  // 6. Read the results back. Everything from here is a value the module chose.
  const outputs = readOutputs(fns, opts.outputs, opts.limits.maxOutputBytes);

  let warnings: string[] = [];
  try {
    const blob = readString(fns, fns.warnings_ptr(), fns.warnings_len(), MAX_MESSAGE_BYTES, "warnings");
    warnings = blob.split("\n").map((w) => w.trim()).filter(Boolean);
  } catch {
    warnings = [];
  }

  return { outputs, warnings, durationMs: Date.now() - started, steps };
}

/**
 * Read every output, checking each label and length before a byte is copied.
 *
 * **The string a module emits is an `id`, not a filename** (spec/04: "A module labels its
 * outputs, it does not name them"). It is matched against `tools[].outputs[]` by `id`, and
 * the name that string once carried is now resolved by the host from the manifest and from
 * the file that was converted. The ABI did not change; only what the string means did.
 *
 * Every check that guarded it as a name still guards it as an id, deliberately. The PATTERN
 * (`isPlainFilename`) stops control characters, separators and `..` in a value that is about
 * to be reported to a user and used as a map key; the MANIFEST check stops a well-formed
 * string the project never declared; the DUPLICATE check stops one run claiming the same
 * output twice. None of them got weaker by the string meaning something narrower.
 */
function readOutputs(fns: AbiFns, specs: ConverterOutputSpec[], maxOutputBytes: number): ConverterOutput[] {
  const n = fns.output_count() >>> 0;
  if (n > MAX_OUTPUT_COUNT) throw new ConverterError("output-too-large", `${n} outputs`);

  const results: ConverterOutput[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < n; i++) {
    const name = readString(
      fns,
      fns.output_name_ptr(i),
      fns.output_name_len(i),
      MAX_NAME_BYTES,
      `output ${i} id`,
    );
    if (!isPlainFilename(name)) throw new ConverterError("output-name", name);

    // `outputSpecFor`, not a bare id lookup: it also answers to the pre-`4eb5a86` modules that
    // still emit the declared FILENAME instead of the id. See its comment for the sunset.
    const spec = outputSpecFor(specs, name);
    if (!spec) throw new ConverterError("unknown-output", name);
    // One run cannot produce the same declared output twice: the second would silently
    // overwrite the first, whatever the two ended up being called.
    if (seen.has(spec.id)) throw new ConverterError("unknown-output", `${name} (duplicate)`);
    seen.add(spec.id);

    // BOUND THE LENGTH BEFORE ALLOCATING. `output_len` is a u32 the module chose; the point
    // is to reject an absurd claim here rather than discover it when the tab dies. Both
    // ceilings apply — the tool-wide one and this output's own.
    const len = fns.output_len(i) >>> 0;
    const ceiling = Math.min(maxOutputBytes, spec.maxBytes);
    if (len > ceiling) throw new ConverterError("output-too-large", `${name}: ${len} > ${ceiling}`);

    // `copyOut` re-derives its view from the live buffer and checks ptr+len against it.
    results.push({ name, outputId: spec.id, bytes: copyOut(fns, fns.output_ptr(i), len) });
  }

  return results;
}
