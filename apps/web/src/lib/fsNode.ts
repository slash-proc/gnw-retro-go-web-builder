/**
 * A node-backed `FsDirHandle`: the third implementation of the directory-handle seam.
 *
 * The app reads a user's folders through a deliberately small interface (`romScan.ts`'s
 * `FsDirHandle`/`FsFileHandle`) that already has two implementations — native File System
 * Access handles in Chromium, and `InputDirHandle`, the read-only `<input webkitdirectory>`
 * shim used on Firefox and Safari. This is the same shape over a real path, which is what a
 * desktop build needs: no picker, no permission that can lapse, no shim that cannot write.
 *
 * WHY IT NEEDS NO DEPENDENCY. `getFile()` must return a `File`, which reads as a DOM type but
 * has been a Node global since v20 (`node:buffer`), carrying the `name`, `size` and
 * `arrayBuffer()` the consumers use. So the interface is satisfiable exactly, with nothing
 * installed. See `docs/ELECTRON.md`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It reads a whole file into memory in `getFile()`, because
 * that is what the interface promises and what `walk()` already does to every file it visits.
 * That is the honest cost of matching the browser today, not a limit of the platform, and
 * `docs/ELECTRON.md` records it as the first thing worth changing once the seam is shared.
 *
 * PURE AND BROWSER-FREE: it imports only `node:fs/promises` and `node:path`, so it is safe to
 * load in a main process or a test and never reachable from the Vite bundle, which has no
 * importer for it.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

/** The read side of the seam, structurally identical to `romScan.ts`'s private interface. */
export interface NodeFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

export interface NodeDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, NodeDirHandle | NodeFileHandle]>;
  /** Real paths are writable; the browser's read-only shim is the exception, not this. */
  readonly writable?: boolean;
}

class NodeFile implements NodeFileHandle {
  readonly kind = "file" as const;
  /** Test/node shim already owns the bytes; romScan may keep its historical eager semantics. */
  readonly eager = true;
  readonly name: string;
  constructor(private readonly path: string) {
    this.name = basename(path);
  }

  async getFile(): Promise<File> {
    const bytes = await readFile(this.path);
    const info = await stat(this.path);
    // `File` is a Node global from v20. `lastModified` is milliseconds, as in the browser.
    return new File([new Uint8Array(bytes)], this.name, { lastModified: info.mtimeMs });
  }
}

class NodeDir implements NodeDirHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly writable = true;
  constructor(private readonly path: string) {
    this.name = basename(path);
  }

  async *entries(): AsyncIterableIterator<[string, NodeDirHandle | NodeFileHandle]> {
    // `withFileTypes` avoids a stat per entry. A symlink reports as neither file nor directory,
    // so it is skipped rather than followed: a loop in a user's ROM folder must not hang a scan.
    const found = await readdir(this.path, { withFileTypes: true });
    // Directory order is filesystem-dependent; sorting makes a scan reproducible across
    // machines, which is what lets a test compare two implementations byte for byte.
    found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of found) {
      const full = join(this.path, entry.name);
      if (entry.isDirectory()) yield [entry.name, new NodeDir(full)];
      else if (entry.isFile()) yield [entry.name, new NodeFile(full)];
    }
  }
}

/** A directory handle over a real path, consumable by everything that takes an `FsDirHandle`. */
export function nodeDirHandle(path: string): NodeDirHandle {
  return new NodeDir(path);
}
