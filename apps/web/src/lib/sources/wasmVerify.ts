/**
 * Static verification of a converter `.wasm` BEFORE it is instantiated
 * (gwrg-dist-spec spec/04-processor.md "Exports", spec/05-host.md "Verify before
 * instantiating").
 *
 * This walks the binary's own section table and answers three questions from the bytes:
 *
 *   1. Does it import anything?  One import is one too many. The module's entire security
 *      property is that no mechanism exists through which it could ask for anything outside
 *      its own linear memory, and an import is exactly such a mechanism.
 *   2. Does it export the ABI, and only the ABI?  Names, kinds AND signatures — an `alloc`
 *      taking the wrong arity is not the `alloc` the host is about to call.
 *   3. Does it declare a bounded memory, within `limits.maxMemoryPages`?  A module with no
 *      declared maximum can grow until the tab dies.
 *
 * The manifest is never consulted here beyond `limits`. "Re-derive the ABI from the binary;
 * the manifest is a convenience, never the source of truth. A manifest claiming a module
 * imports nothing would not make it so." (spec/05.)
 *
 * Verification is not a substitute for instantiating with no import object — it is the other
 * half. The verifier asserts; passing no imports makes the ENGINE enforce the same thing, so
 * a bug in this parser cannot silently hand a module a callback.
 *
 * Pure byte-walking: no DOM, no node built-ins, safe to import from a page, a Worker or a
 * plain-node script alike (spec/05's closing warning about node-only constructs).
 */
import { ConverterError, WASM_PAGE_BYTES, type ConverterLimits } from "./converterTypes.js";

// --- The ABI (spec/04) --------------------------------------------------------------------

/** WASM value types, as they appear in a type-section signature. We only ever expect i32. */
const I32 = 0x7f;

/** One ABI function: its parameter count and whether it returns an i32. */
interface AbiSig {
  params: number;
  result: boolean;
}

const N: AbiSig = { params: 0, result: true };
const N1: AbiSig = { params: 1, result: true };
const N2: AbiSig = { params: 2, result: true };
const VOID: AbiSig = { params: 0, result: false };

/**
 * Every export a `wasm`/`1` module has, with its signature. Transcribed from spec/04's
 * "Exports" block; `memory` is handled separately since it is not a function.
 *
 * Order is the spec's, so this reads as a diff against the document.
 */
export const ABI_EXPORTS: ReadonlyMap<string, AbiSig> = new Map<string, AbiSig>([
  ["abi_version", N], // () -> u32
  ["alloc", N1], // (len) -> ptr
  ["input_clear", VOID], // ()
  ["input_add", N2], // (ptr, len) -> index
  ["run", N1], // (flags) -> code
  ["run_begin", N1], // (flags) -> code
  ["run_step", N], // () -> 0 done | 1 more | code
  ["stage_count", N],
  ["stage_index", N],
  ["stage_name_ptr", N1],
  ["stage_name_len", N1],
  ["output_count", N],
  ["output_name_ptr", N1],
  ["output_name_len", N1],
  ["output_ptr", N1],
  ["output_len", N1],
  ["error_ptr", N],
  ["error_len", N],
  ["warnings_ptr", N],
  ["warnings_len", N],
]);

/** The linear memory export. Not a function, so it is not in ABI_EXPORTS. */
export const ABI_MEMORY_EXPORT = "memory";

// --- Binary reader -------------------------------------------------------------------------

const EXTERNAL_FUNC = 0x00;
const EXTERNAL_TABLE = 0x01;
const EXTERNAL_MEMORY = 0x02;
const EXTERNAL_GLOBAL = 0x03;

const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_FUNCTION = 3;
const SECTION_MEMORY = 5;
const SECTION_EXPORT = 7;

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new ConverterError("bad-binary", "truncated");
    return this.bytes[this.pos++];
  }

  /** Unsigned LEB128, capped at 5 bytes so a malicious varint cannot spin here. */
  u32(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new ConverterError("bad-binary", "varint");
  }

  skip(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.length) {
      throw new ConverterError("bad-binary", "truncated");
    }
    this.pos += n;
  }

  /** A WASM name: a length-prefixed UTF-8 byte run. Decoded strictly. */
  name(): string {
    const len = this.u32();
    if (this.pos + len > this.bytes.length) throw new ConverterError("bad-binary", "truncated");
    const raw = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw new ConverterError("bad-binary", "name is not UTF-8");
    }
  }

  /** limits := flags:u8 min:u32 [max:u32]. Returns max as undefined when unbounded. */
  limits(): { min: number; max?: number } {
    const flags = this.u8();
    // Bit 2 is the memory64 marker; bit 1 is "shared". We accept neither: a converter's
    // memory is plain 32-bit and non-shared (spec/04 relies on it being non-shared, since
    // that is precisely why the host cannot watch a progress counter while `run` is on the
    // stack).
    if (flags & ~0x01) throw new ConverterError("bad-binary", `memory flags 0x${flags.toString(16)}`);
    const min = this.u32();
    const max = flags & 0x01 ? this.u32() : undefined;
    return max === undefined ? { min } : { min, max };
  }
}

// --- Parsed shape --------------------------------------------------------------------------

export interface WasmImport {
  module: string;
  name: string;
  kind: number;
}

export interface WasmExport {
  name: string;
  kind: number;
  index: number;
}

export interface WasmMemory {
  /** Initial size in 64 KiB pages. */
  minPages: number;
  /** Declared maximum, or undefined when the module declares unbounded growth. */
  maxPages?: number;
}

export interface WasmModuleInfo {
  imports: WasmImport[];
  exports: WasmExport[];
  memory?: WasmMemory;
  /** Type-section signatures, indexed by type index. */
  types: { params: number[]; results: number[] }[];
  /** Function-section entries: defined function i has type `funcTypes[i]`. */
  funcTypes: number[];
}

/**
 * Walk the module's section table. Only the five sections that carry ABI evidence are
 * decoded; everything else (code, data, custom, …) is skipped by its declared length.
 *
 * This is deliberately NOT a validator: producing a `WasmModuleInfo` says nothing about
 * whether the module is well-formed enough to run. The engine decides that at instantiate
 * time, and it is far better at it than this is.
 */
export function parseWasm(bytes: Uint8Array): WasmModuleInfo {
  if (bytes.length < 8) throw new ConverterError("bad-binary", "too short");
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new ConverterError("bad-binary", "not a WASM module");
  }
  const version = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if (version !== 1) throw new ConverterError("bad-binary", `binary version ${version}`);

  const info: WasmModuleInfo = { imports: [], exports: [], types: [], funcTypes: [] };
  const r = new Reader(bytes);
  r.pos = 8;

  while (!r.done) {
    const id = r.u8();
    const size = r.u32();
    const end = r.pos + size;
    if (end > bytes.length) throw new ConverterError("bad-binary", "section overruns file");

    switch (id) {
      case SECTION_TYPE: {
        const count = r.u32();
        for (let i = 0; i < count; i++) {
          if (r.u8() !== 0x60) throw new ConverterError("bad-binary", "type is not a functype");
          const nParams = r.u32();
          const params: number[] = [];
          for (let p = 0; p < nParams; p++) params.push(r.u8());
          const nResults = r.u32();
          const results: number[] = [];
          for (let q = 0; q < nResults; q++) results.push(r.u8());
          info.types.push({ params, results });
        }
        break;
      }
      case SECTION_IMPORT: {
        const count = r.u32();
        for (let i = 0; i < count; i++) {
          const module = r.name();
          const name = r.name();
          const kind = r.u8();
          // Skip the descriptor so the walk stays in step even though the module is about
          // to be refused: reporting ALL of a module's imports is more useful than the first.
          switch (kind) {
            case EXTERNAL_FUNC:
              r.u32();
              break;
            case EXTERNAL_TABLE:
              r.u8();
              r.limits();
              break;
            case EXTERNAL_MEMORY:
              r.limits();
              break;
            case EXTERNAL_GLOBAL:
              r.u8();
              r.u8();
              break;
            default:
              throw new ConverterError("bad-binary", `import kind ${kind}`);
          }
          info.imports.push({ module, name, kind });
        }
        break;
      }
      case SECTION_FUNCTION: {
        const count = r.u32();
        for (let i = 0; i < count; i++) info.funcTypes.push(r.u32());
        break;
      }
      case SECTION_MEMORY: {
        const count = r.u32();
        for (let i = 0; i < count; i++) {
          const { min, max } = r.limits();
          // A `wasm`/`1` module has exactly one memory, and it is the one it exports.
          if (i === 0) info.memory = max === undefined ? { minPages: min } : { minPages: min, maxPages: max };
        }
        break;
      }
      case SECTION_EXPORT: {
        const count = r.u32();
        for (let i = 0; i < count; i++) {
          const name = r.name();
          const kind = r.u8();
          const index = r.u32();
          info.exports.push({ name, kind, index });
        }
        break;
      }
      default:
        r.skip(size);
    }

    // Trust the section header's length over our own decoding of its body: a section we
    // read short would otherwise desynchronise the whole walk.
    if (r.pos > end) throw new ConverterError("bad-binary", `section ${id} overread`);
    r.pos = end;
  }

  return info;
}

/** True when a defined function's signature matches the ABI's. */
function signatureMatches(sig: { params: number[]; results: number[] } | undefined, want: AbiSig): boolean {
  if (!sig) return false;
  if (sig.params.length !== want.params) return false;
  if (!sig.params.every((p) => p === I32)) return false;
  if (want.result) return sig.results.length === 1 && sig.results[0] === I32;
  return sig.results.length === 0;
}

export interface VerifiedModule {
  info: WasmModuleInfo;
  memory: WasmMemory & { maxPages: number };
}

/**
 * The gate. Throws a `ConverterError` on the first thing that disqualifies the binary;
 * returns the parsed shape when the module is safe to instantiate.
 *
 * Call this on the bytes you are about to instantiate, and instantiate them with NO import
 * object. Both, not either.
 */
export function verifyConverterModule(bytes: Uint8Array, limits: ConverterLimits): VerifiedModule {
  const info = parseWasm(bytes);

  // 1. Imports. The whole property, in three lines.
  if (info.imports.length > 0) {
    const shown = info.imports
      .slice(0, 4)
      .map((i) => `${i.module}.${i.name}`)
      .join(", ");
    const more = info.imports.length > 4 ? `, +${info.imports.length - 4} more` : "";
    throw new ConverterError("imports-forbidden", `${shown}${more}`);
  }

  // 2. Exports: the ABI, all of it, with the right kinds and signatures.
  const byName = new Map<string, WasmExport>();
  for (const e of info.exports) byName.set(e.name, e);

  const mem = byName.get(ABI_MEMORY_EXPORT);
  if (!mem) throw new ConverterError("missing-export", ABI_MEMORY_EXPORT);
  if (mem.kind !== EXTERNAL_MEMORY) throw new ConverterError("bad-export", "memory is not a memory");

  for (const [name, want] of ABI_EXPORTS) {
    const e = byName.get(name);
    if (!e) throw new ConverterError("missing-export", name);
    if (e.kind !== EXTERNAL_FUNC) throw new ConverterError("bad-export", `${name} is not a function`);
    // With no imports, the function index space starts at the defined functions, so an
    // export's index IS its index into the function section. (This is only sound because
    // the import check above already passed.)
    if (e.index >= info.funcTypes.length) throw new ConverterError("bad-export", `${name} index`);
    if (!signatureMatches(info.types[info.funcTypes[e.index]], want)) {
      throw new ConverterError("bad-export", `${name} signature`);
    }
  }

  // "A `wasm`/`1` module has exactly these." Extra FUNCTION exports widen the callable
  // surface and are refused. Extra globals and tables are not: a Rust cdylib routinely
  // exports `__data_end`/`__heap_base` as globals, they are inert data, and refusing them
  // would fail every real module built the way spec/04's "Building one" section prescribes.
  for (const e of info.exports) {
    if (e.kind === EXTERNAL_FUNC && !ABI_EXPORTS.has(e.name)) {
      throw new ConverterError("extra-export", e.name);
    }
  }

  // 3. Memory bounds. spec/04: without `--max-memory` "the module declares unbounded growth
  // and fails verification".
  if (!info.memory) throw new ConverterError("missing-export", "memory (no memory section)");
  if (info.memory.maxPages === undefined) {
    throw new ConverterError("unbounded-memory", `${info.memory.minPages} pages, no maximum`);
  }
  if (!Number.isInteger(limits.maxMemoryPages) || limits.maxMemoryPages <= 0) {
    throw new ConverterError("memory-too-large", "manifest limits.maxMemoryPages is not a positive integer");
  }
  if (info.memory.maxPages > limits.maxMemoryPages) {
    throw new ConverterError(
      "memory-too-large",
      `${info.memory.maxPages} pages > limit ${limits.maxMemoryPages}`,
    );
  }

  return { info, memory: { minPages: info.memory.minPages, maxPages: info.memory.maxPages } };
}

/** Bytes a module's declared maximum works out to. For reporting, not for a check. */
export function maxMemoryBytes(m: WasmMemory & { maxPages: number }): number {
  return m.maxPages * WASM_PAGE_BYTES;
}
