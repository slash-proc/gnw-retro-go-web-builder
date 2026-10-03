// Shared build identity for the desktop development launcher and main process.
// Hash only renderer inputs and local workspace packages that Vite can compile.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const INPUTS = [
  "apps/web/src",
  "apps/web/package.json",
  "apps/web/vite.config.ts",
  "packages",
  "frontend/vendor/webstlink/src",
];

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== "test")
    .flatMap((entry) => filesUnder(path.join(root, entry.name)));
}

function rendererSourceFingerprint(repoRoot) {
  const hash = crypto.createHash("sha256");
  const files = INPUTS.flatMap((item) => filesUnder(path.join(repoRoot, item))).sort();
  for (const file of files) {
    hash.update(path.relative(repoRoot, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

module.exports = { rendererSourceFingerprint };
