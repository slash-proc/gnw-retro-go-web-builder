/** Retro-Go's global /CONFIG file (persistent_config_t).
 *
 * The firmware stores this as a packed 416-byte little-endian struct in the root of
 * LittleFS. Keep the binary layout here instead of serialising a partial object: the
 * startup/autostart and reserved bytes must survive a reinstall even though they are not
 * part of the ordinary setup UI.
 */

export const RETRO_GO_CONFIG_SIZE = 416;
export const RETRO_GO_CONFIG_MAGIC = 0xcafef00d;
export const RETRO_GO_CONFIG_VERSION = 9;

// Bounds and option order are defined by upstream/external_cores. Keep these in one place so
// the setup controls and the binary encoder apply the same validation.
export const RETRO_GO_BACKLIGHT_RANGE = { min: 0, max: 9 } as const;
export const RETRO_GO_VOLUME_RANGE = { min: 0, max: 9 } as const;
export const RETRO_GO_FONT_SIZE_RANGE = { min: 8, max: 32 } as const;
export const RETRO_GO_THEME_COUNT = 5;
export const RETRO_GO_COLOR_COUNT = 26;
/** RGB888 previews converted from upstream/external_cores/Core/Src/retro-go/gui.c. */
export const RETRO_GO_COLOR_PALETTES = [
  ["#000000", "#630000", "#d68a29", "#5a4110"],
  ["#000000", "#940000", "#d68a29", "#5a4110"],
  ["#000000", "#310000", "#d68a29", "#5a4110"],
  ["#000000", "#630000", "#ffd700", "#634108"],
  ["#000000", "#940000", "#ffd700", "#634108"],
  ["#000000", "#310000", "#ffd700", "#634108"],
  ["#100000", "#630000", "#d68a29", "#5a4110"],
  ["#100000", "#940000", "#d68a29", "#5a4110"],
  ["#100000", "#630000", "#ffd700", "#634108"],
  ["#100000", "#940000", "#ffd700", "#634108"],
  ["#000000", "#630000", "#d68a29", "#5a4110"],
  ["#000000", "#630000", "#ffd700", "#634108"],
  ["#31415a", "#845d4a", "#e7dfde", "#8c8684"],
  ["#291810", "#42696b", "#b58239", "#945d4a"],
  ["#002c29", "#00345a", "#b5a69c", "#18656b"],
  ["#5a3439", "#844939", "#b5d7ce", "#004942"],
  ["#101410", "#293c18", "#ffe384", "#ef9a21"],
  ["#391831", "#94617b", "#ce5939", "#9c2821"],
  ["#291c10", "#635d52", "#fff3bd", "#f7b64a"],
  ["#294139", "#632418", "#e7d3ad", "#ef6d29"],
  ["#212839", "#9cba7b", "#f7df9c", "#ef8e21"],
  ["#732021", "#847184", "#f7d3c6", "#d66d39"],
  ["#31415a", "#843418", "#efc7b5", "#ef9673"],
  ["#734121", "#841008", "#adb221", "#7b6d10"],
  ["#525d73", "#846939", "#dee7de", "#106d84"],
  ["#633010", "#6b8eb5", "#ffcf73", "#9ca2ad"],
] as const;
export const RETRO_GO_TURBO_COUNT = 4;
export const RETRO_GO_FONT_COUNT = 9;
export const RETRO_GO_LANGUAGE_NAMES = [
  "English",
  "Spanish",
  "Portuguese",
  "French",
  "Italian",
  "Deutsch",
  "Norwegian",
  "Russian",
  "Simplified Chinese",
  "Traditional Chinese",
  "Korean",
  "Japanese",
] as const;
export const RETRO_GO_CPU_OC_COUNT = 3;
export const RETRO_GO_MENU_TIMEOUT_RANGE = { min: 0, max: 3600, step: 60 } as const;

export interface RetroGoConfigValues {
  backlight: number;
  startAction: number;
  volume: number;
  fontSize: number;
  theme: number;
  colors: number;
  turboButtons: number;
  font: number;
  language: number;
  startupApp: number;
  cpuOcLevel: number;
  startupFile: string;
  menuTimeoutS: number;
  selectedTab: number;
  cursor: number;
  browseSubpath: string;
  debugClockAlwaysOn: boolean;
  welcomePrompt: number;
}

export interface ParsedRetroGoConfig {
  values: RetroGoConfigValues;
  valid: boolean;
  magicValid: boolean;
  versionSupported: boolean;
  crcValid: boolean;
}

/** Defaults from persistent_config_default in Retro-Go's odroid_settings.c. */
export function defaultRetroGoConfig(): RetroGoConfigValues {
  return {
    backlight: 6,
    startAction: 0,
    volume: 4,
    fontSize: 8,
    theme: 2,
    colors: 0,
    turboButtons: 0,
    font: 0,
    language: 0,
    startupApp: 0,
    cpuOcLevel: 0,
    startupFile: "",
    menuTimeoutS: 600,
    selectedTab: 0,
    cursor: 0,
    browseSubpath: "",
    debugClockAlwaysOn: false,
    welcomePrompt: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? Math.trunc(value) : min));
}

/** Clamp UI-visible values to the same ranges enforced by the firmware getters/setters. */
export function normalizeRetroGoConfig(values: RetroGoConfigValues): RetroGoConfigValues {
  const timeout = clamp(values.menuTimeoutS, RETRO_GO_MENU_TIMEOUT_RANGE.min, RETRO_GO_MENU_TIMEOUT_RANGE.max);
  return {
    ...values,
    backlight: clamp(values.backlight, RETRO_GO_BACKLIGHT_RANGE.min, RETRO_GO_BACKLIGHT_RANGE.max),
    startAction: clamp(values.startAction, 0, 2),
    volume: clamp(values.volume, RETRO_GO_VOLUME_RANGE.min, RETRO_GO_VOLUME_RANGE.max),
    fontSize: clamp(values.fontSize, RETRO_GO_FONT_SIZE_RANGE.min, RETRO_GO_FONT_SIZE_RANGE.max),
    theme: clamp(values.theme, 0, RETRO_GO_THEME_COUNT - 1),
    colors: clamp(values.colors, 0, RETRO_GO_COLOR_COUNT - 1),
    turboButtons: clamp(values.turboButtons, 0, RETRO_GO_TURBO_COUNT - 1),
    font: clamp(values.font, 0, RETRO_GO_FONT_COUNT - 1),
    language: clamp(values.language, 0, RETRO_GO_LANGUAGE_NAMES.length - 1),
    cpuOcLevel: clamp(values.cpuOcLevel, 0, RETRO_GO_CPU_OC_COUNT - 1),
    menuTimeoutS: timeout === 0
      ? 0
      : Math.round(timeout / RETRO_GO_MENU_TIMEOUT_RANGE.step) * RETRO_GO_MENU_TIMEOUT_RANGE.step,
  };
}

function readCString(bytes: Uint8Array, offset: number, length: number): string {
  const end = bytes.subarray(offset, offset + length).indexOf(0);
  const slice = bytes.subarray(offset, offset + (end < 0 ? length : end));
  return new TextDecoder().decode(slice);
}

function writeCString(view: DataView, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value).subarray(0, length - 1);
  for (let i = 0; i < length; i++) view.setUint8(offset + i, 0);
  for (let i = 0; i < bytes.length; i++) view.setUint8(offset + i, bytes[i]);
}

/** Same reflected CRC32 used by crc32_le(0, ...) in the firmware. */
export function retroGoCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function parseRetroGoConfig(input: Uint8Array): ParsedRetroGoConfig | null {
  if (input.length !== RETRO_GO_CONFIG_SIZE) return null;
  const bytes = input.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint8(4);
  const storedCrc = view.getUint32(412, true);
  const crcInput = bytes.slice();
  new DataView(crcInput.buffer).setUint32(412, 0, true);
  const computedCrc = retroGoCrc32(crcInput);
  const values: RetroGoConfigValues = normalizeRetroGoConfig({
    backlight: view.getUint8(5),
    startAction: view.getUint8(6),
    volume: view.getUint8(7),
    fontSize: view.getUint8(8),
    theme: view.getUint8(9),
    colors: view.getUint8(10),
    turboButtons: view.getUint8(11),
    font: view.getUint8(12),
    language: view.getUint8(13),
    startupApp: view.getUint8(14),
    cpuOcLevel: view.getUint8(15),
    startupFile: readCString(bytes, 16, 256),
    menuTimeoutS: view.getUint16(272, true),
    selectedTab: view.getUint16(274, true),
    cursor: view.getUint16(276, true),
    browseSubpath: readCString(bytes, 278, 96),
    debugClockAlwaysOn: view.getUint8(374) !== 0,
    welcomePrompt: view.getUint32(376, true),
  });
  const magicValid = magic === RETRO_GO_CONFIG_MAGIC;
  const versionSupported = version === RETRO_GO_CONFIG_VERSION;
  const crcValid = storedCrc === computedCrc;
  return { values, valid: magicValid && versionSupported && crcValid, magicValid, versionSupported, crcValid };
}

/** Encode values, optionally starting from an existing blob so hidden fields survive. */
export function encodeRetroGoConfig(values: RetroGoConfigValues, base?: Uint8Array): Uint8Array {
  values = normalizeRetroGoConfig(values);
  const bytes = base && base.length === RETRO_GO_CONFIG_SIZE ? base.slice() : new Uint8Array(RETRO_GO_CONFIG_SIZE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, RETRO_GO_CONFIG_MAGIC, true);
  view.setUint8(4, RETRO_GO_CONFIG_VERSION);
  view.setUint8(5, values.backlight & 0xff);
  view.setUint8(6, values.startAction & 0xff);
  view.setUint8(7, values.volume & 0xff);
  view.setUint8(8, values.fontSize & 0xff);
  view.setUint8(9, values.theme & 0xff);
  view.setUint8(10, values.colors & 0xff);
  view.setUint8(11, values.turboButtons & 0xff);
  view.setUint8(12, values.font & 0xff);
  view.setUint8(13, values.language & 0xff);
  view.setUint8(14, values.startupApp & 0xff);
  view.setUint8(15, values.cpuOcLevel & 0xff);
  writeCString(view, 16, 256, values.startupFile);
  view.setUint16(272, Math.max(0, Math.min(0xffff, values.menuTimeoutS | 0)), true);
  view.setUint16(274, values.selectedTab & 0xffff, true);
  view.setUint16(276, values.cursor & 0xffff, true);
  writeCString(view, 278, 96, values.browseSubpath);
  view.setUint8(374, values.debugClockAlwaysOn ? 1 : 0);
  view.setUint8(375, 0);
  view.setUint32(376, values.welcomePrompt >>> 0, true);
  view.setUint32(412, 0, true);
  view.setUint32(412, retroGoCrc32(bytes), true);
  return bytes;
}

