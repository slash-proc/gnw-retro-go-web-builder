// Bundle recognition is a preview: only the explicit Add action persists it.
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

const source = readFileSync(new URL("../src/lib/ui/AddSource.svelte", import.meta.url), "utf8");
const script = source.slice(source.indexOf(">") + 1, source.indexOf("</script>"));
const ast = ts.createSourceFile("add.ts", script, ts.ScriptTarget.Latest, true);
const fn = (name) => ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast).replace(/^export /, "");
async function exercise(pick) {
  let added = 0, finished = 0, released = 0;
  const imported = { resolved: { manifest: { title: "Neo Geo" } }, release: () => released++ };
  const sources = { adding: false, addError: null, importBundleFile: async (data, preview) => {
    assert.equal(preview, imported, "Add must save the verified preview");
    added++;
    return true;
  } };
  const context = { sources, importBundle: async () => imported, Uint8Array, SourceError: class extends Error {}, onDone: () => finished++ };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`
    let addMode = "bundle", bundlePending = null, found = null, foundRelease = null;
    let looking = false, busy = false, canAdd = true, urlInput = "";
    ${pick}
    ${fn("submit")}
    ${fn("changeMode")}
    globalThis.form = { pick: pickBundle, add: submit, cancel: () => changeMode("url"),
      state: () => ({found, bundlePending}) };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const input = { files: [{ arrayBuffer: async () => new ArrayBuffer(1) }], value: "bundle.zip" };
  await context.form.pick({ currentTarget: input });
  assert.equal(added, 0, "Picking a bundle must not add it");
  assert.equal(finished, 0, "Picking a bundle must stay on its review page");
  assert.equal(context.form.state().found, imported.resolved);
  assert.equal(input.value, "");
  await context.form.add();
  assert.equal(added, 1);
  assert.equal(finished, 1);
  context.form.cancel();
  assert.equal(released, 0, "Saved bundle URLs belong to the store");
  await context.form.pick({ currentTarget: input });
  context.form.cancel();
  assert.equal(released, 1, "Abandoning a preview must release its URLs");
}
await exercise(fn("pickBundle"));
// Prove this catches the original immediate-import behavior.
await assert.rejects(exercise(`async function pickBundle(e) {
  const data = new Uint8Array(await e.currentTarget.files[0].arrayBuffer());
  if (await sources.importBundleFile(data, await importBundle(data))) onDone();
}`), /Picking a bundle must not add it/);
console.log("bundlereview: preview, explicit Add, cancel cleanup passed; immediate-import mutation rejected");

// Render the actual review component with a recognized bundle pending.
const web = new URL("..", import.meta.url).pathname;
const temp = mkdtempSync(join(web, "node_modules/.bundle-review-"));
const recognized = { index: {title: "Neo Geo"}, manifest: { targets: [{ platform: "game-and-watch", artifacts: [{filename: "neogeo.bin", bytes: 233340}] }] }, entry: {kind: "core", tag: "v0.0.4", publishedAt: "2026-10-02", requiresAbi: {version: "2"}} };
try {
  const armed = source.replace('let addMode = $state<"url" | "bundle" | "raw">("url");', 'let addMode = $state<"url" | "bundle" | "raw">("bundle");').replace('let found = $state<ResolvedSource | null>(null);', `let found = $state<ResolvedSource | null>(${JSON.stringify(recognized)});`);
  assert.notEqual(armed, source);
  const outfile = join(temp, "review.mjs");
  await build({entryPoints: [join(web, "src/lib/ui/AddSource.svelte")], outfile, bundle: true, platform: "node", format: "esm", external: ["svelte", "svelte/*"], plugins: [{name: "review", setup(b) {
    b.onResolve({filter: /\/(locale\.svelte|store\.svelte|device\.svelte)\.js$/}, a => ({path: a.path.split("/").at(-1), namespace: "stub"}));
    b.onLoad({filter: /.*/, namespace: "stub"}, a => ({contents: a.path === "device.svelte.js" ? "export const device={firmwareAbi:null};" : a.path === "store.svelte.js" ? "export const sources={adding:false,addError:null};" : `export const locale={current:"en",t:{shared:{units:{space:" ",kb:"KB",b:"B"}},sources:{modeUrl:"URL",modeBundle:"Bundle",bundleLabel:"Bundle",colCores:"Cores",colHomebrew:"Homebrew",found:{caption:"Found",name:"Name",type:"Type",installs:"Installs"},detail:{version:"Version",abiLabel:"ABI"}}}};`, loader: "js"}));
    b.onLoad({filter: /\.svelte$/}, a => ({contents: compile(a.path.endsWith("/AddSource.svelte") ? armed : readFileSync(a.path, "utf8"), {filename:a.path, generate:"server", runes:true}).js.code, loader:"js"}));
  }}]});
  const body = render((await import(pathToFileURL(outfile))).default, {props: {onDone: () => {throw new Error("Rendering must not add a source");}}}).body;
  for (const value of ["Found", "Neo Geo", "Cores", "v0.0.4", "neogeo.bin"]) assert.ok(body.includes(value), `Review must display ${value}`);
  console.log("bundlereview: actual bundle review rendered with recognized name, type, version and files");
} finally {rmSync(temp, {recursive:true, force:true});}
