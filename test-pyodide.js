import pyodideModule from "pyodide";

async function run() {
  const pyodide = await pyodideModule.loadPyodide();
  console.log("Loaded");
  // Try unpack
  const fs = require('fs');
  const buf = fs.readFileSync('packages/gnw-restool/dist/restools.zip');
  try {
    pyodide.FS.mkdir("/restools");
  } catch(e) {}
  await pyodide.unpackArchive(buf, "zip", { extractDir: "/restools" });
  console.log(pyodide.FS.readdir("/restools/smw"));
}
run().catch(console.error);
