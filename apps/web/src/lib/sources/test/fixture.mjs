/**
 * A hand-assembled converter `.wasm`, built byte by byte from the spec's export table.
 *
 * There is no toolchain here on purpose. The host under test is a byte-level verifier of a
 * binary format, so its fixture has to be a binary this file controls completely — including
 * the shapes a real compiler cannot be persuaded to emit (a module with an import, a module
 * that declares unbounded memory, a module that claims a 2 GB output). Emitting those from
 * Rust would mean shipping a broken crate per case; emitting them from here is forty lines.
 *
 * The baseline module is a working converter: it takes one input and echoes it back as one
 * output named `out.dat`, in two stages, with one warning. Every other fixture is that module
 * with exactly one thing wrong, so a failed assertion names the thing.
 *
 * `alloc` GROWS MEMORY on every call, and the bump pointer starts at 0x10000 — the second
 * page, which does not exist until the first grow. That is not decoration: it means a host
 * that captured `memory.buffer` before calling `alloc` is holding a detached buffer, and the
 * echo output lives in the grown region, so a host with that bug cannot produce a correct
 * result by accident.
 *
 * Plain node, no dependencies.
 */

// --- LEB128 + section plumbing -------------------------------------------------------------

const uleb = (n) => {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
};

const sleb = (n) => {
  const out = [];
  let v = n | 0;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    const signBit = (b & 0x40) !== 0;
    if ((v === 0 && !signBit) || (v === -1 && signBit)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
};

const vec = (items) => [...uleb(items.length), ...items.flat()];
const section = (id, payload) => [id, ...uleb(payload.length), ...payload];
const str = (s) => {
  const b = [...new TextEncoder().encode(s)];
  return [...uleb(b.length), ...b];
};

// --- Opcodes --------------------------------------------------------------------------------

const I32 = 0x7f;
const END = 0x0b;
const i32c = (n) => [0x41, ...sleb(n)];
const gget = (i) => [0x23, ...uleb(i)];
const gset = (i) => [0x24, ...uleb(i)];
const lget = (i) => [0x20, ...uleb(i)];
const I32_ADD = 0x6a;
const I32_LTU = 0x49;
const MEM_GROW = [0x40, 0x00];
const DROP = 0x1a;

// Type indices, in the order they are emitted below.
const T_N = 0; // () -> i32
const T_N1 = 1; // (i32) -> i32
const T_N2 = 2; // (i32, i32) -> i32
const T_VOID = 3; // () -> ()

// Global indices.
const G_BUMP = 0;
const G_INPTR = 1;
const G_INLEN = 2;
const G_STAGE = 3;

// Fixed addresses in page 0, filled by the data segment.
const ADDR_STAGE_NAME = 0x100;
const ADDR_OUT_NAME = 0x110;
const ADDR_ERROR = 0x180;
// Far enough past ADDR_ERROR that the error message cannot run into it. (It once did, and the
// symptom was a *warning* that ended mid-word — exactly the sort of thing a length check
// cannot catch, because both lengths were honest.)
const ADDR_WARNINGS = 0x200;

/** Where `alloc` starts handing out memory: page 1, which does not exist until it grows. */
const BUMP_START = 0x10000;

const STAGE_NAME = "scan";
const WARNING = "input was not recognised";

/**
 * Build a converter module.
 *
 * Every option is "the one thing wrong with this fixture"; omit them all for the baseline.
 */
export function buildConverter(opts = {}) {
  const {
    abiVersion = 1,
    memMin = 1,
    memMax = 4, // pages; alloc grows, so the baseline needs headroom
    outputName = "out.dat",
    /** Override what `output_len` claims, instead of the real input length. */
    outputLen = null,
    /** Override what `output_ptr` claims. */
    outputPtr = null,
    outputCount = 1,
    stageCount = 2,
    /** Add an import. One is one too many. */
    withImport = false,
    /** Drop one ABI export by name. */
    omitExport = null,
    /** Add a function export the ABI does not define. */
    extraExport = false,
    /** Give one named export the wrong signature. */
    badSignature = null,
    /** Make `run_begin` fail with this code, with a message at ADDR_ERROR. */
    beginError = 0,
    /** Make `run_step` fail with this code on its first call. */
    stepError = 0,
    /** Never return 0 from run_step. */
    neverFinish = false,
    /** Export `memory` as something other than a memory. */
    memoryNotAMemory = false,
    /** Emit no warnings. */
    warning = WARNING,
  } = opts;

  const importCount = withImport ? 1 : 0;
  const nameBytes = new TextEncoder().encode(outputName);
  const warnBytes = new TextEncoder().encode(warning);
  const errorMessage = new TextEncoder().encode("fixture failed on purpose");

  const stepBody = neverFinish
    ? [...i32c(1)]
    : [
        ...gget(G_STAGE),
        ...i32c(stageCount),
        I32_LTU,
        0x04,
        I32, // if (result i32)
        ...gget(G_STAGE),
        ...i32c(1),
        I32_ADD,
        ...gset(G_STAGE),
        ...i32c(1),
        0x05, // else
        ...i32c(0),
        END,
      ];

  /** name -> { type, body } in export order; the function index IS this array's index. */
  const fns = [
    ["abi_version", T_N, i32c(abiVersion)],
    // alloc: grow one page, then bump. The grow is unconditional so every single call
    // detaches whatever the host was holding.
    [
      "alloc",
      T_N1,
      [...i32c(1), ...MEM_GROW, DROP, ...gget(G_BUMP), ...gget(G_BUMP), ...lget(0), I32_ADD, ...gset(G_BUMP)],
    ],
    [
      "input_clear",
      T_VOID,
      [...i32c(BUMP_START), ...gset(G_BUMP), ...i32c(0), ...gset(G_INPTR), ...i32c(0), ...gset(G_INLEN)],
    ],
    ["input_add", T_N2, [...lget(0), ...gset(G_INPTR), ...lget(1), ...gset(G_INLEN), ...i32c(0)]],
    ["run", T_N1, i32c(0)],
    ["run_begin", T_N1, [...i32c(0), ...gset(G_STAGE), ...i32c(beginError)]],
    ["run_step", T_N, stepError ? i32c(stepError) : stepBody],
    ["stage_count", T_N, i32c(stageCount)],
    ["stage_index", T_N, gget(G_STAGE)],
    ["stage_name_ptr", T_N1, i32c(ADDR_STAGE_NAME)],
    ["stage_name_len", T_N1, i32c(STAGE_NAME.length)],
    ["output_count", T_N, i32c(outputCount)],
    ["output_name_ptr", T_N1, i32c(ADDR_OUT_NAME)],
    ["output_name_len", T_N1, i32c(nameBytes.length)],
    ["output_ptr", T_N1, outputPtr === null ? gget(G_INPTR) : i32c(outputPtr)],
    ["output_len", T_N1, outputLen === null ? gget(G_INLEN) : i32c(outputLen)],
    ["error_ptr", T_N, i32c(ADDR_ERROR)],
    ["error_len", T_N, i32c(beginError || stepError ? errorMessage.length : 0)],
    ["warnings_ptr", T_N, i32c(ADDR_WARNINGS)],
    ["warnings_len", T_N, i32c(warnBytes.length)],
  ];

  if (extraExport) fns.push(["surprise", T_N, i32c(0)]);

  const kept = fns.filter(([name]) => name !== omitExport);

  // A bad signature: swap the declared type without touching the body, which is what a
  // module built against a different ABI revision would look like from outside.
  const typeOf = (name, t) => (badSignature === name ? (t === T_N1 ? T_N : T_N1) : t);

  // --- sections ---------------------------------------------------------------------------

  const types = section(
    1,
    vec([
      [0x60, ...vec([]), ...vec([[I32]])], // () -> i32
      [0x60, ...vec([[I32]]), ...vec([[I32]])], // (i32) -> i32
      [0x60, ...vec([[I32], [I32]]), ...vec([[I32]])], // (i32,i32) -> i32
      [0x60, ...vec([]), ...vec([])], // () -> ()
    ]),
  );

  const imports = withImport
    ? section(2, vec([[...str("env"), ...str("now"), 0x00, ...uleb(T_N)]]))
    : [];

  const functions = section(3, vec(kept.map(([name, t]) => uleb(typeOf(name, t)))));

  const memoryLimits = memMax === null ? [0x00, ...uleb(memMin)] : [0x01, ...uleb(memMin), ...uleb(memMax)];
  const memory = section(5, vec([memoryLimits]));

  const globals = section(
    6,
    vec([
      [I32, 0x01, ...i32c(BUMP_START), END],
      [I32, 0x01, ...i32c(0), END],
      [I32, 0x01, ...i32c(0), END],
      [I32, 0x01, ...i32c(0), END],
    ]),
  );

  const exportEntries = kept.map(([name], i) => [...str(name), 0x00, ...uleb(i + importCount)]);
  // `memory` is export kind 2 (a memory) unless the fixture is deliberately lying about it.
  exportEntries.push(memoryNotAMemory ? [...str("memory"), 0x03, ...uleb(G_BUMP)] : [...str("memory"), 0x02, 0x00]);
  const exports = section(7, vec(exportEntries));

  const code = section(
    10,
    vec(
      kept.map(([, , body]) => {
        const fnBody = [...vec([]), ...body, END];
        return [...uleb(fnBody.length), ...fnBody];
      }),
    ),
  );

  const seg = (addr, bytes) => [0x00, ...i32c(addr), END, ...vec([...bytes].map((b) => [b]))];
  const data = section(
    11,
    vec([
      seg(ADDR_STAGE_NAME, new TextEncoder().encode(STAGE_NAME)),
      seg(ADDR_OUT_NAME, nameBytes),
      seg(ADDR_ERROR, errorMessage),
      seg(ADDR_WARNINGS, warnBytes),
    ]),
  );

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...types,
    ...imports,
    ...functions,
    ...memory,
    ...globals,
    ...exports,
    ...code,
    ...data,
  ]);
}

export const FIXTURE_OUTPUT_NAME = "out.dat";
export const FIXTURE_STAGE_NAME = STAGE_NAME;
export const FIXTURE_WARNING = WARNING;
export const FIXTURE_BUMP_START = BUMP_START;
