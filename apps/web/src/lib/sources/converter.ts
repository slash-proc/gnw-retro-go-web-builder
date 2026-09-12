/**
 * The converter host — public interface (gwrg-dist-spec spec/04-processor.md,
 * spec/05-host.md).
 *
 * This is the ONLY module the UI should import to run a converter. Everything below it is
 * implementation:
 *
 *   converter.ts        <- you are here: fetch + hash + gate + Worker + timeout
 *     converterWorker.ts   the thread a run happens on, so it can be terminated
 *       converterRun.ts    the ABI driver: verify, instantiate, feed, step, read back
 *         wasmVerify.ts    static verification of the binary, before instantiating
 *     inputGate.ts         `strict` / `maxBytes` / `variants[]`, before spending a run
 *
 * There is no UI in here and no device access. It takes a manifest tool and some files, and
 * it returns bytes or a `ConverterError`.
 *
 * The one thing a caller must not forget: `result.warnings` and `gate.unrecognised` are
 * requirements, not extras. "Accept it but tell the user it was not recognised" is one
 * requirement, and a warning a module took the trouble to emit is the only voice it has.
 */
import { fetchVerified } from "./client.js";
import { blobCache, type BlobCache } from "./blobCache.js";
import {
  ConverterError,
  type ConverterInput,
  type ConverterLimits,
  type ConverterOutputSpec,
  type ConverterProgress,
  type ConverterResult,
  type ConverterRunInput,
} from "./converterTypes.js";
import { DEFAULT_TIMEOUT_MS } from "./converterRun.js";
import type { ConverterWorkerMessage, ConverterWorkerRequest } from "./converterWorker.js";
import { checkProcessor, gateInputs, parseToolInputs, parseToolLimits, parseToolOutputs } from "./inputGate.js";
import type { GateVerdict } from "./inputGate.js";
import { SourceError, type Tool } from "./types.js";

export { ConverterError } from "./converterTypes.js";
export type {
  ConverterInput,
  ConverterLimits,
  ConverterOutput,
  ConverterOutputSpec,
  ConverterProgress,
  ConverterResult,
  ConverterRunInput,
} from "./converterTypes.js";
export type { GateResult, GateVerdict, OfferedFile } from "./inputGate.js";
export { checkBiosFile, gateInputs, parseToolInputs, parseToolLimits, parseToolOutputs, sha1Hex } from "./inputGate.js";
export { isPlainFilename } from "./converterRun.js";
// The name-safety invariants (spec/05: a declared name wins, compared case-folded, per
// destination directory). Re-exported here so a caller running a converter never has to reach
// past this module to find out whether what it produced may be written.
export { describeCollision, firstCollisionError, foldDir, foldName, planNames } from "./outputNames.js";
export type { NameCollision, NameOrigin, NamePlan, PlannedName } from "./outputNames.js";
export { parseWasm, verifyConverterModule, ABI_EXPORTS } from "./wasmVerify.js";

/**
 * A manifest tool, narrowed once into everything a run needs.
 *
 * Produced by `prepareTool`, which is also where the `processor` version gate fires — so a
 * `wasm`/`2` tool is refused at the point a UI first tries to describe it, rather than at the
 * point a user has already gone and found a ROM for it.
 */
export interface PreparedTool {
  id: string;
  title: Record<string, string>;
  binary: { url: string; bytes: number; sha256: string };
  limits: ConverterLimits;
  inputs: ConverterInput[];
  outputs: ConverterOutputSpec[];
}

/** Injected seams for `fetchConverterBinary`, for tests only. Production passes nothing. */
export interface ConverterBinaryDeps {
  fetch?: (url: string, sha256: string) => Promise<Uint8Array>;
  cache?: BlobCache;
}

/**
 * Did the publisher WRITE a `maxCount`, whatever its value?
 *
 * The spec's `inp.maxCount !== undefined` over raw JSON, spelled out so the one place that
 * cares reads as a question about the manifest rather than about our narrowing. `null` counts
 * as written: it is a key the publisher put there, and it is not a cap we can honour.
 */
function rawMaxCountPresent(raw: Record<string, unknown> | undefined): boolean {
  return raw !== undefined && raw !== null && "maxCount" in raw && raw.maxCount !== undefined;
}

/**
 * The cross-field run-shape rules, mirrored from the spec's own checker.
 *
 * FOUR ERRORs live in one block of `gwrg-dist-spec/site/check.js` (the `// Cross-field rules
 * JSON Schema cannot state.` loop). We enforce them here rather than trusting that the
 * publisher ran that checker, which is the trust `parseToolOutputs`'s docblock says a host
 * does not get to extend to the party it is validating.
 *
 * `parseToolOutputs` has already established `filename` XOR `extension` per output, so
 * "derived" and "fixed" are exhaustive and mutually exclusive below.
 *
 * 1. A `runPerFile` input needs `allowMultiple`: a single-file slot has nothing to iterate.
 * 2. A `maxCount` needs `allowMultiple` too: a slot that takes one file cannot cap a count it
 *    cannot have. See `rawMaxCountPresent` below for why this one reads the RAW key.
 * 3. A derived output name comes from the file being converted, so EXACTLY ONE input has to be
 *    the thing being iterated. Note both directions are refused: zero per-file inputs is as
 *    broken as two, because a derived name with nothing to derive from has no source either.
 *    This is the rule `homebrewConvert.ts` used to take on trust when it picked the FIRST
 *    per-file input out of possibly several and converted it, silently, instead of the one the
 *    publisher meant.
 * 4. A tool either runs per file or runs once. gwrg-dist-spec `44b0bf3`.
 *
 * A `runPerFile` input means one run per file supplied; an output with a fixed `filename` is
 * written on every one of those runs, under the same name each time, so the second file
 * converted collides with the first. The manifest is a collision with itself.
 *
 * Rule 4's refusal is deliberately the MIXED shape the spec's checker refuses, not "runPerFile
 * plus any fixed name". A per-file tool whose outputs are ALL fixed is a `WARN` upstream, not
 * an error ("only the last survives"), and promoting it here would refuse manifests the
 * publisher was told were publishable. The error fires only when the tool ALSO has a derived
 * output -- that is the OpenLara shape (a `.PKD` per level beside a single `TITLE.SCR`), where
 * the remedy is two tools that may share one binary. That all-fixed WARN shape stays accepted,
 * and rule 3 cannot catch it either, because rule 3 is gated on a derived output existing.
 *
 * `SourceError("malformed")` rather than a code of its own: this is the same manifest-shape
 * family as every other refusal in `parseToolOutputs`, it already maps to the `unreadable`
 * prepare group ("the project published something this tool cannot run"), and the detail is
 * what a maintainer reads in the activity log. A new code would buy a log string we can carry
 * in `detail` at the cost of a fifth thing to keep in sync.
 */
function checkRunShape(
  tool: Tool,
  inputs: ConverterInput[],
  outputs: ConverterOutputSpec[],
  toolId: string,
): void {
  // `parseToolInputs` is a `.map()` over `tool.inputs` that throws on any malformed entry, so
  // reaching here means the two arrays are the same length in the same order, and `raw[i]` is
  // the manifest the publisher wrote for `inputs[i]`.
  const raw = Array.isArray(tool.inputs) ? (tool.inputs as unknown as Record<string, unknown>[]) : [];
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    // 1. Per input. Read from the PARSED input, so this asks what the tool actually does here:
    // `parseToolInputs` keeps `runPerFile` only when it is literally `true`, and resolves
    // `allowMultiple` through the `repeatable` shim, so an old manifest is judged on the flag it
    // meant rather than the key it spelled.
    if (inp.runPerFile && !inp.allowMultiple) {
      throw new SourceError("malformed", `${toolId}/${inp.id}: runPerFile without allowMultiple`);
    }
    // 2. `maxCount` without `allowMultiple`. This one reads the RAW key while rule 1 reads the
    // parsed flag, and the asymmetry is deliberate rather than an oversight:
    //
    //   - `allowMultiple` is read RESOLVED, for rule 1's reason exactly: a manifest spelling it
    //     `repeatable` means the same thing, and refusing it would defeat `allowMultipleOf`.
    //   - `maxCount` is read RAW, because `parseToolInputs` keeps it only when it is an integer
    //     >= 1 and DROPS it silently otherwise. Reading the parsed value would ask "did the
    //     publisher write a cap we happened to like?", and answer "no cap" for a manifest that
    //     visibly states one. Refusing beats enforcing something the publisher did not write.
    //
    // This costs nothing against the spec, because the two readings cannot disagree on any
    // manifest the spec's checker evaluates this rule on: `manifest.schema.json` types
    // `maxCount` as `{integer, minimum 1}` -- our exact parsed condition -- and `check.js`
    // RETURNS at the schema step, so a manifest with `maxCount: "3"` or `0` never reaches the
    // cross-field loop at all. The readings differ only on manifests the schema already
    // refuses, and we have no schema validator of our own to refuse them with.
    if (rawMaxCountPresent(raw[i]) && !inp.allowMultiple) {
      throw new SourceError("malformed", `${toolId}/${inp.id}: maxCount without allowMultiple`);
    }
  }
  const perFile = inputs.filter((i) => i.runPerFile);
  const derived = outputs.filter((o) => o.extension !== undefined);
  // 3. A derived name needs exactly one input to derive it from -- never zero, never several.
  if (derived.length > 0 && perFile.length !== 1) {
    throw new SourceError(
      "malformed",
      `${toolId}: ${derived.length} derived output(s), ${perFile.length} runPerFile input(s)`,
    );
  }
  // 4. The mixed shape: a fixed name written once per run, on a tool that runs once per file.
  if (perFile.length === 0 || derived.length === 0) return;
  const fixed = outputs.find((o) => o.filename !== undefined);
  if (fixed) throw new SourceError("malformed", `${toolId}/${fixed.id}: ${fixed.filename}`);
}

/** Narrow and version-gate a manifest tool. Throws `ConverterError`/`SourceError`. */
export function prepareTool(tool: Tool): PreparedTool {
  checkProcessor(tool);
  const b = tool.binary as unknown as Record<string, unknown>;
  if (typeof b?.url !== "string" || typeof b?.bytes !== "number" || typeof b?.sha256 !== "string") {
    throw new SourceError("malformed");
  }
  const inputs = parseToolInputs(tool);
  const outputs = parseToolOutputs(tool);
  checkRunShape(tool, inputs, outputs, tool.id);
  return {
    id: tool.id,
    title: tool.title,
    binary: { url: b.url, bytes: b.bytes, sha256: b.sha256 },
    limits: parseToolLimits(tool),
    inputs,
    outputs,
  };
}

/**
 * Fetch the module and check it against the manifest before it is ever compiled.
 *
 * "Hash the bytes you fetched and compare with `tools[].binary.sha256`. If they disagree,
 * refuse — do not prefer one over the other." `fetchVerified` (client.ts) does exactly that;
 * the size check here is a cheap second opinion on the same question.
 */
export async function fetchConverterBinary(
  tool: PreparedTool,
  deps?: ConverterBinaryDeps,
): Promise<Uint8Array> {
  const fetchOne = deps?.fetch ?? fetchVerified;
  const cache = deps?.cache ?? blobCache();
  // The manifest's sha256 is the cache key, so the lookup costs nothing extra and a hit is
  // self-verifying (`BlobCache.get` re-hashes and reports a mismatch as a miss). The size check
  // below still runs on a hit, exactly as it does on a download — a local store is not trusted
  // any further than a mirror is.
  const key = tool.binary.sha256.toLowerCase();
  let bytes = await cache.get(key).catch(() => null);
  if (!bytes) {
    bytes = await fetchOne(tool.binary.url, tool.binary.sha256);
    // Never let a storage failure fail the run.
    await cache.put(key, bytes, "converter").catch(() => false);
  }
  if (bytes.byteLength !== tool.binary.bytes) {
    throw new ConverterError("binary-hash", `${bytes.byteLength} != ${tool.binary.bytes}`);
  }
  return bytes;
}

export interface RunConverterOptions {
  tool: PreparedTool;
  /** The verified module bytes, from `fetchConverterBinary`. */
  wasm: Uint8Array;
  /** Files that have already passed `gateInputs`. */
  inputs: ConverterRunInput[];
  /** Bitfield from `tools[].options[]`. Unlisted bits are reserved and must be zero. */
  flags?: number;
  onProgress?: (p: ConverterProgress) => void;
  /** Milliseconds before the Worker is terminated. Default 120_000. */
  timeoutMs?: number;
  /**
   * Aborting terminates the Worker. This is the only cancellation the ABI admits — the
   * module cannot be asked to stop, so it is stopped from outside.
   */
  signal?: AbortSignal;
  /** Injected by the validation script so the driver can be exercised without a Worker. */
  spawnWorker?: () => Worker;
}

/** How a Worker is normally made. Vite rewrites this URL at build time. */
function defaultSpawn(): Worker {
  return new Worker(new URL("./converterWorker.ts", import.meta.url), {
    type: "module",
    name: "gwrg-converter",
  });
}

/**
 * Run a converter in a Worker, with a timeout.
 *
 * The Worker is ALWAYS terminated — on success, on failure, on timeout, on abort. A converter
 * that has finished still holds its whole linear memory (up to `limits.maxMemoryPages`, which
 * for smw is 256 MiB), and the only way to give that back is to end the thread.
 */
export function runConverter(opts: RunConverterOptions): Promise<ConverterResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawn = opts.spawnWorker ?? defaultSpawn;

  return new Promise<ConverterResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = spawn();
    } catch (e) {
      reject(new ConverterError("worker-failed", e instanceof Error ? e.message : String(e)));
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      fn();
    };

    function onAbort(): void {
      finish(() => reject(new ConverterError("timeout", "aborted")));
    }

    // The timeout is not reset by progress. A converter is a bounded transform of a file the
    // user already has on disk, not a transfer that can legitimately stall — unlike the flash
    // path, where the watchdog measures a LACK of progress. Here, total wall clock is the
    // right thing to bound.
    timer = setTimeout(() => {
      finish(() => reject(new ConverterError("timeout", `${timeoutMs}ms`)));
    }, timeoutMs);

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish(() => reject(new ConverterError("timeout", "aborted")));
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    worker.onmessage = (e: MessageEvent<ConverterWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        // Progress arrives after the run may already have been settled by a timeout; the
        // guard keeps a late message from calling back into a finished UI.
        if (!settled) opts.onProgress?.(msg.progress);
        return;
      }
      if (msg.type === "done") {
        finish(() =>
          resolve({
            outputs: msg.outputs,
            warnings: msg.warnings,
            durationMs: msg.durationMs,
            steps: msg.steps,
          }),
        );
        return;
      }
      finish(() => reject(new ConverterError(msg.code as ConverterError["code"], msg.detail)));
    };

    worker.onerror = (e) => {
      // A module worker that fails to load reports here with an almost empty event; the
      // message is whatever there is, and it is untrusted text either way.
      finish(() =>
        reject(new ConverterError("worker-failed", typeof e === "object" && e && "message" in e ? String((e as ErrorEvent).message) : undefined)),
      );
    };

    worker.postMessage(buildWorkerRequest(opts));
  });
}

/**
 * Build the Worker message, field by field, out of values that are guaranteed cloneable.
 *
 * `postMessage` serialises with the structured clone algorithm, and StructuredSerializeInternal
 * throws `DataCloneError` for anything carrying a `[[ProxyHandler]]` slot. A `PreparedTool`
 * routinely reaches here as a Svelte 5 `$state` proxy — `RomManagementTab.svelte` holds the
 * chosen title in `let promptFor = $state<HomebrewTitle | null>(null)`, and `$state` proxies
 * plain objects and arrays DEEPLY, so `tool.limits` and `tool.outputs` (the two fields the old
 * code passed straight through by reference) were proxies and the post threw before the
 * converter ever started.
 *
 * The unwrap happens HERE, at the one boundary, rather than at each caller: `$state.snapshot`
 * is only available in a `.svelte`/`.svelte.ts` module and this file is plain TypeScript, and
 * a rule that every future caller must remember to pass plain data is a rule that will be
 * forgotten. Reading each primitive through the proxy yields the plain value, so this is a
 * handful of field reads — NOT a deep copy.
 *
 * `wasm` and `inputs[].bytes` are deliberately NOT copied. Svelte only proxies values whose
 * prototype is `Object.prototype` or `Array.prototype` (`svelte/src/internal/client/proxy.js`),
 * so a `Uint8Array` is handed back untouched even when it sits inside a proxied object — it is
 * already cloneable, and copying megabytes of ROM to prove it would be waste. They are not
 * transferred either: `prepareState` and the input prompt still hold those buffers after a run
 * (a retry re-posts the same bytes), and transferring would detach them.
 */
function buildWorkerRequest(opts: RunConverterOptions): ConverterWorkerRequest {
  const { limits, outputs } = opts.tool;
  return {
    wasm: opts.wasm,
    inputs: opts.inputs.map((i) => ({ inputId: i.inputId, filename: i.filename, bytes: i.bytes })),
    flags: opts.flags ?? 0,
    limits: { maxMemoryPages: limits.maxMemoryPages, maxOutputBytes: limits.maxOutputBytes },
    // `filename` XOR `extension`, so each is spread only when present — a `filename: undefined`
    // key would make a derived output look like a fixed one with a missing name.
    outputs: outputs.map((o) => ({
      id: o.id,
      ...(o.filename !== undefined ? { filename: o.filename } : {}),
      ...(o.extension !== undefined ? { extension: o.extension } : {}),
      maxBytes: o.maxBytes,
    })),
  };
}

/**
 * The whole flow, in the order spec/05 requires it: gate the files, then run.
 *
 * The ordering is the point. The gate is what makes "an obviously wrong file costs nothing"
 * true, and it is the host's job precisely because only the host has the file, the hashes and
 * the user. A caller that wants to show the verdicts before committing to a run should call
 * `gateInputs` and `runConverter` itself; this is the convenience for the case that does not.
 */
export async function gateAndRun(
  opts: RunConverterOptions & { files: { inputId: string; filename: string; bytes: Uint8Array }[] },
): Promise<ConverterResult & { unrecognised: string[]; verdicts: GateVerdict[] }> {
  const gate = await gateInputs(opts.tool.inputs, opts.files);
  if (gate.errors.length > 0) throw gate.errors[0];
  const result = await runConverter({ ...opts, inputs: gate.accepted });
  // The verdicts come back too, because a DERIVED output name is resolved from them: rule 1
  // of spec/03's resolution order is the matched variant's `filename`, and the gate is the
  // only place that ever knew which variant matched.
  return { ...result, unrecognised: gate.unrecognised.map((v) => v.filename), verdicts: gate.verdicts };
}
