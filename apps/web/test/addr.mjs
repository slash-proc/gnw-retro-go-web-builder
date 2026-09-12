#!/usr/bin/env node
/**
 * Offline coverage for `bankForAddr()` (src/lib/advanced/addr.ts) — the pure function that
 * turns the Advanced range fields' ABSOLUTE start address into the bank index handed to the
 * flasher.
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/addr.mjs'
 *
 * Plain node, no framework (repo convention). Nothing here touches a device.
 *
 * Why this file exists: Dump/Write/Erase used to pick the bank from a <select> with a
 * bank-RELATIVE offset, so an address could not name a location outside a bank. Now the bank
 * is DERIVED from the typed (or bar-filled) absolute address, and "which bank is this?" is
 * the single decision every downstream check hangs off — `offBytes = addr - BANK_BASE[bank]`,
 * the alignment check, the region bound, the locked guard and the bank-1 acknowledgement.
 *
 * The bound that matters most is bank 1's UPPER one. Internal flash is two 256 KiB banks at
 * 0x08000000 and 0x08100000, so 0x08040000-0x080fffff is a gap that belongs to NEITHER bank.
 * An unbounded bank 1 resolved a gap address to bank 1 with `offBytes > region`; Dump's
 * overrun clamp (`region - off`) then produced a NEGATIVE length and passed it to the read.
 * Every out-of-bank address must resolve to -1 so the caller's `inRange` is false and the
 * action stays disabled.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- Tiny harness ----------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// --- Compile the module under test ------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-addr-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/advanced/addr.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
});
const { bankForAddr, BANK_BASE, EXTBASE, INT_BANK_SPAN, regionSize } =
  await import(pathToFileURL(join(out, "addr.js")).href);

// --- …and `regionLabelForBlock` (src/lib/engine/classify.ts), which maps a failed flash
// block from gnw-flasher's FlashVerifyError onto the SAME already-localized geometry-bar
// segment labels the UI draws. It lives with the geometry, not with the flasher, on purpose:
// the engine carries block identity only (bank/offset/address) and never UI copy.
// `locale` (a .svelte.ts rune store) is stubbed — nothing here depends on the strings, only
// on which segment covers an offset.
{
  const { writeFileSync } = await import("node:fs");
  const stub = join(out, "locale-stub.js");
  writeFileSync(stub, "export const locale = new Proxy({}, { get: () => new Proxy({}, { get: () => '' }) });\n");
  // classify.ts -> intflashscan.ts pulls @gnw/gnw-patch (patch tables, WASM). Unused by the
  // geometry helpers under test, and unresolvable from the temp outdir; stub it to nothing.
  // CommonJS on purpose: esbuild allows any NAMED import off a CJS module (interop), so one
  // stub covers every symbol intflashscan happens to pull in without listing them.
  const pkgStub = join(out, "pkg-stub.cjs");
  writeFileSync(pkgStub, "module.exports = new Proxy({}, { get: () => () => undefined });\n");
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/engine/classify.ts")],
    outdir: out,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    plugins: [
      {
        name: "stub-locale",
        setup(b) {
          b.onResolve({ filter: /i18n\/locale\.svelte\.js$/ }, () => ({ path: stub }));
          b.onResolve({ filter: /^@gnw\// }, () => ({ path: pkgStub }));
        },
      },
    ],
    logLevel: "warning",
  });
}
const { regionLabelForBlock } = await import(pathToFileURL(join(out, "classify.js")).href);

const seg = (bank, offset, size, label, kind) => ({ pct: 0, kind, label, bank, offset, size, detail: [] });
const GEO = [
  seg(0, 0, 0x100000, "OFW", "ofw"),
  seg(0, 0x100000, 0x300000, "Games & Homebrew", "frogfs"),
  seg(0, 0x400000, 0xc00000, "Free Space", "free"),
  seg(1, 0, 0x40000, "retro-go", "bank"),
];

check("a failed block resolves to the partition label covering its offset", () => {
  eq(regionLabelForBlock(GEO, { bank: 0, offset: 0x100000 }), "Games & Homebrew", "first byte of the region");
  eq(regionLabelForBlock(GEO, { bank: 0, offset: 0x3fffff }), "Games & Homebrew", "last byte of the region");
  eq(regionLabelForBlock(GEO, { bank: 0, offset: 0 }), "OFW", "the region below it");
  eq(regionLabelForBlock(GEO, { bank: 1, offset: 0x2000 }), "retro-go", "an internal bank");
});

check("the bank is part of the match, not just the offset", () => {
  // Bank 1 offset 0x2000 is 'retro-go'; the SAME offset in bank 0 is the OFW partition.
  eq(regionLabelForBlock(GEO, { bank: 0, offset: 0x2000 }), "OFW", "bank 0");
  eq(regionLabelForBlock(GEO, { bank: 2, offset: 0x2000 }), null, "an unmapped bank yields no label");
});

check("no covering segment yields null, so the caller can fall back to the bare address", () => {
  eq(regionLabelForBlock(GEO, { bank: 0, offset: 0x2000000 }), null, "past the end of the scan");
  eq(regionLabelForBlock([], { bank: 0, offset: 0 }), null, "no scan at all");
});

check("free space is only used when nothing named covers the block", () => {
  eq(regionLabelForBlock(GEO, { bank: 0, offset: 0x800000 }), "Free Space", "genuinely free");
  // A named partition and the free filler both covering an offset must not flip to 'free'.
  // The free segment is deliberately FIRST here: `extflashSegments` interleaves free runs by
  // offset, so array order gives no guarantee the named one is seen first. Asserting this with
  // the free segment appended last passes even if the kind filter is deleted entirely.
  const overlap = [seg(0, 0, 0x1000000, "Free Space", "free"), ...GEO];
  eq(regionLabelForBlock(overlap, { bank: 0, offset: 0x100000 }), "Games & Homebrew", "named wins over free");
  eq(regionLabelForBlock(overlap, { bank: 0, offset: 0 }), "OFW", "named wins over free, at an offset the free run also starts at");
});

const B1 = BANK_BASE[1]; // 0x08000000
const B2 = BANK_BASE[2]; // 0x08100000
const MB = 1024 * 1024;

// --- The map the function is asserting --------------------------------------------------
check("the module's own constants are what this test assumes", () => {
  eq(B1, 0x08000000, "bank 1 base");
  eq(B2, 0x08100000, "bank 2 base");
  eq(EXTBASE, 0x90000000, "extflash base");
  eq(INT_BANK_SPAN, 0x40000, "internal bank span (256 KiB)");
  eq(regionSize(0, 64), 64 * MB, "regionSize follows the scanned ext size");
  // Armed: the INTERNAL region size is what Dump's overrun clamp (`region - off`) uses for
  // banks 1/2. Shrinking it silently truncated every internal dump and no check noticed.
  eq(regionSize(1, 64), INT_BANK_SPAN, "bank 1 region is one internal bank span");
  eq(regionSize(2, 64), INT_BANK_SPAN, "bank 2 region is one internal bank span");
  eq(regionSize(1, null), INT_BANK_SPAN, "an internal region does not depend on the ext scan");
});

check("anything below bank 1's base is outside every bank", () => {
  eq(bankForAddr(0, 64), -1, "zero");
  eq(bankForAddr(0x00000001, 64), -1, "low memory");
  eq(bankForAddr(B1 - 1, 64), -1, "the byte immediately below bank 1");
  eq(bankForAddr(0x20000000, 64), -1, "internal SRAM, not flash");
});

check("bank 1 covers exactly its first and last byte", () => {
  eq(bankForAddr(B1, 64), 1, "bank 1 first byte");
  eq(bankForAddr(B1 + 1, 64), 1, "inside bank 1");
  eq(bankForAddr(B1 + INT_BANK_SPAN - 1, 64), 1, "bank 1 last byte");
});

// THE regression. Every address here is >= bank 1's base, so an unbounded bank 1 returns 1.
check("the gap between bank 1's end and bank 2's base belongs to NEITHER bank", () => {
  eq(bankForAddr(B1 + INT_BANK_SPAN, 64), -1, "the first byte past bank 1");
  eq(bankForAddr(0x08080000, 64), -1, "mid-gap (the reported repro address)");
  eq(bankForAddr(B2 - 1, 64), -1, "the byte immediately below bank 2");
  // Armed: the two addresses this gap sits between DO resolve, so the denial above is not
  // vacuous — it is the bound, not a broken function.
  eq(bankForAddr(B1 + INT_BANK_SPAN - 1, 64), 1, "the byte below the gap is bank 1");
  eq(bankForAddr(B2, 64), 2, "the byte above the gap is bank 2");
});

check("a gap address can never produce a negative clamped length", () => {
  // The exact arithmetic DumpSection performs: bank -> region -> offset -> overrun clamp.
  const addr = 0x08080000;
  const bank = bankForAddr(addr, 64);
  eq(bank, -1, "the gap address must not name a bank");
  // The caller's guard: inRange false => region 0, offBytes NaN, valid false, no read.
  const inRange = bank >= 0;
  eq(inRange, false, "inRange must be false");
  const region = inRange ? regionSize(bank, 64) : 0;
  const off = inRange ? addr - BANK_BASE[bank] : NaN;
  eq(region, 0, "no region for an out-of-bank address");
  eq(Number.isFinite(off), false, "no offset for an out-of-bank address");
});

check("bank 2 covers exactly its first and last byte, and stops there", () => {
  eq(bankForAddr(B2, 64), 2, "bank 2 first byte");
  eq(bankForAddr(B2 + INT_BANK_SPAN - 1, 64), 2, "bank 2 last byte");
  eq(bankForAddr(B2 + INT_BANK_SPAN, 64), -1, "the first byte past bank 2");
  eq(bankForAddr(0x08200000, 64), -1, "well past bank 2");
});

check("extflash is bounded by the SCANNED size, not a constant", () => {
  eq(bankForAddr(EXTBASE, 64), 0, "ext first byte");
  eq(bankForAddr(EXTBASE + 64 * MB - 1, 64), 0, "ext last byte of a 64 MB chip");
  eq(bankForAddr(EXTBASE + 64 * MB, 64), -1, "the first byte past a 64 MB chip");
  // Same address, smaller chip: in range on 64 MB, out of range on 16 MB.
  eq(bankForAddr(EXTBASE + 20 * MB, 64), 0, "20 MB into a 64 MB chip is in range");
  eq(bankForAddr(EXTBASE + 20 * MB, 16), -1, "the same address on a 16 MB chip is not");
  eq(bankForAddr(EXTBASE + 16 * MB - 1, 16), 0, "ext last byte of a 16 MB chip");
});

check("a device with no scanned ext size cannot resolve an ext address", () => {
  // regionSize falls back to 1 MB for a null size, so only the first megabyte resolves —
  // and the realistic case (a partition address well up the chip) does not.
  eq(bankForAddr(EXTBASE + 20 * MB, null), -1, "no scan => no far ext address");
  eq(bankForAddr(B2, null), 2, "internal banks do not depend on the ext scan");
});

check("garbage in gives -1, not a bank", () => {
  eq(bankForAddr(NaN, 64), -1, "NaN (what parseAddr returns for garbage)");
  eq(bankForAddr(Infinity, 64), -1, "Infinity");
  eq(bankForAddr(-1, 64), -1, "negative");
});

// --- Report -----------------------------------------------------------------------------
console.log(`\naddr: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
