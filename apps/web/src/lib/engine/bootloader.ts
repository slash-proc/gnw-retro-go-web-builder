/** Install Sylverb's standalone bank-1 bootloader with a pinned, verified release image. */
import type { GnwFlasher, LogFn } from "@gnw/gnw-flasher";
import standaloneBootloaderUrl from "@gnw/gnw-patch/vendor/gnw_bootloader.bin?url";
import { hashHex } from "../cryptoHash.js";
import { flashImage } from "./flasher.js";

export const STANDALONE_BOOTLOADER_SIZE = 50232;
export const STANDALONE_BOOTLOADER_SHA256 =
  "fe171fad5160c9a02edab5c435f64fc4ee19e97fcf684abe2fe72a54903d005b";

const read32 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

export async function loadStandaloneBootloader(fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(standaloneBootloaderUrl);
  if (!response.ok) throw new Error(`Bootloader download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== STANDALONE_BOOTLOADER_SIZE)
    throw new Error(`Bootloader size mismatch (expected ${STANDALONE_BOOTLOADER_SIZE}, got ${bytes.length})`);
  const digest = await hashHex("SHA-256", bytes);
  if (digest !== STANDALONE_BOOTLOADER_SHA256)
    throw new Error(`Bootloader SHA-256 mismatch (expected ${STANDALONE_BOOTLOADER_SHA256}, got ${digest})`);
  const sp = read32(bytes, 0);
  const pc = read32(bytes, 4) & ~1;
  if ((sp >>> 24) !== 0x20 || pc < 0x08000000 || pc >= 0x08000000 + bytes.length)
    throw new Error("The verified bootloader has an invalid bank-1 vector table");
  return bytes;
}

export async function flashStandaloneBootloader(
  flasherOrGetter: GnwFlasher | ((force?: boolean) => Promise<GnwFlasher>),
  onProgress?: (done: number, total: number) => void,
  log?: LogFn,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (abortSignal?.aborted) throw new Error("Operation aborted");
  const bytes = await loadStandaloneBootloader();
  await flashImage(flasherOrGetter, 1, 0, bytes, onProgress, log, { abortSignal });
}
