/// <reference lib="webworker" />

// Load Pyodide from CDN
importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js");

declare function loadPyodide(options?: any): Promise<any>;

let pyodideReady: Promise<any> | null = null;
let pyodide: any = null;

async function initPyodide() {
  if (!pyodideReady) {
    pyodideReady = loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/",
    }).then((p) => {
      pyodide = p;
      return p;
    });
  }
  return pyodideReady;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, action, game, romData, restoolZip } = e.data;

  try {
    if (action === "extract") {
      await initPyodide();

      // 1. Unpack the restool python scripts into the virtual filesystem
      pyodide.unpackArchive(restoolZip, "zip", { extractDir: "/restools" });

      // 2. Write the ROM to the virtual FS
      const romName = game === "smw" ? "smw.sfc" : "zelda3.sfc";
      pyodide.FS.writeFile(`/${romName}`, new Uint8Array(romData));

      // 3. Run the extraction script
      let outData: Uint8Array | null = null;

      if (game === "smw") {
        await pyodide.runPythonAsync(`
import sys
import os

os.chdir('/restools/restools/smw')
sys.argv = ['restool.py', '--rom', '/smw.sfc']

with open('restool.py', 'r') as f:
    code = f.read()

exec(code, {'__name__': '__main__'})
        `);
        outData = pyodide.FS.readFile("/restools/restools/smw/smw_assets.dat");
      } else if (game === "zelda3") {
        await pyodide.runPythonAsync(`
import sys
import os

os.chdir('/restools/restools/zelda3')
sys.argv = ['restool.py', '--rom', '/zelda3.sfc']

with open('restool.py', 'r') as f:
    code = f.read()

exec(code, {'__name__': '__main__'})
        `);
        outData = pyodide.FS.readFile("/restools/restools/zelda3/zelda3_assets.dat");
      }

      self.postMessage({ id, success: true, data: outData }, [outData!.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ id, success: false, error: err.message || String(err) });
  }
};
