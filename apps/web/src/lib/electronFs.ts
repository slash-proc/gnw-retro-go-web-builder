/** Electron's path-backed implementation of the directory handle used by the web app. */
export interface ElectronFsApi {
  pickDirectory(id?: string): Promise<{ rootId: string; name: string } | null>;
  adoptLegacyDirectory(path: string): Promise<{ rootId: string; name: string } | null>;
  readDirectory(rootId: string, relativePath: string): Promise<Array<{
    name: string; kind: "file" | "directory"; size?: number; lastModified?: number;
  }>>;
  readFile(rootId: string, relativePath: string): Promise<Uint8Array>;
  readFileRange(rootId: string, relativePath: string, offset: number, length: number): Promise<Uint8Array>;
  statFile(rootId: string, relativePath: string): Promise<{ size: number; lastModified: number }>;
  writeFile(rootId: string, relativePath: string, bytes: Uint8Array): Promise<void>;
  makeDirectory(rootId: string, relativePath: string): Promise<void>;
  removeEntry(rootId: string, relativePath: string): Promise<void>;
  scanDirectory(rootId: string): Promise<Array<{ path: string; size: number; lastModified: number }>>;
}

declare global {
  interface Window { gnwDesktopFs?: ElectronFsApi; }
}

export const electronFs = (): ElectronFsApi | null =>
  typeof window !== "undefined" ? window.gnwDesktopFs ?? null : null;

export interface ElectronDirectoryMarker {
  __gnwElectronRootId: string;
  __gnwElectronName: string;
}

const join = (base: string, name: string): string => base ? `${base}/${name}` : name;

export function electronDirHandle(rootId: string, name: string): any {
  const api = electronFs();
  if (!api) throw new Error("Electron filesystem bridge unavailable");
  const path = "";
  return {
    kind: "directory", name, writable: true,
    __gnwElectronRootId: rootId, __gnwElectronName: name, __gnwElectronRelativePath: "",
    async *entries() {
      for (const entry of await api.readDirectory(rootId, path)) {
        const relativePath = join(path, entry.name);
        yield [entry.name, entry.kind === "directory"
          ? electronChildDirectory(rootId, name, relativePath)
          : electronFileHandle(rootId, relativePath, entry.name, entry.size ?? 0, entry.lastModified ?? 0)];
      }
    },
    async getDirectoryHandle(child: string, opts: { create?: boolean } = {}) {
      const relativePath = join(path, child);
      if (opts.create) await api.makeDirectory(rootId, relativePath);
      return electronChildDirectory(rootId, name, relativePath);
    },
    async getFileHandle(child: string, opts: { create?: boolean } = {}) {
      const relativePath = join(path, child);
      if (opts.create) {
        try { await api.readFile(rootId, relativePath); }
        catch { await api.writeFile(rootId, relativePath, new Uint8Array()); }
      }
      return electronFileHandle(rootId, relativePath, child, 0, 0);
    },
    async removeEntry(child: string) { await api.removeEntry(rootId, child); },
    async isSameEntry(other: unknown) {
      const candidate = other as (ElectronDirectoryMarker & { __gnwElectronRelativePath?: string }) | null;
      return candidate?.__gnwElectronRootId === rootId && (candidate.__gnwElectronRelativePath ?? "") === "";
    },
    async resolve(other: unknown) {
      const candidate = other as (ElectronDirectoryMarker & { __gnwElectronRelativePath?: string }) | null;
      if (!candidate || candidate.__gnwElectronRootId !== rootId) return null;
      return (candidate.__gnwElectronRelativePath ?? "").split("/").filter(Boolean);
    },
  };
}

function electronChildDirectory(rootId: string, rootName: string, relativePath: string): any {
  const api = electronFs()!;
  const name = relativePath.split("/").pop() || rootName;
  const marker = { __gnwElectronRootId: rootId, __gnwElectronName: rootName };
  return {
    kind: "directory", name, writable: true, ...marker,
    async *entries() {
      for (const entry of await api.readDirectory(rootId, relativePath)) {
        const childPath = join(relativePath, entry.name);
        yield [entry.name, entry.kind === "directory"
          ? electronChildDirectory(rootId, rootName, childPath)
          : electronFileHandle(rootId, childPath, entry.name, entry.size ?? 0, entry.lastModified ?? 0)];
      }
    },
    async getDirectoryHandle(child: string, opts: { create?: boolean } = {}) {
      const childPath = join(relativePath, child);
      if (opts.create) await api.makeDirectory(rootId, childPath);
      return electronChildDirectory(rootId, rootName, childPath);
    },
    async getFileHandle(child: string, opts: { create?: boolean } = {}) {
      const childPath = join(relativePath, child);
      if (opts.create) {
        try { await api.readFile(rootId, childPath); }
        catch { await api.writeFile(rootId, childPath, new Uint8Array()); }
      }
      return electronFileHandle(rootId, childPath, child, 0, 0);
    },
    async removeEntry(child: string) { await api.removeEntry(rootId, join(relativePath, child)); },
    async isSameEntry(other: unknown) {
      const candidate = other as (ElectronDirectoryMarker & { __gnwElectronRelativePath?: string }) | null;
      return candidate?.__gnwElectronRootId === rootId && candidate.__gnwElectronRelativePath === relativePath;
    },
    async resolve(other: unknown) {
      const candidate = other as (ElectronDirectoryMarker & { __gnwElectronRelativePath?: string }) | null;
      if (!candidate || candidate.__gnwElectronRootId !== rootId) return null;
      const childPath = candidate.__gnwElectronRelativePath ?? "";
      if (!childPath.startsWith(relativePath ? `${relativePath}/` : "")) return null;
      return childPath.slice(relativePath.length).split("/").filter(Boolean);
    },
    __gnwElectronRelativePath: relativePath,
  };
}

function electronFileHandle(rootId: string, relativePath: string, name: string, size: number, lastModified: number): any {
  const api = electronFs()!;
  return {
    kind: "file", name, size, lastModified,
    __gnwElectronRootId: rootId, __gnwElectronRelativePath: relativePath,
    async getFileMetadata() {
      if (size !== 0 || lastModified !== 0) return { size, lastModified };
      try { return await api.statFile(rootId, relativePath); }
      catch { return { size, lastModified }; }
    },
    async getFile() {
      const metadata = await this.getFileMetadata();
      const fileSize = metadata.size;
      const modified = metadata.lastModified;
      const readRange = async (offset: number, length: number): Promise<ArrayBuffer> => {
        const bytes = await api.readFileRange(rootId, relativePath, offset, length);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      };
      // Keep the File surface used by the scanner, but defer payload reads. ZIP inspection
      // calls slice() for the central directory and should transfer only that small range;
      // ROM bytes are read in full later, when the user actually selects one.
      return {
        name,
        size: fileSize,
        lastModified: modified,
        async arrayBuffer() { return readRange(0, fileSize); },
        slice(start = 0, end = fileSize) {
          const clamp = (index: number, fallback: number) => {
            const value = Number.isFinite(index) ? Math.trunc(index) : fallback;
            return value < 0 ? Math.max(fileSize + value, 0) : Math.min(value, fileSize);
          };
          const from = clamp(start, 0);
          const to = Math.max(from, clamp(end, fileSize));
          return { size: to - from, arrayBuffer: () => readRange(from, to - from) };
        },
      } as File;
    },
    async createWritable() {
      let bytes = new Uint8Array();
      return {
        async write(value: BufferSource | Blob) {
          if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
          else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
          else bytes = Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        },
        async close() { await api.writeFile(rootId, relativePath, bytes); },
      };
    },
  };
}

export function isElectronDirectoryMarker(value: unknown): value is ElectronDirectoryMarker {
  const marker = value as ElectronDirectoryMarker | null;
  return !!marker && typeof marker.__gnwElectronRootId === "string" && typeof marker.__gnwElectronName === "string";
}
