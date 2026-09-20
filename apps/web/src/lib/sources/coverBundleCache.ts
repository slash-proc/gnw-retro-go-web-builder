/**
 * Proof-of-concept persistent bundle for low-resolution cover art.
 *
 * One file contains the cache signature, a small manifest, and all cover payloads concatenated
 * behind it. The bundle is derived data: a missing, corrupt, or stale file is simply rebuilt.
 * This deliberately uses a tiny binary format instead of JSON/base64 so image bytes are never
 * copied through strings.
 */
import { scoped } from "../storageScope.js";

const MAGIC = new Uint8Array([0x47, 0x4e, 0x57, 0x43, 0x4f, 0x56, 0x31, 0x00]); // GNWCOV1\0
const VERSION = 1;
const DIR_NAME = scoped("cover-bundles");

export interface CoverBundleEntry {
  key: string;
  mime: string;
  bytes: Uint8Array;
}

export interface CoverBundle {
  signature: string;
  entries: Map<string, { mime: string; bytes: Uint8Array }>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeU32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true);
  return offset + 4;
}

function readU32(view: DataView, offset: number): [number, number] {
  return [view.getUint32(offset, true), offset + 4];
}

function writeBytes(out: Uint8Array, offset: number, bytes: Uint8Array): number {
  out.set(bytes, offset);
  return offset + bytes.byteLength;
}

/** Serialize one bundle without retaining a second copy of any individual image. */
export function encodeCoverBundle(signature: string, entries: readonly CoverBundleEntry[]): Uint8Array {
  const signatureBytes = encoder.encode(signature);
  const encoded = entries.map((entry) => ({
    key: encoder.encode(entry.key),
    mime: encoder.encode(entry.mime),
    bytes: entry.bytes,
  }));
  const manifestBytes = encoded.reduce((n, e) => n + 4 + e.key.byteLength + 4 + e.mime.byteLength + 4 + 4, 0);
  const headerBytes = MAGIC.byteLength + 4 + 4 + signatureBytes.byteLength + 4;
  const payloadOffset = headerBytes + manifestBytes;
  const total = payloadOffset + encoded.reduce((n, e) => n + e.bytes.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  offset = writeBytes(out, offset, MAGIC);
  offset = writeU32(view, offset, VERSION);
  offset = writeU32(view, offset, signatureBytes.byteLength);
  offset = writeBytes(out, offset, signatureBytes);
  offset = writeU32(view, offset, encoded.length);
  let payload = payloadOffset;
  for (const entry of encoded) {
    offset = writeU32(view, offset, entry.key.byteLength);
    offset = writeBytes(out, offset, entry.key);
    offset = writeU32(view, offset, entry.mime.byteLength);
    offset = writeBytes(out, offset, entry.mime);
    offset = writeU32(view, offset, payload);
    offset = writeU32(view, offset, entry.bytes.byteLength);
    payload = writeBytes(out, payload, entry.bytes);
  }
  return out;
}

/** Parse and validate a bundle. Returned image bytes are views into the one input ArrayBuffer. */
export function decodeCoverBundle(bytes: Uint8Array): CoverBundle | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    if (bytes.byteLength < MAGIC.byteLength + 12 || !MAGIC.every((b, i) => bytes[i] === b)) return null;
    offset += MAGIC.byteLength;
    let value: number;
    [value, offset] = readU32(view, offset);
    if (value !== VERSION) return null;
    let signatureLength: number;
    [signatureLength, offset] = readU32(view, offset);
    if (signatureLength > bytes.byteLength - offset) return null;
    const signature = decoder.decode(bytes.subarray(offset, offset + signatureLength));
    offset += signatureLength;
    let count: number;
    [count, offset] = readU32(view, offset);
    const entries = new Map<string, { mime: string; bytes: Uint8Array }>();
    for (let i = 0; i < count; i++) {
      let length: number;
      [length, offset] = readU32(view, offset);
      if (length > bytes.byteLength - offset) return null;
      const key = decoder.decode(bytes.subarray(offset, offset + length));
      offset += length;
      [length, offset] = readU32(view, offset);
      if (length > bytes.byteLength - offset) return null;
      const mime = decoder.decode(bytes.subarray(offset, offset + length));
      offset += length;
      let payloadOffset: number;
      let payloadLength: number;
      [payloadOffset, offset] = readU32(view, offset);
      [payloadLength, offset] = readU32(view, offset);
      if (payloadOffset > bytes.byteLength || payloadLength > bytes.byteLength - payloadOffset) return null;
      entries.set(key, { mime, bytes: bytes.subarray(payloadOffset, payloadOffset + payloadLength) });
    }
    return { signature, entries };
  } catch {
    return null;
  }
}

function safeName(sourceId: string): string {
  return encodeURIComponent(sourceId).replace(/%/g, "_") + ".bin";
}

async function cacheDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_NAME, { create });
  } catch {
    return null;
  }
}

export async function readCoverBundle(sourceId: string): Promise<Uint8Array | null> {
  try {
    const dir = await cacheDirectory(false);
    if (!dir) return null;
    const file = await (await dir.getFileHandle(safeName(sourceId))).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** Atomic enough for a derived cache: write a sibling then replace the visible file. */
export async function writeCoverBundle(sourceId: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const dir = await cacheDirectory(true);
    if (!dir) return false;
    const name = safeName(sourceId);
    const temp = `${name}.tmp-${Date.now()}`;
    const writable = await (await dir.getFileHandle(temp, { create: true })).createWritable();
    await writable.write(bytes);
    await writable.close();
    const target = await dir.getFileHandle(name, { create: true });
    // File System Access has no portable rename on a file handle; write the verified complete
    // bytes to the target after the temporary write succeeds, then remove the temporary file.
    const targetWritable = await target.createWritable();
    await targetWritable.write(bytes);
    await targetWritable.close();
    await dir.removeEntry(temp);
    return true;
  } catch {
    return false;
  }
}
