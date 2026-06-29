const CONSOLE_WHITELISTS = {
  nes: [".nes", ".fds", ".nsf"],
  snes: [".sfc", ".smc"],
  gb: [".gb", ".gbc"],
  gbc: [".gb", ".gbc"],
  gba: [".gba"],
  sms: [".sms"],
  gg: [".gg"],
  md: [".md", ".gen", ".smd", ".bin"],
  pce: [".pce"],
  sg: [".sg"],
  gw: [".gw"],
  col: [".col", ".rom"],
  wsv: [".wsv", ".sv", ".bin"],
  msx: [".msx", ".rom", ".dsk", ".mx1", ".mx2", ".cdk", ".cas"],
  a2600: [".a26", ".bin"],
  a7800: [".a78", ".bin"],
  amstrad: [".dsk", ".cdk", ".cdt", ".sna"],
  videopac: [".bin"],
  tama: [".b", ".bin"],
  mini: [".min"],
  pico8: [".p8", ".png"]
};

// If a file is in a valid console folder, we check its extension.
// If the extension matches the whitelist for that folder, it's included.
// To determine the ACTUAL system (e.g. gb vs gbc), we might need a specific mapping:
const EXT_TO_SYSTEM_OVERRIDE = {
  ".gbc": "gbc",
  ".gb": "gb"
};
