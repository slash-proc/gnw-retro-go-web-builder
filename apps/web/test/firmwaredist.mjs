#!/usr/bin/env node
/**
 * Offline coverage for `src/lib/firmwareDist/` — the client for the Retro-Go SD **firmware
 * distribution** format (`docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd).
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/firmwaredist.mjs'
 *
 * Plain node, no framework (repo convention). esbuild bundles the real TypeScript; there is
 * nothing to mock because the parsers are pure and the only network entry points take an
 * injected `fetchImpl`.
 *
 * The fixtures under `test/fixtures/firmwaredist/` are VERBATIM copies of the firmware repo's
 * `docs/examples/` — the output of a genuine four-build packer run. See SOURCE.md there. The
 * whole point is that a format change fails HERE rather than on a device, so never edit a
 * fixture to make an assertion pass; the parser is what moves.
 *
 * The refusal cases mutate a *parsed copy* in memory. Nothing on disk is ever modified.
 *
 * What is pinned:
 *   - versions.json parses, and `versions[0]` / `newestVersion()` is the newest release
 *   - a version entry's `manifest` resolves against the versions.json URL
 *   - every build's `bundle`/`debug` url resolves against the MANIFEST url (a different
 *     directory from the versions.json one — that is the bug this catches)
 *   - `content[]` exposes `path` (zip entry) and `install` (device path) as distinct fields,
 *     and neither is ever turned into a URL
 *   - an unknown `schemaVersion` is REFUSED, not best-effort parsed
 *   - a truncated / malformed document is refused with a useful `FirmwareDistError`, not a
 *     raw SyntaxError
 *   - `languages` includes `en_us` even though no build ships an `en_us` blob (it is baked
 *     into the firmware's rodata)
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gnwResolveFor, gnwImport } from "./gnwResolve.mjs";

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") return r.then(() => { passed++; },
      (e) => { failures.push(`${name}: ${e && e.message ? e.message : e}`); });
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
  return undefined;
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg);
}
/** Run `fn`, require it to throw a FirmwareDistError of `kind`, and return the error. */
function throws(fn, kind, msg) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`${msg}: expected a throw, got a value`);
  eq(err.name, "FirmwareDistError", `${msg}: wrong error type (${err.message})`);
  eq(err.kind, kind, `${msg}: wrong kind`);
  ok(err.message.length > kind.length, `${msg}: error carries no detail`);
  return err;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures/firmwaredist");
const out = mkdtempSync(join(tmpdir(), "gnw-firmwaredist-"));

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/firmwareDist/index.ts")],
  outfile: join(out, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  // `installMarker.ts` reuses `@gnw/gnw-patch`'s crc32; keep the workspace package external
  // and pointed at THIS checkout's dist (see gnwResolve.mjs for why a worktree needs this).
  plugins: [gnwResolveFor(import.meta.url)],
});

await esbuild.build({
  entryPoints: [join(here, "../src/lib/unzip.ts")],
  outfile: join(out, "unzip.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});

const fd = await import(pathToFileURL(join(out, "bundle.js")).href);
// The install-marker suite recomputes CRCs with the SAME implementation the module reuses
// (`packages/gnw-patch`'s `crc32`), from this checkout's dist — never a second copy.
const { superblockCrc32: refCrc32 } = await gnwImport(import.meta.url, "gnw-patch");
const { unzip: realUnzip } = await import(pathToFileURL(join(out, "unzip.js")).href);

const readFixture = (name) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));
const rawVersions = readFixture("versions.json");
const rawManifest = readFixture("manifest.json");
const rawProjects = readFixture("projects.json");
rawManifest.updates = { bank1: { bytes: 1, sha256: "a".repeat(64), url: "retro-go_update-bank1.bin" }, bank2: { bytes: 1, sha256: "b".repeat(64), url: "retro-go_update-bank2.bin" } };

// The real published locations. `manifest.json` lives in a `v<tag>/` SUBDIRECTORY of the one
// holding `versions.json`, which is exactly why resolution has to be against the right base.
const VERSIONS_URL =
  "https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/versions.json";

// --- versions.json --------------------------------------------------------------------

const versions = fd.parseVersions(rawVersions, VERSIONS_URL);

check("versions.json parses against the real fixture", () => {
  eq(versions.schemaVersion, 1, "schemaVersion");
  eq(versions.project, "retro-go-sd", "project");
  eq(versions.repo, "slash-proc/game-and-watch-retro-go-sd", "repo");
  eq(typeof versions.retained, "number", "retained");
  ok(versions.versions.length >= 1, "at least one version entry");
  eq(versions.url, VERSIONS_URL, "url is remembered for resolution");
});

check("newest is versions[0], in published order (there is no `latest`)", () => {
  const newest = fd.newestVersion(versions);
  eq(newest, versions.versions[0], "newestVersion() is versions[0]");
  // Order is preserved exactly as published, and the publisher promises newest first. Assert
  // the promise holds on the real file rather than re-sorting behind the publisher's back.
  for (let i = 1; i < versions.versions.length; i++) {
    const prev = Date.parse(versions.versions[i - 1].publishedAt);
    const cur = Date.parse(versions.versions[i].publishedAt);
    ok(Number.isFinite(prev) && Number.isFinite(cur), "publishedAt parses as RFC 3339");
    ok(prev >= cur, `versions[${i - 1}] is not newer than versions[${i}]`);
  }
});

check("a version entry duplicates the three pre-fetch filter fields", () => {
  const newest = fd.newestVersion(versions);
  eq(typeof newest.gitTag, "string", "gitTag");
  eq(typeof newest.providesAbi.version, "number", "providesAbi.version");
  eq(typeof newest.providesAbi.size, "number", "providesAbi.size");
  eq(typeof newest.coreMetaVersion, "number", "coreMetaVersion");
});

check("manifest resolves against the versions.json URL", () => {
  const newest = fd.newestVersion(versions);
  eq(newest.manifest, `${newest.tag}/manifest.json`, "raw relative reference is preserved");
  eq(
    newest.manifestUrl,
    `https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/${newest.tag}/manifest.json`,
    "manifestUrl",
  );
  // The same relative reference against a DIFFERENT index location must follow that index —
  // a hardcoded base would pass the assertion above and fail here.
  const mirrored = fd.parseVersions(rawVersions, "https://example.test/mirror/dist/versions.json");
  eq(
    fd.newestVersion(mirrored).manifestUrl,
    `https://example.test/mirror/dist/${newest.tag}/manifest.json`,
    "manifestUrl follows the index it was read from",
  );
});

check("findVersion() refuses an unknown tag instead of falling back to the newest", () => {
  eq(fd.findVersion(versions, fd.newestVersion(versions).tag).tag, versions.versions[0].tag, "hit");
  eq(fd.findVersion(versions, "v0.0.0-nope"), undefined, "miss");
});

// --- manifest.json --------------------------------------------------------------------

const MANIFEST_URL = fd.newestVersion(versions).manifestUrl;
const manifest = fd.parseManifest(rawManifest, MANIFEST_URL);

check("debug artifacts may be omitted from release builds", () => {
  const doc = structuredClone(rawManifest);
  doc.builds.forEach((b) => delete b.debug);
  const parsed = fd.parseManifest(doc, MANIFEST_URL);
  ok(parsed.builds.every((b) => b.debug === undefined), "debug is optional");
});

check("manifest.json parses against the real fixture", () => {
  eq(manifest.schemaVersion, 1, "schemaVersion");
  eq(manifest.project, "retro-go-sd", "project");
  eq(manifest.source.repo, "slash-proc/game-and-watch-retro-go-sd", "source.repo");
  ok(/^[0-9a-f]{7,40}$/.test(manifest.source.commit), "source.commit is a hex sha");
  ok(Number.isFinite(Date.parse(manifest.builtAt)), "builtAt is RFC 3339");
  eq(manifest.url, MANIFEST_URL, "url is remembered for resolution");
});

check("firmware identity is read whole, including the parsed abiOffset", () => {
  const f = manifest.firmware;
  eq(f.abiOffset, "0x400", "abiOffset as published");
  eq(f.abiOffsetBytes, 0x400, "abiOffset parsed for the in-image read");
  eq(f.superblock.magic, "GWLB", "superblock.magic");
  eq(f.superblock.version, 2, "superblock.version");
  eq(f.superblock.structSize, 36, "superblock.structSize");
  eq(f.installFile.path, "data/INSTALL", "installFile.path");
  eq(f.installFile.magic, "RGIN", "installFile.magic");
  eq(typeof f.gitTag, "string", "gitTag");
  eq(typeof f.coreMetaVersion, "number", "coreMetaVersion");
});

check("the index's three duplicated fields agree with the manifest (the manifest wins)", () => {
  const entry = fd.newestVersion(versions);
  eq(entry.gitTag, manifest.firmware.gitTag, "gitTag");
  eq(entry.providesAbi.version, manifest.firmware.providesAbi.version, "providesAbi.version");
  eq(entry.providesAbi.size, manifest.firmware.providesAbi.size, "providesAbi.size");
  eq(entry.coreMetaVersion, manifest.firmware.coreMetaVersion, "coreMetaVersion");
});

check("paths are absolute storage-root roles, kept open-ended", () => {
  for (const role of ["cores", "homebrew", "bios", "roms", "covers", "cheats", "data"]) {
    ok(manifest.paths[role]?.startsWith("/"), `paths.${role} is absolute`);
  }
  eq(manifest.paths.homebrew, "/homebrews", "the role name and the directory differ on purpose");
});

check("all four builds are present and addressable by storage x bank", () => {
  eq(manifest.builds.length, 4, "build count");
  for (const storage of ["sd", "flash"]) {
    for (const bank of [1, 2]) {
      const b = fd.findBuild(manifest, storage, bank);
      ok(b, `${storage}-bank${bank} exists`);
      eq(b.id, fd.buildId(storage, bank), "id matches its axes");
      eq(b.storage, storage, "storage");
      eq(b.bank, bank, "bank");
    }
  }
  eq(fd.findBuild(manifest, "sd", 1).littlefsBlockSize, 4096, "littlefsBlockSize");
});

check("bundle/debug urls resolve against the MANIFEST url, not the versions url", () => {
  const tag = fd.newestVersion(versions).tag;
  const dir = `https://slash-proc.github.io/game-and-watch-retro-go-sd/dist/${tag}/`;
  for (const b of manifest.builds) {
    eq(b.bundle.url, `${dir}retro-go-sd-${tag}-${b.id}.zip`, `${b.id} bundle.url`);
    eq(b.debug.url, `${dir}retro-go-sd-${tag}-${b.id}-debug.zip`, `${b.id} debug.url`);
    ok(/^[0-9a-f]{64}$/.test(b.bundle.sha256), `${b.id} bundle.sha256 is lowercase hex`);
    ok(b.bundle.bytes > 0 && b.debug.bytes > 0, `${b.id} asset sizes`);
  }
  // Resolving against the INDEX url instead would drop the `v<tag>/` segment. Pin the
  // difference so the two bases can never be swapped silently.
  const wrong = new URL(`retro-go-sd-${tag}-sd-bank2.zip`, VERSIONS_URL).toString();
  ok(wrong !== fd.findBuild(manifest, "sd", 2).bundle.url, "the two bases are distinguishable");
});

check("top-level projects is an asset beside the manifest", () => {
  ok(manifest.projects, "projects asset present");
  eq(
    manifest.projects.url,
    MANIFEST_URL.replace(/manifest\.json$/, "projects.json"),
    "projects.url resolves beside the manifest",
  );
});

check("image is a zip member with a path and no url", () => {
  for (const b of manifest.builds) {
    eq(b.image.path, "gw_retro_go_intflash.bin", `${b.id} image.path`);
    eq(b.image.url, undefined, `${b.id} image has no url — it lives inside the bundle`);
  }
});

check("content[] keeps `path` and `install` as distinct fields, and neither is a url", () => {
  const b = fd.findBuild(manifest, "sd", 2);
  ok(b.content.length > 1, "content is non-trivial");
  const fr = b.content.find((e) => e.language === "fr_fr");
  ok(fr, "the fr_fr blob is present");
  eq(fr.path, "lang/fr_fr.bin", "path is the zip entry");
  eq(fr.install, "lang/fr_fr.bin", "install is where it lands on the device");
  eq(fr.url, undefined, "content entries never carry a url");
  for (const e of b.content) {
    ok(typeof e.path === "string" && typeof e.install === "string", "both fields exist");
    ok(!e.install.startsWith("/"), `${e.install} is relative to the storage root`);
    ok(!e.path.split("/").includes(".."), `${e.path} has no .. segment`);
  }
  // Currently always equal, deliberately separate fields — assert the invariant AND that an
  // installer reading `install` gets the right answer if they ever diverge.
  const diverged = structuredClone(rawManifest);
  const build = diverged.builds.find((x) => x.id === b.id);
  build.content.find((e) => e.path === "lang/fr_fr.bin").install = "lang/other_fr.bin";
  const reparsed = fd.parseManifest(diverged, MANIFEST_URL);
  const entry = fd.findBuild(reparsed, "sd", 2).content.find((e) => e.language === "fr_fr");
  eq(entry.path, "lang/fr_fr.bin", "path unaffected");
  eq(entry.install, "lang/other_fr.bin", "install is carried independently");
});

check("language blobs are per-build — fr_fr differs in size across banks", () => {
  const b1 = fd.findBuild(manifest, "sd", 1).content.find((e) => e.language === "fr_fr");
  const b2 = fd.findBuild(manifest, "sd", 2).content.find((e) => e.language === "fr_fr");
  ok(b1.bytes !== b2.bytes, "bank-1 and bank-2 fr_fr blobs are not interchangeable");
  ok(b1.sha256 !== b2.sha256, "and not the same bytes");
});

check("languages includes en_us even though no build ships an en_us blob", () => {
  ok(manifest.languages.includes("en_us"), "en_us is a declared UI language");
  for (const b of manifest.builds) {
    ok(!fd.buildLanguages(b).includes("en_us"), `${b.id} ships no en_us blob`);
  }
  // en_us is baked into the firmware's rodata; it is the ONLY declared language with no blob.
  const noBlob = fd.languagesWithoutBlob(manifest);
  eq(noBlob.join(","), "en_us", "exactly en_us has no blob");
  // Every other declared language does have one, in every build.
  for (const b of manifest.builds) {
    const shipped = fd.buildLanguages(b);
    for (const l of manifest.languages) {
      if (l === "en_us") continue;
      ok(shipped.includes(l), `${b.id} ships ${l}`);
    }
  }
});

check("contentForLanguages() keeps unlabelled content and the chosen blobs only", () => {
  const b = fd.findBuild(manifest, "flash", 2);
  const picked = fd.contentForLanguages(b, ["fr_fr", "ja_jp"]);
  const langs = picked.filter((e) => e.language).map((e) => e.language).sort();
  eq(langs.join(","), "fr_fr,ja_jp", "only the wanted blobs");
  const unlabelled = b.content.filter((e) => !e.language).length;
  eq(picked.length - langs.length, unlabelled, "every unlabelled entry is kept");
  ok(unlabelled > 0, "fonts and the boot logo are unlabelled content");
  // A user picking no language at all still gets the fonts and the logo.
  eq(fd.contentForLanguages(b, []).length, unlabelled, "empty selection keeps the rest");
});

// --- projects.json --------------------------------------------------------------------

check("projects.json parses and hands off absolute GWRG versions urls", () => {
  const projects = fd.parseProjects(rawProjects);
  eq(projects.schemaVersion, 1, "schemaVersion");
  ok(projects.projects.length > 0, "non-empty");
  for (const p of projects.projects) {
    ok(p.kind === "core" || p.kind === "homebrew", `${p.project} kind is core/homebrew`);
    ok(p.versionsUrl.startsWith("https://"), `${p.project} versionsUrl is absolute https`);
    ok(p.versionsUrl.endsWith("/versions.json"), `${p.project} versionsUrl names versions.json`);
  }
});

// --- refusals -------------------------------------------------------------------------

check("an unknown schemaVersion is refused, in all three files", () => {
  for (const [name, raw, parse] of [
    ["versions", rawVersions, (d) => fd.parseVersions(d, VERSIONS_URL)],
    ["manifest", rawManifest, (d) => fd.parseManifest(d, MANIFEST_URL)],
    ["projects", rawProjects, (d) => fd.parseProjects(d)],
  ]) {
    const bumped = { ...raw, schemaVersion: 2 };
    const err = throws(() => parse(bumped), "unsupported-schema", `${name} schemaVersion 2`);
    eq(err.detail, "2", `${name}: the refused version is reported`);
    throws(() => parse({ ...raw, schemaVersion: "1" }), "malformed", `${name} non-integer`);
    const { schemaVersion: _drop, ...missing } = raw;
    throws(() => parse(missing), "malformed", `${name} missing schemaVersion`);
  }
});

check("a truncated document is refused with a useful error, not a raw SyntaxError", async () => {
  const text = readFileSync(join(fixtures, "versions.json"), "utf8");
  const truncated = text.slice(0, Math.floor(text.length / 2));
  const fetchImpl = async () =>
    new Response(truncated, { status: 200, headers: { "content-type": "application/json" } });
  let err;
  try {
    await fd.fetchVersions(VERSIONS_URL, fetchImpl);
  } catch (e) {
    err = e;
  }
  ok(err, "truncated JSON throws");
  eq(err.name, "FirmwareDistError", `wrong error type: ${err}`);
  eq(err.kind, "malformed", "kind");
  ok(err.message.includes(VERSIONS_URL), "the message names the document");
  ok(/not valid JSON/.test(err.message), "the message says what was wrong");
});

check("a malformed document is refused with a field-naming error", () => {
  const noVersions = { ...rawVersions, versions: [] };
  throws(() => fd.parseVersions(noVersions, VERSIONS_URL), "malformed", "empty versions[]");

  const badEntry = structuredClone(rawVersions);
  delete badEntry.versions[0].providesAbi;
  const e1 = throws(
    () => fd.parseVersions(badEntry, VERSIONS_URL),
    "malformed",
    "missing providesAbi",
  );
  ok(e1.message.includes("providesAbi"), `the error names the field: ${e1.message}`);

  const e2 = throws(() => fd.parseVersions("not an object", VERSIONS_URL), "malformed", "scalar");
  ok(e2.message.includes("versions.json"), "the error names the document");

  const badBuild = structuredClone(rawManifest);
  badBuild.builds[0].bundle.sha256 = "nope";
  const e3 = throws(() => fd.parseManifest(badBuild, MANIFEST_URL), "malformed", "bad sha256");
  ok(/builds\[0\]\.bundle\.sha256/.test(e3.message), `error locates the field: ${e3.message}`);
});

check("a url escaping the manifest directory is refused, never resolved", () => {
  const escaped = structuredClone(rawManifest);
  escaped.builds[0].bundle.url = "../../../elsewhere/evil.zip";
  const err = throws(() => fd.parseManifest(escaped, MANIFEST_URL), "malformed", "escaping url");
  ok(/plain filename/.test(err.message), `error explains the rule: ${err.message}`);

  const absolute = structuredClone(rawManifest);
  absolute.builds[0].debug.url = "https://evil.test/thing.zip";
  throws(() => fd.parseManifest(absolute, MANIFEST_URL), "malformed", "absolute url");
});

check("an install path escaping the storage root is refused, never sanitised", () => {
  for (const field of ["install", "path"]) {
    const escaped = structuredClone(rawManifest);
    escaped.builds[0].content[0][field] = "../../etc/passwd";
    throws(() => fd.parseManifest(escaped, MANIFEST_URL), "malformed", `escaping ${field}`);
    const absolute = structuredClone(rawManifest);
    absolute.builds[0].content[0][field] = "/etc/passwd";
    throws(() => fd.parseManifest(absolute, MANIFEST_URL), "malformed", `absolute ${field}`);
  }
});

// --- the fetch layer (injected, no network) --------------------------------------------

const fixtureFetch = async (url) => {
  const u = String(url);
  const name = u.endsWith("/manifest.json")
    ? "manifest.json"
    : u.endsWith("/projects.json")
      ? "projects.json"
      : u.endsWith("/versions.json")
        ? "versions.json"
        : null;
  if (!name) return new Response("", { status: 404 });
  const doc = readFixture(name);
  if (name === "manifest.json") doc.updates = rawManifestUpdates;
  return new Response(JSON.stringify(doc), { status: 200 });
};

await check("fetchNewestRelease() walks index -> manifest with an injected fetch", async () => {
  const got = await fd.fetchNewestRelease({ versionsUrl: VERSIONS_URL, fetchImpl: fixtureFetch });
  eq(got.entry.tag, fd.newestVersion(versions).tag, "picked the newest entry");
  eq(got.manifest.url, MANIFEST_URL, "manifest was fetched from the resolved url");
  eq(got.manifest.builds.length, 4, "manifest parsed");
  const projects = await fd.fetchProjects(got.manifest, fixtureFetch);
  ok(projects && projects.projects.length > 0, "projects followed from the manifest");
});

await check("a 404 is `not-found` and a thrown fetch is `network`", async () => {
  let err;
  try {
    await fd.fetchVersions("https://example.test/missing/other.json", fixtureFetch);
  } catch (e) {
    err = e;
  }
  eq(err?.kind, "not-found", `404: ${err}`);
  err = undefined;
  try {
    await fd.fetchVersions(VERSIONS_URL, async () => {
      throw new TypeError("Failed to fetch");
    });
  } catch (e) {
    err = e;
  }
  eq(err?.kind, "network", `offline: ${err}`);
  eq(err?.name, "FirmwareDistError", "the raw TypeError does not escape");
});

await check("fetchNewestRelease() refuses an unknown tag", async () => {
  let err;
  try {
    await fd.fetchNewestRelease({
      versionsUrl: VERSIONS_URL,
      tag: "v0.0.0-nope",
      fetchImpl: fixtureFetch,
    });
  } catch (e) {
    err = e;
  }
  eq(err?.kind, "not-found", `unknown tag: ${err}`);
});

// --- choosing a build -------------------------------------------------------------------
//
// doc, "Choosing a build": two axes (storage x bank), and three things an installer must
// REFUSE rather than guess at. Each refusal is a typed outcome with its own `reason`, so
// these tests assert the reason string, never just "it didn't succeed".

const MANIFEST_ABI = manifest.firmware.providesAbi; // {version: 2, size: 844} in this release

/**
 * A synthetic intflash image carrying `abi` at the manifest's `abiOffset` (0x400): two LE
 * uint32 (version, size) followed by the four leading function pointers `parseFirmwareAbi`
 * checks for plausibility. The real fixtures are byte-identical upstream copies and are never
 * edited — a disagreeing image has to be built, not hand-patched.
 */
function synthImage(abi, { offset = 0x400, pointers = true } = {}) {
  const img = new Uint8Array(0x2000);
  const dv = new DataView(img.buffer);
  dv.setUint32(offset, abi.version, true);
  dv.setUint32(offset + 4, abi.size, true);
  for (let i = 0; i < 4; i++) {
    // Thumb code addresses in internal flash: bit 0 set, inside 0x08000000..0x08200000.
    dv.setUint32(offset + 8 + i * 4, pointers ? 0x08001235 + i * 8 : 0, true);
  }
  return img;
}

const noBootloader = { dualBootBootloader: false };

check("each of the four published builds is selectable by its storage+bank", () => {
  eq(manifest.builds.length, 4, "the fixture is the four-build run");
  for (const b of manifest.builds) {
    const sel = fd.selectBuild(manifest, { storage: b.storage, bank: b.bank, ...noBootloader });
    ok(sel.ok, `${b.id}: refused (${sel.reason})`);
    eq(sel.build.id, b.id, `${b.id}: wrong build chosen`);
    eq(sel.build.storage, b.storage, `${b.id}: storage`);
    eq(sel.build.bank, b.bank, `${b.id}: bank`);
    // No image supplied: the manifest's advisory ABI is passed through, flagged unverified.
    eq(sel.abiVerified, false, `${b.id}: nothing was verified without image bytes`);
    eq(sel.abi.version, MANIFEST_ABI.version, `${b.id}: advisory abi version`);
  }
  eq(new Set(manifest.builds.map((b) => b.id)).size, 4, "the four ids are distinct");
});

check("a storage with no published build refuses distinguishably", () => {
  // A release that only ever shipped SD builds, against a device with no card mod.
  const sdOnly = { ...manifest, builds: manifest.builds.filter((b) => b.storage === "sd") };
  const sel = fd.selectBuild(sdOnly, { storage: "flash", bank: 2, ...noBootloader });
  eq(sel.ok, false, "flash on an SD-only release must refuse");
  eq(sel.reason, "storage-unavailable", "reason");
  eq(sel.requested.storage, "flash", "the request is echoed back");
  ok(sel.availableStorage.includes("sd"), "it names what IS available");
  ok(!sel.availableStorage.includes("flash"), "…and does not claim flash");
  // Distinguishable: a missing BANK is a different outcome, not the same refusal.
  const bank = fd.selectBuild(
    { ...manifest, builds: manifest.builds.filter((b) => b.bank === 2) },
    { storage: "sd", bank: 1, ...noBootloader },
  );
  eq(bank.reason, "bank-unavailable", "a missing bank is its own reason");
  ok(bank.availableBanks.includes(2), "…and names the bank that exists");
});

check("bank 1 under the dual-boot bootloader refuses; bank 2 does not", () => {
  // boot_bank2() spins forever when bank 2 holds no valid reset vector
  // (external/firmware_update/Core/Src/firmware_update.c:97-114).
  const one = fd.selectBuild(manifest, { storage: "sd", bank: 1, dualBootBootloader: true });
  eq(one.ok, false, "bank 1 under the dual-boot bootloader must refuse");
  eq(one.reason, "bank1-dual-boot", "reason");
  eq(one.build.id, "sd-bank1", "it names the build it refused to install");
  eq(one.bank2Build?.bank, 2, "…and points at the safe alternative");

  const two = fd.selectBuild(manifest, { storage: "sd", bank: 2, dualBootBootloader: true });
  ok(two.ok, "bank 2 is the normal choice under that bootloader");
  eq(two.build.id, "sd-bank2", "bank 2 build");

  // Without the bootloader, bank 1 is a legitimate (stock-replacing) install.
  const stock = fd.selectBuild(manifest, { storage: "sd", bank: 1, ...noBootloader });
  ok(stock.ok, "bank 1 on a device with no dual-boot bootloader is allowed");
});

check("the image's own ABI words are what count, not the manifest's", () => {
  // The manifest is advisory (doc, "Compatibility"); a misplaced .firmware_abi section really
  // did ship, producing plausible images whose bytes at 0x400 were garbage.
  const good = fd.selectBuild(manifest, {
    storage: "flash", bank: 2, ...noBootloader,
    image: synthImage(MANIFEST_ABI),
  });
  ok(good.ok, `an agreeing image passes (${good.reason})`);
  eq(good.abiVerified, true, "the ABI is flagged as read from the image");
  eq(good.abi.size, MANIFEST_ABI.size, "verified size");

  const wrongSize = fd.selectBuild(manifest, {
    storage: "flash", bank: 2, ...noBootloader,
    image: synthImage({ version: MANIFEST_ABI.version, size: MANIFEST_ABI.size + 4 }),
  });
  eq(wrongSize.ok, false, "a disagreeing size must refuse");
  eq(wrongSize.reason, "abi-mismatch", "reason");
  eq(wrongSize.imageAbi.size, MANIFEST_ABI.size + 4, "it reports what the image actually said");
  eq(wrongSize.manifestAbi.size, MANIFEST_ABI.size, "…beside what the manifest claimed");

  const wrongVersion = fd.selectBuild(manifest, {
    storage: "flash", bank: 2, ...noBootloader,
    image: synthImage({ version: MANIFEST_ABI.version + 1, size: MANIFEST_ABI.size }),
  });
  eq(wrongVersion.reason, "abi-mismatch", "a disagreeing version refuses too");

  // The shipped bug's actual shape: nothing believable at 0x400 at all.
  const garbage = fd.selectBuild(manifest, {
    storage: "flash", bank: 2, ...noBootloader,
    image: synthImage(MANIFEST_ABI, { pointers: false }),
  });
  eq(garbage.reason, "abi-mismatch", "an unreadable ABI refuses");
  eq(garbage.imageAbi, null, "…and reports the image as unreadable rather than inventing one");
});

check("verifyImageAbi is the same judgement, exposed on its own", () => {
  eq(fd.verifyImageAbi(manifest, synthImage(MANIFEST_ABI)).agrees, true, "agrees");
  const bad = fd.verifyImageAbi(manifest, synthImage({ version: 9, size: MANIFEST_ABI.size }));
  eq(bad.agrees, false, "disagrees");
  eq(bad.imageAbi.version, 9, "the image's own value is surfaced");
});

// --- compatibility ----------------------------------------------------------------------
// doc, "Compatibility": required_abi_version == providesAbi.version
//                    && required_abi_min_size <= providesAbi.size

check("a core loads on an equal version with a smaller required size, not a larger one", () => {
  const meta = manifest.firmware.coreMetaVersion;
  const smaller = fd.coreCompatibility(MANIFEST_ABI, meta, {
    abiVersion: MANIFEST_ABI.version,
    abiMinSize: MANIFEST_ABI.size - 8,
  });
  ok(smaller.loads, "smaller required size loads (the struct is append-only)");
  ok(smaller.abiVersionMatches && smaller.abiSizeSufficient, "both halves pass");

  const exact = fd.coreCompatibility(MANIFEST_ABI, meta, {
    abiVersion: MANIFEST_ABI.version,
    abiMinSize: MANIFEST_ABI.size,
  });
  ok(exact.loads, "an exactly-equal size loads (<=, not <)");

  const larger = fd.coreCompatibility(MANIFEST_ABI, meta, {
    abiVersion: MANIFEST_ABI.version,
    abiMinSize: MANIFEST_ABI.size + 4,
  });
  ok(!larger.loads, "a larger required size does not load");
  ok(larger.abiVersionMatches, "…and says WHICH half failed");
  ok(!larger.abiSizeSufficient, "the size half is the failing one");

  // Version is equality, not a floor: a NEWER firmware does not run an older core.
  const older = fd.coreCompatibility(MANIFEST_ABI, meta, {
    abiVersion: MANIFEST_ABI.version - 1,
    abiMinSize: 8,
  });
  ok(!older.loads, "a different ABI version never loads, even a lower one");
  ok(!older.abiVersionMatches, "the version half is the failing one");

  eq(
    fd.coreLoads(MANIFEST_ABI, meta, {
      abiVersion: MANIFEST_ABI.version, abiMinSize: MANIFEST_ABI.size,
    }),
    true,
    "coreLoads() is the boolean shorthand",
  );

  // coreMetaVersion is reported separately: it is a container-format warning, not the rule.
  const wrongMeta = fd.coreCompatibility(MANIFEST_ABI, meta, {
    abiVersion: MANIFEST_ABI.version, abiMinSize: 8, metaVersion: meta + 1,
  });
  ok(wrongMeta.loads, "metaVersion does not change the ABI rule");
  eq(wrongMeta.metaVersionMatches, false, "…but is reported as a mismatch");
  eq(
    fd.coreCompatibility(MANIFEST_ABI, meta, { abiVersion: 2, abiMinSize: 8 }).metaVersionMatches,
    undefined,
    "unknown when the caller did not supply one",
  );
});

check("the versions.json-only pre-check agrees with the manifest for this release", () => {
  // providesAbi + coreMetaVersion are duplicated into versions.json precisely so a picker can
  // warn BEFORE fetching a manifest. They must agree; the manifest wins.
  const entry = fd.newestVersion(versions);
  eq(entry.providesAbi.version, MANIFEST_ABI.version, "versions.json abi version agrees");
  eq(entry.providesAbi.size, MANIFEST_ABI.size, "versions.json abi size agrees");
  eq(entry.coreMetaVersion, manifest.firmware.coreMetaVersion, "coreMetaVersion agrees");

  for (const req of [
    { abiVersion: MANIFEST_ABI.version, abiMinSize: MANIFEST_ABI.size - 8, metaVersion: entry.coreMetaVersion },
    { abiVersion: MANIFEST_ABI.version, abiMinSize: MANIFEST_ABI.size + 4 },
    { abiVersion: MANIFEST_ABI.version + 1, abiMinSize: 8 },
  ]) {
    const pre = fd.coreCompatibilityPrecheck(entry, req);
    const post = fd.coreCompatibilityFromManifest(manifest, req);
    eq(pre.loads, post.loads, `pre-check disagrees with the manifest for ${JSON.stringify(req)}`);
    eq(pre.abiVersionMatches, post.abiVersionMatches, "version half agrees");
    eq(pre.abiSizeSufficient, post.abiSizeSufficient, "size half agrees");
  }
});

// --- verified extraction (docs/FIRMWARE_DIST.md, "Installing" step 1) -------------------
//
// The bundle zip is BUILT here rather than mocked: `src/lib/unzip.ts` is the real reader the
// app uses, and a stored-mode archive it can read is a few dozen lines of DataView. Mocking
// the unzip would only have tested our own mock's idea of a zip.
//
// The build objects are synthesised because the real published bundles are 490 KB binaries
// that do not belong in the repo — but they are shaped exactly like the manifest fixture's
// (`sdUpdate.path === image.path`, `content[]` carrying `path`/`install`/`language`), and the
// shared-entry case is asserted against the real manifest too, further down.

const sha256hex = (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest("hex");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A real stored-mode (method 0) zip, central directory and all. */
function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nb.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nb.length, true);
    lh.set(nb, 30);
    parts.push(lh, data);

    const ch = new Uint8Array(46 + nb.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nb, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.size, true);
  ev.setUint16(10, files.size, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const bytesOf = (s) => new TextEncoder().encode(s);

const IMAGE_BYTES = bytesOf("intflash image bytes\n".repeat(40));
const LANG_BYTES = bytesOf("fr_fr language blob\n".repeat(7));
const LOGO_BYTES = bytesOf("boot logo\n".repeat(3));

/**
 * A bundle plus the build that declares it. `mutate` gets the zip's entry map before it is
 * written, so a case can corrupt exactly one file and leave every other hash correct.
 */
function makeBundle({ mutate, shareSdUpdate = true } = {}) {
  const files = new Map([
    ["gw_retro_go_intflash.bin", IMAGE_BYTES],
    ["lang/fr_fr.bin", LANG_BYTES],
    ["bios/logo.bin", LOGO_BYTES],
  ]);
  if (!shareSdUpdate) files.set("update_bank2.bin", bytesOf("a DIFFERENT updater payload\n"));
  const member = (path, data) => ({ path, bytes: data.length, sha256: sha256hex(data) });
  const build = {
    id: "sd-bank2",
    storage: "sd",
    bank: 2,
    capabilities: [],
    littlefsBlockSize: 4096,
    buildFlags: "SD_CARD=1 INTFLASH_BANK=2",
    debug: { bytes: 1, sha256: "0".repeat(64), url: "https://example.invalid/debug.zip" },
    image: member("gw_retro_go_intflash.bin", IMAGE_BYTES),
    sdUpdate: shareSdUpdate
      ? { ...member("gw_retro_go_intflash.bin", IMAGE_BYTES), filename: "update_bank2.bin" }
      : { ...member("update_bank2.bin", files.get("update_bank2.bin")), filename: "update_bank2.bin" },
    content: [
      { ...member("lang/fr_fr.bin", LANG_BYTES), install: "lang/fr_fr.bin", language: "fr_fr" },
      { ...member("bios/logo.bin", LOGO_BYTES), install: "bios/logo.bin" },
    ],
  };
  if (mutate) mutate(files);
  const zip = makeZip(files);
  build.bundle = { bytes: zip.length, sha256: sha256hex(zip), url: "https://example.invalid/b.zip" };
  return { build, zip };
}

/** Wraps the real unzip so a case can assert it was (or was NOT) called. */
function countingUnzip() {
  const spy = async (buf) => {
    spy.calls++;
    return realUnzip(buf);
  };
  spy.calls = 0;
  return spy;
}

await check("a bundle whose hash matches opens and yields every declared entry", async () => {
  const { build, zip } = makeBundle();
  const spy = countingUnzip();
  const res = await fd.extractBundle(build, zip, { unzip: spy });
  ok(res.ok, `expected an extraction, got ${res.ok === false ? res.reason : "?"}`);
  eq(spy.calls, 1, "the archive is opened exactly once");
  eq(res.buildId, "sd-bank2", "buildId");
  eq(res.image.sha256, build.image.sha256, "image digest is the manifest's");
  eq(Buffer.from(res.image.bytes).toString(), Buffer.from(IMAGE_BYTES).toString(), "image bytes");
  eq(res.content.length, 2, "both content entries");
  eq(res.content[0].install, "lang/fr_fr.bin", "install is carried through for the write step");
  eq(res.content[0].language, "fr_fr", "language survives");
  eq(res.content[0].index, 0, "content index is kept for a refusal to name");
  eq(res.content[1].language, undefined, "a non-language entry has no language");
});

await check("verifyBundleBytes answers on its own, with no archive in scope", async () => {
  const { build, zip } = makeBundle();
  eq(await fd.verifyBundleBytes(build, zip), null, "a matching bundle is not refused");
  const bad = await fd.verifyBundleBytes(build, bytesOf("nope"));
  ok(bad && bad.ok === false, "a mismatching bundle is refused");
  eq(bad.reason, "bundle-hash", "reason");
});

await check("a bundle whose hash does not match is refused BEFORE unzipping", async () => {
  const { build, zip } = makeBundle();
  const tampered = zip.slice();
  tampered[tampered.length - 30] ^= 0xff; // inside the central directory, still a "zip"
  const spy = countingUnzip();
  const res = await fd.extractBundle(build, tampered, { unzip: spy });
  eq(res.ok, false, "refused");
  eq(res.reason, "bundle-hash", "reason");
  eq(spy.calls, 0, "the archive was NOT opened");
  eq(res.expected, build.bundle.sha256, "the refusal carries the published hash");
  eq(res.actual, sha256hex(tampered), "and the hash actually computed");
  eq(res.actualBytes, tampered.length, "and the size actually supplied");
  ok(/^[0-9a-f]{64}$/.test(res.actual), "hashes are lowercase hex");
});

await check("a content entry whose bytes do not match its sha256 is refused, by name", async () => {
  // The bundle's OWN hash still matches: the zip is built after the corruption, so this can
  // only be caught by the per-entry check the doc asks for after extracting.
  const { build, zip } = makeBundle({
    mutate: (files) => files.set("lang/fr_fr.bin", bytesOf("swapped language blob\n")),
  });
  const res = await fd.extractBundle(build, zip);
  eq(res.ok, false, "refused");
  eq(res.reason, "member-hash", "reason");
  eq(res.member.role, "content", "role");
  eq(res.member.path, "lang/fr_fr.bin", "the refusal names WHICH entry failed");
  eq(res.member.index, 0, "and its position in content[]");
  eq(res.expected, build.content[0].sha256, "expected hash");
  ok(res.actual !== res.expected, "actual differs");
});

await check("a corrupt image is refused before any content entry is looked at", async () => {
  const { build, zip } = makeBundle({
    mutate: (files) => files.set("gw_retro_go_intflash.bin", bytesOf("not the image\n")),
  });
  const res = await fd.extractBundle(build, zip);
  eq(res.ok, false, "refused");
  eq(res.reason, "member-hash", "reason");
  eq(res.member.role, "image", "the image is checked first");
});

await check("a zip missing a declared path is refused, not yielded as undefined", async () => {
  const { build, zip } = makeBundle({ mutate: (files) => files.delete("bios/logo.bin") });
  const res = await fd.extractBundle(build, zip);
  eq(res.ok, false, "refused");
  eq(res.reason, "missing-entry", "reason");
  eq(res.member.path, "bios/logo.bin", "names the missing path");
  eq(res.member.index, 1, "and which content[] entry declared it");
  ok(res.available.includes("gw_retro_go_intflash.bin"), "carries what the archive DOES hold");
  ok(!res.available.includes("bios/logo.bin"), "and the missing name is not in it");
});

await check("extraction reads `path`, never `install`", async () => {
  // Point every `install` somewhere that is NOT in the archive. If anything resolved a file
  // by `install` this would fail; the doc calls confusing the two the easiest mistake to make.
  const { build, zip } = makeBundle();
  for (const c of build.content) c.install = `sd/root/${c.path}`;
  const res = await fd.extractBundle(build, zip);
  ok(res.ok, "extracted despite install pointing outside the archive");
  eq(res.content[0].install, "sd/root/lang/fr_fr.bin", "install is passed through verbatim");
  eq(res.content[0].path, "lang/fr_fr.bin", "and path is what was read");
});

await check("bytes that hash correctly but are not a zip are refused, not thrown", async () => {
  const junk = bytesOf("this is not an archive");
  const build = makeBundle().build;
  build.bundle = { bytes: junk.length, sha256: sha256hex(junk), url: "https://example.invalid/x.zip" };
  const res = await fd.extractBundle(build, junk);
  eq(res.ok, false, "refused");
  eq(res.reason, "unreadable-archive", "reason");
  ok(res.detail.length > 0, "the reader's own message is kept as evidence");
});

// --- /data/INSTALL, the install marker ---------------------------------------------------
//
// docs/FIRMWARE_DIST.md, "The install marker": 80 bytes, little-endian, packed, magic "RGIN",
// standard CRC-32 over all 80 bytes with the crc field zeroed. Absence is the whole point of
// the refusal cases below: the doc requires a missing or mismatched marker to read as
// "unknown", never as an error, so every one of them must return null rather than throw.

/** An independent hand-rolled encoder — NOT the module's writer — so the reader is checked
 *  against the doc's table rather than against its own serialiser. */
function handBuildMarker({ bank = 2, storage = 1, abiVersion = 1, abiSize = 844, superblockOffset = 0x1234,
  coreMeta = 3, gitTag = "Retro-Go SD v2.0.0", installedAt = 1_700_000_000 } = {}) {
  const b = new Uint8Array(80);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x4e494752, true);      // "RGIN"
  dv.setUint8(4, 1);                      // version
  dv.setUint8(5, bank);
  dv.setUint8(6, storage);
  dv.setUint32(8, abiVersion, true);
  dv.setUint32(12, abiSize, true);
  dv.setUint32(16, superblockOffset, true);
  dv.setUint16(20, coreMeta, true);
  b.set(new TextEncoder().encode(gitTag), 24);
  dv.setUint32(72, installedAt, true);
  dv.setUint32(76, refCrc32(b), true);
  return b;
}

check("the doc's CRC-32 vector pins the shared implementation", () => {
  // docs/FIRMWARE_DIST.md: crc32_le(0, "The quick brown fox", 19) == 0xb74574de (== zlib).
  eq(refCrc32(new TextEncoder().encode("The quick brown fox")) >>> 0, 0xb74574de,
    "standard CRC-32 vector");
});

check("a valid marker parses and every field matches the doc's table", () => {
  const m = fd.readInstallMarker(handBuildMarker());
  ok(m, "a well-formed marker parses");
  eq(m.version, 1, "version");
  eq(m.bank, 2, "bank");
  eq(m.storage, "sd", "storage 1 -> sd");
  eq(m.storageByte, 1, "raw storage byte");
  eq(m.providesAbi.version, 1, "abi_version");
  eq(m.providesAbi.size, 844, "abi_size");
  eq(m.superblockOffset, 0x1234, "superblock_offset");
  eq(m.coreMetaVersion, 3, "core_meta_version");
  eq(m.gitTag, "Retro-Go SD v2.0.0", "git_tag, NUL padding stripped");
  eq(m.installedAt, 1_700_000_000, "installed_at");
  eq(fd.INSTALL_MARKER_SIZE, 80, "the record is 80 bytes");
  eq(fd.readInstallMarker(handBuildMarker({ storage: 0 })).storage, "flash", "storage 0 -> flash");
});

check("the stored crc is the recompute over the same bytes with crc zeroed", () => {
  const b = handBuildMarker();
  const stored = new DataView(b.buffer).getUint32(76, true);
  const zeroed = b.slice();
  zeroed.set([0, 0, 0, 0], 76);
  eq(refCrc32(zeroed), stored, "recomputed crc == stored crc");
  eq(fd.readInstallMarker(b).crc32, stored, "the parser reports the verified crc");
});

check("a flipped byte ANYWHERE in the 76 fails the crc", () => {
  const good = handBuildMarker();
  const survivors = [];
  for (let i = 0; i < 76; i++) {
    const bad = good.slice();
    bad[i] ^= 0x01;
    if (fd.readInstallMarker(bad) !== null) survivors.push(i);
  }
  // Offsets 0-3 are the magic and 4 the version — rejected before the crc even runs, which is
  // still a rejection. 72-75 are the crc itself. Every other byte must fail the crc check.
  eq(survivors.length, 0, `bytes accepted after a bit flip: ${survivors.join(",")}`);
});

check("a wrong magic is rejected", () => {
  const b = handBuildMarker();
  b[0] = 0x53; // "S" instead of "R" — crc left alone, so only the magic is wrong
  eq(fd.readInstallMarker(b), null, "wrong magic -> null");
});

check("an unknown record version is rejected", () => {
  const b = handBuildMarker();
  b[4] = 2;
  b.set([0, 0, 0, 0], 72);
  new DataView(b.buffer).setUint32(72, refCrc32(b), true); // crc is VALID; version is not
  eq(fd.readInstallMarker(b), null, "a crc-valid marker of an unknown version -> null");
});

check("a truncated or empty input is rejected, not read past", () => {
  eq(fd.readInstallMarker(handBuildMarker().slice(0, 75)), null, "75 bytes -> null");
  eq(fd.readInstallMarker(new Uint8Array(0)), null, "0 bytes -> null");
});

check("absence returns the cannot-tell result rather than throwing", () => {
  // A card with no /data/INSTALL at all: the reader must degrade, not throw into the flow.
  eq(fd.readInstallMarker(null), null, "null input -> null");
  eq(fd.readInstallMarker(undefined), null, "undefined input -> null");
  eq(fd.readInstallMarker(new Uint8Array(76)), null, "an all-zero file -> null");
});

check("the marker's gitTag feeds compare.ts, and an unreadable one is never an upgrade", () => {
  const order = ["Retro-Go SD v2.1.0", "Retro-Go SD v2.0.0"];
  const m = fd.readInstallMarker(handBuildMarker({ gitTag: "Retro-Go SD v2.0.0" }));
  eq(fd.versionRelation(m.gitTag, "Retro-Go SD v2.1.0", order), "newer", "an upgrade is newer");
  eq(fd.sameVersion(m.gitTag, "Retro-Go SD v2.0.0"), true, "verbatim byte-compare, no parsing");
  const absent = fd.readInstallMarker(new Uint8Array(0));
  eq(fd.versionRelation(absent?.gitTag, "Retro-Go SD v2.1.0", order), "unknown",
    "no marker -> unknown");
  eq(fd.isUpgrade(absent?.gitTag, "Retro-Go SD v2.1.0", order), false,
    "unknown is never an upgrade");
});

check("the writer round-trips byte-exactly with the reader", () => {
  const fields = { bank: 1, storage: "flash", providesAbi: { version: 1, size: 844 },
    superblockOffset: 0x1234, coreMetaVersion: 3, gitTag: "Retro-Go v2.0.0", installedAt: 0 };
  const enc = fd.writeInstallMarker(fields);
  eq(enc.length, 80, "the writer emits exactly 80 bytes");
  const hand = handBuildMarker({ bank: 1, storage: 0, gitTag: "Retro-Go v2.0.0", installedAt: 0 });
  eq(Buffer.from(enc).toString("hex"), Buffer.from(hand).toString("hex"),
    "writer output is byte-identical to the doc-derived encoding");
  const m = fd.readInstallMarker(enc);
  ok(m, "the writer's output parses");
  eq(m.gitTag, fields.gitTag, "gitTag survives the round trip");
  eq(m.installedAt, 0, "installed_at 0 (RTC not set) is preserved");
  eq(fd.readInstallMarker(fd.writeInstallMarker({ ...fields, gitTag: "x".repeat(48) })).gitTag,
    "x".repeat(48), "a git_tag that exactly fills the 48-byte field has no NUL terminator");
  let threw = false;
  try { fd.writeInstallMarker({ ...fields, gitTag: "x".repeat(49) }); } catch { threw = true; }
  ok(threw, "a git_tag too long for the field is a programming error, not silent truncation");
});

check("the manifest's installFile ref agrees with the parser's constants", () => {
  eq(rawManifest.firmware.installFile.magic, "RGIN", "manifest magic");
  eq(rawManifest.firmware.installFile.version, fd.INSTALL_MARKER_VERSION, "manifest version");
  eq(rawManifest.firmware.installFile.path, fd.INSTALL_MARKER_PATH, "manifest path");
});

// --- fixture integrity ------------------------------------------------------------------

check("the fixtures are the real published examples, with a provenance note", () => {
  const note = readFileSync(join(fixtures, "SOURCE.md"), "utf8");
  ok(/docs\/examples/.test(note), "SOURCE.md records where the fixtures came from");
  ok(/re-copy/i.test(note), "SOURCE.md says to re-copy on a format change");
  // A guard that cannot run must fail, not print a green line (repo convention).
  ok(rawManifest.builds && rawManifest.builds.length === 4, "manifest fixture is the 4-build run");
});

// --- the curated list, from the newest release (curated.ts) -----------------------------

await check("loadCuratedProjects() walks index -> manifest -> projects.json", async () => {
  const list = await fd.loadCuratedProjects({ versionsUrl: VERSIONS_URL, fetchImpl: fixtureFetch });
  ok(Array.isArray(list), "a list, not the file wrapper");
  eq(list.length, rawProjects.projects.length, "every curated entry survives the walk");
  eq(list[0].project, rawProjects.projects[0].project, "order is the published order");
  ok(list.some((p) => p.kind === "core"), "cores present");
  ok(list.some((p) => p.kind === "homebrew"), "homebrew present");
});

await check("a release with no `projects` yields null, not an error", async () => {
  const noProjects = structuredClone(rawManifest);
  delete noProjects.projects;
  const fetchNoProjects = async (url) =>
    url.endsWith("/manifest.json")
      ? new Response(JSON.stringify(noProjects), { status: 200 })
      : fixtureFetch(url);
  const list = await fd.loadCuratedProjects({
    versionsUrl: VERSIONS_URL,
    fetchImpl: fetchNoProjects,
  });
  eq(list, null, "absence is null");
});

check("a malformed versionsUrl is refused rather than followed", () => {
  for (const bad of [
    "http://slash-proc.github.io/x/dist/versions.json",
    "https://slash-proc.github.io/x/dist/manifest.json",
    "not a url",
  ]) {
    const doc = structuredClone(rawProjects);
    doc.projects[0].versionsUrl = bad;
    throws(() => fd.parseProjects(doc), "malformed", `refused: ${bad}`);
  }
});

writeFileSync(join(out, "done"), "");

if (failures.length) {
  console.error(`firmwaredist: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
if (passed === 0) {
  console.error("firmwaredist: no assertions ran");
  process.exit(1);
}
console.log(`firmwaredist: ${passed} checks passed`);
