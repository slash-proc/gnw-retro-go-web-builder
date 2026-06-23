/**
 * Console display names for retro-go's `roms/<system>/` folder names. The scan + the
 * on-device FrogFS read both surface the raw folder key (e.g. "gbc"); the UI shows the
 * friendly label (e.g. "Game Boy Color"). Unknown systems fall back to the uppercased key.
 */
const LABELS: Record<string, string> = {
  nes: "NES",
  fds: "Famicom Disk System",
  snes: "Super NES",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  sms: "Master System",
  gg: "Game Gear",
  md: "Genesis / Mega Drive",
  gen: "Genesis / Mega Drive",
  genesis: "Genesis / Mega Drive",
  pce: "PC Engine",
  col: "ColecoVision",
  a26: "Atari 2600",
  a78: "Atari 7800",
  lynx: "Atari Lynx",
  ws: "WonderSwan",
  ngp: "Neo Geo Pocket",
  msx: "MSX",
  sg1000: "SG-1000",
  pico8: "PICO-8",
  tama: "Tamagotchi",
  wsc: "WonderSwan Color",
  homebrew: "Homebrew",
};

/** Friendly console name for a retro-go system folder key. */
export function consoleLabel(system: string): string {
  return LABELS[system] ?? system.toUpperCase();
}
