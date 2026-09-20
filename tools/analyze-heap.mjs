#!/usr/bin/env node

// Analyze a Chrome .heaptimeline snapshot without loading it into DevTools.
// Usage: node --max-old-space-size=8192 tools/analyze-heap.mjs PROFILE

import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: node tools/analyze-heap.mjs PROFILE");

const h = JSON.parse(fs.readFileSync(file, "utf8"));
const meta = h.snapshot.meta;
const nf = Object.fromEntries(meta.node_fields.map((x, i) => [x, i]));
const ef = Object.fromEntries(meta.edge_fields.map((x, i) => [x, i]));
const width = meta.node_fields.length;
const nodeTypes = meta.node_types[0];
const edgeTypes = meta.edge_types[0];
const strings = h.strings;
const nodes = [];

const nodeAt = (i) => h.nodes.slice(i * width, i * width + width);
const nodeName = (n) => strings[n[nf.name]] ?? String(n[nf.name]);
const nodeType = (n) => nodeTypes[n[nf.type]] ?? String(n[nf.type]);

for (let i = 0; i < h.nodes.length / width; i++) {
  const n = nodeAt(i);
  nodes.push({ i, n, type: nodeType(n), name: nodeName(n), self: n[nf.self_size], edges: n[nf.edge_count] });
}

const outgoing = new Map();
const incoming = new Map();
let edgePos = 0;
for (const owner of nodes) {
  const list = [];
  for (let j = 0; j < owner.edges; j++) {
    const e = h.edges.slice(edgePos, edgePos + meta.edge_fields.length);
    edgePos += meta.edge_fields.length;
    // Chrome stores to_node as a flat node-array index, not a node id.
    const target = nodes[e[ef.to_node] / width];
    if (!target) continue;
    const label = e[ef.type] === 1 || e[ef.type] === 2
      ? strings[e[ef.name_or_index]]
      : String(e[ef.name_or_index]);
    const edge = { owner, target, type: edgeTypes[e[ef.type]], label };
    list.push(edge);
    if (!incoming.has(target.i)) incoming.set(target.i, []);
    incoming.get(target.i).push(edge);
  }
  outgoing.set(owner.i, list);
}

const lazy = nodes.filter((x) => x.name === "LazyRom");
console.log(JSON.stringify({
  nodes: nodes.length,
  lazyRom: lazy.length,
  lazySelfBytes: lazy.reduce((sum, x) => sum + x.self, 0),
}, null, 2));

const cached = [];
for (const l of lazy) {
  for (const e of outgoing.get(l.i) ?? []) {
    if (e.label === "cached") cached.push({ lazy: l, buffer: e.target });
  }
}

const cachedTypes = new Map();
for (const x of cached) cachedTypes.set(x.buffer.type, (cachedTypes.get(x.buffer.type) ?? 0) + 1);
console.log("cached edges:", cached.length);
console.log("cached target types:", [...cachedTypes]);

const loaded = cached.filter((x) => x.buffer.name === "Uint8Array");
let backingBytes = 0;
const backingStores = new Set();
for (const x of loaded) {
  const seen = new Set([x.buffer.i]);
  const queue = [{ node: x.buffer, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (node.name === "system / JSArrayBufferData") {
      backingBytes += node.self;
      backingStores.add(node.i);
      continue;
    }
    if (depth >= 3) continue;
    for (const e of outgoing.get(node.i) ?? []) {
      if (seen.has(e.target.i)) continue;
      seen.add(e.target.i);
      queue.push({ node: e.target, depth: depth + 1 });
    }
  }
}
console.log(JSON.stringify({
  loadedUint8Arrays: loaded.length,
  backingBytes,
  backingMB: Math.round(backingBytes / 1024 / 1024),
  distinctBackingStores: backingStores.size,
}, null, 2));

const roots = new Set(nodes.filter((x) => x.type === "synthetic" || x.name === "(GC roots)").map((x) => x.i));
function pathToRoot(start) {
  const seen = new Set([start.i]);
  const queue = [{ node: start, path: [] }];
  while (queue.length) {
    const { node, path } = queue.shift();
    if (roots.has(node.i)) return path;
    for (const e of incoming.get(node.i) ?? []) {
      if (seen.has(e.owner.i)) continue;
      seen.add(e.owner.i);
      queue.push({
        node: e.owner,
        path: [...path, { from: e.owner.name, type: e.owner.type, edge: e.label }],
      });
    }
  }
  return null;
}

for (const x of loaded.slice(0, 10)) {
  console.log(JSON.stringify({
    lazyNode: x.lazy.i,
    path: pathToRoot(x.lazy),
  }, null, 2));
}
