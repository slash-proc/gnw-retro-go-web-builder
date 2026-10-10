#!/usr/bin/env node
/** Checks the release signature inventory and the vendored v1.0.8 bootloader assets. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const inventory = readFileSync(join(root, "apps/web/src/lib/engine/bootloaderHashes.ts"), "utf8");
const scanner = readFileSync(join(root, "apps/web/src/lib/engine/intflashscan.ts"), "utf8");
const flashHelper = readFileSync(join(root, "apps/web/src/lib/engine/bootloader.ts"), "utf8");
const wizard = readFileSync(join(root, "apps/web/src/lib/views/Wizard.svelte"), "utf8");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const [standaloneTable, dualbootTable] = inventory.split("export const DUAL_BOOTLOADERS:");
const counts = {
  standalone: (standaloneTable.match(/release: "v1\.0\.[0-8]"/g) ?? []).length,
  dualboot: (dualbootTable.match(/release: "v1\.0\.[3-8]"/g) ?? []).length,
};
if (counts.standalone !== 9 || counts.dualboot !== 6)
  throw new Error(`expected 9 standalone and 6 dual-boot release signatures; saw ${counts.standalone} and ${counts.dualboot}`);
if (!scanner.includes("base + 0x32000") || !scanner.includes('"standalone"'))
  throw new Error("scanner does not inspect standalone and dual-boot bootloader locations");
if (hash(join(root, "packages/gnw-patch/vendor/gnw_bootloader.bin")) !==
    "fe171fad5160c9a02edab5c435f64fc4ee19e97fcf684abe2fe72a54903d005b")
  throw new Error("vendored standalone bootloader does not match Sylverb v1.0.8");
if (!flashHelper.includes("STANDALONE_BOOTLOADER_SHA256") || !wizard.includes("flashStandaloneBootloader"))
  throw new Error("Guided Setup does not verify and install the standalone bootloader");
console.log("bootloader-hashes: 4 passed, 0 failed");
