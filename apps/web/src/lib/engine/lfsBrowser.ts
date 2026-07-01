import { device } from "../device.svelte.js";
import { readLittleFsTree, readLittleFsFileLazy, type LittlefsTreeNode } from "@gnw/fs-builders";

export async function ensureLfsTree(onProgress?: (p: number) => void): Promise<LittlefsTreeNode> {
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
    
    const addr = 0x90000000 + p.offset + p.size - ((block + 1) * blockSize);
    const data = await device.transport!.readMemory(addr, blockSize);
    device.lfsBlockCache.set(block, data);
    
    blocksFetched++;
    if (onProgress) onProgress(Math.min(0.99, blocksFetched / 20));
    return data;
  });
  
  if (onProgress) onProgress(1);

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
    
    const addr = 0x90000000 + p.offset + p.size - ((block + 1) * blockSize);
    const data = await device.transport!.readMemory(addr, blockSize);
    device.lfsBlockCache.set(block, data);
    return data;
  });
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
