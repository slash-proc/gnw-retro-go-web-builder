# Desktop shell

An Electron window that loads the built web app. Nothing more yet.

`docs/ELECTRON.md` is the plan this belongs to. The shell is **step 4** there, and it is
deliberately the least interesting part: the desktop filesystem seam (steps 1 to 3) does not
depend on it, which is why it can exist as an empty frame while that work happens elsewhere.

## Why this is not in `apps/`

The root `package.json` globs `apps/*` as npm workspaces, so a package there is installed by
every `npm ci` in the repo. Electron's prebuilt binaries are roughly 150 MB per platform and
nothing in the web build, the Pages deploy or the dev container needs them. Keeping the desktop
package outside the glob leaves all three exactly as fast as they were, at the cost of a second
lockfile that CI installs on its own.

## Building it locally

Nothing here is installed by the repo's normal setup, and the project's rule is that nothing is
installed on the host, so this needs its own deliberate install:

```
npm run build --workspace @gnw/web   # with PUBLIC_BASE=./ -- see below
node desktop/scripts/stage-web.mjs
cd desktop && npm ci && npx electron-builder --linux --x64 --publish never
```

`PUBLIC_BASE=./` is not optional. The shell loads `index.html` over `file://`, where Vite's
default absolute asset URLs resolve against the filesystem root and the app opens as a blank
page. `scripts/stage-web.mjs` refuses to stage a build with absolute URLs rather than let that
ship.

## Signing

Nothing is signed, on any platform. See the header of
`.github/workflows/release-desktop.yml` for what a user sees as a result and what adding it
later would take.
