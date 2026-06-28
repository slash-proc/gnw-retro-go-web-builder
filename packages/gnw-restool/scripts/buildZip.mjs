import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

async function buildZip() {
  const zip = new JSZip();

  // Zelda 3 Tables
  const zelda3Dir = path.join(ROOT, "external/zelda3/tables");
  if (fs.existsSync(zelda3Dir)) {
    const files = fs.readdirSync(zelda3Dir);
    for (const f of files) {
      if (f.endsWith(".py") || f.endsWith(".bin") || f.endsWith(".png")) {
        const data = fs.readFileSync(path.join(zelda3Dir, f));
        zip.file(`zelda3/${f}`, data);
      }
    }
  }

  // Zelda 3 Other (Fonts)
  const zelda3OtherDir = path.join(ROOT, "external/zelda3/other");
  if (fs.existsSync(zelda3OtherDir)) {
    if (fs.existsSync(path.join(zelda3OtherDir, "3x5_font.png"))) {
      const data = fs.readFileSync(path.join(zelda3OtherDir, "3x5_font.png"));
      zip.file(`other/3x5_font.png`, data);
    }
  }

  // SMW Assets
  const smwDir = path.join(ROOT, "external/smw/assets");
  if (fs.existsSync(smwDir)) {
    const files = fs.readdirSync(smwDir);
    for (const f of files) {
      if (f.endsWith(".py") || f.endsWith(".h")) {
        const data = fs.readFileSync(path.join(smwDir, f));
        zip.file(`smw/${f}`, data);
      }
    }
  }

  const outDir = path.join(__dirname, "../dist");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(path.join(outDir, "restools.zip"), content);
  console.log(`[gnw-restool] Wrote dist/restools.zip (${content.length} bytes)`);
}

buildZip().catch(e => {
  console.error("Failed to build restools.zip:", e);
  process.exit(1);
});
