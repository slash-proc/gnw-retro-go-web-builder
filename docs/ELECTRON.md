# Electron desktop app

The desktop shell serves the web renderer from the stable `gnw://app` origin. The renderer has no
Node access; a narrow preload bridge exposes native folder selection and root-relative filesystem
operations. The main process remembers the paths explicitly selected by the user in Electron's
user-data directory, so ROM, SD-card, and firmware-backup folders do not require a browser
permission grant on every launch.

## Folder access

The renderer represents a selected folder with a small directory-handle adapter. Main-process
IPC requests refer to a registered root ID and a relative path, never an arbitrary renderer-supplied
absolute path. Requests reject traversal and symlink components. Library scans enumerate names,
sizes, and modification times in the main process; ROM bytes are read only when the app needs them.

Existing `gnw:` installations stored absolute selected paths under `gnw:electron-dir:*`. On first
load, the current bridge adopts those paths and replaces them with registered root IDs. The browser
build continues to use the File System Access API or its existing folder-input fallback.

## Development and packaging

Build the web app with a relative asset base, stage it, then launch/package Electron:

```sh
PUBLIC_BASE=./ npm run build --workspace @gnw/web
node desktop/scripts/stage-web.mjs
cd desktop && npm ci
cd desktop && npx electron .
```

`desktop/scripts/stage-web.mjs` checks that the staged HTML has no root-absolute asset URLs. The
shell serves `desktop/build/web` over `gnw://app`; this secure origin also lets Chromium persist
WebUSB adapter permissions between launches.

For an isolated local build, set `WEB_OUT_DIR` while building and `GNW_WEB_ROOT` when launching
Electron. These variables are useful when multiple worktrees share a machine.

## Boundaries

Electron retains the web app's browser USB transport and workflows. The native bridge is limited
to selected directories; it does not expose Node APIs to page code. The web build remains the
browser-based product and does not receive Electron filesystem access.
