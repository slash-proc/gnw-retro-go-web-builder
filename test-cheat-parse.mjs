const userRoms = new Map([
  ["md/Sonic.md", new Uint8Array()],
  ["md/Sonic.ggcodes", new TextEncoder().encode("AABB-CCDD\nEEFF-GGHH")]
]);

const games = [
  { system: "md", name: "Sonic.md", key: "md/Sonic.md" }
];

const parsed = {};
const decoder = new TextDecoder();
for (const [path, data] of userRoms) {
  if (path.endsWith(".ggcodes") || path.endsWith(".mcf") || path.endsWith(".pceplus")) {
    let system = "";
    let baseName = "";
    const parts = path.split("/");
    if (path.startsWith("cheats/") && parts.length >= 3) {
      system = parts[1];
      baseName = parts.slice(2).join("/").replace(/\.[^/.]+$/, "");
    } else if (parts.length >= 2) {
      system = parts[0];
      baseName = parts.slice(1).join("/").replace(/\.[^/.]+$/, "");
    }
    if (system && baseName) {
      const game = games.find(g => 
        g.system === system && g.name.replace(/\.[^/.]+$/, "") === baseName
      );
      if (game) {
        const text = decoder.decode(data);
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        parsed[game.key] = lines;
      }
    }
  }
}
console.log(parsed);
