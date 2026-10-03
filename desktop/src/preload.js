const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gnwDesktopFs", Object.freeze({
  pickDirectory: (id) => ipcRenderer.invoke("gnw:pick-directory", id),
  adoptLegacyDirectory: (path) => ipcRenderer.invoke("gnw:adopt-legacy-directory", path),
  readDirectory: (rootId, relativePath) => ipcRenderer.invoke("gnw:read-directory", rootId, relativePath),
  readFile: (rootId, relativePath) => ipcRenderer.invoke("gnw:read-file", rootId, relativePath),
  readFileRange: (rootId, relativePath, offset, length) => ipcRenderer.invoke("gnw:read-file-range", rootId, relativePath, offset, length),
  statFile: (rootId, relativePath) => ipcRenderer.invoke("gnw:stat-file", rootId, relativePath),
  writeFile: (rootId, relativePath, bytes) => ipcRenderer.invoke("gnw:write-file", rootId, relativePath, bytes),
  makeDirectory: (rootId, relativePath) => ipcRenderer.invoke("gnw:make-directory", rootId, relativePath),
  removeEntry: (rootId, relativePath) => ipcRenderer.invoke("gnw:remove-entry", rootId, relativePath),
  scanDirectory: (rootId) => ipcRenderer.invoke("gnw:scan-directory", rootId),
}));
