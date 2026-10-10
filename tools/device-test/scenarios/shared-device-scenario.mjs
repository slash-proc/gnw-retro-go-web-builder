import { expect } from "../fixtures.mjs";
import { createServer } from "node:http";
import { appendFile, mkdir, readdir, stat, lstat, open, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ppmToPng } from "../device.mjs";
import { openDirectorySources, addDirectorySource as addDirectoryViaUi } from "../workflows/sources.mjs";
import { returnToStockAndAssertUnlocked } from "../workflows/status.mjs";
import { chooseGuidedPath } from "../workflows/guided-setup.mjs";
import { waitForLibrarySettled, assertFullLibrary } from "../workflows/library.mjs";
import { backupLockedStock } from "../workflows/backup.mjs";
import { patchStockFirmware } from "../workflows/patch.mjs";
import { installPublishedRetroGo, syncLibraryItem } from "../workflows/retro-go.mjs";

// This scan produces large atlas/network activity. The test captures purpose-made PNGs at
// each phase; Playwright's continuous screencast trace duplicates those images and can exceed
// a gigabyte for no added diagnostic value.
const directories = JSON.parse(process.env.GNW_TEST_DIRECTORY_MAP || "[]");
const fullDirectoryScan = process.env.GNW_TEST_FULL_DIRECTORY_SCAN === "1";
const installE2E = process.env.GNW_TEST_INSTALL_E2E === "1";
const librarySyncE2E = process.env.GNW_TEST_LIBRARY_SYNC === "1";
const captureGwemuProfile = process.env.GNW_TEST_CAPTURE_GWEMU_PROFILE || null;
const pristineBackupE2E = process.env.GNW_TEST_PRISTINE_BACKUP === "1";
const backupUnlockOnly = process.env.GNW_TEST_BACKUP_UNLOCK_ONLY === "1";
const adapterEnabled = process.env.GNW_TEST_ADAPTER_ENABLED === "1";
const fullBrowserInstrumentation = process.env.GNW_TEST_BROWSER_INSTRUMENTATION === "full";
const profileName = process.env.GNW_TEST_PROFILE_NAME || null;
const roots = Object.fromEntries(directories.map((item) => [item.id, item.path]));
const rootNames = Object.fromEntries(directories.map((item) => [item.id, item.name]));
const rootGroupsById = Object.fromEntries(directories.map((item) => [item.id, item.group]));
const rootGroups = Object.fromEntries(["roms", "firmware_bios", "ofw_backups"].map((group) => [
  group,
  directories.filter((item) => item.group === group),
]));

function sourceServer() {
  const io = { rangeRequests: 0, rangeBytes: 0, fullReads: 0, fullBytes: 0, entries: 0,
    entryDirectories: [], romFilesByExtension: {}, romFilesByDirectory: {},
    zipEntriesListed: [], zipReads: [], rendererMemory: [] };
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // The browser File System Access API does not cache each file slice as an HTTP resource.
    // This read-only HTTP bridge only transports those bytes for the test, so don't let Chromium
    // retain hundreds of megabytes of synthetic range responses in its network cache.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/memory") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const sample = JSON.parse(body);
        io.rendererMemory.push(sample);
        if (io.rendererMemory.length > 90) io.rendererMemory.shift();
        if (fullBrowserInstrumentation && process.env.GNW_TEST_REPORT_DIR) {
          await appendFile(path.join(process.env.GNW_TEST_REPORT_DIR, "renderer-memory.jsonl"), JSON.stringify(sample) + "\n");
          if (sample.modalText || sample.installProgress) {
            await appendFile(path.join(process.env.GNW_TEST_REPORT_DIR, "ui-progress.jsonl"), JSON.stringify({
              at: sample.at,
              modalText: sample.modalText,
              visibleProgress: sample.visibleProgress,
              progress: sample.installProgress,
            }) + "\n");
          }
          if (sample.gdb) {
            const { recent, ...summary } = sample.gdb;
            await appendFile(path.join(process.env.GNW_TEST_REPORT_DIR, "gdb-transport.jsonl"),
              JSON.stringify({ at: sample.at, ...summary, recent }) + "\n");
          }
        }
        res.writeHead(204).end();
        return;
      }
      const rootId = url.searchParams.get("root");
      const group = rootGroupsById[rootId];
      const root = roots[rootId];
      if (!root) throw new Error("unknown source root");
      const relative = url.searchParams.get("path") || "";
      const target = path.resolve(root, relative);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error("path outside source root");
      if (url.pathname === "/write" && req.method === "POST") {
        if (!pristineBackupE2E || group !== "ofw_backups" || relative.includes(path.sep)
            || !/^(?:internal_flash_backup|flash_backup|itcm_backup|internal_flash_unverified)_(?:mario|zelda)\.bin$/.test(relative)) {
          throw new Error("backup writes are not allowed for this source");
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await writeFile(target, Buffer.concat(chunks));
        res.writeHead(204).end();
      } else if (url.pathname === "/entries") {
        if (io.entryDirectories.length < 5000) io.entryDirectories.push(`${group}:${relative}`);
        const rows = [];
        for (const item of await readdir(target, { withFileTypes: true })) {
          if (item.isSymbolicLink()) continue;
          if (!fullDirectoryScan) {
            // The default smoke mode exposes only the selected ROM and omits BIOS/OFW files.
            // An install-flow diagnostic still needs the real OFW backup pair, while it can
            // keep the ROM source narrowed to Tetris to avoid repeating the large library scan.
            if (group === "roms" && !relative && item.name !== "Game Boy") continue;
            if (group === "roms" && relative === "Game Boy" && item.name !== "Tetris.zip") continue;
            if (group !== "roms" && !installE2E) continue;
          }
          const child = path.join(target, item.name);
          const info = await stat(child);
          if (group === "roms" && item.isFile()) {
            const extension = path.extname(item.name).toLowerCase() || "<none>";
            io.romFilesByExtension[extension] = (io.romFilesByExtension[extension] || 0) + 1;
            const directory = relative || ".";
            const byDirectory = io.romFilesByDirectory[directory] || (io.romFilesByDirectory[directory] = {});
            byDirectory[extension] = (byDirectory[extension] || 0) + 1;
          }
          if (/\.zip$/i.test(item.name) && io.zipEntriesListed.length < 5000) {
            io.zipEntriesListed.push({ group, dir: relative, name: item.name });
          }
          rows.push({ name: item.name, kind: item.isDirectory() ? "directory" : "file", size: info.size, lastModified: info.mtimeMs });
          io.entries++;
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(rows));
      } else if (url.pathname === "/metadata") {
        const info = await lstat(target);
        if (info.isSymbolicLink()) throw new Error("symbolic links are not source files");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          name: path.basename(target),
          kind: info.isDirectory() ? "directory" : "file",
          size: info.size,
          lastModified: info.mtimeMs,
        }));
      } else if (url.pathname === "/file") {
        if (/\.zip$/i.test(relative) && io.zipReads.length < 5000) {
          io.zipReads.push({ group, path: relative, start: url.searchParams.get("start"), end: url.searchParams.get("end") });
        }
        const info = await stat(target);
        const hasRange = url.searchParams.has("start") || url.searchParams.has("end");
        const start = Math.max(0, Math.min(info.size, Number(url.searchParams.get("start") || 0)));
        const end = Math.max(start, Math.min(info.size, Number(url.searchParams.get("end") || info.size)));
        const length = end - start;
        const buffer = Buffer.allocUnsafe(length);
        const file = await open(target, "r");
        try {
          let offset = 0;
          while (offset < length) {
            const { bytesRead } = await file.read(buffer, offset, length - offset, start + offset);
            if (!bytesRead) break;
            offset += bytesRead;
          }
          const body = buffer.subarray(0, offset);
          if (hasRange) { io.rangeRequests++; io.rangeBytes += body.byteLength; }
          else { io.fullReads++; io.fullBytes += body.byteLength; }
          res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.byteLength }).end(body);
        } finally {
          await file.close();
        }
      } else {
        res.writeHead(404).end("not found");
      }
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(error.message);
    }
  });
  return new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve({
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    io,
  })));
}

async function checkpoint(page, testInfo, name) {
  const file = testInfo.outputPath(`${name}.png`);
  // The Library virtualizes thousands of ROMs with a tall spacer element. A full-page
  // screenshot rasterizes that virtual height (hundreds of thousands of pixels) and can
  // allocate more memory than the app itself. Capture the visible UI viewport instead.
  await page.screenshot({ path: file, timeout: 30_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

async function emulatorCheckpoint(device, testInfo, name) {
  if (!device.qmp) return;
  // Container QEMU writes through /out. A visible host GWemu instead needs the
  // host path to the report directory; Playwright reads that file via /reports.
  const hostScreenshotDir = process.env.GNW_TEST_QMP_HOST_SCREENSHOT_DIR;
  const sharedPpmPath = hostScreenshotDir
    ? path.join(hostScreenshotDir, `${name}.ppm`)
    : `/out/${name}.ppm`;
  const localPpmPath = path.join(process.env.GNW_TEST_REPORT_DIR || "/reports", `${name}.ppm`);
  const pngPath = testInfo.outputPath(`${name}.png`);
  let png;
  let lastError;
  // GWemu's QMP screendump may acknowledge before its host file is fully flushed,
  // especially while the emulated display is changing power state.
  for (let attempt = 0; attempt < 20; attempt++) {
    await device.qmp.screenshot(sharedPpmPath);
    try {
      png = ppmToPng(await readFile(localPpmPath));
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!png) throw lastError ?? new Error("GWemu screenshot was not ready");
  await writeFile(pngPath, png);
  await rm(localPpmPath);
  await testInfo.attach(name, { path: pngPath, contentType: "image/png" });
}

async function chromiumMemoryDump(cdp) {
  await cdp.send("Tracing.start", {
    categories: "disabled-by-default-memory-infra",
    options: "record-until-full",
    transferMode: "ReturnAsStream",
  });
  const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  const dump = await cdp.send("Tracing.requestMemoryDump", { levelOfDetail: "detailed" });
  await cdp.send("Tracing.end");
  const result = await Promise.race([
    complete,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Chromium memory dump timed out")), 10_000)),
  ]);
  const chunks = [];
  if (result.stream) {
    while (true) {
      const part = await cdp.send("IO.read", { handle: result.stream, size: 1_048_576 });
      if (part.data) chunks.push(part.data);
      if (part.eof) break;
    }
    await cdp.send("IO.close", { handle: result.stream });
  }
  return { success: dump.success, trace: chunks.join("") };
}

async function sourceRegistrySnapshot(page) {
  return await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const rows = JSON.parse(localStorage.getItem("gnw:sources.v1") || "[]");
    return {
      storageKeys: keys.filter((key) => key.startsWith("gnw:")),
      curatedSources: rows.map((row) => ({
        repo: row.repo,
        active: row.active,
        curated: row.curated,
        kind: row.card?.kind,
        systems: row.card?.systems?.map((system) => ({ id: system.id, folder: system.folder, extensions: system.extensions })) || [],
        status: row.status,
      })),
    };
  });
}

async function libraryDiagnostics(page) {
  return await page.evaluate(async () => {
    const [{ romSelection }, { coreRegistry }, model, registryModel] = await Promise.all([
      import("/src/lib/romSelection.svelte.js"),
      import("/src/lib/sources/coreRegistry.svelte.js"),
      import("/src/lib/romSelection.svelte.js"),
      import("/src/lib/sources/coreRegistry.js"),
    ]);
    const games = romSelection.games;
    return {
      visibleGameCount: games.length,
      gameBoyTetrisCandidates: games.filter((game) => game.system === "gb" && /tetris/i.test(game.key))
        .map(({ key, name }) => ({ key, name })),
      parsedGameBoyTetris: model.parseRomPath("Game Boy/Tetris (USA) (Rev-A).gb", coreRegistry.current),
      nativeArchiveRules: registryModel.nativeArchiveRulesFor(coreRegistry.current),
      visibleGameCountsBySystem: games.reduce((counts, game) => {
        counts[game.system] = (counts[game.system] || 0) + 1;
        return counts;
      }, {}),
      visibleGameBoyCount: games.filter((game) => game.system === "gb").length,
      registeredSystems: coreRegistry.current.systems.map((system) => ({
        id: system.id, folder: system.folder, longName: system.longName, shortName: system.shortName,
        installable: system.installable, ingestable: system.ingestable,
      })),
    };
  });
}

export async function runDeviceScenario({ page, device }, testInfo, scenarioTest) {
  let caughtTestError = null;
  if (directories.length === 0) throw new Error("No configured directory sources were mounted");
  const { server, url, io } = await sourceServer();
  const browserLog = [];
  const networkFailures = [];
  const postPatchConnectionBisect = { startedAt: null, milestones: [], stockReconnectSamples: [] };
  async function recordPostPatchConnectionMilestone(name) {
    const state = await page.evaluate(async () => {
      const bodyText = document.body.innerText.slice(0, 1200);
      const protectionRow = [...document.querySelectorAll(".rows .row")]
        .find((row) => row.querySelector("dt")?.innerText.includes("Read protection"));
      return {
        connectionLabel: bodyText.match(/Connected \([^)]+\)|Connection lost[^\n]*/)?.[0] ?? null,
        readProtection: protectionRow?.querySelector("dd")?.innerText.trim() ?? null,
        bodyText,
      };
    }).catch((error) => ({ captureError: String(error) }));
    const at = Date.now();
    if (postPatchConnectionBisect.startedAt === null) postPatchConnectionBisect.startedAt = at;
    postPatchConnectionBisect.milestones.push({ name, at, elapsedMs: at - postPatchConnectionBisect.startedAt, state });
    const details = JSON.stringify(postPatchConnectionBisect, null, 2) + "\n";
    if (process.env.GNW_TEST_REPORT_DIR)
      await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "post-patch-connection-bisect.json"), details);
  }
  page.on("console", (message) => browserLog.push(`[console:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => browserLog.push(`[pageerror] ${error.stack || error.message}`));
  page.on("requestfailed", (request) => networkFailures.push({
    at: Date.now(), url: request.url(), method: request.method(), failure: request.failure()?.errorText ?? "unknown",
  }));
  page.on("response", (response) => {
    if (response.status() >= 400) networkFailures.push({
      at: Date.now(), url: response.url(), status: response.status(),
    });
  });
  // Make action/locator waits bounded and known; the one-second UI/GDB telemetry below records
  // what the user-facing progress actually showed when one of those waits expires.
  page.setDefaultTimeout(30_000);

  await page.addInitScript(({ endpoint, names, available, adapterPort, installE2E, pristineBackupE2E, backupUnlockOnly, adapterEnabled, clearFolderMetadata, fullBrowserInstrumentation }) => {
    let index = 0;
    let progressStore = null;
    import("/src/lib/installProgress.svelte.js")
      .then((module) => { progressStore = module.installProgress; })
      .catch(() => {});
    class DirectoryHandle {
      constructor(root, relative = "") { this.root = root; this.relative = relative; this.name = relative.split("/").filter(Boolean).at(-1) || names[root]; this.kind = "directory"; }
      async queryPermission() { return "granted"; }
      async requestPermission() { return "granted"; }
      async isSameEntry(other) { return other?.root === this.root && other?.relative === this.relative; }
      async *entries() {
        const query = new URLSearchParams({ root: this.root, path: this.relative });
        const rows = await (await fetch(`${endpoint}/entries?${query}`)).json();
        for (const row of rows) yield [row.name, row.kind === "directory"
          ? new DirectoryHandle(this.root, [this.relative, row.name].filter(Boolean).join("/"))
          : new FileHandle(this.root, [this.relative, row.name].filter(Boolean).join("/"), row)];
      }
      async metadata(relative) {
        const query = new URLSearchParams({ root: this.root, path: relative });
        const response = await fetch(`${endpoint}/metadata?${query}`);
        if (!response.ok) throw new DOMException("Not found", "NotFoundError");
        return response.json();
      }
      async getDirectoryHandle(name) {
        const handle = new DirectoryHandle(this.root, [this.relative, name].filter(Boolean).join("/"));
        const row = await this.metadata(handle.relative);
        if (row.kind !== "directory") throw new DOMException("Not a directory", "TypeMismatchError");
        return handle;
      }
      async getFileHandle(name, options = {}) {
        const relative = [this.relative, name].filter(Boolean).join("/");
        let row;
        try { row = await this.metadata(relative); }
        catch (error) {
          if (!options.create) throw error;
          row = { name, kind: "file", size: 0, lastModified: Date.now() };
        }
        if (row.kind !== "file") throw new DOMException("Not a file", "TypeMismatchError");
        return new FileHandle(this.root, relative, row);
      }
    }
    class FileHandle {
      constructor(root, relative, metadata) { this.root = root; this.relative = relative; this.name = relative.split("/").at(-1); this.kind = "file"; this.metadata = metadata; }
      async getFileMetadata() { return { size: this.metadata.size, lastModified: this.metadata.lastModified }; }
      async createWritable() {
        const file = this;
        let contents = [];
        return {
          async write(data) {
            if (data instanceof Blob) contents.push(new Uint8Array(await data.arrayBuffer()));
            else if (ArrayBuffer.isView(data)) contents.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
            else if (data instanceof ArrayBuffer) contents.push(new Uint8Array(data));
            else throw new TypeError("unsupported backup write payload");
          },
          async close() {
            const body = new Uint8Array(contents.reduce((size, part) => size + part.byteLength, 0));
            let offset = 0;
            for (const part of contents) { body.set(part, offset); offset += part.byteLength; }
            const query = new URLSearchParams({ root: file.root, path: file.relative });
            const response = await fetch(`${endpoint}/write?${query}`, { method: "POST", body });
            if (!response.ok) throw new Error(`backup write failed (${response.status})`);
            contents = [];
          },
        };
      }
        async getFile() {
          const file = this;
          const size = file.metadata.size;
          const makeSlice = (start = 0, end = file.metadata.size) => ({
          async arrayBuffer() {
            const query = new URLSearchParams({ root: file.root, path: file.relative, start: String(start), end: String(end) });
            const response = await fetch(`${endpoint}/file?${query}`);
            if (!response.ok) throw new Error(`source read failed (${response.status})`);
            return response.arrayBuffer();
          },
        });
          return {
            name: this.name,
            size,
            lastModified: this.metadata.lastModified,
            slice(start = 0, end = size) {
              const from = Math.max(0, Math.min(size, start < 0 ? size + start : start));
            const to = Math.max(from, Math.min(size, end < 0 ? size + end : end));
            return makeSlice(from, to);
          },
          async arrayBuffer() { return makeSlice(0, file.metadata.size).arrayBuffer(); },
        };
      }
    }
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => new DirectoryHandle(backupUnlockOnly
        ? available[0]
        : available[index++]),
    });
    Object.defineProperty(window, "__gnwTestCreateDirectoryHandle", {
      configurable: true,
      value: (sourceId) => new DirectoryHandle(sourceId),
    });
    if (clearFolderMetadata) {
      // Docker's picker supplies test-only handles. Chromium cannot structured-clone their
      // methods into IndexedDB, so profile resume must re-register mounted directories through
      // the real Sources UI instead of restoring stale folder metadata.
      localStorage.removeItem("gnw:localFolders.v1");
    }
    if (fullBrowserInstrumentation) setInterval(() => {
      const memory = performance.memory;
      fetch(`${endpoint}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          at: Math.round(performance.now()),
          usedHeap: memory?.usedJSHeapSize ?? null,
          heapLimit: memory?.jsHeapSizeLimit ?? null,
          background: document.querySelector(".background-status")?.innerText ?? null,
          modalText: document.querySelector('[role="dialog"]')?.innerText ?? null,
          modalLog: document.querySelector('[role="dialog"] .log-box')?.innerText ?? null,
          visibleProgress: (() => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return null;
            return {
              title: dialog.querySelector("h1,h2,h3,[role=heading]")?.innerText ?? null,
              rows: [...dialog.querySelectorAll(".checklist .row")].map((row) => ({
                level: row.classList.contains("substep") ? "substep" : "phase",
                status: [...row.classList].find((name) => name.startsWith("status-"))?.slice(7) ?? null,
                text: row.innerText.replace(/\\s+/g, " ").trim(),
                barWidth: row.nextElementSibling?.classList.contains("bar-row")
                  ? row.nextElementSibling.querySelector(".fill")?.style.width ?? null : null,
              })),
            };
          })(),
          installProgress: progressStore ? {
            modalPhase: progressStore.modalPhase,
            title: progressStore.prompt?.title ?? null,
            error: progressStore.error,
            phases: Object.entries(progressStore.phaseState).map(([id, phase]) => ({
              id,
              status: phase.status,
              progress: phase.progress ? { ...phase.progress } : null,
              substeps: phase.substeps.map((substep) => ({
                id: substep.id,
                status: phase.substepStatus[substep.id],
                progress: phase.substepProgress[substep.id] ? { ...phase.substepProgress[substep.id] } : null,
              })),
            })),
          } : null,
          gdb: window.__gnwGdbDebug?.snapshot?.() ?? null,
          scanning: document.querySelectorAll(".scan-layers").length > 0,
          dom: (() => {
            const images = [...document.images];
            const unique = new Map(images.filter((image) => image.complete && image.naturalWidth && image.naturalHeight
              && !/\.svg(?:[?#]|$)/i.test(image.currentSrc || image.src))
              .map((image) => [image.currentSrc || image.src, image]));
            return {
              nodes: document.getElementsByTagName("*").length,
              images: images.length,
              decodedImages: unique.size,
              decodedImagePixelBytes: [...unique.values()].reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight * 4, 0),
              largestDecodedImages: [...unique.values()].sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
                .slice(0, 8).map((image) => ({ width: image.naturalWidth, height: image.naturalHeight, src: (image.currentSrc || image.src).slice(0, 120) })),
              canvases: [...document.querySelectorAll("canvas")].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
            };
          })(),
          carousel: window.__gnwCarouselDebug?.snapshot?.() ?? null,
          covers: window.__gnwCoverDebug?.snapshot?.() ?? null,
          lazyBytes: window.gnwLazyBytesReport?.() ?? null,
        }),
      }).catch(() => {});
    }, 1000);
    else if (installE2E || librarySyncE2E) setInterval(() => {
      const dialog = document.querySelector('[role="dialog"]');
      fetch(`${endpoint}/memory`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: Date.now(), modalText: dialog?.innerText ?? null,
          installProgress: progressStore ? { modalPhase: progressStore.modalPhase,
            error: progressStore.error, phases: progressStore.phaseState } : null }),
      }).catch(() => {});
    }, 1000);
    if (adapterEnabled) {
      localStorage.setItem("gnw:adapterType", JSON.stringify("remote"));
      localStorage.setItem("gnw:remoteHost", JSON.stringify("127.0.0.1"));
      localStorage.setItem("gnw:remotePort", JSON.stringify(Number(adapterPort)));
      localStorage.setItem("gnw:target-media", JSON.stringify("flash"));
      localStorage.setItem("gnw:landing-media-chosen", JSON.stringify(false));
    }
  }, { endpoint: url, names: rootNames, available: directories.map((item) => item.id),
    adapterPort: Number(process.env.GNW_TEST_ADAPTER_PORT || 0), installE2E, pristineBackupE2E, backupUnlockOnly, adapterEnabled,
    clearFolderMetadata: !!profileName, fullBrowserInstrumentation });

  try {
    await scenarioTest.step("open Directory sources", async () => {
      await page.goto("/");
      const flashMemory = page.getByRole("button", { name: /flash memory/i });
      if (await flashMemory.isVisible().catch(() => false)) await flashMemory.click();
      // Use the normal device entry so the shared Overview connection control is available;
      // the Advanced shortcut opens directly into OFW management and has no Connect action.
      await page.getByRole("button", { name: /^manage device\b/i }).first().click();
      if (installE2E || librarySyncE2E) {
        const adapterSetup = await page.evaluate(async () => {
          // Import the same Vite module URL as App.svelte. Using the .ts path creates a second
          // module instance in dev mode, whose device store never receives the UI connection.
          const { device } = await import("/src/lib/device.svelte.js");
          const read = (key) => {
            try { return JSON.parse(localStorage.getItem(`gnw:${key}`)); }
            catch { return null; }
          };
          return {
            store: { type: device.adapterType, host: device.remoteHost, port: device.remotePort },
            persisted: { type: read("adapterType"), host: read("remoteHost"), port: read("remotePort") },
            device: { connection: device.connection, locked: device.locked, model: device.model },
          };
        });
        if (process.env.GNW_TEST_REPORT_DIR) {
          await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "adapter-setup.json"),
            JSON.stringify(adapterSetup, null, 2) + "\n");
        }
        await testInfo.attach("adapter-setup.json", Buffer.from(JSON.stringify(adapterSetup, null, 2) + "\n"),
          { contentType: "application/json" });
        expect(adapterSetup.store).toMatchObject({ type: "remote", host: "127.0.0.1" });
        expect(adapterSetup.store.port).toBeGreaterThan(0);
        // The app deliberately switches a locked pristine target into Recovery Mode.
        // Existing backup install runs start unlocked and identify as normal Mario stock firmware.
        // Read the visible connection state so this follows the same path as users.
        await expect.poll(async () => page.locator("body").innerText(),
          { timeout: 90_000, intervals: [500, 1000, 2000] })
          .toMatch(pristineBackupE2E
            ? /Connected \(Recovery Mode\)/
            : librarySyncE2E
            // Library sync can start from either a cold dual-boot image in stock OFW or
            // a release-provisioned Retro-Go image. The sync workflow enters Recovery
            // Mode through the app when needed, then waits for a fresh partition scan.
            ? /Connected \((?:Stock|Retro-Go)\)/
            : /Connected \(Stock\)[\s\S]*Mario \(Stock\)/);
        if (pristineBackupE2E) {
          await expect.poll(async () => page.locator("body").innerText(),
            { timeout: 30_000, intervals: [250, 500, 1000] })
            .toMatch(/Read protection[\s\S]*Locked/);
        }
        await emulatorCheckpoint(device, testInfo, librarySyncE2E
          ? "00-prepared-target-connected"
          : "00-stock-connected-before-ram-util");
      }
      await openDirectorySources(page);
      await checkpoint(page, testInfo, "01-directory-sources");
    });

    const folderBindings = [];
    const addDirectory = async (source, association) => {
      const existingIds = profileName ? await page.evaluate(async () => {
        return JSON.parse(localStorage.getItem("gnw:localFolders.v1") || "[]").map((folder) => folder.id);
      }) : [];
      await addDirectoryViaUi(page, source, association);
      if (profileName) {
        const folderState = await page.evaluate((priorIds) => {
          const rows = JSON.parse(localStorage.getItem("gnw:localFolders.v1") || "[]");
          const added = rows.filter((folder) => !priorIds.includes(folder.id));
          return { id: added.at(-1)?.id ?? null, rows };
        }, existingIds);
        if (!folderState.id) throw new Error(`Could not associate the added directory with ${source.id}; saved rows: ${JSON.stringify(folderState.rows)}`);
        const folderId = folderState.id;
        folderBindings.push({ sourceId: source.id, folderId });
      }
    };

    {
      if (!backupUnlockOnly) {
      await scenarioTest.step("add ROM directory", async () => {
        for (const source of rootGroups.roms) await addDirectory(source, null);
        await checkpoint(page, testInfo, "02-rom-directory-added");
      });
      await scenarioTest.step("add BIOS directory", async () => {
        for (const source of rootGroups.firmware_bios) await addDirectory(source, "BIOS");
        await checkpoint(page, testInfo, "03-bios-directory-added");
      });
      }
      await scenarioTest.step("add OFW backup directory", async () => {
        for (const source of rootGroups.ofw_backups) await addDirectory(source, "OFW Backup");
        await checkpoint(page, testInfo, "04-ofw-directory-added");
      });
      if (profileName) {
        const exportState = await page.evaluate((bindings) => {
          const rows = JSON.parse(localStorage.getItem("gnw:localFolders.v1") || "[]");
          const ids = new Set(bindings.map(({ folderId }) => folderId));
          return rows.filter((row) => ids.has(row.id));
        }, folderBindings);
        if (exportState.length !== folderBindings.length) throw new Error("Browser profile export did not include all directory rows");
        const profileExport = { schemaVersion: 1, name: profileName, folders: exportState, folderBindings };
        if (process.env.GNW_TEST_REPORT_DIR)
          await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "profile-export.json"), JSON.stringify(profileExport, null, 2) + "\n");
      }
    }
    const sourceSnapshot = await sourceRegistrySnapshot(page);
    const snapshotText = JSON.stringify(sourceSnapshot, null, 2) + "\n";
    if (process.env.GNW_TEST_REPORT_DIR) {
      await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "source-registry.json"), snapshotText);
    }
    await testInfo.attach("source-registry.json", Buffer.from(snapshotText), { contentType: "application/json" });
    let tetrisSummary = "NOT FOUND: Game Boy/Tetris.zip";
    await scenarioTest.step(backupUnlockOnly
      ? "skip Library for backup/unlock-only run"
      : "open Library and wait for its scan", async () => {
      if (!backupUnlockOnly) {
      await page.getByRole("tab", { name: /library|roms/i }).click();
      const search = page.getByRole("searchbox");
      await expect(search).toBeVisible({ timeout: 60_000 });
      // Search the exact file from Game Boy/Tetris.zip. A generic `Tetris` search can
      // accidentally pass on an NES compilation (which happened in an earlier run).
      await search.fill("Tetris (USA) (Rev-A)");
      const gameBoyTetris = page.locator(".row").filter({ hasText: "Tetris (USA) (Rev-A)" });
      await page.waitForTimeout(1_000);
      const gameBoyTetrisCount = await gameBoyTetris.count();
      tetrisSummary = gameBoyTetrisCount ? await gameBoyTetris.first().innerText() : "NOT FOUND: Game Boy/Tetris.zip";
      if (gameBoyTetrisCount) expect(tetrisSummary).toContain("GB");
      if (gameBoyTetrisCount) await gameBoyTetris.first().click();
      if (process.env.GNW_TEST_REPORT_DIR) {
        await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "game-boy-tetris.txt"),
          `count=${gameBoyTetrisCount}\n${tetrisSummary}\n`);
      }
      await testInfo.attach("game-boy-tetris.txt", Buffer.from(`count=${gameBoyTetrisCount}\n${tetrisSummary}\n`), { contentType: "text/plain" });
      await search.fill("");
      let systems = [];
      if (fullDirectoryScan) {
        const { inferredCount, allCount, systems: fullSystems } = await assertFullLibrary(page);
        await testInfo.attach("recognized-rom-count.txt", Buffer.from(`${inferredCount}\n`), { contentType: "text/plain" });
        systems = fullSystems;
        const systemSummary = systems.map((value) => value.replace(/\s+/g, " ").trim()).join("\n") + "\n";
        if (process.env.GNW_TEST_REPORT_DIR) {
          await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "recognized-systems.txt"), systemSummary);
        }
        await testInfo.attach("recognized-systems.txt", Buffer.from(systemSummary), { contentType: "text/plain" });
        const recognizedSummary = `virtualizedRows=${inferredCount}\nallFilterCount=${allCount}\n`;
        if (process.env.GNW_TEST_REPORT_DIR) {
          await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "recognized-rom-count.txt"), recognizedSummary);
        }
        await testInfo.attach("recognized-rom-count.txt", Buffer.from(recognizedSummary), { contentType: "text/plain" });
      }
      // Capture store and source state before the long atlas wait; avoid bulky DOM/store reads
      // from the renderer after full-library cover preparation has completed.
      const diagnostics = await libraryDiagnostics(page);
      const diagnosticsText = JSON.stringify(diagnostics, null, 2) + "\n";
      if (process.env.GNW_TEST_REPORT_DIR) {
        await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "library-diagnostics.json"), diagnosticsText);
      }
      await testInfo.attach("library-diagnostics.json", Buffer.from(diagnosticsText), { contentType: "application/json" });
      const settledSources = await sourceRegistrySnapshot(page);
      const settledSourceText = JSON.stringify(settledSources, null, 2) + "\n";
      if (process.env.GNW_TEST_REPORT_DIR) {
        await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "source-registry-settled.json"), settledSourceText);
      }
      await testInfo.attach("source-registry-settled.json", Buffer.from(settledSourceText), { contentType: "application/json" });
      let midAtlasMemoryDump = null;
      let observedAtlasState = null;
      const settledCoverState = await waitForLibrarySettled(page, {
        fullCollection: fullDirectoryScan,
        onAtlasObserved: async (state) => {
          observedAtlasState = state;
          const cdp = await page.context().newCDPSession(page);
          try { midAtlasMemoryDump = await chromiumMemoryDump(cdp); }
          catch (error) { midAtlasMemoryDump = { error: String(error) }; }
          await cdp.detach();
          if (process.env.GNW_TEST_REPORT_DIR) {
            await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "cover-preparation-memory-dump.json"),
              JSON.stringify({ observedAtlasState, memoryDump: midAtlasMemoryDump }) + "\n");
          }
        },
      });
      if (fullDirectoryScan) {
        // The wait helper returns the drained queue snapshots from inside its polling loop.
        expect(settledCoverState?.covers?.atlas?.ready).toBe(true);
        expect(settledCoverState?.covers?.atlas?.signatureMatches).toBe(true);
        const settledCoverText = JSON.stringify(settledCoverState, null, 2) + "\n";
        if (process.env.GNW_TEST_REPORT_DIR) {
          await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "settled-cover-state.json"), settledCoverText);
        }
        await testInfo.attach("settled-cover-state.json", Buffer.from(settledCoverText), { contentType: "application/json" });
      }
      await checkpoint(page, testInfo, "05-library-settled");
      if (fullDirectoryScan) {
        const tetrisCover = page.locator('.coverflow-item[title*="Tetris (USA) (Rev-A)"]').first();
        await expect(tetrisCover, "the selected Game Boy Tetris cover should render after atlas preparation").toBeVisible();
        const renderedCover = await tetrisCover.evaluate((card) => ({
          atlas: !!card.querySelector(".coverflow-item__atlas-sprite"),
          fullResolution: !!card.querySelector(".coverflow-item__main"),
          lowResolution: !!card.querySelector(".coverflow-item__lod"),
          emptyPlaceholder: !!card.querySelector(".coverflow-item__placeholder"),
        }));
        expect(renderedCover.emptyPlaceholder, "a known Tetris cover must not render as an empty card").toBe(false);
        expect(renderedCover.atlas || renderedCover.fullResolution || renderedCover.lowResolution,
          "a known Tetris cover must show atlas, low-resolution, or full-resolution art").toBe(true);
        if (process.env.GNW_TEST_REPORT_DIR) {
          await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "tetris-cover-render.json"),
            JSON.stringify(renderedCover, null, 2) + "\n");
        }
        await testInfo.attach("tetris-cover-render.json", Buffer.from(JSON.stringify(renderedCover, null, 2) + "\n"),
          { contentType: "application/json" });
      }
      expect(gameBoyTetrisCount, "the actual Game Boy/Tetris.zip ROM must appear, not an unrelated Tetris compilation").toBe(1);
      if (fullDirectoryScan) {
        expect(systems.some((value) => /^GB(?:\s|\()/m.test(value)),
          "the Game Boy system must be represented by its actual ROMs").toBe(true);
      }
      }

      if (librarySyncE2E) {
        await scenarioTest.step("sync Game Boy Tetris to the prepared Retro-Go device", async () => {
          await syncLibraryItem({ page, device, testInfo, io,
            searchTerm: "Tetris (USA) (Rev-A)", rowText: "Tetris (USA) (Rev-A)",
            romSummary: tetrisSummary, checkpoint, emulatorCheckpoint,
            continueToLibrary: false });
        });
      } else if (installE2E) {
        await scenarioTest.step(pristineBackupE2E
          ? "enter dual-boot setup with an empty backup destination"
          : "enter dual-boot setup with the saved stock backup", async () => {
          await chooseGuidedPath(page, "dual");
          const backupState = await page.evaluate(async () => {
            const { backupPresence } = await import("/src/lib/backupPresence.svelte.js");
            const snapshots = await backupPresence.scanDirectories();
            const { complete, partial } = backupPresence.forModel("mario");
            return {
              mario: {
                complete: !!complete, partial,
                internalBytes: complete?.internal?.byteLength ?? null,
                externalBytes: complete?.external?.byteLength ?? null,
                internalOk: complete?.internalOk ?? false,
                externalOk: complete?.externalOk ?? false,
              },
              sources: snapshots.map(({ source, backups }) => ({
                name: source.name, status: source.status, usedBy: source.usedBy,
                backups: backups.map(({ model, internalOk, externalOk }) => ({ model, internalOk, externalOk })),
              })),
            };
          });
          const backupText = JSON.stringify(backupState, null, 2) + "\n";
          if (process.env.GNW_TEST_REPORT_DIR)
            await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "wizard-backup-state.json"), backupText);
          await testInfo.attach("wizard-backup-state.json", Buffer.from(backupText), { contentType: "application/json" });
          if (pristineBackupE2E) {
            expect(backupState.mario.complete, "a pristine-device run must begin without a saved backup pair").toBe(false);
            expect(backupState.mario.partial).toBe(false);
            await expect(page.getByRole("button", { name: /^Back Up$/i })).toBeEnabled();
            await checkpoint(page, testInfo, "06-pristine-backup-destination-empty");
          } else {
            // The supplied backup must be hash-valid to skip the fresh device dump.
            expect(backupState.mario.complete, "the pre-supplied Mario backup pair should skip a device dump").toBe(true);
            await expect(page.getByRole("heading", { name: /^Patch Device$/i })).toBeVisible();
            await expect(page.getByRole("button", { name: /^Patch$/i })).toBeEnabled();
            await checkpoint(page, testInfo, "06-dual-boot-backup-ready");
            await emulatorCheckpoint(device, testInfo, "06-stock-before-ram-util");
          }
        });

        if (pristineBackupE2E) {
          await scenarioTest.step("dump and verify the locked stock firmware backup", async () => {
            await backupLockedStock({ page, device, testInfo, checkpoint, emulatorCheckpoint });
          });
        }

        await scenarioTest.step("patch stock OFW and flash the dual-boot bootloader", async () => {
          await patchStockFirmware({ page, device, testInfo, checkpoint, emulatorCheckpoint,
            onMilestone: recordPostPatchConnectionMilestone, browserLog });
        });

        if (backupUnlockOnly) {
          await scenarioTest.step("finish after the pristine backup is saved and device unlocked", async () => {
            await returnToStockAndAssertUnlocked({ page, device, testInfo, checkpoint, emulatorCheckpoint,
              milestones: postPatchConnectionBisect, onMilestone: recordPostPatchConnectionMilestone });
          });
        } else {
          await expect(page.getByRole("heading", { name: /^Install Retro-Go$/i })).toBeVisible();
          await expect(page.getByRole("button", { name: /^Install$/i })).toBeEnabled();

        await scenarioTest.step("install the published Retro-Go SD release", async () => {
          await installPublishedRetroGo({ page, testInfo, io, checkpoint, browserLog });
          if (captureGwemuProfile) {
            const snapshot = "/reports/gwemu-profile-snapshot";
            await mkdir(snapshot, { recursive: true });
            await writeFile(path.join(snapshot, "profile.json"), JSON.stringify({
              schemaVersion: 1, name: captureGwemuProfile, state: "retro-go",
              capturedAfter: "published-retro-go-install-before-library-sync",
            }, null, 2) + "\n");
            await testInfo.attach("gwemu-profile-snapshot.json", Buffer.from(JSON.stringify({
              name: captureGwemuProfile,
              media: "copied by the runner after GWemu exits and flushes its flash images",
              capturedAfter: "published-retro-go-install-before-library-sync",
            }, null, 2) + "\n"), { contentType: "application/json" });
          }
        });

        await scenarioTest.step("install only Game Boy Tetris and verify it on the emulated device", async () => {
          await syncLibraryItem({ page, device, testInfo, io,
            searchTerm: "Tetris (USA) (Rev-A)", rowText: "Tetris (USA) (Rev-A)",
            romSummary: tetrisSummary, checkpoint, emulatorCheckpoint });
        });
        }
      }
      await testInfo.attach("scope.txt", Buffer.from(backupUnlockOnly
        ? "The pristine backup/unlock flow registers the OFW backup destination, verifies the locked-device dump, and stops after flashing the unlock patch. It skips ROM enumeration and browser cover processing.\n"
        : fullDirectoryScan
        ? "Configured source directories are scanned in full through the Sources UI. Game Boy Tetris is verified in Library. Chromium proportional resident memory and combined container memory are sampled without a run-time ceiling.\n"
        : "Configured directory registrations are exercised through the Sources UI. The read-only picker bridge exposes only Game Boy/Tetris.zip from ROMs and no file entries from BIOS/OFW.\n"),
      { contentType: "text/plain" });
    });
  } catch (error) {
    caughtTestError = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error), stack: null };
    throw error;
  } finally {
    const latestUi = io.rendererMemory.at(-1) ?? null;
    const observedErrors = [
      ...testInfo.errors.map((entry) => ({ message: entry.message, stack: entry.stack, location: entry.location })),
      ...(caughtTestError ? [{ ...caughtTestError, location: null }] : []),
    ];
    const timeoutErrors = observedErrors
      .filter((entry) => /(?:timeout|timed out|exceeded.*\b\d+ms\b|(?:after|within)\s+\d+\s*(?:seconds?|minutes?))/i.test(entry.message))
      .map((entry) => ({
        message: entry.message,
        stack: entry.stack,
        location: entry.location,
        // Include the sampler window, not only the final sample: UI state may have
        // changed just after Playwright's deadline expired.
        uiSamples: io.rendererMemory.slice(-30),
        networkFailures: networkFailures.slice(-30),
        browserLog: browserLog.slice(-30),
      }));
    const finalState = {
      status: caughtTestError ? "failed" : testInfo.status,
      errors: observedErrors.map((entry) => entry.message),
      timeoutErrors: timeoutErrors.map(({ message, location }) => ({ message, location })),
      url: page.url(),
      latestUi,
      recentUi: io.rendererMemory.slice(-15),
      networkFailures: networkFailures.slice(-100),
      recentBrowserLog: browserLog.slice(-100),
    };
    if (postPatchConnectionBisect.milestones.length || postPatchConnectionBisect.stockReconnectSamples.length) {
      await testInfo.attach("post-patch-connection-bisect.json",
        Buffer.from(JSON.stringify(postPatchConnectionBisect, null, 2) + "\n"),
        { contentType: "application/json" });
    }
    if (process.env.GNW_TEST_REPORT_DIR) {
      await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "ui-state-final.json"), JSON.stringify(finalState, null, 2) + "\n");
      await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "ui-timeouts.json"), JSON.stringify(timeoutErrors, null, 2) + "\n");
      const screenshot = path.join(process.env.GNW_TEST_REPORT_DIR, "ui-state-final.png");
      await Promise.race([page.screenshot({ path: screenshot }).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await testInfo.attach("ui-state-final.json", Buffer.from(JSON.stringify(finalState, null, 2) + "\n"), { contentType: "application/json" });
    await testInfo.attach("ui-timeouts.json", Buffer.from(JSON.stringify(timeoutErrors, null, 2) + "\n"), { contentType: "application/json" });
    // The init script samples renderer memory once a second. Close the page before
    // the bridge so it stops issuing keep-alive requests, then drain the HTTP server.
    await page.evaluate(() => window.__gnwTestFlushAuditLog?.()).catch(() => {});
    await page.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (process.env.GNW_TEST_REPORT_DIR) {
      await writeFile(path.join(process.env.GNW_TEST_REPORT_DIR, "source-bridge-io.json"), JSON.stringify(io, null, 2) + "\n");
    }
    await testInfo.attach("source-bridge-io.json", Buffer.from(JSON.stringify(io, null, 2) + "\n"), { contentType: "application/json" });
  }
}
