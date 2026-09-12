// Electron main process: a window that loads the built web app, and nothing else.
//
// DELIBERATELY MINIMAL. `docs/ELECTRON.md` stages the desktop work, and the shell is step 4
// precisely because nothing above it depends on it. This file exists so there is something for
// CI to package; it is not the filesystem layer and must not grow into it. The desktop
// `FsDirHandle` implementation, the preload bridge that would expose it, and the retirement of
// `needs-permission` all belong to that plan, not here.
//
// SECURITY POSTURE (ELECTRON.md "Renderer security"): the renderer runs with Node OFF, context
// isolation ON and the sandbox ON. Page content therefore has no more reach than it does in a
// browser tab, which is the same posture the Pages build ships under today. When the preload
// bridge does gain a surface, IT becomes the security boundary and should be reviewed as one.
const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

/** The packaged web build. `scripts/stage-web.mjs` puts Vite's output here. */
const WEB_ROOT = path.join(__dirname, "..", "build", "web");

function createWindow() {
  const win = new BrowserWindow({
    // The design caps its body at --maxw (1360px) and the Overview's docked screen column
    // drops out below roughly 1200px, so open wide enough to show the layout as drawn.
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f4f4f4",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Paint once rather than showing an empty frame first.
  win.once("ready-to-show", () => win.show());

  // Anything that would open a new window is an external link (docs, project READMEs, release
  // pages). Hand it to the real browser instead of opening a chromeless Electron window with no
  // address bar, which is both worse to use and a phishing surface.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadFile(path.join(WEB_ROOT, "index.html"));
  return win;
}

app.whenReady().then(() => {
  createWindow();
  // macOS keeps the app alive with no windows; re-open one when the dock icon is clicked.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
