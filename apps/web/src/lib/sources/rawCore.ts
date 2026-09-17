import { sha256Hex } from "./client.js";
import { SourceError, type ResolvedSource, type SystemEntry } from "./types.js";
import { blobCache } from "./blobCache.js";

const MAGIC = "CORE";
const META_SIZE = 0x230;
const HEADER_PREFIX = 8;
const SEGMENT_SIZE = 12;
const SYSTEM_SIZE = 116;

// Keep the just-imported payload available even when IndexedDB is unavailable or slow. The
// persisted source only contains metadata; this in-memory fallback covers the same tab.
const rawPayloads = new Map<string, Uint8Array>();
export function rawCorePayload(hash: string): Uint8Array | undefined {
  return rawPayloads.get(hash);
}

export interface RawCoreSegment {
  region: 0 | 1 | 2;
  codeSize: number;
  bssSize: number;
}

export interface RawCoreSystem {
  systemName: string;
  dirname: string;
  extensions: string;
  parseType: 0 | 1;
  padLogoOffset: number;
  padLogoSize: number;
  headerLogoOffset: number;
  headerLogoSize: number;
  cheatExt: string;
}

export interface RawCoreMetadata {
  requiredAbiVersion: number;
  requiredAbiMinSize: number;
  flags: number;
  segments: RawCoreSegment[];
  systems: RawCoreSystem[];
  version: { major: number; minor: number; patch: number };
  coreName: string;
}

export interface RawCoreDescriptor {
  filename: string;
  bytes: Uint8Array;
  headerVersion: number;
  headerLength: number;
  metadata: RawCoreMetadata;
}

function splitExtensions(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((x) => (x.startsWith(".") ? x : `.${x}`))
    .filter((x) => x.length > 1 && x.length <= 32);
}

/** Normalize a parsed CORE into the app's existing source representation. */
export async function rawCoreSource(
  descriptor: RawCoreDescriptor,
  publish: (bytes: Uint8Array) => string = (bytes) =>
    URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer])),
): Promise<{ resolved: ResolvedSource; hash: string; release: () => void }> {
  const hash = await sha256Hex(descriptor.bytes);
  rawPayloads.set(hash, descriptor.bytes);
  // The installer may run immediately after import.  Do not return a resolved source until
  // its payload is durable in the content-addressed cache; otherwise prepareCoreArtifacts()
  // races the write, sees a cache miss, and falls back to the intentionally unusable
  // raw.invalid URL.  That made the source visible and selected while silently producing no
  // /cores/ artifact.
  await blobCache().put(hash, descriptor.bytes, "artifact");
  const m = descriptor.metadata;
  const systems: SystemEntry[] = m.systems.map((s, i) => ({
    id: s.dirname || `core-${i + 1}`,
    longName: s.systemName || s.dirname || `System ${i + 1}`,
    shortName: s.systemName || s.dirname || `System ${i + 1}`,
    extensions: splitExtensions(s.extensions),
    browse: s.parseType === 1 ? "directory" : "file",
    compression: false,
    ...(s.cheatExt ? { cheatExt: s.cheatExt } : {}),
  }));
  const repo = `raw/${hash}`;
  const url = publish(descriptor.bytes);
  let released = false;
  return {
    hash,
    resolved: {
      repo,
      versionsUrl: "https://raw.invalid/versions.json",
      index: {
        schemaVersion: 1,
        project: m.coreName,
        title: m.coreName,
        repo,
        releasesUrl: "https://raw.invalid/",
        versions: [],
      },
      entry: {
        tag: `v${m.version.major}.${m.version.minor}.${m.version.patch}`,
        manifest: "manifest.json",
        publishedAt: new Date(0).toISOString(),
        prerelease: false,
        kind: "core",
        requiresAbi: { version: m.requiredAbiVersion, minSize: m.requiredAbiMinSize },
        needsUserFiles: false,
      },
      manifestUrl: "https://raw.invalid/manifest.json",
      manifest: {
        schemaVersion: 1,
        project: m.coreName,
        title: m.coreName,
        source: { repo, commit: hash, ref: descriptor.filename },
        tools: [],
        targets: [
          {
            id: "game-and-watch",
            platform: "game-and-watch",
            label: m.coreName,
            kind: "core",
            requiresAbi: { version: m.requiredAbiVersion, minSize: m.requiredAbiMinSize },
            artifacts: [
              {
                filename: descriptor.filename,
                bytes: descriptor.bytes.byteLength,
                sha256: hash,
                url,
              },
            ],
            systems,
          },
        ],
      },
    },
    release: () => {
      if (!released) {
        released = true;
        URL.revokeObjectURL(url);
      }
    },
  };
}

function invalid(detail?: string): SourceError {
  return new SourceError("raw-core-invalid", detail);
}

function text(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function safeRange(offset: number, size: number, total: number): boolean {
  return offset <= total && size <= total - offset;
}

/** Parse the external CORE v3 container. The returned bytes are the original file unchanged. */
export function parseRawCore(input: Uint8Array, filename: string): RawCoreDescriptor {
  if (input.length < HEADER_PREFIX) throw invalid("truncated header");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (new TextDecoder().decode(input.subarray(0, 4)) !== MAGIC) {
    throw invalid("unsupported magic");
  }
  const headerVersion = view.getUint16(4, true);
  const headerLength = view.getUint16(6, true);
  if (headerVersion !== 3) throw invalid(`unsupported header version ${headerVersion}`);
  if (headerLength < META_SIZE) throw invalid("header is shorter than v3 metadata");
  if (!safeRange(HEADER_PREFIX, headerLength, input.length)) throw invalid("truncated header data");

  const base = HEADER_PREFIX;
  const requiredAbiVersion = view.getUint32(base + 0x000, true);
  const requiredAbiMinSize = view.getUint32(base + 0x004, true);
  const flags = view.getUint32(base + 0x008, true);
  const segments: RawCoreSegment[] = [];
  const segmentsCount = view.getUint32(base + 0x00c, true);
  if (segmentsCount < 1 || segmentsCount > 4) throw invalid("invalid segments count");
  let payloadBytes = 0;
  for (let i = 0; i < 4; i++) {
    const off = base + 0x010 + i * SEGMENT_SIZE;
    const region = view.getUint32(off, true);
    if (region > 2) throw invalid(`invalid segment region ${region}`);
    const codeSize = view.getUint32(off + 4, true);
    const bssSize = view.getUint32(off + 8, true);
    if (codeSize > Number.MAX_SAFE_INTEGER - bssSize) throw invalid("segment size overflow");
    payloadBytes += codeSize;
    segments.push({ region: region as 0 | 1 | 2, codeSize, bssSize });
  }

  const systemsCount = view.getUint32(base + 0x040, true);
  if (systemsCount < 1 || systemsCount > 4) throw invalid("invalid systems count");
  const systems: RawCoreSystem[] = [];
  for (let i = 0; i < systemsCount; i++) {
    const off = base + 0x044 + i * SYSTEM_SIZE;
    const parseType = view.getUint32(off + 80, true);
    if (parseType > 1) throw invalid(`invalid parse type ${parseType}`);
    systems.push({
      systemName: text(input.subarray(off, off + 32)),
      dirname: text(input.subarray(off + 32, off + 48)),
      extensions: text(input.subarray(off + 48, off + 80)),
      parseType: parseType as 0 | 1,
      padLogoOffset: view.getUint32(off + 84, true),
      padLogoSize: view.getUint32(off + 88, true),
      headerLogoOffset: view.getUint32(off + 92, true),
      headerLogoSize: view.getUint32(off + 96, true),
      cheatExt: text(input.subarray(off + 100, off + 108)),
    });
  }
  // The header is structurally complete above; logos are intentionally not decoded or extracted.
  const version = {
    major: view.getUint8(base + 0x214),
    minor: view.getUint8(base + 0x215),
    patch: view.getUint8(base + 0x216),
  };
  const coreName = text(input.subarray(base + 0x217, base + 0x22f));
  if (!coreName) throw invalid("missing core name");
  if (HEADER_PREFIX + headerLength + payloadBytes > input.length) {
    throw invalid("truncated segment payload");
  }
  return {
    filename,
    bytes: input.slice(),
    headerVersion,
    headerLength,
    metadata: {
      requiredAbiVersion,
      requiredAbiMinSize,
      flags,
      segments,
      systems,
      version,
      coreName,
    },
  };
}
