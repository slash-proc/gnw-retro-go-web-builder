/**
 * The Worker a converter runs in (gwrg-dist-spec spec/05-host.md, "Run it in a Worker with a
 * timeout").
 *
 * "The ABI has no cancellation flag and cannot have one. Terminating the Worker is the only
 * way to stop a run and the only way to reclaim its memory."
 *
 * So this file is thin on purpose. It owns no policy — every rule lives in `converterRun.ts`
 * and `wasmVerify.ts`, which the plain-node validation script exercises directly. All this
 * does is unwrap a message, call the driver, and post progress and a result back. The
 * interesting property of the Worker is not what it computes; it is that the main thread can
 * `terminate()` it, which is the only cancellation the ABI admits.
 *
 * Loaded by Vite as a module worker (`new Worker(url, { type: "module" })`).
 */
import { ConverterError, type ConverterProgress, type ConverterRunOptions } from "./converterTypes.js";
import { runConverterModule } from "./converterRun.js";

/** Main thread -> Worker. Exactly the run options, minus the callback (not structured-clonable). */
export interface ConverterWorkerRequest {
  wasm: Uint8Array;
  inputs: { inputId: string; filename: string; bytes: Uint8Array }[];
  flags: number;
  limits: ConverterRunOptions["limits"];
  outputs: ConverterRunOptions["outputs"];
  maxSteps?: number;
}

/** Worker -> main thread. */
export type ConverterWorkerMessage =
  | { type: "progress"; progress: ConverterProgress }
  | {
      type: "done";
      outputs: { name: string; outputId: string; bytes: Uint8Array }[];
      warnings: string[];
      durationMs: number;
      steps: number;
    }
  | { type: "error"; code: string; detail?: string };

// `self` is typed as a Window under the DOM lib; a module worker's global is a
// DedicatedWorkerGlobalScope. Narrowed locally so this file needs no lib change.
const ctx = self as unknown as {
  onmessage: ((e: { data: ConverterWorkerRequest }) => void) | null;
  postMessage(message: ConverterWorkerMessage, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const req = e.data;
  void (async () => {
    try {
      const result = await runConverterModule({
        wasm: req.wasm,
        inputs: req.inputs,
        flags: req.flags,
        limits: req.limits,
        outputs: req.outputs,
        maxSteps: req.maxSteps,
        onProgress: (progress) => ctx.postMessage({ type: "progress", progress }),
      });
      // Transfer the output buffers rather than copying them: they are the whole payload,
      // and this Worker is about to be terminated anyway.
      const transfer = result.outputs.map((o) => o.bytes.buffer as Transferable);
      ctx.postMessage(
        {
          type: "done",
          outputs: result.outputs,
          warnings: result.warnings,
          durationMs: result.durationMs,
          steps: result.steps,
        },
        transfer,
      );
    } catch (err) {
      // A ConverterError does not survive structured cloning as a class, so it crosses as its
      // code and detail and is rebuilt on the other side.
      if (err instanceof ConverterError) {
        ctx.postMessage({ type: "error", code: err.code, detail: err.detail });
      } else {
        ctx.postMessage({
          type: "error",
          code: "worker-failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })();
};
