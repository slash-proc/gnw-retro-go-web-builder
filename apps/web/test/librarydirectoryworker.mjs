import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/lib/libraryDirectory.worker.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
});

async function exercise(code) {
  const messages = [];
  let reads = 0;
  let autoAck = false;
  let clock = 0;
  const self = {
    postMessage(message) {
      messages.push(message);
      if (autoAck && message.type === "progress") queueMicrotask(() => send({ type: "ack" }));
    },
  };
  runInNewContext(code, { self, Uint8Array, DataView, TextDecoder, Map, Promise, Error, performance: { now: () => clock += 101 } });
  const send = (data) => self.onmessage({ data });
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  const waitUntil = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      assert(Date.now() < deadline, "worker did not finish");
      await turn();
    }
  };
  const directory = (name, children) => ({
    kind: "directory",
    name,
    async *entries() { yield* children; },
  });
  const consoles = [["a7800", 164], ["lynx", 373], ["gbc", 605]];
  const children = consoles.map(([consoleName, count]) => [consoleName, directory(consoleName,
    Array.from({ length: count }, (_, index) => {
      const name = consoleName === "a7800" && index === 0 ? "cached.zip" : `game-${index}.rom`;
      return [name, { kind: "file", name, async getFile() {
        reads++;
        return {
          size: index + 1,
          lastModified: 1,
          arrayBuffer() { throw new Error("ROM payload read during scan"); },
          slice() { throw new Error("unchanged archive was reread"); },
        };
      } }];
    }),
  )]);
  children.push(["neogeo", directory("neogeo", [["native.zip", { kind: "file", async getFile() { reads++; return { size: 10, lastModified: 1, slice() { throw new Error("native ROM archive inspected"); }, arrayBuffer() { throw new Error("native ROM archive read"); } }; } }]])]);
  children.push([".hidden", { kind: "file", getFile() { throw new Error("hidden file read"); } }]);
  const root = directory("library", children);
  send({ type: "pause" });
  const cached = new Map([["a7800/cached.zip", {
    size: 1, lastModified: 1, verdict: { ok: true, name: "cached.a78", entry: { size: 42 } },
  }]]);
  send({ type: "scan", dir: root, cached, archiveRules: { folders: ["neogeo"], loose: false } });
  await turn();
  assert.equal(reads, 0, "paused worker read file metadata");
  send({ type: "resume" });
  await waitUntil(() => messages.some((message) => message.type === "progress"));
  const pausedAt = reads;
  await turn();
  assert.equal(reads, pausedAt, "worker outran unacknowledged progress");
  send({ type: "pause" });
  send({ type: "ack" });
  await turn();
  assert.equal(reads, pausedAt, "worker continued reading while interaction was active");
  autoAck = true;
  send({ type: "resume" });
  await waitUntil(() => messages.some((message) => message.type === "complete" || message.type === "error"));
  assert.equal(messages.find((message) => message.type === "error"), undefined);
  const completed = messages.find((message) => message.type === "complete");
  assert.equal(completed.entries.length, 1143);
  assert.equal("handle" in completed.entries[0], false, "worker returns path metadata without retaining every file handle");
  assert.equal(reads, 1143);
  assert.equal(completed.cached.has("neogeo/native.zip"), false, "native ZIP bypasses directory indexing");
  assert.equal(completed.cached.get("a7800/cached.zip").verdict.name, "cached.a78");
  for (const [consoleName, count] of consoles) {
    assert.equal(completed.entries.filter((entry) => entry.path.startsWith(consoleName + "/")).length, count);
  }
  assert.equal(messages.filter((message) => message.type === "progress").at(-1).done, 1143);

  messages.length = 0;
  const snapshot = completed.entries;
  send({ type: "scan", dir: root, cached, archiveRules: { folders: ["neogeo"], loose: false }, snapshot });
  await waitUntil(() => messages.some((message) => message.type === "complete"));
  assert.equal(reads, 1143, "cached startup reread known file metadata");
  assert.equal(messages.find((message) => message.type === "complete").stats.metadataReads, 0);

  children[0][1].entries = async function* () {
    yield ["new.rom", { kind: "file", async getFile() { reads++; return { size: 12, lastModified: 2 }; } }];
  };
  messages.length = 0;
  send({ type: "scan", dir: root, cached, archiveRules: { folders: ["neogeo"], loose: false }, snapshot });
  await waitUntil(() => messages.some((message) => message.type === "complete"));
  const changed = messages.find((message) => message.type === "complete");
  assert.equal(changed.stats.metadataReads, 1, "startup reads metadata only for new paths");
  assert.equal(changed.entries.length, 980, "removed paths disappear from the next snapshot");
  assert.equal(changed.entries.some((entry) => entry.path === "a7800/cached.zip"), false);
  assert.equal(changed.entries.find((entry) => entry.path === "a7800/new.rom").size, 12);

  children[0][1].entries = async function* () {
    yield ["new.rom", { kind: "file", async getFile() { reads++; return { size: 99, lastModified: 3 }; } }];
  };
  messages.length = 0;
  send({ type: "scan", dir: root, cached, archiveRules: { folders: ["neogeo"], loose: false } });
  await waitUntil(() => messages.some((message) => message.type === "complete"));
  const refreshed = messages.find((message) => message.type === "complete");
  assert.equal(refreshed.stats.metadataReads, 980, "explicit refresh reads all metadata");
  assert.equal(refreshed.entries.find((entry) => entry.path === "a7800/new.rom").size, 99, "refresh detects replacements in place");
}

await exercise(bundle.outputFiles[0].text);
await assert.rejects(
  exercise(bundle.outputFiles[0].text.replace("while (paused)", "while (false)")),
  /paused worker read file metadata/,
);
const archiveMutation = bundle.outputFiles[0].text.replace("!isNativeRomArchive(path, archiveRules)", "true");
assert.notEqual(archiveMutation, bundle.outputFiles[0].text, "native archive mutation must change the worker");
await assert.rejects(exercise(archiveMutation), /native ZIP bypasses directory indexing/);
const metadataMutation = bundle.outputFiles[0].text.replace("const previousFile = known.get(path);", "const previousFile = undefined;");
assert.notEqual(metadataMutation, bundle.outputFiles[0].text);
await assert.rejects(exercise(metadataMutation), /cached startup reread known file metadata/);
console.log("librarydirectoryworker: pause/resume, backpressure, 1143-file scan, cached presence validation, additions/removals, full refresh, and regressions verified");
