#!/usr/bin/env node
/** Retro-Go firmware install target is invariant: bank 2, including legacy bank-1 upgrades. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const src = readFileSync(join(here, "../src/lib/advanced/RomSection.svelte"), "utf8");
const wizard = readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8");
const config = readFileSync(join(here, "../src/lib/advanced/RetroGoConfigPanel.svelte"), "utf8");
assert(/const bank = 2 as const;/.test(src), "Advanced installer must target bank 2");
assert(/bank: 2,/.test(wizard), "Guided Setup must build for bank 2");
assert(/b\.type === "Retro-Go"/.test(wizard), "legacy Retro-Go banks must remain detectable");
assert(!/BankCard/.test(src), "Advanced Retro-Go install must not offer a bank picker");
assert(/RetroGoConfigPanel/.test(src), "Advanced Retro-Go install must expose CONFIG settings");
assert(/bank1NeedsBootPath/.test(src), "Advanced UI must retain boot-path guidance without a bank picker");
assert(/class="layout-foldout"/.test(src) && /layoutAdvancedToggle/.test(src), "Advanced UI must retain the Advanced Layout disclosure");
assert(/migrateSavesLabel/.test(src) && /migrateSettingsLabel/.test(src), "Advanced migration must split saves and settings");
assert(/bind:alwaysUse=\{retroGoConfigAlwaysUse\}/.test(src) && /bind:alwaysUse=\{retroGoConfigAlwaysUse\}/.test(wizard), "Both install paths must bind the persistent CONFIG preference");
assert(/configAlwaysUse/.test(config) && /saveSel\("retro-go-config-always-use"/.test(config), "CONFIG panel must expose and persist Always use these settings");
assert(/class:config-disabled=\{disabled\}/.test(config) && /pointer-events: none/.test(config), "Keep settings must disable the CONFIG foldout itself");
assert(/writeFilesToDeviceLfs/.test(config) && /path: "CONFIG"/.test(config), "Installed CONFIG updates must write the CONFIG file directly");
assert(/settingsChanged/.test(config) && /configUpdateSettings/.test(config), "CONFIG panel must expose an update action only for changed installed settings");
assert(!/configFontSize|RETRO_GO_FONT_SIZE_RANGE/.test(config), "CONFIG panel must not expose the ineffective font size setting");
assert(/readRomFile/.test(config) && /saveFileToDirOrDownload/.test(config) && /medium === "sd"/.test(config), "SD CONFIG must load and update through the card folder");
assert(/medium=\{installMode\}/.test(src) && /retroGoConfigChanged/.test(src) && /pendingSdContent\.set\("CONFIG"/.test(src), "Advanced SD installs must include selected CONFIG settings");
assert(/id: "keepSettings"/.test(wizard) && /checkboxValues\.keepSettings/.test(wizard), "Guided install must keep settings in the install modal");
assert(/id: "migrateGames", label: \(\) => locale\.t\.romSection\.migrateGamesLabel/.test(wizard) && /id: "migrateSaves", label: \(\) => locale\.t\.romSection\.migrateSavesLabel/.test(wizard), "Guided install controls must use Keep wording");
assert(!/medium=\{device\.targetMedia\}/.test(wizard) && !/sdTree\.set\("CONFIG"/.test(wizard), "Guided Setup must not expose or inject CONFIG settings");
assert(!/offsetHint|layoutDefaultsNote/.test(src), "Advanced Layout must omit the redundant helper text");
assert(/const sourceReservedOffset = chosenReserved/.test(wizard) && /const targetStockModel = backupModelOverride \?\? backupModel/.test(wizard) && /targetReservedOffset\(sourceReservedOffset, targetStockModel, blockSize\)/.test(wizard), "Guided Setup must separate the existing FrogFS offset from the selected stock target");
assert(/readGameData\(readTracked, sourceReservedOffset, g\)/.test(wizard) && /f\.dataOffs \+ sourceReservedOffset/.test(wizard), "Guided migration must read games and assets from their existing FrogFS location");
assert(/defaultLittlefsLength\(\{[\s\S]*?reservedOffset,/.test(wizard), "Guided install layout must size LittleFS from the migrated target offset");
console.log("bankinfer: 20 passed, 0 failed");
