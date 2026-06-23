// LittleFS image builder/reader (browser + node), backed by the vendored
// littlefs v2.11 compiled to WASM. Produces a standalone image (block 0 first);
// the gnw-flasher LFS binding maps blocks to the device's end-of-flash partition
// when writing it. See docs/LITTLEFS.md.
import createLittlefs from "../vendor/littlefs-wasm/littlefs.mjs";

export interface LittlefsModuleOpts {
  /** Browser: locate the .wasm (e.g. a Vite `?url` import). */
  locateFile?: (path: string) => string;
}

export class LittleFsError extends Error {
  constructor(public readonly code: number | string) {
    super(typeof code === "number" ? `littlefs error ${code}` : code);
    this.name = "LittleFsError";
  }
}

async function getModule(opts?: LittlefsModuleOpts): Promise<LittlefsModule> {
  return createLittlefs(opts?.locateFile ? { locateFile: opts.locateFile } : {});
}

function withCStr<T>(M: LittlefsModule, s: string, fn: (ptr: number) => T): T {
  const len = M.lengthBytesUTF8(s) + 1;
  const ptr = M._malloc(len);
  try {
    M.stringToUTF8(s, ptr, len);
    return fn(ptr);
  } finally {
    M._free(ptr);
  }
}

const check = (code: number): void => {
  if (code < 0) throw new LittleFsError(code);
};

/**
 * Build a LittleFS image in memory. Block layout matches a stock littlefs image
 * (block 0 at offset 0); `blockSize` should be the device's flash erase size,
 * `blockCount` = partition bytes / blockSize.
 */
export class LittleFsImage {
  private constructor(
    private readonly M: LittlefsModule,
    private readonly blockSize: number,
    private readonly blockCount: number,
  ) {}

  static async create(blockSize: number, blockCount: number, opts?: LittlefsModuleOpts): Promise<LittleFsImage> {
    const M = await getModule(opts);
    console.log("lfs_w_create", blockSize, blockCount, "total bytes =", blockSize * blockCount);
    const res = M._lfs_w_create(blockSize, blockCount);
    if (res < 0) console.error("lfs_w_create failed:", res);
    check(res);
    return new LittleFsImage(M, blockSize, blockCount);
  }

  /** Create a directory (and is a no-op if it already exists). */
  mkdir(path: string): void {
    console.log("mkdir", path);
    const res = withCStr(this.M, path, (p) => this.M._lfs_w_mkdir(p));
    if (res < 0) console.error("mkdir failed:", res);
    check(res);
  }

  /** Create/overwrite a file with the given bytes. */
  writeFile(path: string, data: Uint8Array): void {
    console.log("writeFile", path, data.length, "bytes");
    const M = this.M;
    const dptr = M._malloc(data.length || 1);
    try {
      M.HEAPU8.set(data, dptr);
      const res = withCStr(M, path, (p) => M._lfs_w_write(p, dptr, data.length));
      if (res < 0) console.error("writeFile failed:", res);
      check(res);
    } finally {
      M._free(dptr);
    }
  }

  /** List the contents of a directory. */
  listDir(path: string): LittlefsDirEntry[] {
    check(withCStr(this.M, path, (p) => this.M._lfs_w_listdir(p)));
    const dptr = this.M._lfs_w_dirdata();
    let str = "";
    let i = 0;
    while (this.M.HEAPU8[dptr + i] !== 0) {
      str += String.fromCharCode(this.M.HEAPU8[dptr + i]);
      i++;
    }

    const entries: LittlefsDirEntry[] = [];
    if (str.length > 0) {
      for (const line of str.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split(":");
        entries.push({
          type: parseInt(parts[0], 10) as 1 | 2,
          size: parseInt(parts[1], 10),
          name: parts.slice(2).join(":"),
        });
      }
    }
    return entries;
  }

  /** Unmount and return the finished image bytes. */
  finish(): Uint8Array {
    check(this.M._lfs_w_unmount());
    const ptr = this.M._lfs_w_image();
    const size = this.M._lfs_w_image_size();
    return this.M.HEAPU8.slice(ptr, ptr + size);
  }
}

/** Mount an existing image and read a file — used for round-trip validation. */
export async function readFileFromImage(
  img: Uint8Array,
  blockSize: number,
  blockCount: number,
  path: string,
  opts?: LittlefsModuleOpts,
): Promise<Uint8Array> {
  const M = await getModule(opts);
  const iptr = M._malloc(img.length);
  try {
    M.HEAPU8.set(img, iptr);
    check(M._lfs_w_mount(iptr, blockSize, blockCount));
  } finally {
    M._free(iptr);
  }
  const len = withCStr(M, path, (p) => M._lfs_w_read(p));
  check(len);
  const dptr = M._lfs_w_filedata();
  const out = M.HEAPU8.slice(dptr, dptr + len);
  M._lfs_w_unmount();
  return out;
}

export interface LittlefsDirEntry {
  type: 1 | 2; // 1 = REG, 2 = DIR
  size: number;
  name: string;
}

export async function listDirFromImage(
  img: Uint8Array,
  blockSize: number,
  blockCount: number,
  path: string,
  opts?: LittlefsModuleOpts,
): Promise<LittlefsDirEntry[]> {
  const M = await getModule(opts);
  const iptr = M._malloc(img.length);
  try {
    M.HEAPU8.set(img, iptr);
    check(M._lfs_w_mount(iptr, blockSize, blockCount));
  } finally {
    M._free(iptr);
  }
  check(withCStr(M, path, (p) => M._lfs_w_listdir(p)));
  const dptr = M._lfs_w_dirdata();
  let str = "";
  let i = 0;
  while (M.HEAPU8[dptr + i] !== 0) {
    str += String.fromCharCode(M.HEAPU8[dptr + i]);
    i++;
  }
  M._lfs_w_unmount();

  const entries: LittlefsDirEntry[] = [];
  if (str.length > 0) {
    for (const line of str.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split(":");
      entries.push({
        type: parseInt(parts[0], 10) as 1 | 2,
        size: parseInt(parts[1], 10),
        name: parts.slice(2).join(":"),
      });
    }
  }
  return entries;
}

export interface LittlefsTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: LittlefsTreeNode[];
}

export async function readLittleFsTree(
  blockSize: number,
  blockCount: number,
  fetchBlock: (block: number) => Promise<Uint8Array>,
  opts?: LittlefsModuleOpts,
): Promise<LittlefsTreeNode> {
  const M = await getModule(opts);

  check(M._lfs_w_init(blockSize, blockCount));

  let lastMissing = -1;

  while (true) {
    const err = M._lfs_w_mount_retry();
    if (err < 0) {
      const missing = M._lfs_w_missing_block();
      if (missing >= 0) {
        if (missing === lastMissing) throw new LittleFsError(`Infinite loop detected on block ${missing}`);
        lastMissing = missing;
        if (missing >= blockCount) throw new LittleFsError(`Requested block ${missing} out of bounds (${blockCount})`);
        
        const data = await fetchBlock(missing);
        if (data.length !== blockSize) throw new LittleFsError("Fetched block size mismatch.");
        const iptr = M._lfs_w_image() + (missing * blockSize);
        M.HEAPU8.set(data, iptr);
        M._lfs_w_mark_loaded(missing);
        continue;
      }
      check(err);
    }
    break;
  }

  async function walk(path: string, name: string): Promise<LittlefsTreeNode> {
    const node: LittlefsTreeNode = { name, path, isDirectory: true, children: [] };
    
    let dirLastMissing = -1;
    // Restartable directory listing
    while (true) {
      const err = withCStr(M, path, (p) => M._lfs_w_listdir(p));
      if (err < 0) {
        const missing = M._lfs_w_missing_block();
        if (missing >= 0) {
          if (missing === dirLastMissing) throw new LittleFsError(`Infinite loop detected in listdir on block ${missing}`);
          dirLastMissing = missing;
          if (missing >= blockCount) throw new LittleFsError(`Requested block ${missing} out of bounds (${blockCount})`);
          
          const data = await fetchBlock(missing);
          if (data.length !== blockSize) throw new LittleFsError("Fetched block size mismatch.");
          const iptr = M._lfs_w_image() + (missing * blockSize);
          M.HEAPU8.set(data, iptr);
          M._lfs_w_mark_loaded(missing);
          continue; // retry
        }
        check(err);
      }
      break;
    }

    const dptr = M._lfs_w_dirdata();
    let str = "";
    let i = 0;
    while (M.HEAPU8[dptr + i] !== 0) {
      str += String.fromCharCode(M.HEAPU8[dptr + i]);
      i++;
    }
    
    if (str.length > 0) {
      for (const line of str.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split(":");
        const type = parseInt(parts[0], 10);
        const size = parseInt(parts[1], 10);
        const cname = parts.slice(2).join(":");
        
        const childPath = path === "/" ? `/${cname}` : `${path}/${cname}`;
        if (type === 2) {
          node.children!.push(await walk(childPath, cname));
        } else {
          node.children!.push({ name: cname, path: childPath, isDirectory: false, size });
        }
      }
    }
    return node;
  }

  const root = await walk("/", "");
  M._lfs_w_unmount();
  return root;
}

export async function readLittleFsDir(
  blockSize: number,
  blockCount: number,
  path: string,
  fetchBlock: (block: number) => Promise<Uint8Array>,
  opts?: LittlefsModuleOpts,
): Promise<LittlefsTreeNode[]> {
  const M = await getModule(opts);

  check(M._lfs_w_init(blockSize, blockCount));

  const fetchedBlocks = new Set<number>();

  while (true) {
    const err = M._lfs_w_mount_retry();
    if (err < 0) {
      const missing = M._lfs_w_missing_block();
      if (missing >= 0) {
        if (fetchedBlocks.has(missing)) throw new LittleFsError(`Infinite loop detected on mount block ${missing}`);
        fetchedBlocks.add(missing);
        if (missing >= blockCount) throw new LittleFsError(`Requested block ${missing} out of bounds (${blockCount})`);
        
        const data = await fetchBlock(missing);
        if (data.length !== blockSize) throw new LittleFsError("Fetched block size mismatch.");
        const iptr = M._lfs_w_image() + (missing * blockSize);
        M.HEAPU8.set(data, iptr);
        M._lfs_w_mark_loaded(missing);
        continue;
      }
      check(err);
    }
    break;
  }

  while (true) {
    const err = withCStr(M, path, (p) => M._lfs_w_listdir(p));
    if (err < 0) {
      const missing = M._lfs_w_missing_block();
      if (missing >= 0) {
        if (fetchedBlocks.has(missing)) throw new LittleFsError(`Infinite loop detected in listdir on block ${missing}`);
        fetchedBlocks.add(missing);
        if (missing >= blockCount) throw new LittleFsError(`Requested block ${missing} out of bounds (${blockCount})`);
        
        const data = await fetchBlock(missing);
        if (data.length !== blockSize) throw new LittleFsError("Fetched block size mismatch.");
        const iptr = M._lfs_w_image() + (missing * blockSize);
        M.HEAPU8.set(data, iptr);
        M._lfs_w_mark_loaded(missing);
        continue;
      }
      check(err);
    }
    break;
  }

  const dptr = M._lfs_w_dirdata();
  let str = "";
  let i = 0;
  while (M.HEAPU8[dptr + i] !== 0) {
    str += String.fromCharCode(M.HEAPU8[dptr + i]);
    i++;
  }

  const children: LittlefsTreeNode[] = [];
  if (str.length > 0) {
    for (const line of str.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split(":");
      const type = parseInt(parts[0], 10);
      const size = parseInt(parts[1], 10);
      const cname = parts.slice(2).join(":");
      
      const childPath = path === "/" ? `/${cname}` : `${path}/${cname}`;
      children.push({
        name: cname,
        path: childPath,
        isDirectory: type === 2,
        size: type === 1 ? size : undefined,
      });
    }
  }

  M._lfs_w_unmount();
  return children;
}
