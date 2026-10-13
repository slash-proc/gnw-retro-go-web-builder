// Exercise browser LittleFS call sites: Node's vendor-relative fallback hides missing URLs.
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const out = join(mkdtempSync(join(tmpdir(), "lfs-url-")), "reader.mjs");
globalThis.__lfsDevice = {
  partitions: [{ fs: "littlefs", offset: 0, size: 8192, meta: { blockSize: 4096, blockCount: 2 } }],
  flasher: {}, lfsBlockCache: new Map(), installedLfsTree: null,
};
globalThis.__lfsUrls = [];
await build({
  entryPoints: ["src/lib/engine/lfsBrowser.ts"], outfile: out,
  bundle: true, platform: "node", format: "esm",
  plugins: [{ name: "browser-fixture", setup(b) {
    b.onResolve({ filter: /device\.svelte\.js$|^@gnw\/fs-builders/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => {
      if (a.path.endsWith("?url")) return { contents: 'export default "/assets/littlefs-fixture.wasm";' };
      if (a.path.includes("device.svelte")) return { contents: "export const device = globalThis.__lfsDevice;" };
      return { contents: `
        export async function readLittleFsTree(bs,bc,fetchBlock,opts) {
          globalThis.__lfsUrls.push(opts?.locateFile?.("littlefs.wasm"));
          return {children:[]};
        }
        export async function readLittleFsFileLazy(bs,bc,path,fetchBlock,opts) {
          globalThis.__lfsUrls.push(opts?.locateFile?.("littlefs.wasm"));
          return new Uint8Array([42]);
        }` };
    });
  }}],
});
const reader = await import(pathToFileURL(out).href);
await reader.ensureLfsTree();
assert.deepEqual(await reader.readLfsFile("data/save"), new Uint8Array([42]));
assert.deepEqual(globalThis.__lfsUrls, ["/assets/littlefs-fixture.wasm", "/assets/littlefs-fixture.wasm"]);
const sync = readFileSync("src/lib/views/RomManagementTab.svelte", "utf8");
assert.match(sync, /import littlefsWasmUrl from .*littlefs\.wasm\?url/);
assert.match(sync, /buildCoresLittlefs\(lfsFiles,[^\n]*moduleOpts: \{ locateFile: \(\) => littlefsWasmUrl \}/);
console.log("lfswasmurl: browser tree, file reader and sync builder URL checks passed");
