import type { SwdTransport } from "@gnw/swd-transport";

/**
 * Read `len` bytes from `addr` in small chunks, each passed through `transport`
 * as its own queue entry (no extra inter-chunk delay by default) so other queued
 * ops (poll, screenshot halt, etc.) can interleave between chunks.
 *
 * This is deliberately a DIFFERENT pacing policy than screenshot.ts, which uses
 * large 64 KiB chunks specifically so its inter-chunk delay stays INSIDE a single
 * serialTransport queue entry (busy()=true throughout) — see CLAUDE.md and
 * docs/AUDIT_NOTES.md item #2 for why those two shapes can't be merged safely.
 */
export async function readMemoryPaced(
  transport: SwdTransport,
  addr: number,
  len: number,
  opts: { chunkSize?: number; delayMs?: number } = {},
): Promise<Uint8Array> {
  const chunkSize = opts.chunkSize ?? 1024;
  const delayMs = opts.delayMs ?? 0;
  const out = new Uint8Array(len);
  for (let off = 0; off < len; off += chunkSize) {
    const n = Math.min(chunkSize, len - off);
    out.set(await transport.readMemory(addr + off, n), off);
    if (delayMs > 0 && off + n < len) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}
