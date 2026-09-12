/**
 * builder-core suite. resolveBuild() is the only real logic in this package —
 * the Makefile-equivalent layout decision: bank → INTFLASH_ADDRESS, the
 * power-of-two EXTFLASH_OFFSET+SIZE constraint from the linker script, and the
 * CI variant key. Everything else is still a `notImplemented()` scaffold stub,
 * which is itself worth pinning: several call sites treat these as "not ready
 * yet", and a stub that silently started returning undefined instead of
 * throwing would be worse than one that throws.
 */
import { resolveBuild, fetchManifest, listVariants, fetchArtifacts, buildFilesystem, flash, pullSaves, pushSaves } from "../dist/index.js";

let pass = 0,
  fail = 0;
const check = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
};

const base = { target: "mario", intflashBank: 1, extflashSizeMb: 1, sdCard: false };

// --- bank → internal flash address (Makefile INTFLASH_ADDRESS) --------------
check(resolveBuild({ ...base, intflashBank: 1 }).intflashAddress === 0x08000000, "bank 1 → INTFLASH_ADDRESS 0x08000000");
check(resolveBuild({ ...base, intflashBank: 2 }).intflashAddress === 0x08100000, "bank 2 → INTFLASH_ADDRESS 0x08100000");
check(resolveBuild({ ...base, intflashBank: 2 }).intflashAddress - resolveBuild({ ...base, intflashBank: 1 }).intflashAddress === 0x100000,
  "the two banks are 1 MiB apart");
check(resolveBuild(base).extflashAddress === 0x90000000, "external flash is memory-mapped at 0x90000000");

// --- size / offset ----------------------------------------------------------
check(resolveBuild({ ...base, extflashSizeMb: 64 }).extflashSize === 64 * 1024 * 1024, "extflashSizeMb is converted to bytes");
check(resolveBuild(base).extflashOffset === 0, "extflashOffset defaults to 0");
check(resolveBuild({ ...base, extflashSizeMb: 8, extflashOffset: 8 * 1024 * 1024 }).extflashOffset === 8 * 1024 * 1024,
  "an explicit extflashOffset is carried through");

// The linker-script constraint: OFFSET + SIZE must be a power of two.
const rejects = (opts, label) => {
  let msg = "";
  try {
    resolveBuild(opts);
  } catch (e) {
    msg = String(e);
  }
  check(/must be a power of 2/.test(msg), `${label} (got: ${msg || "no throw"})`);
};
rejects({ ...base, extflashSizeMb: 3 }, "3 MiB (not a power of 2) is rejected");
rejects({ ...base, extflashSizeMb: 8, extflashOffset: 4 * 1024 * 1024 }, "offset 4 MiB + size 8 MiB = 12 MiB is rejected");
rejects({ ...base, extflashSizeMb: 0 }, "a zero-size external flash is rejected (0 is not a power of 2)");
rejects({ ...base, extflashSizeMb: -1 }, "a negative size is rejected");
check(resolveBuild({ ...base, extflashSizeMb: 8, extflashOffset: 8 * 1024 * 1024 }).extflashSize === 8 * 1024 * 1024,
  "offset 8 MiB + size 8 MiB = 16 MiB is accepted");
check(resolveBuild({ ...base, extflashSizeMb: 1, extflashOffset: 3 * 1024 * 1024 }).extflashOffset === 3 * 1024 * 1024,
  "offset 3 MiB + size 1 MiB = 4 MiB is accepted (the SUM is what must be a power of 2)");

// --- variant key (must match the CI artifact naming) ------------------------
check(resolveBuild({ ...base, extflashSizeMb: 16 }).variantKey === "mario-ext16mb-flash", "variantKey: mario / 16 MiB / flash");
check(resolveBuild({ target: "zelda", intflashBank: 2, extflashSizeMb: 64, sdCard: true }).variantKey === "zelda-ext64mb-sd",
  "variantKey: zelda / 64 MiB / sd");
check(resolveBuild({ ...base, intflashBank: 2 }).variantKey === resolveBuild({ ...base, intflashBank: 1 }).variantKey,
  "variantKey does not depend on the intflash bank (the same artifact is linked for either)");
check(resolveBuild({ ...base, sdCard: true }).sdCard === true && resolveBuild(base).sdCard === false, "sdCard is carried through");
check(resolveBuild({ target: "zelda", intflashBank: 1, extflashSizeMb: 1, sdCard: false }).target === "zelda", "target is carried through");

// resolveBuild is pure: same input → equal output, and no input mutation.
{
  const opts = { ...base, extflashSizeMb: 16, features: { coverflow: true } };
  const frozen = JSON.stringify(opts);
  const a = resolveBuild(opts);
  const b = resolveBuild(opts);
  check(JSON.stringify(a) === JSON.stringify(b), "resolveBuild is deterministic");
  check(JSON.stringify(opts) === frozen, "resolveBuild does not mutate its input");
  check(!("features" in a), "opaque feature toggles are not leaked into the descriptor");
}

// --- scaffold stubs must keep throwing, loudly and by name ------------------
for (const [fn, name] of [
  [() => fetchManifest("http://x"), "fetchManifest"],
  [() => listVariants("http://x"), "listVariants"],
  [() => fetchArtifacts(resolveBuild(base)), "fetchArtifacts"],
  [() => buildFilesystem("flash", [], resolveBuild(base)), "buildFilesystem"],
  [() => flash({}, {}), "flash"],
  [() => pullSaves({}), "pullSaves"],
  [() => pushSaves({}, {}), "pushSaves"],
]) {
  let msg = "";
  try {
    await fn();
  } catch (e) {
    msg = String(e);
  }
  // listVariants delegates to fetchManifest, so it reports that name.
  const want = name === "listVariants" ? "fetchManifest" : name;
  check(new RegExp(`\\[builder-core\\] ${want} not implemented yet`).test(msg), `${name}(): rejects with a named scaffold error (got: ${msg || "no throw"})`);
}

console.log(`builder-core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
