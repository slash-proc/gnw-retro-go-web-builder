// Electron shell. The renderer gets a stable secure origin and a capability-based filesystem
// bridge; it never receives Node integration or arbitrary absolute-path file operations.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, writeFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { rendererSourceFingerprint } = require("./build-contract.js");

protocol.registerSchemesAsPrivileged([
  { scheme: "gnw", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const WEB_ROOT = process.env.GNW_WEB_ROOT || path.join(__dirname, "..", "build", "web");
const ROOTS_FILE = path.join(app.getPath("userData"), "authorized-directories.json");
const roots = new Map();

function trustedSender(event) {
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === "gnw:" && url.host === "app";
  } catch { return false; }
}

function registerIpc(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error("Untrusted filesystem request");
    return handler(...args);
  });
}

async function saveRoots() {
  await mkdir(path.dirname(ROOTS_FILE), { recursive: true });
  const tmp = `${ROOTS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify([...roots.entries()]));
  await rename(tmp, ROOTS_FILE);
}

async function loadRoots() {
  try {
    const saved = JSON.parse(await readFile(ROOTS_FILE, "utf8"));
    for (const [id, root] of saved) {
      if (typeof id === "string" && typeof root?.path === "string" && typeof root?.name === "string") {
        roots.set(id, { path: root.path, name: root.name });
      }
    }
  } catch { /* first launch or unavailable profile storage */ }
}

async function registerRoot(directory) {
  const canonical = await realpath(directory);
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Selected path is not a real directory");
  for (const [rootId, root] of roots) {
    if (root.path === canonical) return { rootId, name: root.name };
  }
  const rootId = randomUUID();
  const name = path.basename(canonical) || canonical;
  roots.set(rootId, { path: canonical, name });
  await saveRoots();
  return { rootId, name };
}

function rootFor(rootId) {
  const root = roots.get(rootId);
  if (!root) throw new Error("This folder is no longer registered; select it again");
  return root;
}

function relativeParts(relativePath) {
  if (typeof relativePath !== "string") throw new Error("Invalid relative path");
  if (!relativePath) return [];
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) {
    throw new Error("Invalid relative path");
  }
  return parts;
}

// Refuse symlinks at every component so a crafted renderer request cannot escape a picked root.
async function resolveExisting(rootId, relativePath, expected) {
  const root = rootFor(rootId);
  const rootInfo = await lstat(root.path);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Selected folder is no longer a real directory");
  const parts = relativeParts(relativePath);
  let current = root.path;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Symbolic links are not followed");
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error("Path component is not a directory");
  }
  if (expected === "directory" && parts.length > 0 && !(await lstat(current)).isDirectory()) throw new Error("Not a directory");
  if (expected === "file" && parts.length > 0 && !(await lstat(current)).isFile()) throw new Error("Not a regular file");
  return { path: current, root };
}

async function resolveForWrite(rootId, relativePath, createParents = false) {
  const parts = relativeParts(relativePath);
  if (parts.length === 0) throw new Error("Cannot replace the selected directory");
  const { root } = rootFor(rootId);
  const rootInfo = await lstat(root.path);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Selected folder is no longer a real directory");
  let current = root.path;
  const directoryParts = createParents ? parts : parts.slice(0, -1);
  for (const part of directoryParts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Invalid path component");
    } catch (error) {
      if (error.code !== "ENOENT" || !createParents) throw error;
      await mkdir(current);
    }
  }
  if (!createParents) {
    const target = path.join(current, parts[parts.length - 1]);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Invalid file target");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return target;
  }
  return current;
}

registerIpc("gnw:pick-directory", async (id) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: typeof id === "string" ? id : "Choose folder",
  });
  return result.canceled || !result.filePaths[0] ? null : registerRoot(result.filePaths[0]);
});
registerIpc("gnw:adopt-legacy-directory", async (directory) => {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) return null;
  try { return await registerRoot(directory); } catch { return null; }
});
registerIpc("gnw:read-directory", async (rootId, relativePath) => {
  const { path: directory } = await resolveExisting(rootId, relativePath, "directory");
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) continue;
    if (entry.isFile()) {
      const info = await lstat(path.join(directory, entry.name));
      result.push({ name: entry.name, kind: "file", size: info.size, lastModified: info.mtimeMs });
    } else result.push({ name: entry.name, kind: "directory" });
  }
  return result;
});
registerIpc("gnw:read-file", async (rootId, relativePath) => {
  const { path: file } = await resolveExisting(rootId, relativePath, "file");
  return new Uint8Array(await readFile(file));
});
registerIpc("gnw:read-file-range", async (rootId, relativePath, offset, length) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new Error("Invalid file range");
  }
  const { path: file } = await resolveExisting(rootId, relativePath, "file");
  const info = await lstat(file);
  const bytesToRead = Math.min(length, Math.max(0, info.size - offset));
  const output = Buffer.alloc(bytesToRead);
  const handle = await open(file, "r");
  try {
    const { bytesRead } = await handle.read(output, 0, bytesToRead, offset);
    return new Uint8Array(output.buffer, output.byteOffset, bytesRead);
  } finally {
    await handle.close();
  }
});
registerIpc("gnw:stat-file", async (rootId, relativePath) => {
  const { path: file } = await resolveExisting(rootId, relativePath, "file");
  const info = await lstat(file);
  return { size: info.size, lastModified: info.mtimeMs };
});
registerIpc("gnw:write-file", async (rootId, relativePath, bytes) => {
  const file = await resolveForWrite(rootId, relativePath);
  await writeFile(file, Buffer.from(bytes));
});
registerIpc("gnw:make-directory", async (rootId, relativePath) => {
  await resolveForWrite(rootId, relativePath, true);
});
registerIpc("gnw:remove-entry", async (rootId, relativePath) => {
  const { path: entry } = await resolveExisting(rootId, relativePath, "any");
  if (entry === rootFor(rootId).path) throw new Error("Cannot remove the selected directory");
  await rm(entry, { recursive: true, force: false });
});
registerIpc("gnw:scan-directory", async (rootId) => {
  const { root } = await resolveExisting(rootId, "", "directory");
  const clock = () => Number(process.hrtime.bigint()) / 1e6;
  const started = clock();
  const scanId = randomUUID().slice(0, 8);
  const found = [];
  const pending = [{ absolute: root.path, relative: "" }];
  let directories = 0;
  let visited = 0;
  let lstatMs = 0;
  let readdirMs = 0;
  let nextReport = 1000;
  console.info(`[gnw:scan ${scanId}] start root=${root.name}`);
  while (pending.length) {
    const directory = pending.pop();
    const readStarted = clock();
    const entries = await readdir(directory.absolute, { withFileTypes: true });
    readdirMs += clock() - readStarted;
    directories++;
    // Bound concurrency so a large flat ROM folder doesn't allocate one promise per entry or
    // serialize thousands of metadata syscalls through the main process.
    for (let offset = 0; offset < entries.length; offset += 128) {
      const batch = entries.slice(offset, offset + 128).filter((entry) =>
        !entry.name.startsWith(".") && (entry.isDirectory() || entry.isFile()),
      );
      const metadata = await Promise.all(batch.map(async (entry) => {
        const absolute = path.join(directory.absolute, entry.name);
        const relative = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
        const statStarted = clock();
        try {
          const info = await lstat(absolute);
          return { absolute, relative, info };
        } finally {
          lstatMs += clock() - statStarted;
        }
      }));
      for (const { absolute, relative, info } of metadata) {
        visited++;
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) pending.push({ absolute, relative });
        else if (info.isFile()) found.push({ path: relative, size: info.size, lastModified: info.mtimeMs });
      }
      if (visited >= nextReport) {
        console.info(`[gnw:scan ${scanId}] progress files=${found.length} entries=${visited} dirs=${directories} elapsed=${Math.round(clock() - started)}ms`);
        nextReport = (Math.floor(visited / 1000) + 1) * 1000;
      }
    }
  }
  console.info(`[gnw:scan ${scanId}] done files=${found.length} entries=${visited} dirs=${directories} elapsed=${Math.round(clock() - started)}ms readdir=${Math.round(readdirMs)}ms lstat=${Math.round(lstatMs)}ms`);
  return found;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: "#f4f4f4", show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL("gnw://app/index.html");
  return win;
}

app.whenReady().then(async () => {
  if (!app.isPackaged) {
    const manifestPath = path.join(WEB_ROOT, "desktop-build.json");
    let builtFingerprint = null;
    try { builtFingerprint = JSON.parse(await readFile(manifestPath, "utf8")).rendererSourceFingerprint; }
    catch { /* report below */ }
    const currentFingerprint = rendererSourceFingerprint(path.resolve(__dirname, "..", ".."));
    if (builtFingerprint !== currentFingerprint) {
      const message = "The Electron renderer is missing or out of date. Launch it with `npm run dev` from desktop/ to rebuild it with Docker.";
      console.error(`[gnw] ${message}`);
      await dialog.showMessageBox({ type: "error", title: "Electron build is out of date", message });
      app.quit();
      return;
    }
  }
  await loadRoots();
  protocol.handle("gnw", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    // The renderer's dev-only debug sink is intentionally absent from the packaged app.
    if (relative === "api/debug") return new Response(null, { status: 204 });
    const root = path.resolve(WEB_ROOT);
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return new Response("Not found", { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(file).toString());
      if (!response.ok) console.warn(`[gnw] asset response ${response.status}: ${request.url} -> ${file}`);
      return response;
    } catch (error) {
      console.error(`[gnw] asset fetch failed: ${request.url} -> ${file}`, error);
      return new Response("Not found", { status: 404 });
    }
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === "usb" && requestingOrigin === "gnw://app",
  );
  session.defaultSession.setDevicePermissionHandler((details) => details.origin === "gnw://app");
  session.defaultSession.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const devices = details.deviceList ?? [];
    if (devices.length === 0) { callback(); return; }
    const labels = devices.map((device) => {
      const name = device.productName || device.manufacturerName || "USB device";
      return `${name} (VID ${device.vendorId.toString(16).padStart(4, "0")}, PID ${device.productId.toString(16).padStart(4, "0")})`;
    });
    const owner = BrowserWindow.getAllWindows()[0];
    void dialog.showMessageBox(owner, {
      type: "question", title: "Select debug adapter", message: "Choose the WebUSB adapter to use.",
      buttons: [...labels, "Cancel"], cancelId: labels.length, defaultId: 0,
    }).then(({ response }) => callback(response < devices.length ? devices[response].deviceId : undefined));
  });

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
