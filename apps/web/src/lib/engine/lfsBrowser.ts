import { device } from "../device.svelte.js";
import { readLittleFsTree, readLittleFsFileLazy, type LittlefsTreeNode } from "@gnw/fs-builders";
import { readMemoryPaced } from "./chunkedRead.js";
import { EXTBASE } from "./addr.js";
import { parseCoreHeader, evaluateCoreVersions, type CoreVersionCheck } from "./coreVersion.js";

/** Read `len` bytes from `addr` in 1 KiB chunks so each chunk passes through the
 *  serialTransport as its own queue entry (no internal 10 ms sleep). Other queued
 *  ops (poll, screenshot halt, etc.) can interleave between chunks. */
function readInChunks(addr: number, len: number): Promise<Uint8Array> {
  return readMemoryPaced(device.transport!, addr, len, { chunkSize: 1024 });
}

/** LittleFS doesn't expose a total block count up front, so progress here is a rough
 *  estimate (assumes ~20 blocks for a typical tree walk), reported as a percentage on a
 *  0..100 scale — matches every other engine progress callback's `(done, total)` shape
 *  instead of the 0..1 fraction this used to report. */
const LFS_TREE_PROGRESS_TOTAL = 100;
const LFS_TREE_PROGRESS_ESTIMATED_BLOCKS = 20;

export async function ensureLfsTree(onProgress?: (done: number, total: number) => void): Promise<LittlefsTreeNode> {
  if (device.installedLfsTree) return device.installedLfsTree;

  const p = device.partitions.find((p) => p.fs === "littlefs");
  if (!p || !device.flasher) {
    throw new Error("LittleFS partition not found.");
  }

  const blockSize = p.meta?.blockSize ?? device.info?.minEraseSizeBytes ?? 4096;
  const blockCount = p.meta?.blockCount ?? Math.floor(p.size / blockSize);

  let blocksFetched = 0;

  const tree = await readLittleFsTree(blockSize, blockCount, async (block) => {
    if (device.lfsBlockCache.has(block)) return device.lfsBlockCache.get(block)!;

    const addr = EXTBASE + p.offset + p.size - ((block + 1) * blockSize);
    const data = await readInChunks(addr, blockSize);
    device.lfsBlockCache.set(block, data);

    blocksFetched++;
    const pct = Math.min(99, Math.round((blocksFetched / LFS_TREE_PROGRESS_ESTIMATED_BLOCKS) * 100));
    onProgress?.(pct, LFS_TREE_PROGRESS_TOTAL);
    return data;
  });

  onProgress?.(LFS_TREE_PROGRESS_TOTAL, LFS_TREE_PROGRESS_TOTAL);

  function sortTree(n: LittlefsTreeNode) {
    if (n.children) {
      n.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const c of n.children) sortTree(c);
    }
  }
  sortTree(tree);
  device.installedLfsTree = tree;
  return tree;
}

export async function readLfsFile(path: string): Promise<Uint8Array> {
  const p = device.partitions.find((p) => p.fs === "littlefs");
  if (!p || !device.flasher) {
    throw new Error("LittleFS partition not found.");
  }

  const blockSize = p.meta?.blockSize ?? device.info?.minEraseSizeBytes ?? 4096;
  const blockCount = p.meta?.blockCount ?? Math.floor(p.size / blockSize);

  return readLittleFsFileLazy(blockSize, blockCount, path, async (block) => {
    if (device.lfsBlockCache.has(block)) return device.lfsBlockCache.get(block)!;
    
    const addr = EXTBASE + p.offset + p.size - ((block + 1) * blockSize);
    const data = await readInChunks(addr, blockSize);
    device.lfsBlockCache.set(block, data);
    return data;
  });
}

/** Validate that every installed core (LittleFS, Flash-mode) agrees with the given firmware
 *  version (and with each other). No partial-read primitive exists in the LittleFS reader
 *  (`readLittleFsFileLazy` always reads a file to completion), so this pulls each core's full
 *  bytes over SWD — call it from the deep scan's background/non-blocking tail, never inline
 *  with the extflash-partition-scan results the UI is waiting on.
 *
 *  `isCancelled` is checked BEFORE EVERY core read, not just once at the end — a stub reboot
 *  (e.g. a flash starting while this is still running) causes a real, brief USB
 *  disconnect/reconnect, and this must stop issuing transferOut calls against the old
 *  transport the instant that happens, not keep reading and crash with "device must be opened
 *  first". Returns whatever was read so far if cancelled partway through. */
export async function checkCoreVersions(
  firmwareVersion: string | null,
  isCancelled?: () => boolean,
): Promise<CoreVersionCheck> {
  const tree = await ensureLfsTree();
  const coresDir = tree.children?.find((n) => n.isDirectory && n.name === "cores");
  const cores: Record<string, string | null> = {};
  if (coresDir?.children) {
    for (const f of coresDir.children) {
      if (f.isDirectory) continue;
      if (isCancelled?.()) break;
      try {
        const data = await readLfsFile(f.path);
        cores[f.path] = parseCoreHeader(data)?.tag ?? null;
      } catch {
        cores[f.path] = null;
      }
    }
  }
  return evaluateCoreVersions(firmwareVersion, cores);
}

export async function getLfsUsedSpace(): Promise<{ usedBytes: number, freeBytes: number } | null> {
  const p = device.partitions.find((p) => p.fs === "littlefs");
  if (!p || !device.flasher) return null;
  const tree = await ensureLfsTree();
  const blockSize = p.meta?.blockSize ?? device.info?.minEraseSizeBytes ?? 4096;
  const blockCount = p.meta?.blockCount ?? Math.floor(p.size / blockSize);

  let usedBlocks = 2; // superblock
  function walk(node: LittlefsTreeNode) {
    if (node.isDirectory) {
      usedBlocks += 1;
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    } else if (node.size !== undefined) {
      // Inline files are <= blockSize/8 usually in littlefs, but to be safe let's assume
      // files larger than blockSize / 4 consume block(s).
      if (node.size > blockSize / 4) {
        usedBlocks += Math.ceil(node.size / blockSize);
      }
    }
  }
  walk(tree);

  const usedBytes = usedBlocks * blockSize;
  const freeBytes = (blockCount * blockSize) - usedBytes;
  return { 
    usedBytes: Math.min(usedBytes, p.size), 
    freeBytes: Math.max(0, freeBytes) 
  };
}
