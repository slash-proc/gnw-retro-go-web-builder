#!/usr/bin/env node
/** Exercise exact Sylverb bootloader signatures through the real bank scanner. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const out = mkdtempSync(join(tmpdir(), "gnw-bootloader-scan-"));
const check = (condition, message) => { if (!condition) throw new Error(message); };

await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/intflashscan.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  plugins: [{
    name: "patch-superblock-stub",
    setup(build) {
      build.onResolve({ filter: /^@gnw\/gnw-patch$/ }, () => ({ path: "patch-stub", namespace: "patch-stub" }));
      build.onLoad({ filter: /.*/, namespace: "patch-stub" }, () => ({
        contents: `export const FLAG_LITTLEFS_LENGTH = 1; export const locateSuperblock = () => { throw new Error("not present"); }; export const readSuperblock = () => { throw new Error("not present"); };`,
        loader: "js",
      }));
    },
  }],
  logLevel: "warning",
});

const { scanIntflashBanks } = await import(pathToFileURL(join(out, "intflashscan.js")).href);
const standalone = readFileSync(join(repo, "packages/gnw-patch/vendor/gnw_bootloader.bin"));
const dualboot = readFileSync(join(repo, "packages/gnw-patch/vendor/gnw_bootloader_0x08032000.bin"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
check(sha(standalone) === "fe171fad5160c9a02edab5c435f64fc4ee19e97fcf684abe2fe72a54903d005b", "standalone test asset changed");
check(sha(dualboot) === "43fd718c1a53dda140f29e4025fc8b6d3bfa71f19a710139135f998e4de022d7", "dualboot test asset changed");

const B1 = 0x08000000;
const B2 = 0x08100000;
const span = 256 << 10;
function imageAt(offset, bytes) {
  const image = new Uint8Array(span).fill(0xff);
  image.set(bytes, offset);
  return image;
}
async function scan(bank1) {
  const bank2 = imageAt(span - 0x1000, new TextEncoder().encode("Retro-Go SD v2.0.0"));
  const read = async (address, length) => {
    const bank = address >= B2 ? bank2 : bank1;
    const base = address >= B2 ? B2 : B1;
    const offset = address - base;
    return bank.slice(offset, offset + length);
  };
  return scanIntflashBanks(read);
}

const standaloneBanks = await scan(imageAt(0, standalone));
check(standaloneBanks[0].bootloader === "standalone", "base-address standalone bootloader was not detected");
check(standaloneBanks[1].retroGoVersion === "v2.0.0", "bank-2 Retro-Go remains detected alongside standalone loader");

const dualBanks = await scan(imageAt(0x32000, dualboot));
check(dualBanks[0].bootloader === "dualboot", "0x32000 dual-boot loader was not detected");
check(dualBanks[1].retroGoVersion === "v2.0.0", "bank-2 Retro-Go remains detected alongside dual-boot loader");

const small = imageAt(0, new Uint8Array(1024).fill(0x42));
const lowBanks = await scanIntflashBanks(async (address,length) => {
  const bank = address >= B2 ? small : new Uint8Array(span).fill(0xff);
  const base = address >= B2 ? B2 : B1;
  return bank.slice(address-base,address-base+length);
});
check(lowBanks[1].type !== "empty" && lowBanks[1].dataSize > 0, "low-address partial bank must not be classified empty");
const faultBanks = await scanIntflashBanks(async (address,length) => {
  if (address === B2+span-4096) throw new Error("injected flash read fault");
  return new Uint8Array(length).fill(0xff);
});
check(faultBanks[1].type.startsWith("unreadable"), "bank geometry read fault must not become empty");
rmSync(out, { recursive: true, force: true });
console.log("bootloader-scan: 8 checks passed, 0 failed");
