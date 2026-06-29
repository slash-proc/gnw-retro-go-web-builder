import type { AssetExtractionRequest, AssetExtractionResult } from "./index.js";

// In an ES module worker, importScripts requires a classic worker, or we can just use dynamic import.
// Let's use dynamic import since this is a module worker.
let pyodideInstance: any = null;

async function initPyodide() {
  if (pyodideInstance) return pyodideInstance;
  // @ts-ignore
  const pyodideModule = await import("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.mjs");
  pyodideInstance = await pyodideModule.loadPyodide();
  await pyodideInstance.loadPackage("micropip");
  const micropip = pyodideInstance.pyimport("micropip");
  await micropip.install("Pillow");
  await micropip.install("PyYAML");
  return pyodideInstance;
}

globalThis.onmessage = async (e: MessageEvent<AssetExtractionRequest>) => {
  const { game, romData, zipUrl } = e.data;
    let step = "init";
  try {
    const pyodide = await initPyodide();

    step = "fetch zip";
    const zipData = await fetch(zipUrl).then((r) => r.arrayBuffer());
    try { pyodide.FS.mkdir("/restools"); } catch (e) {}
    
    step = "unpack";
    await pyodide.unpackArchive(zipData, "zip", { extractDir: "/restools" });

    step = "mkdir game";
    try { pyodide.FS.mkdir(`/restools/${game}`); } catch (e) {}

    step = "write rom";
    const romPath = `/restools/${game}/rom.sfc`;
    pyodide.FS.writeFile(romPath, new Uint8Array(romData));

    step = "run python";
    let pyCode = "";
    const resetCode = `import os, sys, runpy\nfor k in list(sys.modules.keys()):\n    file_attr = getattr(sys.modules[k], '__file__', None)\n    if file_attr and file_attr.startswith('/restools'):\n        del sys.modules[k]\n`;
    if (game === "zelda3") {
      pyCode = resetCode + `os.chdir("/restools/zelda3")\nos.makedirs("sprites", exist_ok=True)\nsys.path.insert(0, "/restools/zelda3")\nsys.argv = ["restool.py", "--extract-from-rom", "--rom", "rom.sfc"]\nrunpy.run_path("restool.py", run_name="__main__")`;
    } else if (game === "smw") {
      pyCode = resetCode + `os.chdir("/restools/smw")\nsys.path.insert(0, "/restools/smw")\nsys.argv = ["restool.py", "--rom", "rom.sfc"]\nrunpy.run_path("restool.py", run_name="__main__")`;
    }

    await pyodide.runPythonAsync(pyCode);

    step = "read output";
    const resultFiles: Record<string, Uint8Array> = {};
    if (game === "zelda3") {
      resultFiles["zelda3_assets.dat"] = pyodide.FS.readFile("/restools/zelda3/zelda3_assets.dat");
    } else if (game === "smw") {
      resultFiles["smw_assets.dat"] = pyodide.FS.readFile("/restools/smw/smw_assets.dat");
    }

    step = "cleanup";
    pyodide.FS.unlink(romPath);

    globalThis.postMessage({ game, success: true, files: resultFiles } as AssetExtractionResult);
  } catch (error: any) {
    globalThis.postMessage({ game, success: false, error: `Failed at step: ${step} - ${error.message || String(error)}` } as AssetExtractionResult);
  }
};
