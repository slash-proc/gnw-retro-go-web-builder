/**
 * Minimal ARM Thumb-2 assembler for the gnw_patch firmware patcher.
 *
 * A purpose-built, dependency-free replacement for keystone-engine — a faithful
 * 1:1 port of gnwmanager's `thumb_asm.py` (branch `remove-keystone-engine`). It
 * supports only the handful of Thumb-2 instruction forms emitted by the
 * Mario/Zelda firmware patches:
 *
 *   movw  Rd, #imm16                       MOV (immediate), T3
 *   mov.w Rd, #const (+cond)               MOV (immediate), T2 (modified immediate)
 *   mov   Rd, Rm                           MOV (register),  T1
 *   add.w Rd, Rn, #const (+cond)           ADD (immediate), T3 (modified immediate)
 *   sub.w Rd, Rn, #const (+cond)           SUB (immediate), T3 (modified immediate)
 *   sub   sp, #imm                         SUB (SP minus immediate), T2
 *   ldr.w Rt, [pc, #imm]                   LDR (literal), T2 (signed offset)
 *   b     <target>                         B, T2 (narrow)
 *   b.w   #<target>                        B, T4 (wide)
 *   it/itt/ite/...                         IT block
 *
 * Encodings follow the ARMv7-M ARM and are verified byte-for-byte against the
 * upstream Python (itself keystone-validated) and against keystone's own cached
 * output (see test/validate.mjs).
 *
 * `assemble(code, addr)` mirrors the slice of keystone's `Ks.asm` the patcher
 * uses: an assembly string (optionally several instructions separated by `;`)
 * plus the address of the first instruction, returning little-endian bytes.
 * Like keystone, it throws on operands that cannot be encoded.
 */

export class ThumbAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThumbAssemblyError";
  }
}

const CONDITIONS: Record<string, number> = {
  eq: 0, ne: 1, cs: 2, hs: 2, cc: 3, lo: 3,
  mi: 4, pl: 5, vs: 6, vc: 7, hi: 8, ls: 9,
  ge: 10, lt: 11, gt: 12, le: 13, al: 14,
};

const REGISTERS: Record<string, number> = (() => {
  const r: Record<string, number> = {};
  for (let i = 0; i < 16; i++) r[`r${i}`] = i;
  r.sp = 13;
  r.lr = 14;
  r.pc = 15;
  return r;
})();

const COND_RE = Object.keys(CONDITIONS).join("|");
// The optional condition is consumed by an enclosing IT block and does not change
// the encoding, so e.g. `addne.w` encodes identically to `add.w`.
const MOV_W_RE = new RegExp(`^mov(?:${COND_RE})?\\.w$`);
const ADD_W_RE = new RegExp(`^add(?:${COND_RE})?\\.w$`);
const SUB_W_RE = new RegExp(`^sub(?:${COND_RE})?\\.w$`);
// `ldr.w Rt, [pc, #imm]` -- PC-relative literal load with a signed byte offset.
const LDR_W_PC_RE = /^ldr\.w\s+(\w+)\s*,\s*\[\s*pc\s*,\s*#\s*(-?(?:0x)?[0-9a-f]+)\s*\]$/;

function reg(token: string): number {
  const v = REGISTERS[token];
  if (v === undefined) throw new ThumbAssemblyError(`Invalid register '${token}'`);
  return v;
}

/** Parse an integer in Python `int(s, 0)` style: 0x hex, 0b binary, 0o octal, decimal. */
function parseIntC(token: string): number {
  const s = token.trim();
  if (/^[+-]?0x[0-9a-f]+$/i.test(s)) return signedParse(s, 16);
  if (/^[+-]?0b[01]+$/i.test(s)) return signedParse(s, 2);
  if (/^[+-]?0o[0-7]+$/i.test(s)) return signedParse(s, 8);
  if (/^[+-]?\d+$/.test(s)) return Number.parseInt(s, 10);
  return NaN;
}

/** Parse a signed prefixed literal (e.g. "-0x1c") at the given radix (prefix stripped). */
function signedParse(s: string, radix: number): number {
  const neg = s[0] === "-";
  const body = s.replace(/^[+-]/, "").slice(2); // drop 0x / 0b / 0o
  const v = Number.parseInt(body, radix);
  return neg ? -v : v;
}

function imm(token: string): number {
  if (!token.startsWith("#")) {
    throw new ThumbAssemblyError(`Expected '#'-prefixed immediate, got '${token}'`);
  }
  const v = parseIntC(token.slice(1));
  if (Number.isNaN(v)) throw new ThumbAssemblyError(`Invalid immediate '${token}'`);
  return v;
}

function branchTarget(token: string): number {
  // Narrow `b` is written `b 0x1c`; wide `b.w` is written `b.w #0x...`.
  const t = token.startsWith("#") ? token.slice(1) : token;
  const v = parseIntC(t);
  if (Number.isNaN(v)) throw new ThumbAssemblyError(`Invalid branch target '${token}'`);
  return v;
}

const emit16 = (hw: number): number[] => [hw & 0xff, (hw >> 8) & 0xff];
const emit32 = (hw1: number, hw2: number): number[] => [
  hw1 & 0xff, (hw1 >> 8) & 0xff, hw2 & 0xff, (hw2 >> 8) & 0xff,
];

function ror32(value: number, amount: number): number {
  amount &= 31;
  return ((value >>> amount) | (value << (32 - amount))) >>> 0;
}

/**
 * Encode a 32-bit constant as a 12-bit Thumb "modified immediate"
 * (ThumbExpandImm), returning the `i:imm3:imm8` field used by the T2
 * MOV/ADD/SUB (immediate) encodings. Throws if not representable (matching
 * keystone, which rejects rather than widening).
 */
export function encodeModifiedImmediate(value: number): number {
  value >>>= 0;

  // 0b0000_0000_<abcdefgh>: an 8-bit value, zero-extended.
  if (value <= 0xff) return value;

  const b0 = value & 0xff;
  const b1 = (value >>> 8) & 0xff;
  const b2 = (value >>> 16) & 0xff;
  const b3 = (value >>> 24) & 0xff;

  // 0b0001: 0x00XY00XY
  if (b1 === 0 && b3 === 0 && b0 === b2) return (0b0001 << 8) | b0;
  // 0b0010: 0xXY00XY00
  if (b0 === 0 && b2 === 0 && b1 === b3) return (0b0010 << 8) | b1;
  // 0b0011: 0xXYXYXYXY
  if (b0 === b1 && b1 === b2 && b2 === b3) return (0b0011 << 8) | b0;

  // Rotation form: an 8-bit value 1bcdefgh rotated right by 8..31.
  for (let rotation = 8; rotation < 32; rotation++) {
    const unrotated = ror32(value, (-rotation % 32) + 32); // undo the right-rotate
    if (unrotated <= 0xff && (unrotated & 0x80) !== 0) {
      return (rotation << 7) | (unrotated & 0x7f);
    }
  }

  throw new ThumbAssemblyError(`0x${value.toString(16).toUpperCase()} is not a valid Thumb modified immediate`);
}

/** Yield every distinct 32-bit constant representable as a modified immediate. */
export function* iterModifiedImmediates(): Generator<number> {
  const seen = new Set<number>();
  const emit = (v: number): boolean => {
    v >>>= 0;
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  };

  for (let v = 0; v < 0x100; v++) if (emit(v)) yield v;
  for (let byte = 1; byte < 0x100; byte++) {
    for (const v of [
      ((byte << 16) | byte) >>> 0,
      ((byte << 24) | (byte << 8)) >>> 0,
      ((byte << 24) | (byte << 16) | (byte << 8) | byte) >>> 0,
    ]) {
      if (emit(v)) yield v;
    }
  }
  for (let rotation = 8; rotation < 32; rotation++) {
    for (let imm7 = 0; imm7 < 0x80; imm7++) {
      const v = ror32(0x80 | imm7, rotation);
      if (emit(v)) yield v;
    }
  }
}

function splitModifiedImmediate(constant: number): [number, number, number] {
  const twelve = encodeModifiedImmediate(constant);
  return [(twelve >>> 11) & 1, (twelve >>> 8) & 0x7, twelve & 0xff];
}

function movw(ops: string[]): number[] {
  if (ops.length !== 2) throw new ThumbAssemblyError("movw expects 'Rd, #imm16'");
  const rd = reg(ops[0]);
  if (rd === 13 || rd === 15) throw new ThumbAssemblyError(`movw cannot target ${ops[0]}`);
  const value = imm(ops[1]);
  if (value < 0 || value > 0xffff) {
    throw new ThumbAssemblyError(`movw immediate 0x${value.toString(16)} out of 16-bit range`);
  }
  const imm4 = (value >>> 12) & 0xf;
  const i = (value >>> 11) & 1;
  const imm3 = (value >>> 8) & 0x7;
  const imm8 = value & 0xff;
  const hw1 = 0xf240 | (i << 10) | imm4;
  const hw2 = (imm3 << 12) | (rd << 8) | imm8;
  return emit32(hw1, hw2);
}

function movW(ops: string[]): number[] {
  if (ops.length !== 2) throw new ThumbAssemblyError("mov.w expects 'Rd, #const'");
  const rd = reg(ops[0]);
  if (rd === 13 || rd === 15) throw new ThumbAssemblyError(`mov.w cannot target ${ops[0]}`);
  const [i, imm3, imm8] = splitModifiedImmediate(imm(ops[1]));
  const hw1 = 0xf04f | (i << 10);
  const hw2 = (imm3 << 12) | (rd << 8) | imm8;
  return emit32(hw1, hw2);
}

function addsubW(ops: string[], baseHw1: number, name: string): number[] {
  if (ops.length !== 3) throw new ThumbAssemblyError(`${name} expects 'Rd, Rn, #const'`);
  const rd = reg(ops[0]);
  const rn = reg(ops[1]);
  if (rd === 15) throw new ThumbAssemblyError(`${name} cannot target pc`);
  if (rn === 15) throw new ThumbAssemblyError(`${name} cannot use pc as the source register`);
  const [i, imm3, imm8] = splitModifiedImmediate(imm(ops[2]));
  const hw1 = baseHw1 | (i << 10) | rn;
  const hw2 = (imm3 << 12) | (rd << 8) | imm8;
  return emit32(hw1, hw2);
}

function movReg(ops: string[]): number[] {
  if (ops.length !== 2) throw new ThumbAssemblyError("mov expects 'Rd, Rm'");
  const rd = reg(ops[0]);
  const rm = reg(ops[1]);
  const d = (rd >>> 3) & 1;
  const hw = 0x4600 | (d << 7) | (rm << 3) | (rd & 0x7);
  return emit16(hw);
}

function subSp(ops: string[]): number[] {
  if (ops.length !== 2 || reg(ops[0]) !== 13) throw new ThumbAssemblyError("sub expects 'sp, #imm'");
  const value = imm(ops[1]);
  if (value % 4 !== 0 || value < 0 || value > 0x1fc) {
    throw new ThumbAssemblyError(`sub sp immediate 0x${value.toString(16)} must be a multiple of 4 in [0, 0x1FC]`);
  }
  return emit16(0xb080 | (value >>> 2));
}

function ldrWLiteral(rtToken: string, immToken: string): number[] {
  // LDR (literal), T2: load Rt from Align(PC,4) +/- imm12 (a byte offset). The
  // explicit [pc, #imm] form encodes imm directly, independent of the address.
  const rt = reg(rtToken);
  const value = parseIntC(immToken);
  if (Number.isNaN(value) || value < -0xfff || value > 0xfff) {
    throw new ThumbAssemblyError(`ldr.w literal offset ${immToken} out of +/-4095 range`);
  }
  const u = value >= 0 ? 1 : 0;
  const hw1 = 0xf85f | (u << 7);
  const hw2 = (rt << 12) | (Math.abs(value) & 0xfff);
  return emit32(hw1, hw2);
}

function b(ops: string[], addr: number): number[] {
  if (ops.length !== 1) throw new ThumbAssemblyError("b expects a single target");
  const offset = branchTarget(ops[0]) - (addr + 4);
  if (offset & 1) throw new ThumbAssemblyError("branch target must be halfword-aligned");
  const im = offset >> 1;
  if (im < -0x400 || im > 0x3ff) {
    throw new ThumbAssemblyError(`b target out of range for the narrow encoding (offset ${offset})`);
  }
  return emit16(0xe000 | (im & 0x7ff));
}

function bW(ops: string[], addr: number): number[] {
  if (ops.length !== 1) throw new ThumbAssemblyError("b.w expects a single target");
  const offset = branchTarget(ops[0]) - (addr + 4);
  if (offset & 1) throw new ThumbAssemblyError("branch target must be halfword-aligned");
  if (offset < -(1 << 24) || offset >= 1 << 24) {
    throw new ThumbAssemblyError(`b.w target out of +/-16MB range (offset ${offset})`);
  }
  const s = (offset >> 24) & 1;
  const i1 = (offset >> 23) & 1;
  const i2 = (offset >> 22) & 1;
  const imm10 = (offset >> 12) & 0x3ff;
  const imm11 = (offset >> 1) & 0x7ff;
  const j1 = ~(i1 ^ s) & 1;
  const j2 = ~(i2 ^ s) & 1;
  const hw1 = 0xf000 | (s << 10) | imm10;
  const hw2 = 0x9000 | (j1 << 13) | (j2 << 11) | imm11;
  return emit32(hw1, hw2);
}

function it(mnemonic: string, ops: string[]): number[] {
  if (ops.length !== 1) throw new ThumbAssemblyError("IT expects a single condition");
  const pattern = mnemonic.slice(2); // the 't'/'e' chars following "it"
  if (pattern.length > 3 || [...pattern].some((ch) => ch !== "t" && ch !== "e")) {
    throw new ThumbAssemblyError(`Unsupported IT form '${mnemonic}'`);
  }
  const cond = CONDITIONS[ops[0]];
  if (cond === undefined) throw new ThumbAssemblyError(`Invalid condition '${ops[0]}'`);
  const fc0 = cond & 1;
  const n = 1 + pattern.length;
  let mask = 1 << (4 - n);
  for (let idx = 0; idx < pattern.length; idx++) {
    const val = pattern[idx] === "t" ? fc0 : fc0 ^ 1;
    mask |= val << (3 - idx);
  }
  return emit16(0xbf00 | (cond << 4) | mask);
}

function assembleOne(text: string, addr: number): number[] {
  // `ldr.w Rt, [pc, #imm]` has bracket syntax the generic tokenizer mangles.
  const ldr = text.match(LDR_W_PC_RE);
  if (ldr) return ldrWLiteral(ldr[1], ldr[2]);

  const tokens = text.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const mnemonic = tokens[0];
  const ops = tokens.slice(1);

  if (MOV_W_RE.test(mnemonic)) return movW(ops);
  if (mnemonic === "movw") return movw(ops);
  if (mnemonic === "mov") return movReg(ops);
  if (ADD_W_RE.test(mnemonic)) return addsubW(ops, 0xf100, "add.w");
  if (SUB_W_RE.test(mnemonic)) return addsubW(ops, 0xf1a0, "sub.w");
  if (mnemonic === "sub") return subSp(ops);
  if (mnemonic === "b.w") return bW(ops, addr);
  if (mnemonic === "b") return b(ops, addr);
  if (mnemonic.startsWith("it")) return it(mnemonic, ops);

  throw new ThumbAssemblyError(`Unsupported instruction: '${text}'`);
}

/**
 * Assemble one or more Thumb-2 instructions (separated by `;`) starting at
 * `addr` (used to resolve PC-relative branches). Returns little-endian bytes.
 * Throws ThumbAssemblyError on anything unencodable.
 */
export function assemble(code: string, addr = 0): Uint8Array {
  const result: number[] = [];
  for (const rawPiece of code.toLowerCase().split(";")) {
    const piece = rawPiece.trim();
    if (!piece) continue;
    result.push(...assembleOne(piece, addr + result.length));
  }
  return Uint8Array.from(result);
}
