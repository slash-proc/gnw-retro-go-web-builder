const CONSOLE_WHITELISTS: Record<string, Set<string>> = {
  nes: new Set([".nes", ".fds", ".nsf"]),
  snes: new Set([".sfc", ".smc"]),
  gb: new Set([".gb", ".gbc"]),
  gbc: new Set([".gb", ".gbc"]),
  gba: new Set([".gba"]),
  sms: new Set([".sms"]),
  gg: new Set([".gg"]),
  md: new Set([".md", ".gen", ".smd", ".bin"]),
  pce: new Set([".pce"]),
  sg: new Set([".sg"]),
  gw: new Set([".gw"]),
  col: new Set([".col", ".rom"]),
  wsv: new Set([".wsv", ".sv", ".bin"]),
  msx: new Set([".msx", ".rom", ".dsk", ".mx1", ".mx2", ".cdk", ".cas"]),
  a2600: new Set([".a26", ".bin"]),
  a7800: new Set([".a78", ".bin"]),
  amstrad: new Set([".dsk", ".cdk", ".cdt", ".sna"]),
  videopac: new Set([".bin"]),
  tama: new Set([".b", ".bin"]),
  mini: new Set([".min"]),
  pico8: new Set([".p8", ".png"])
};

function parseRomPath(path: string): { system: string, name: string } | null {
  const parts = path.split("/");
  const filename = parts.pop();
  if (!filename) return null;

  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null; // No extension
  const ext = filename.slice(dot).toLowerCase();

  // Find the most recent parent directory that matches a valid console shortname
  let governingConsole: string | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].toLowerCase();
    if (CONSOLE_WHITELISTS[p]) {
      governingConsole = p;
      break;
    }
  }

  if (!governingConsole) return null; // Not inside a known console folder

  const whitelist = CONSOLE_WHITELISTS[governingConsole];
  if (!whitelist.has(ext)) return null; // Extension not whitelisted for this console

  let system = governingConsole;
  
  // Special overriding rules based on file extension
  if (ext === ".gbc") system = "gbc";
  if (ext === ".gb") system = "gb";

  return { system, name: filename };
}
console.log(parseRomPath("gb/pokemon/gold.gbc"));
console.log(parseRomPath("msx/games/game.rom"));
console.log(parseRomPath("md/readme.txt"));
console.log(parseRomPath("bios/nes/palettes.bin"));
