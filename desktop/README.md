# Desktop shell

Electron wrapper for the web app. It serves the renderer over `gnw://app`, keeps Node access in
the main process, and provides the selected-folder filesystem bridge described in
[`docs/ELECTRON.md`](../docs/ELECTRON.md).

## Local development

Run Electron development from Docker so the renderer always matches the current checkout:

```sh
cd desktop
npm ci                 # once
npm run dev
```

`npm run dev` uses the running Docker dev service, builds the internal package graph and Vite
renderer bundle, stages it, and launches Electron. It does not run the full web test chain; use
the push gate for that. Electron checks the staged source fingerprint at startup and refuses to
open if it does not match the checkout. This prevents direct launches from silently showing a
stale renderer. The renderer uses `PUBLIC_BASE=./` for the `gnw://app` origin. Rebuild the dev
image with `docker compose build dev` after changing dependency manifests.

## Packaging

`npx electron-builder --linux --x64 --publish never` (or the appropriate platform target) builds
the desktop package. Release automation and signing details are in
`.github/workflows/release-desktop.yml`.
