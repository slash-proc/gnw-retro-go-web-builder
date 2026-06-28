import type { AssetExtractionRequest, AssetExtractionResult } from "./index.js";

// Import Pyodide dynamically from CDN.
// In an ES module worker, we can import from an absolute URL.
// @ts-ignore
import * as pyodideModule from "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.mjs";

let pyodideInstance: any = null;

async function initPyodide() {
  if (pyodideInstance) return pyodideInstance;
  pyodideInstance = await pyodideModule.loadPyodide();
  await pyodideInstance.loadPackage("micropip");
  const micropip = pyodideInstance.pyimport("micropip");
  await micropip.install("Pillow");
  await micropip.install("PyYAML");
  return pyodideInstance;
}

globalThis.onmessage = async (e: MessageEvent<AssetExtractionRequest>) => {
  const { game, romData, zipUrl } = e.data;
  try {
    const pyodide = await initPyodide();

    // Fetch and unpack the python scripts
    const zipData = await fetch(zipUrl).then((r) => r.arrayBuffer());
    await pyodide.unpackArchive(zipData, "zip", { extractDir: "/restools" });

    // Write ROM to virtual FS
    const romPath = `/restools/${game}/rom.sfc`;
    pyodide.FS.writeFile(romPath, new Uint8Array(romData));

    // Run the extraction
    let pyCode = "";
    if (game === "zelda3") {
      pyCode = `
import os
import sys
os.chdir("/restools/zelda3")
os.makedirs("sprites", exist_ok=True)
sys.path.insert(0, "/restools/zelda3")
sys.argv = ["restool.py", "--extract-from-rom", "--rom", "rom.sfc"]
import restool
      `;
    } else if (game === "smw") {
      pyCode = `
import os
import sys
os.chdir("/restools/smw")
sys.path.insert(0, "/restools/smw")
sys.argv = ["restool.py", "--rom", "rom.sfc"]
import restool
      `;
    }

    await pyodide.runPythonAsync(pyCode);

    // Read the generated files
    const resultFiles: Record<string, Uint8Array> = {};
    if (game === "zelda3") {
      resultFiles["zelda3_assets.dat"] = pyodide.FS.readFile("/restools/zelda3/zelda3_assets.dat");
    } else if (game === "smw") {
      resultFiles["smw_assets.dat"] = pyodide.FS.readFile("/restools/smw/smw_assets.dat");
    }

    // Clean up to save memory
    pyodide.FS.unlink(romPath);

    globalThis.postMessage({ game, success: true, files: resultFiles } as AssetExtractionResult);
  } catch (error: any) {
    globalThis.postMessage({ game, success: false, error: error.message } as AssetExtractionResult);
  }
};
