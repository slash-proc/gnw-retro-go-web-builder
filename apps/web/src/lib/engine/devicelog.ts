/**
 * Read retro-go's persistent printf buffer over SWD — without booting the
 * gnwmanager stub, so the running firmware's RAM stays intact.
 *
 * syscalls.c keeps printf output in `logbuf[4096]` (section `.persistent_logbuf`,
 * fixed at 0x30000008 in current retro-go-sd builds) with the write index `log_idx` at
 * 0x30000004. The section is
 * persistent, so the log survives a reset (as long as the device keeps power). littlefs
 * LFS_ERROR is enabled, so a failed lfs_mount() prints its reason here — exactly what we
 * need to debug "LittleFS corrupted". Read the buffer, decode, and read it back.
 */
import type { SwdTransport } from "@gnw/swd-transport";
import { connectProbe } from "./transport.js";
import { zipExtractOne, zipList } from "../unzip.js";
import { manifestOnce, versionsOnce } from "../firmwareDist/memo.js";
import { versionToken } from "../firmwareDist/compare.js";
import { FIRMWARE_VERSIONS_URL } from "../firmwareDist/types.js";
import { dbg } from "../debug.js";

// Device-log polling runs continuously while Retro-Go is active. Keep diagnostics useful by
// emitting each steady-state observation once, then only logging it again when its value changes.
// Without this, a 1–2 second poll interval floods the debug/audit log with identical reads.
const lastDebugByKey = new Map<string, string>();
function dbgStable(key: string, message: string): void {
  if (lastDebugByKey.get(key) === message) return;
  lastDebugByKey.set(key, message);
  dbg(message);
}

const LOGBUF_SIZE = 4096;
/**
 * The current retro-go-sd ELF puts the persistent section in AHB SRAM. The DTCM pair is kept
 * for older images; gnwmanager's monitor discovers these same values from the ELF symbols.
 */
export interface DeviceLogLayout {
  buffer: number;
  index: number;
  size: number;
}

const LOG_LAYOUTS: DeviceLogLayout[] = [
  { buffer: 0x30000008, index: 0x30000004, size: LOGBUF_SIZE },
  { buffer: 0x20000008, index: 0x20000004, size: LOGBUF_SIZE },
];

/** The pre-v2 firmware format has no published debug ELF. Its persistent section is in DTCM. */
export function fallbackLogLayout(version: string): DeviceLogLayout {
  const major = Number(versionToken(version).match(/^v?(\d+)/)?.[1] ?? 0);
  return major >= 2 ? LOG_LAYOUTS[0] : LOG_LAYOUTS[1];
}

export function readElf32LogSymbols(elf: Uint8Array): DeviceLogLayout | null {
  if (elf.length < 52 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) return null;
  if (elf[4] !== 1 || elf[5] !== 1) return null; // ELF32, little-endian
  const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  const shoff = dv.getUint32(32, true);
  const shentsize = dv.getUint16(46, true);
  const shnum = dv.getUint16(48, true);
  if (!shoff || shentsize < 40 || shnum === 0 || shoff + shentsize * shnum > elf.length) return null;

  let symtab: { offset: number; size: number; entsize: number; link: number } | null = null;
  for (let i = 0; i < shnum; i++) {
    const off = shoff + i * shentsize;
    const type = dv.getUint32(off + 4, true);
    if (type !== 2) continue; // SHT_SYMTAB
    symtab = {
      offset: dv.getUint32(off + 16, true),
      size: dv.getUint32(off + 20, true),
      link: dv.getUint32(off + 24, true),
      entsize: dv.getUint32(off + 36, true),
    };
    break;
  }
  if (!symtab || symtab.entsize < 16 || symtab.link >= shnum || symtab.offset + symtab.size > elf.length) return null;
  const strOff = shoff + symtab.link * shentsize;
  const strStart = dv.getUint32(strOff + 16, true);
  const strSize = dv.getUint32(strOff + 20, true);
  if (strStart + strSize > elf.length) return null;
  const names = new TextDecoder("latin1").decode(elf.subarray(strStart, strStart + strSize));
  let buffer = 0;
  let index = 0;
  let size = LOGBUF_SIZE;
  for (let off = symtab.offset; off + symtab.entsize <= symtab.offset + symtab.size; off += symtab.entsize) {
    const nameOff = dv.getUint32(off, true);
    const value = dv.getUint32(off + 4, true);
    const symbolSize = dv.getUint32(off + 8, true);
    const end = names.indexOf("\0", nameOff);
    const name = end < 0 ? "" : names.slice(nameOff, end);
    if (name === "logbuf") { buffer = value; if (symbolSize > 0) size = symbolSize; }
    else if (name === "log_idx") index = value;
  }
  return buffer && index && size > 0 ? { buffer, index, size } : null;
}

/** Resolve the installed Retro-Go bank's log symbols from its published debug ELF. */
export async function loadDeviceLogLayout(version: string, bank: 1 | 2): Promise<DeviceLogLayout | null> {
  // ELF debug assets were introduced with the v2 distribution format. Older releases use the
  // historical fixed DTCM addresses and must not trigger a pointless versions/manifest fetch.
  const major = Number(versionToken(version).match(/^v?(\d+)/)?.[1] ?? 0);
  dbg(`[devicelog] resolve version=${version} token=${versionToken(version)} major=${major} bank=${bank}`);
  if (!Number.isFinite(major) || major < 2) {
    dbg("[devicelog] pre-v2 build: using fixed legacy layout");
    return null;
  }
  const versions = await versionsOnce(FIRMWARE_VERSIONS_URL);
  const token = versionToken(version);
  const entry = versions.versions.find((v) => versionToken(v.gitTag) === token)
    ?? versions.versions.find((v) => versionToken(v.gitTag).startsWith(token) || token.startsWith(versionToken(v.gitTag)));
  if (!entry) {
    dbg("[devicelog] no matching published firmware entry");
    return null;
  }
  const manifest = await manifestOnce(entry);
  const build = manifest.builds.find((b) => b.bank === bank) ?? manifest.builds[0];
  if (!build) {
    dbg("[devicelog] matching manifest has no build");
    return null;
  }
  const response = await fetch(build.debug.url);
  if (!response.ok) throw new Error(`debug ELF fetch failed (${response.status})`);
  const zip = new Uint8Array(await response.arrayBuffer());
  const elfEntry = zipList(zip).find((e) => !e.isDirectory && e.name.endsWith(".elf"));
  if (!elfEntry) {
    dbg("[devicelog] debug zip contains no ELF");
    return null;
  }
  const layout = readElf32LogSymbols(await zipExtractOne(zip, elfEntry));
  dbg("[devicelog] ELF layout", layout ?? "unresolved");
  return layout;
}

/** _write() NUL-terminates each write, so the buffer is NUL-separated text. Turn runs
 *  of NUL/control bytes (write separators) into newlines; keep spaces within lines. */
function decodeLog(buf: Uint8Array): string {
  return new TextDecoder("latin1")
    .decode(buf)
    .replace(/[^\t\n\x20-\x7e]+/g, "\n")
    .split("\n")
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0)
    .join("\n")
    .trim();
}

function decodeLogPrefix(buf: Uint8Array): string {
  const end = buf.indexOf(0);
  return decodeLog(end < 0 ? buf : buf.subarray(0, end));
}

/** SWD block reads require both address and length to be word aligned. */
async function readLogBytes(
  transport: SwdTransport,
  address: number,
  length: number,
  quiet = false,
): Promise<Uint8Array> {
  if (length === 0) return new Uint8Array();
  const prefix = address & 3;
  const alignedAddress = address - prefix;
  const alignedLength = (length + prefix + 3) & ~3;
  return (await transport.readMemory(alignedAddress, alignedLength, undefined, !quiet)).subarray(prefix, prefix + length);
}

export interface DeviceLog {
  text: string;
  /** Current write index into the 4 KiB buffer (the valid log is the prefix before it). */
  idx: number;
  probeName: string;
}

/**
 * Extract the currently launched game/homebrew from the persistent log.
 *
 * Core initialization is launcher bookkeeping, not an activity the header should expose:
 * the launcher itself is simply "Retro-Go". Retro-Go switches back to app 0 when it returns to
 * that launcher, so clear the prior title at that boundary and only publish an actual
 * `Starting game` record afterwards.
 */
export function retroGoActivityFromLog(text: string): string | null {
  let activity: string | null = null;
  for (const line of text.split("\n")) {
    const app = line.match(/odroid_system_switch_app:\s+Switching to app\s+(-?\d+)/);
    if (app && Number(app[1]) === 0) {
      activity = null;
      continue;
    }
    const game = line.match(/Retro-Go:\s+Starting game:\s*(.+?)\s*$/);
    if (game?.[1]) activity = game[1];
  }
  return activity;
}

/**
 * Fast liveness check: True if retro-go's persistent logbuf signature exists.
 */
export async function isRetroGoRunning(transport: SwdTransport): Promise<boolean> {
  for (const layout of LOG_LAYOUTS) {
    try {
      const idx = (await transport.readWord(layout.index)) >>> 0;
      // The log index is a byte count into the linear buffer. Zero is a valid empty log,
      // but it cannot positively identify Retro-Go, so keep looking for another layout.
      if (idx === 0 || idx > layout.size) continue;
      const sampleStart = Math.max(0, idx - 64);
      const sample = await readLogBytes(transport, layout.buffer + sampleStart, idx - sampleStart);
      let asciiCount = 0;
      for (const byte of sample) {
        if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) asciiCount++;
      }
      if (asciiCount >= Math.max(1, sample.length * 0.5)) return true;
    } catch {
      // Try the legacy address pair before reporting that no log is present.
    }
  }
  return false;
}

/**
 * Read + decode the logbuf over an ALREADY-OPEN transport (the live connection). Use this
 * while connected — it shares the held probe (and, when passed the store's serialized
 * transport, queues safely with the liveness poll / ops) instead of opening a second probe.
 */
export async function readLogFromTransport(
  transport: SwdTransport,
  preferred?: DeviceLogLayout | null,
  quiet = false,
): Promise<{ text: string; idx: number }> {
  // A symbol-resolved layout is authoritative. If its buffer is currently empty, do not let
  // stale bytes at a fallback address masquerade as a live log.
  if (preferred) {
    dbgStable("preferred-layout", `[devicelog] preferred layout ${JSON.stringify(preferred)}`);
    try {
      const idx = (await transport.readWord(preferred.index)) >>> 0;
      if (idx <= preferred.size) {
        // A watchdog restart intentionally preserves the buffer but can leave the cursor at
        // zero while the first post-reset write has not happened yet. Inspect the whole buffer
        // in that case instead of discarding useful preserved output.
        const readLength = idx === 0 ? preferred.size : idx;
        const buf = await readLogBytes(transport, preferred.buffer, readLength, quiet);
        const text = idx === 0 ? decodeLogPrefix(buf) : decodeLog(buf);
        dbgStable("preferred-read", `[devicelog] preferred read index=0x${preferred.index.toString(16)} idx=${idx} bytes=${buf.length} text=${text.length}`);
        if (text.length > 0) return { text, idx };
      }
    } catch {
      dbgStable("preferred-read-failed", "[devicelog] preferred read failed");
      // If the symbol-resolved address cannot be read, fall back to the historical pairs below.
    }
  }
  let selected: { idx: number; text: string } | null = null;
  const layouts = preferred
    ? [preferred, ...LOG_LAYOUTS.filter((l) => l.buffer !== preferred.buffer || l.index !== preferred.index)]
    : LOG_LAYOUTS;
  for (const layout of layouts) {
    try {
      const idx = (await transport.readWord(layout.index)) >>> 0;
      const candidateKey = `candidate-index-${layout.index.toString(16)}`;
      dbgStable(candidateKey, `[devicelog] candidate index=0x${layout.index.toString(16)} buffer=0x${layout.buffer.toString(16)} idx=${idx}`);
      if (idx > layout.size) continue;
      if (idx === 0) {
        const text = decodeLogPrefix(await readLogBytes(transport, layout.buffer, layout.size, quiet));
        dbgStable(`zero-index-${layout.index.toString(16)}`, `[devicelog] zero-index scan bytes=${layout.size} text=${text.length}`);
        if (text.length > 0) return { text, idx };
        selected ??= { idx, text: "" };
        continue;
      }
      const buf = await readLogBytes(transport, layout.buffer, Math.min(idx, layout.size), quiet);
      const text = decodeLog(buf);
      // Prefer the current AHB layout, but use the legacy pair when an older image is the only
      // one containing a plausible log. This mirrors symbol discovery without shipping an ELF
      // parser in the browser.
      if (text.length > 0) {
        dbgStable(`candidate-decoded-${layout.index.toString(16)}`, `[devicelog] candidate decoded bytes=${buf.length} text=${text.length}`);
        selected = { idx, text };
        break;
      }
    } catch {
      dbgStable(`candidate-failed-${layout.index.toString(16)}`, `[devicelog] candidate read failed index=0x${layout.index.toString(16)}`);
      // An older target may not expose the current layout; try the legacy symbol pair.
    }
  }
  if (!selected) return { text: "", idx: 0 };
  // Retro-Go's _write() buffer is linear, not circular: it appends at log_idx and resets the
  // cursor to zero when the next write would overflow. Bytes after log_idx are stale data from
  // an earlier boot, so reading/rotating the whole 4 KiB made those bytes appear as stray
  // characters and moved the real beginning of the log into the middle of the output.
  return { text: selected.text, idx: selected.idx };
}

/**
 * Attach a probe (NO stub boot) and read the device's printf log. Use this while the
 * device is still powered and running retro-go (e.g. on the corrupt-filesystem screen) —
 * the pre-connect path that opens its own probe.
 */
export async function readDeviceLog(): Promise<DeviceLog> {
  const handle = await connectProbe();
  try {
    const { text, idx } = await readLogFromTransport(handle.transport);
    return { text, idx, probeName: handle.probeName };
  } finally {
    await handle.dispose();
  }
}
