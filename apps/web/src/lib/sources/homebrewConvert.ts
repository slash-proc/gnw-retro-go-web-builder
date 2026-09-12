/**
 * "Prepare" a homebrew title: run its manifest converter over the user's files.
 *
 * This is what replaced `engine/restool.ts` (Pyodide + a bundled `restools.zip`). The module
 * is now fetched from the source's own release, hash-verified against `tools[].binary.sha256`,
 * statically verified, and run in a terminable Worker — none of which the app carries.
 *
 * ## The run loop lives HERE, above `runConverter`
 *
 * `runConverter()` is per-run and stateless — it spawns a Worker, drives one module to
 * completion and terminates the thread, which is the only cancellation the ABI admits. So
 * "how many runs" is not its question, and pushing it down there would have made a stateless
 * thing stateful. It is this module's question, and there are exactly two answers
 * (spec/03-manifest.md, "One run, or one run per file"):
 *
 *   - **one run over every file** — zelda3's shape: a base ROM plus any number of translated
 *     ROMs, all feeding ONE run that produces ONE asset pack. This is `allowMultiple` alone;
 *   - **one run per file** — Doom's shape: a library of WADs, one `.whd` out of each. This is
 *     `runPerFile`, which requires `allowMultiple` because a single-file slot has nothing to
 *     iterate.
 *
 * The axis lives on the INPUT because the input is what multiplies. Every OTHER input is
 * passed to every run unchanged — that is how a conversion mod gets its base IWAD alongside
 * each PWAD — and the number of outputs follows from the number of runs rather than being
 * stated anywhere.
 *
 * The gate runs ONCE, over the whole offered set, before any Worker is spawned. That ordering
 * is the point of `maxCount`: with `runPerFile` the run count IS the file count, "the one
 * genuinely open-ended thing in this model" (spec/05), and discovering the ceiling after eight
 * runs would enforce nothing.
 *
 * ## Accumulation, and why outputs are a LIST before they are a Map
 *
 * Outputs accumulate ACROSS runs rather than replacing (spec/05). The obvious accumulator — a
 * `Map` written on every run — is wrong in a way that is invisible: two runs deriving the same
 * name would silently overwrite, which is precisely the collision `outputNames.ts` exists to
 * refuse. So each run appends to a LIST, the whole list goes through `planNames()` with the
 * artifacts and everything else destined for the same directory, and only a clean plan becomes
 * a `Map`. A collision is refused (`name-collision`), never renamed around and never written.
 *
 * "The same directory" is decided per OUTPUT, not per target — `placement.ts`'s `outputSubdir`
 * can send one tool's outputs to two directories, where two identical names are two files.
 *
 * The two things a caller must not drop on the floor: `warnings` (the only voice a module has)
 * and `unrecognised` (files accepted under `strict: false`, which the user MUST be told
 * about). Both are returned rather than logged here, because only the UI can show them.
 */
import { fetchConverterBinary, runConverter, ConverterError, isPlainFilename } from "./converter.js";
import type { ConverterBinaryDeps } from "./converter.js";
import type {
  ConverterOutputSpec,
  ConverterProgress,
  ConverterRunInput,
} from "./converterTypes.js";
import { gateInputs, type GateVerdict, type OfferedFile } from "./inputGate.js";
import { firstCollisionError, planNames, type PlannedName } from "./outputNames.js";
import { artifactDir, converterOutputDir, outputSubdir, useForTool } from "./placement.js";
import type { HomebrewTitle } from "./homebrewTitles.svelte.js";

export interface HomebrewConversion {
  /**
   * Where each produced file goes RELATIVE to `converterOutputDir` -> bytes, accumulated over
   * every run.
   *
   * A bare filename for every output that sits directly in that directory, which is all of
   * them today. An output declaring `subdir` is `<subdir>/<filename>`, so the caller's single
   * key prefix still composes into the right path and two outputs sharing a name in different
   * subdirectories stay two entries here — a Map keyed by bare filename would silently keep
   * one, which is the exact overwrite the collision plan exists to prevent.
   */
  files: Map<string, Uint8Array>;
  /** Untrusted text from the module. Show it. */
  warnings: string[];
  /** Filenames accepted despite matching no `variants[]` entry. Show these too. */
  unrecognised: string[];
}

/**
 * One run's worth of input: every non-per-file file, plus (when the tool iterates) the ONE
 * file this run is for.
 */
export interface ConverterRunBatch {
  inputs: ConverterRunInput[];
  /**
   * The file this run converts, when the tool declares a `runPerFile` input. It is what a
   * DERIVED output name is derived from, and it is undefined for a single-run tool.
   */
  pivot?: OfferedFile;
}

const toRunInput = (f: OfferedFile): ConverterRunInput => ({
  inputId: f.inputId,
  filename: f.filename,
  bytes: f.bytes,
});

/**
 * How many times to run, and with what — pure, so the decision can be pinned without a Worker.
 *
 * With no `runPerFile` input the answer is always ONE run over everything, however many files
 * were offered: that is zelda3, and a tool that took eleven translations and ran eleven times
 * would produce eleven asset packs where the manifest promised one.
 *
 * With one, there is a run per file OF THAT INPUT, and every other accepted file rides along
 * unchanged in each. Shared files come first so a module reading `input_add` order sees its
 * base before the file layered on it — the ABI resolves roles by hashing content, so this is
 * a courtesy rather than a contract, but it costs nothing to be the sane order.
 *
 * A `runPerFile` input that got no accepted file at all (it is optional, or the gate refused
 * everything offered under `strict: false`) falls back to a single run: there is nothing to
 * iterate, and refusing here would turn an optional slot into a required one.
 */
export function planRuns(accepted: OfferedFile[], perFileId: string | undefined): ConverterRunBatch[] {
  const pivots = perFileId === undefined ? [] : accepted.filter((f) => f.inputId === perFileId);
  if (pivots.length === 0) return [{ inputs: accepted.map(toRunInput) }];
  const shared = accepted.filter((f) => f.inputId !== perFileId).map(toRunInput);
  return pivots.map((pivot) => ({ inputs: [...shared, toRunInput(pivot)], pivot }));
}

/** One produced file, before it is known whether it may be written. */
interface ProducedFile {
  name: string;
  bytes: Uint8Array;
  spec: ConverterOutputSpec;
  /** The file it was derived from, for the collision message. Untrusted text. */
  from?: string;
}

export interface ConvertOptions {
  onProgress?: (p: ConverterProgress) => void;
  signal?: AbortSignal;
  /** Injected by the validation script. Production passes neither. */
  spawnWorker?: () => Worker;
  binaryDeps?: ConverterBinaryDeps;
}

/**
 * Fetch the module, gate the files, run it once or once per file, and settle the names.
 * Throws `ConverterError` / `SourceError`; the caller maps the code to copy rather than
 * surfacing a raw message.
 */
export async function convertHomebrewTitle(
  title: HomebrewTitle,
  files: OfferedFile[],
  opts?: ConvertOptions,
): Promise<HomebrewConversion> {
  const tool = title.tool;
  if (!tool) throw new ConverterError("unsupported-processor", title.key);

  const wasm = await fetchConverterBinary(tool, opts?.binaryDeps);

  // The files arrive already bound to an input: the prompt asks per-SLOT, so the user picking
  // a file for "Translated ROM" IS the answer to which input it belongs to. This used to
  // re-derive the id from the file extension instead, which silently broke every tool with two
  // inputs sharing an extension — zelda3 declares `base` and `language` both taking `.sfc`, so
  // an added translation was assigned to `base`, hashed against the single US variant, matched
  // nothing and was refused `input-unrecognised` under `base`'s `strict`. Never re-derive a
  // role the user already stated.
  //
  // ONE gate pass, over the whole set, before any Worker exists — `maxCount` and the arity
  // rules are only meaningful checked here.
  const gate = await gateInputs(tool.inputs, files);
  if (gate.errors.length > 0) throw gate.errors[0];

  // `gateInputs` pushes exactly one verdict per offered file, in order, on every branch — so
  // this pairs a file with the verdict that judged it without matching on a filename (two
  // files may share one) or on an input id (a `runPerFile` slot holds many).
  const verdictOf = new Map<OfferedFile, GateVerdict>();
  files.forEach((f, i) => {
    const v = gate.verdicts[i];
    if (v) verdictOf.set(f, v);
  });

  // Exactly one input can be the thing being iterated, so `find` is picking the only one there
  // is. That is now OUR guarantee, not the publisher's: `checkRunShape` (converter.ts) refuses
  // a tool with a derived output and anything other than one `runPerFile` input, so this can
  // no longer silently convert the first of several.
  const perFileId = tool.inputs.find((i) => i.runPerFile)?.id;
  const batches = planRuns(gate.accepted, perFileId);

  const produced: ProducedFile[] = [];
  const warnings: string[] = [];

  for (const batch of batches) {
    const result = await runConverter({
      tool,
      wasm,
      inputs: batch.inputs,
      ...(opts?.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
      ...(opts?.spawnWorker ? { spawnWorker: opts.spawnWorker } : {}),
    });

    // Which file THIS run's derived names come from. With `runPerFile` it is the pivot; for a
    // single run it is the first accepted file, which is the only file a derived name could
    // sensibly come from when the tool converts one thing.
    const source =
      (batch.pivot ? verdictOf.get(batch.pivot) : undefined) ??
      gate.verdicts.find((v) => v.error === undefined);

    for (const o of result.outputs) {
      // The manifest's spec, never the module's emitted string: since spec/04's amendment that
      // string is only an `id`, and a module has no say in any filename at all.
      const spec = tool.outputs.find((s) => s.id === o.outputId);
      if (!spec) throw new ConverterError("unknown-output", o.name);
      produced.push({
        name: resolveOutputName(spec, source),
        bytes: o.bytes,
        spec,
        ...(batch.pivot ? { from: batch.pivot.filename } : {}),
      });
    }
    warnings.push(...result.warnings);
  }

  // --- Placement, then the collision refusal -----------------------------------------------
  //
  // A homebrew's converted output sits beside its binary; a core's is a GAME and lands in
  // `roms/<system id>/`. That is what supplies the destination directory here — and the
  // directory is what `planNames` groups by, so two files that are one file on the card are
  // caught and two identically-named files in different directories are not.
  const use = useForTool(title.target, tool.id);
  const outDir = converterOutputDir(title.target, use);
  const artDir = artifactDir(title.target);

  // Per OUTPUT, not per target: `subdir` can send two of one tool's outputs to two
  // directories, and the collision grouping has to follow the REAL destination or it would
  // refuse two files that are two files on the card. `rel` is the same fact in the caller's
  // key space, where the directory is a prefix it supplies rather than part of the name.
  const placed = produced.map((p) => {
    const sub = outputSubdir(title.target, p.spec.subdir);
    return { p, dir: sub ? `${outDir}/${sub}` : outDir, rel: sub ? `${sub}/${p.name}` : p.name };
  });

  const planned: PlannedName[] = [
    // Publisher-declared names first for readability only; `planNames` ranks them itself.
    ...title.target.artifacts.map((a): PlannedName => ({ dir: artDir, name: a.filename, origin: "artifact" })),
    ...placed.map(
      ({ p, dir }): PlannedName => ({
        dir,
        name: p.name,
        origin: p.spec.filename !== undefined ? "fixed" : "derived",
        ...(p.from ? { from: p.from } : {}),
      }),
    ),
  ];
  const collision = firstCollisionError(planNames(planned));
  if (collision) throw collision;

  // Only now is a Map safe: every name in it is distinct on the card, so nothing is overwritten
  // on the way in. Keyed by `rel` for the same reason the plan groups by `dir` — two outputs
  // may legitimately share a filename when they land in different subdirectories.
  const out = new Map<string, Uint8Array>();
  for (const { p, rel } of placed) out.set(rel, p.bytes);

  return { files: out, warnings, unrecognised: gate.unrecognised.map((v) => v.filename) };
}

/**
 * The name a produced file takes on the card — spec/03's "How a derived name is resolved",
 * spec/05's "Resolve names yourself, and force the declared extension".
 *
 * A `filename` output is that name and nothing else looks at the input. An `extension` output
 * is derived, in exactly two rules, in order:
 *
 *   1. The matched variant's `filename`, when the input was recognised and that variant
 *      declares one. `DOOM2.WAD` becomes `"Doom II - Hell on Earth.whd"`.
 *   2. Otherwise the input file's own name: keep the stem, REPLACE the extension with the
 *      output's declared one. `MYHACK.WAD` becomes `MYHACK.whd`, never `MYHACK.WAD.whd`.
 *
 * Forcing the extension is the load-bearing half. The install set is a flat directory, so a
 * user-supplied stem entering it is untrusted input and a WAD named `doom.bin` must not land
 * where a core binary goes. Rule 1's name is publisher text and rule 2's is user text; both
 * are held to `isPlainFilename` before they are returned, and a name that survives neither is
 * an error the user resolves — spec/05 is explicit that there is no canned fallback, because
 * two files that collide would still collide under one.
 *
 * What this does NOT do, deliberately: check the result against anything else in the install
 * set. That is `outputNames.ts` (`planNames`) — collision, case-folding and the
 * declared-name-wins rule, which the loop above applies once every run has produced its files.
 */
export function resolveOutputName(spec: ConverterOutputSpec, source: GateVerdict | undefined): string {
  if (spec.filename !== undefined) return spec.filename;
  const ext = spec.extension;
  if (ext === undefined) throw new ConverterError("output-name", spec.id); // parse refuses this

  // Rule 1. `parseVariants` already held it to `isPlainFilename`; re-checking costs nothing
  // and a caller may hand us a hand-built spec.
  if (source?.variantFilename !== undefined && isPlainFilename(source.variantFilename)) {
    return source.variantFilename;
  }

  // Rule 2. The stem is everything before the LAST dot, so `My.Game.v2.wad` keeps
  // `My.Game.v2`. A leading dot is not an extension separator (`.hidden` is a stem), and a
  // name with no dot at all is already a stem.
  const raw = source?.filename ?? "";
  const dot = raw.lastIndexOf(".");
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  // An empty stem is the "sanitises to nothing usable" case, and it does NOT fall through to
  // `isPlainFilename` — a bare `.whd` passes that pattern perfectly well while naming nothing,
  // and every file that hit this would be called the same thing. spec/05 is explicit that
  // there is no canned fallback, precisely because two files that collide would still collide
  // under one; so this is an error the user resolves.
  if (stem === "") throw new ConverterError("output-name", raw);
  const derived = `${stem}${ext}`;
  if (!isPlainFilename(derived)) throw new ConverterError("output-name", derived);
  return derived;
}
