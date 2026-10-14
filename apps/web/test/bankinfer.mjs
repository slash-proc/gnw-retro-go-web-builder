#!/usr/bin/env node
/** Retro-Go firmware install target is invariant: bank 2, including legacy bank-1 upgrades. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const src = readFileSync(join(here, "../src/lib/advanced/RomSection.svelte"), "utf8");
const wizard = readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8");
assert(/const bank = 2 as const;/.test(src), "Advanced installer must target bank 2");
assert(/bank: 2,/.test(wizard), "Guided Setup must build for bank 2");
assert(/b\.type === "Retro-Go"/.test(wizard), "legacy Retro-Go banks must remain detectable");
assert(!/BankCard/.test(src), "Advanced Retro-Go install must not offer a bank picker");
assert(/RetroGoConfigPanel/.test(src), "Advanced Retro-Go install must expose CONFIG settings");
assert(/bank1NeedsBootPath/.test(src), "Advanced UI must retain boot-path guidance without a bank picker");
assert(/layoutAdvancedToggle/.test(src), "Advanced UI must retain the Advanced Layout disclosure");
console.log("bankinfer: 6 passed, 0 failed");
