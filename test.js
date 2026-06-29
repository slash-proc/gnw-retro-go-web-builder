const { loadPyodide } = require("pyodide");
async function main() {
  const pyodide = await loadPyodide();
  try {
    pyodide.FS.readFile("/does/not/exist");
  } catch (e) {
    console.log("Caught:", e.message);
  }
}
main();
