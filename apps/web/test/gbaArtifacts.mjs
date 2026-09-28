import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve the GBA XIP metadata from the release manifest when the fixture includes it.
 * The fallback keeps owner-supplied four-file fixtures usable; the current GBA release
 * contract declares this same base in versions.json -> manifest.json.
 */
export function gbaMappedSpec(assetDir, xip, fallbackRelocBase = 0xdec00000) {
  const manifestPath = join(assetDir, "manifest.json");
  if (!existsSync(manifestPath)) return { mapped: true, relocBase: fallbackRelocBase };

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.project !== "gba") throw new Error(`GBA fixture manifest has project ${manifest.project}`);
  const artifact = manifest.targets?.flatMap((target) => target.artifacts ?? [])
    .find((candidate) => candidate.filename === "gba.xip");
  if (!artifact || artifact.mapped !== true || !Number.isInteger(artifact.relocBase)) {
    throw new Error("GBA release manifest must declare gba.xip as mapped with an integer relocBase");
  }
  if (artifact.bytes !== xip.length) throw new Error(`manifest gba.xip size ${artifact.bytes} != fixture ${xip.length}`);
  const sha256 = createHash("sha256").update(xip).digest("hex");
  if (artifact.sha256 !== sha256) throw new Error("fixture gba.xip does not match the manifest SHA-256");

  const versionsPath = join(assetDir, "versions.json");
  if (existsSync(versionsPath)) {
    const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
    const latest = versions.versions?.[0];
    if (versions.project !== "gba" || latest?.tag !== manifest.source?.ref) {
      throw new Error("versions.json latest release does not match the supplied GBA manifest");
    }
  }
  return { mapped: artifact.mapped, relocBase: artifact.relocBase };
}

/** Count exactly the aligned 32-bit words the published relocation rule must patch. */
export function countMappedWords(bytes, relocBase) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let count = 0;
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const masked = (dv.getUint32(i, true) & ~1) >>> 0;
    if (masked >= relocBase && masked < relocBase + bytes.length) count++;
  }
  return count;
}
