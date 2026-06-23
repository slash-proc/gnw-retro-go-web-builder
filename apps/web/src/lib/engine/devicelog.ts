/**
 * Read retro-go's persistent printf ring buffer over SWD — without booting the
 * gnwmanager stub, so the running firmware's RAM stays intact.
 *
 * syscalls.c keeps printf output in `logbuf[4096]` (section `.persistent_logbuf`,
 * fixed at 0x20000008) with the write index `log_idx` at 0x20000004. The section is
 * persistent, so the log survives a reset (as long as the device keeps power). littlefs
 * LFS_ERROR is enabled, so a failed lfs_mount() prints its reason here — exactly what we
 * need to debug "LittleFS corrupted". Read the buffer, decode, and read it back.
 */
import type { SwdTransport } from "@gnw/swd-transport";
import { connectProbe } from "./transport.js";

const LOGBUF_ADDR = 0x20000008; // .persistent_logbuf — char logbuf[1024*4]
const LOGBUF_SIZE = 4096;
const LOGIDX_ADDR = 0x20000004; // .persistent_log_idx — uint32_t log_idx

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

export interface DeviceLog {
  text: string;
  /** Current write index into the 4 KiB buffer (freshest output is near here). */
  idx: number;
  probeName: string;
}

/**
 * Fast liveness check: True if retro-go's persistent logbuf signature exists.
 */
export async function isRetroGoRunning(transport: SwdTransport): Promise<boolean> {
  try {
    const idx = (await transport.readWord(LOGIDX_ADDR)) >>> 0;
    // The log index must be a reasonable number (not 0, not uninitialized SRAM garbage)
    if (idx === 0 || idx > 10000000) return false;

    // Read a 64-byte sample near the write head
    const readIdx = Math.max(0, idx - 64) % LOGBUF_SIZE;
    const sample = await transport.readMemory(LOGBUF_ADDR + readIdx, 64);
    
    let asciiCount = 0;
    for (let i = 0; i < sample.length; i++) {
       if ((sample[i] >= 32 && sample[i] <= 126) || sample[i] === 10) asciiCount++;
    }
    // If it's mostly printable ASCII, it's very likely the Retro-Go log buffer
    return asciiCount >= 32;
  } catch {
    return false;
  }
}

/**
 * Read + decode the logbuf over an ALREADY-OPEN transport (the live connection). Use this
 * while connected — it shares the held probe (and, when passed the store's serialized
 * transport, queues safely with the liveness poll / ops) instead of opening a second probe.
 */
export async function readLogFromTransport(
  transport: SwdTransport,
): Promise<{ text: string; idx: number }> {
  const idx = (await transport.readWord(LOGIDX_ADDR)) >>> 0;
  const buf = await transport.readMemory(LOGBUF_ADDR, LOGBUF_SIZE);
  // It's a ring buffer; log_idx is the write head, so the oldest byte is AT idx. Rotate so
  // the log reads chronologically (oldest → newest) instead of wrapping mid-stream.
  const i = idx % LOGBUF_SIZE;
  const ordered = new Uint8Array(LOGBUF_SIZE);
  ordered.set(buf.subarray(i), 0);
  ordered.set(buf.subarray(0, i), LOGBUF_SIZE - i);
  return { text: decodeLog(ordered), idx };
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
