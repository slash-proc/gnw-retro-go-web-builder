#!/usr/bin/env node
/** Binary compatibility checks for Retro-Go's official persistent /CONFIG format. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e?.message ?? e}`); }
}
function eq(a, b, message) {
  if (a !== b) throw new Error(`${message}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-retrogo-config-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/retroGoConfig.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const { defaultRetroGoConfig, defaultRetroGoConfigForLocale, encodeRetroGoConfig, normalizeRetroGoConfig, parseRetroGoConfig, retroGoLanguageForLocale, RETRO_GO_COLOR_PALETTES, RETRO_GO_CONFIG_SIZE } =
  await import(pathToFileURL(join(out, "retroGoConfig.js")).href);

const defaults = defaultRetroGoConfig();
const blob = encodeRetroGoConfig(defaults);
check("official CONFIG is 416 bytes and round-trips", () => {
  eq(blob.length, RETRO_GO_CONFIG_SIZE, "CONFIG size");
  const parsed = parseRetroGoConfig(blob);
  eq(parsed.valid, true, "CRC and header validity");
  eq(parsed.values.backlight, 6, "official backlight default");
  eq(parsed.values.volume, 4, "official volume default");
  eq(parsed.values.menuTimeoutS, 600, "official menu timeout default");
});

check("color preview palettes match official count", () => {
  eq(RETRO_GO_COLOR_PALETTES.length, 26, "palette count");
  eq(RETRO_GO_COLOR_PALETTES[0][1], "#630000", "first palette main color");
  eq(RETRO_GO_COLOR_PALETTES[25][2], "#ffcf73", "last palette selected color");
});

check("editing visible settings preserves hidden bytes", () => {
  const seeded = blob.slice();
  seeded[380] = 0xa5; // reserved_app marker used by newer developer builds
  const originalBlob = encodeRetroGoConfig({ ...defaults, startupFile: "/homebrews/dev.bin" }, seeded);
  const original = parseRetroGoConfig(originalBlob);
  const edited = encodeRetroGoConfig({ ...original.values, volume: 7 }, originalBlob);
  const parsed = parseRetroGoConfig(edited);
  eq(parsed.valid, true, "edited CRC");
  eq(parsed.values.volume, 7, "edited volume");
  eq(edited[16], 47, "startup bytes preserved");
  eq(edited[380], 0xa5, "reserved bytes preserved");
  eq(original.values.startupFile, parsed.values.startupFile, "hidden startup field preserved");
});

check("tampering invalidates CRC without changing the decoded layout", () => {
  const changed = blob.slice();
  changed[7] = 8;
  const parsed = parseRetroGoConfig(changed);
  eq(parsed.valid, false, "tampered config rejected");
  eq(parsed.crcValid, false, "tampered CRC rejected");
  eq(parsed.values.volume, 8, "field remains at its stored offset");
});

check("settings are clamped to upstream ranges", () => {
  const normalized = normalizeRetroGoConfig({
    ...defaults,
    backlight: 99,
    volume: -4,
    fontSize: 255,
    theme: 99,
    colors: 99,
    turboButtons: 99,
    font: 99,
    language: 99,
    cpuOcLevel: 99,
    menuTimeoutS: 3599,
  });
  eq(normalized.backlight, 9, "backlight max");
  eq(normalized.volume, 0, "volume min");
  eq(normalized.fontSize, 32, "font size max");
  eq(normalized.theme, 4, "theme max");
  eq(normalized.colors, 25, "colors max");
  eq(normalized.turboButtons, 3, "turbo max");
  eq(normalized.font, 8, "font max");
  eq(normalized.language, 11, "language max");
  eq(normalized.cpuOcLevel, 2, "CPU overclock max");
  eq(normalized.menuTimeoutS, 3600, "timeout rounds to a minute");
});

check("fresh-install language follows the UI locale", () => {
  eq(retroGoLanguageForLocale("de"), 5, "German language");
  eq(defaultRetroGoConfigForLocale("ja").language, 11, "Japanese language");
  eq(defaultRetroGoConfigForLocale("nl").language, 0, "unsupported locale falls back to English");
});

if (failures.length) {
  console.error(`retrogo-config: ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`retrogo-config: ${passed} passed, 0 failed`);
}
