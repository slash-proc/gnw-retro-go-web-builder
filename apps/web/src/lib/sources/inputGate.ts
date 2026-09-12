/**
 * The input gate: everything the HOST must settle before a converter run
 * (gwrg-dist-spec spec/03-manifest.md "Inputs"/"strict", spec/05-host.md "Enforce `strict`
 * yourself").
 *
 * "This is the host's job because the host is the only party that can do it. It has the file,
 * the hash table and the user; the module has bytes and no way to ask a question. Doing it
 * before a run also means an obviously wrong file costs nothing."
 *
 * So: hash each user-supplied file, compare against that input's `variants[]`, check
 * `maxBytes` in the same pass, and decide. `strict` (default true) means refuse an
 * unrecognised file; `strict: false` means accept it and SAY it was not recognised. A module
 * never gets a vote — it hashes to resolve roles, never to refuse a file.
 *
 * This also holds the narrowing of `types.ts`'s deliberately-loose `Tool.inputs: unknown[]`
 * into the shapes the run path needs. Parsed field by field, never cast: a manifest comes
 * from a third-party repo over the network.
 */
import {
  ConverterError,
  SUPPORTED_PROCESSOR_TYPE,
  SUPPORTED_PROCESSOR_VERSION,
  type ConverterInput,
  type ConverterLimits,
  type ConverterOutputSpec,
  type InputVariant,
} from "./converterTypes.js";
import { isPlainFilename } from "./converterRun.js";
import { isSubpath } from "./subpath.js";
import { SourceError, type Tool } from "./types.js";

// --- Manifest narrowing --------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HEX40 = /^[0-9a-fA-F]{40}$/;

/**
 * `$defs/extension` from the published schema, verbatim: a leading dot and then alphanumerics.
 * Nothing else — no second dot, no separator, no space. The declared extension is FORCED onto
 * every derived name, so it is the one part of that name a user's file can never influence,
 * and it has to be incapable of carrying a path.
 */
const EXTENSION = /^\.[A-Za-z0-9]+$/;

function parseVariants(list: unknown): InputVariant[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new SourceError("malformed");
  return list.map((raw) => {
    if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.sha1 !== "string") {
      throw new SourceError("malformed");
    }
    if (!HEX40.test(raw.sha1)) throw new SourceError("malformed");
    return {
      id: raw.id,
      sha1: raw.sha1.toLowerCase(),
      ...(typeof raw.bytes === "number" ? { bytes: raw.bytes } : {}),
      // The canonical name a derived output takes when this variant matched. Publisher text,
      // so it is held to the same plain-filename rule as anything else that becomes a name;
      // a malformed one is dropped and resolution falls through to the file's own stem
      // rather than failing the whole manifest over an optional field.
      ...(typeof raw.filename === "string" && isPlainFilename(raw.filename)
        ? { filename: raw.filename }
        : {}),
      ...(isObj(raw.label) ? { label: raw.label as Record<string, string> } : {}),
    };
  });
}

/**
 * TRANSITIONAL — the ONE place that reads an input's "may this slot take several files" flag.
 *
 * gwrg-dist-spec commit `4eb5a86` ("Let a converter turn a library of files into a library of
 * files") renamed an input's `repeatable` to `allowMultiple`, so that the new sibling
 * `runPerFile` reads sensibly beside it. Published manifests still carry the old key: zelda3
 * v0.3.0 is live right now with `base: {repeatable: false}` and `language: {repeatable: true}`,
 * and it was published hours BEFORE that commit landed. Refusing it made its whole tool
 * unparseable, which the user sees as "the project published a file this tool could not read"
 * on the Configure page and as a Library row that raises no file prompt at all.
 *
 * The same accommodation `isCoreKind()` makes for `kind: "emulator"`, for the same reason: the
 * spec is a draft, it moves, and publishers lag it. This is ONE renamed key, not an era — every
 * other pre-`4eb5a86` difference is additive (`runPerFile`, `maxCount`, a variant's `filename`)
 * or a relaxation an old manifest already satisfies (an output's `filename` XOR `extension`,
 * where the old shape required `filename` and so still parses). Nothing else is forgiven here.
 *
 * `allowMultiple` wins whenever it is present; `repeatable` answers only in its absence. A
 * non-boolean in either key is still malformed — this widens the accepted NAMES by one, never
 * the accepted TYPES. Returns `undefined` when neither key is usable, which the caller refuses.
 *
 * When every project this app resolves has republished, delete the `repeatable` arm HERE and
 * nowhere else: `parseToolInputs` is the only reader of the raw key.
 */
function allowMultipleOf(raw: Record<string, unknown>): boolean | undefined {
  if (typeof raw.allowMultiple === "boolean") return raw.allowMultiple;
  if (typeof raw.repeatable === "boolean") return raw.repeatable;
  return undefined;
}

/** Narrow `tools[].inputs` from `unknown[]` to the shape the gate needs. */
export function parseToolInputs(tool: Tool): ConverterInput[] {
  if (!Array.isArray(tool.inputs)) throw new SourceError("malformed");
  return tool.inputs.map((raw) => {
    // `allowMultiple` is read through `allowMultipleOf` (above), which also answers to the
    // pre-`4eb5a86` name. `undefined` means neither key was a boolean, which is still malformed.
    const allowMultiple = isObj(raw) ? allowMultipleOf(raw) : undefined;
    if (
      !isObj(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.required !== "boolean" ||
      allowMultiple === undefined ||
      typeof raw.maxBytes !== "number" ||
      !Number.isInteger(raw.maxBytes) ||
      raw.maxBytes <= 0 ||
      !Array.isArray(raw.extensions)
    ) {
      throw new SourceError("malformed");
    }
    return {
      id: raw.id,
      required: raw.required,
      allowMultiple,
      // `runPerFile` needs `allowMultiple` (a single-file slot has nothing to iterate) -- read
      // as a flag here and REFUSED by `checkRunShape` (converter.ts), which is where the
      // cross-field rules live because they need the outputs too. Carried for the run loop,
      // which is a later step. `maxCount` is enforced by `gateInputs` below, before a run is
      // spent.
      ...(raw.runPerFile === true ? { runPerFile: true } : {}),
      ...(typeof raw.maxCount === "number" && Number.isInteger(raw.maxCount) && raw.maxCount >= 1
        ? { maxCount: raw.maxCount }
        : {}),
      extensions: raw.extensions.filter((e): e is string => typeof e === "string"),
      maxBytes: raw.maxBytes,
      variants: parseVariants(raw.variants),
      // "Default `true`. Refuse a file matching no variant." An absent key is strict; only an
      // explicit `false` relaxes it.
      strict: raw.strict !== false,
      ...(isObj(raw.label) ? { label: raw.label as Record<string, string> } : {}),
      ...(isObj(raw.description) ? { description: raw.description as Record<string, string> } : {}),
    };
  });
}

/**
 * Narrow `tools[].outputs`. The manifest decides what a legitimate run produces.
 *
 * `filename` XOR `extension` (schema `oneOf`). Both is a contradiction — a fixed name and a
 * derived one cannot both be the name — and neither leaves the file nameless. The schema
 * states it, and this refuses it anyway: the manifest comes from a third-party repo over the
 * network, and a host that assumed the publisher ran the checker would be trusting the very
 * party it is validating.
 */
export function parseToolOutputs(tool: Tool): ConverterOutputSpec[] {
  if (!Array.isArray(tool.outputs) || tool.outputs.length === 0) throw new SourceError("malformed");
  return tool.outputs.map((raw: unknown) => {
    if (
      !isObj(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.maxBytes !== "number" ||
      !Number.isInteger(raw.maxBytes) ||
      raw.maxBytes <= 0
    ) {
      throw new SourceError("malformed");
    }
    const hasFilename = raw.filename !== undefined;
    const hasExtension = raw.extension !== undefined;
    if (hasFilename === hasExtension) throw new SourceError("malformed"); // both, or neither
    if (hasFilename && (typeof raw.filename !== "string" || !isPlainFilename(raw.filename))) {
      throw new SourceError("malformed");
    }
    if (hasExtension && (typeof raw.extension !== "string" || !EXTENSION.test(raw.extension))) {
      throw new SourceError("malformed");
    }
    return {
      id: raw.id,
      ...(hasFilename ? { filename: raw.filename as string } : {}),
      ...(hasExtension ? { extension: raw.extension as string } : {}),
      // gwrg-dist-spec `61d3726`. Validated as a path segment here because that is where every
      // other untrusted manifest name is checked; whether it MAY be used is the consumer's
      // question, since a `subdir` is relative to the target's `dataDir` and this function is
      // handed a tool, not a target. A consumer that finds no `dataDir` ignores it.
      ...(isSubpath(raw.subdir) ? { subdir: raw.subdir } : {}),
      maxBytes: raw.maxBytes,
    };
  });
}

/** Narrow `tools[].limits`. Both ceilings are required by the schema. */
export function parseToolLimits(tool: Tool): ConverterLimits {
  const l = tool.limits as unknown;
  if (
    !isObj(l) ||
    typeof l.maxMemoryPages !== "number" ||
    typeof l.maxOutputBytes !== "number" ||
    !Number.isInteger(l.maxMemoryPages) ||
    !Number.isInteger(l.maxOutputBytes) ||
    l.maxMemoryPages <= 0 ||
    l.maxOutputBytes <= 0
  ) {
    throw new SourceError("malformed");
  }
  return { maxMemoryPages: l.maxMemoryPages, maxOutputBytes: l.maxOutputBytes };
}

/**
 * "Reject unknown versions." A `processor` this host does not implement is refused, not
 * guessed at — the point of splitting `type` from `version` is that a future non-WASM
 * processor is a new type rather than a schema break, and neither is a thing to improvise on.
 */
export function checkProcessor(tool: Tool): void {
  const p = tool.processor as unknown;
  if (!isObj(p) || typeof p.type !== "string" || typeof p.version !== "number") {
    throw new SourceError("malformed");
  }
  if (p.type !== SUPPORTED_PROCESSOR_TYPE) {
    throw new ConverterError("unsupported-processor", p.type);
  }
  if (p.version !== SUPPORTED_PROCESSOR_VERSION) {
    throw new ConverterError("unsupported-processor", `${p.type}/${p.version}`);
  }
}

// --- Hashing --------------------------------------------------------------------------------

/**
 * Lowercase hex SHA-1 of some bytes. SHA-1 because that is what `variants[].sha1` publishes —
 * it identifies a known ROM, it is not a security boundary (the security boundary is the
 * module importing nothing), and every ROM hash table in the world is already SHA-1.
 */
export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", copy as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- The gate ---------------------------------------------------------------------------------

/** One file the user offered, before the gate has looked at it. */
export interface OfferedFile {
  inputId: string;
  /** As the user named it. Untrusted text; used for reporting only. */
  filename: string;
  bytes: Uint8Array;
  /**
   * Which `variants[]` entry these bytes matched, when they matched one. The gate is the only
   * place that hashes, so it is the only place that can say; by the time the file reaches the
   * row that draws it, the bytes are long gone. Absent means unattributed, which is a real
   * answer (a `strict: false` input accepts files no variant describes) and not a missing one.
   */
  variantId?: string;
}

export interface GateVerdict {
  inputId: string;
  filename: string;
  sha1: string;
  /** True when the bytes matched one of the input's `variants[]`. */
  recognised: boolean;
  /** Which variant, when recognised. */
  variantId?: string;
  /**
   * That variant's canonical `filename`, when it declares one. This is rule 1 of spec/03's
   * derived-name resolution and the gate is the only place that knows it — by the time the
   * outputs come back, which variant matched is no longer visible.
   */
  variantFilename?: string;
  /** Set when the file is refused; the run must not be spent. */
  error?: ConverterError;
}

export interface GateResult {
  /** Files that may be handed to `input_add`, in the order they were offered. */
  accepted: OfferedFile[];
  /** Every file, accepted or not, with why. */
  verdicts: GateVerdict[];
  /** Refusals, as errors the UI maps to copy. Non-empty means do not run. */
  errors: ConverterError[];
  /**
   * Files accepted despite matching no variant (`strict: false`). The host MUST tell the user
   * about these — "accept it but tell the user it was not recognised" is one requirement, not
   * two options.
   */
  unrecognised: GateVerdict[];
}

/**
 * Hash, compare, decide — for every offered file, in one pass, before any run.
 *
 * Also enforces the two arity rules the schema states and the module cannot: a `required`
 * input must get a file, and a non-`allowMultiple` one must get at most one. Neither is
 * something `input_add` could express, since it takes no name and no role.
 */
export async function gateInputs(specs: ConverterInput[], files: OfferedFile[]): Promise<GateResult> {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const verdicts: GateVerdict[] = [];
  const accepted: OfferedFile[] = [];
  const errors: ConverterError[] = [];
  const unrecognised: GateVerdict[] = [];
  const seen = new Map<string, number>();

  for (const file of files) {
    const spec = byId.get(file.inputId);
    if (!spec) {
      const err = new ConverterError("unknown-output", file.inputId);
      errors.push(err);
      verdicts.push({ inputId: file.inputId, filename: file.filename, sha1: "", recognised: false, error: err });
      continue;
    }

    seen.set(spec.id, (seen.get(spec.id) ?? 0) + 1);

    // maxBytes first: it costs nothing and it is the check that stops a 4 GB file being
    // hashed at all.
    if (file.bytes.byteLength > spec.maxBytes) {
      const err = new ConverterError(
        "input-too-large",
        `${file.filename}: ${file.bytes.byteLength} > ${spec.maxBytes}`,
      );
      errors.push(err);
      verdicts.push({ inputId: spec.id, filename: file.filename, sha1: "", recognised: false, error: err });
      continue;
    }

    const sha1 = await sha1Hex(file.bytes);
    // A variant may pin `bytes` as well; a hash collision is not the thing this catches, a
    // mis-published variant is. Both must agree for a match to count.
    // `.toLowerCase()` even though `parseVariants` already normalised: a caller may hand us a
    // hand-built spec, and published ROM hashes are conventionally uppercase (zelda3's are).
    // A case difference silently failing every match is not a bug worth the saved cycle.
    const match = spec.variants.find(
      (v) => v.sha1.toLowerCase() === sha1 && (v.bytes === undefined || v.bytes === file.bytes.byteLength),
    );

    if (match) {
      const verdict: GateVerdict = {
        inputId: spec.id,
        filename: file.filename,
        sha1,
        recognised: true,
        variantId: match.id,
        ...(match.filename !== undefined ? { variantFilename: match.filename } : {}),
      };
      verdicts.push(verdict);
      // NOT a copy carrying `variantId`: `inputDiscovery.ts` builds `new Set(gate.accepted)` and
      // tests membership by IDENTITY against the files it offered, so a spread here silently
      // drops every recognised file from discovery's result. The match is reported in `verdicts`
      // (same `filename`), which is where a caller reads it from.
      accepted.push(file);
      continue;
    }

    // No match. `strict` — and nothing else, and certainly not the module — decides.
    if (spec.strict) {
      const err = new ConverterError("input-unrecognised", file.filename);
      errors.push(err);
      verdicts.push({ inputId: spec.id, filename: file.filename, sha1, recognised: false, error: err });
      continue;
    }
    const verdict: GateVerdict = { inputId: spec.id, filename: file.filename, sha1, recognised: false };
    verdicts.push(verdict);
    unrecognised.push(verdict);
    accepted.push(file);
  }

  for (const spec of specs) {
    const n = seen.get(spec.id) ?? 0;
    if (spec.required && accepted.every((f) => f.inputId !== spec.id)) {
      errors.push(new ConverterError("input-missing", spec.id));
    }
    if (!spec.allowMultiple && n > 1) {
      errors.push(new ConverterError("input-not-multiple", `${spec.id}: ${n} files`));
    }
    // `maxCount` is checked HERE, and this is the whole reason the gate runs before the run:
    // with `runPerFile` the number of runs IS the number of files, which spec/05 calls "the
    // one unbounded quantity in the model". Discovering the ceiling after eight runs have
    // already happened would enforce nothing. The count is of files OFFERED, not accepted —
    // a slot given twenty files is over its ceiling whether or not the gate liked them.
    if (spec.maxCount !== undefined && n > spec.maxCount) {
      errors.push(new ConverterError("input-too-many", `${spec.id}: ${n} > ${spec.maxCount}`));
    }
  }

  return { accepted, verdicts, errors, unrecognised };
}

/**
 * A BIOS is a user-supplied file like a converter input, but it is INSTALLED rather than
 * converted, so nothing downstream ever looks at it again — and the device is not a backstop
 * (spec/05: ColecoVision's core reads its 8 KiB and ignores the return value, so a truncated
 * BIOS boots into uninitialised heap with no error). Same gate, same rules.
 *
 * `requiredFor` is not decided here: it "only bites when the user is installing a game with
 * one of the extensions it names", which is knowledge the install path has and this does not.
 */
export async function checkBiosFile(
  entry: { sha1?: string; bytes?: number; strict?: boolean },
  bytes: Uint8Array,
  filename: string,
): Promise<{ recognised: boolean; sha1: string; error?: ConverterError }> {
  const strict = entry.strict !== false;
  if (entry.bytes !== undefined && bytes.byteLength !== entry.bytes) {
    // A size mismatch is the truncation case above, so it is refused even when the entry
    // publishes no hash to compare against.
    return {
      recognised: false,
      sha1: "",
      error: new ConverterError("input-too-large", `${filename}: ${bytes.byteLength} != ${entry.bytes}`),
    };
  }
  if (!entry.sha1) return { recognised: false, sha1: "" }; // Nothing published to check against.
  const sha1 = await sha1Hex(bytes);
  if (sha1 === entry.sha1.toLowerCase()) return { recognised: true, sha1 };
  return {
    recognised: false,
    sha1,
    ...(strict ? { error: new ConverterError("input-unrecognised", filename) } : {}),
  };
}
