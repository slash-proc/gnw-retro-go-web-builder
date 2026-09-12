# Electron: real filesystem access

**Status: the shell exists; the filesystem seam is still the plan below.**

`desktop/` now holds a real Electron shell (`src/main.js`, an intentionally empty `preload.js`,
`scripts/stage-web.mjs`) with `electron` and `electron-builder` as dev dependencies, and
`.github/workflows/release-desktop.yml` builds it for Windows, macOS and Linux (see
"Desktop release" in `docs/DEVELOPMENT.md` for the matrix and the deliberate absence of code
signing). It lives outside the `apps/*` workspace glob on purpose.

What has **not** changed is everything this document is actually about: the shell still loads the
same web build and still goes through the same browser filesystem APIs. `lib/fsNode.ts` proves a
node-backed `FsDirHandle` through the real `scanRomDirectory`/`walk`, but nothing wires it in yet.
So the plan below stands as written.

The goal the owner chose is **real filesystem access**, not distribution and not native USB.
Concretely: no folder pickers, no permission that can lapse, direct read and write of the SD
card and the ROM library, and Firefox/Safari users stop being second-class because the browser's
limits stop applying.

This document is the plan for getting there and the record of what has actually been verified.

## The seam already exists, and it already has two implementations

`apps/web/src/lib/romScan.ts:42` declares a deliberately small directory interface:

```ts
interface FsDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]>;
  readonly writable?: boolean;
}
interface FsFileHandle { kind: "file"; name: string; getFile(): Promise<File>; }
```

Two things implement it today:

1. **Native File System Access handles** (Chromium), obtained from `showDirectoryPicker`.
2. **`InputDirHandle`** (`romScan.ts:221`), an in-memory tree built from an
   `<input webkitdirectory>` `FileList` — the read-only path Firefox and Safari already use.

A node-backed third implementation is therefore the natural shape, and it is what
`apps/web/src/lib/fsNode.ts` now provides. **This is an extension of an existing seam, not a new
abstraction.**

It needs **no dependency**: `getFile()` must return a `File`, which reads as a DOM type but has
been a Node global since v20 (`node:buffer`), carrying the `name`, `size` and `arrayBuffer()`
the consumers actually use.

### What was proven

`apps/web/test/fsnode.mjs` runs the **real** `scanRomDirectory`, `walk` and `getValidRoot` —
not copies — against a temporary directory, and against the browser shim, and requires the two
to agree: same keys, same bytes, same summary, same `roms/` prefix strip, same hidden-file rule.
That agreement is the point; either implementation alone could be self-consistently wrong.

Worth noting this is the **first suite to exercise `walk()` at all**. `coreregistry.mjs` stubs
`romScan` out entirely, so the recursion, the hidden-file rule and the prefix strip were
previously uncovered by anything.

### What was NOT proven

- **Nothing about writing.** The proof covers the read side only. The write side is a separate,
  duplicated interface (below) and is untouched.
- **Nothing about Electron.** No shell, no IPC, no packaging, no renderer. `fsNode.ts` is
  reachable from a Node process and from tests; the Vite bundle has no importer for it.
- **Nothing about performance at scale.** The fixture is four files.

## The abstraction is duplicated, and that is the first thing to fix

`engine/ofw.ts:209-225` declares its **own** `FsDirHandle`, `FsFileHandle` and `FsWritable`,
independently of `romScan.ts`'s. It is the write-capable superset:

```ts
interface FsWritable { write(data: BufferSource | Blob): Promise<void>; close(): Promise<void>; }
interface FsFileHandle { kind; name; getFile(): Promise<File>; createWritable(): Promise<FsWritable>; }
interface FsDirHandle { kind; name; entries(); getFileHandle(name, opts?); getDirectoryHandle(name, opts?); }
```

So the codebase has one concept described twice, with the read-only half in one file and the
read-write half in another, and nothing keeping them consistent. Any desktop work that starts by
adding a *third* declaration makes this worse. **Step 1 is to give these one home.**

Note `dirSupportsWriteBack` (`romScan.ts:171`) duck-types on the presence of `getDirectoryHandle`
rather than reading the `writable` flag the interface already declares. A node handle that offers
`getDirectoryHandle` would silently be treated as writable, which is correct but accidental.

## Every place the app touches the filesystem

| Site | What it does | Desktop |
|---|---|---|
| `romScan.ts:42` | the read interface | shared, gains a node implementation |
| `romScan.ts:80` `walk` | recursive read, **whole file into memory** | works; the memory cost is the thing to fix |
| `romScan.ts:166` `nativeFolderPickerSupported` | Chromium check | always true, or meaningless |
| `romScan.ts:171` `dirSupportsWriteBack` | duck-type for write support | always true |
| `romScan.ts:221` `InputDirHandle` | the Firefox read-only shim | unused on desktop; still needed for the web build |
| `romScan.ts:269` `pickFolder` | hidden `<input webkitdirectory>` | replaced by a path, or a native dialog |
| `romScan.ts:353` `showDirectoryPicker` | the Chromium picker | same |
| `romScan.ts:~421` | `getDirectoryHandle`/`getFileHandle`/`createWritable` write-back | real writes |
| `romScan.ts:380` `pickSdCardFolder` | dynamically imports `device.svelte` | unchanged |
| `engine/ofw.ts:209-225` | the second, write-capable interface | merge with the first |
| `engine/ofw.ts:309-322` | writes stock-firmware backups | real writes, no picker |
| `persist.ts:126-148` | `queryPermission`/`requestPermission` on a stored handle | **evaporates** |
| `persist.ts` (handle store) | persists handles to IndexedDB | becomes path persistence |
| `library.svelte.ts:200` | only persists native handles, shims are not structured-cloneable | a path always persists |
| `sources/localFolders.svelte.ts` | registry with `ready \| needs-permission \| missing` | `needs-permission` evaporates; `missing` remains |
| `sources/blobCache.ts` | OPFS behind `BlobCacheBackend` | a real directory behind the same seam |
| `views/RomManagementTab.svelte:1873` | ZIP fallback when a handle cannot write back | **no longer needed** |
| `sdFolderPick.svelte.ts` | pick/scan failure state | a path either reads or does not |

### What each concept becomes

- **`needs-permission` evaporates.** There is no grant to lapse against a real path. The registry
  keeps `ready` and `missing`; a folder that has been moved or unmounted is still `missing`, and
  that case gets *more* common on desktop, not less (external drives).
- **Handle persistence becomes path persistence.** Simpler, and it removes the
  "shims are not structured-cloneable" special case at `library.svelte.ts:200`.
- **`dirSupportsWriteBack` becomes constantly true**, which retires the ZIP fallback in
  `RomManagementTab.svelte`. That fallback exists only because the `<input webkitdirectory>` shim
  cannot write; it is not a feature anyone asked for.
- **Picking becomes optional.** A remembered path needs no gesture at all. A first-run pick is
  still a native dialog, but it is a convenience rather than the only way in.
- **OPFS becomes a directory.** `BlobCacheBackend` is already fully injected
  (`list/stat/read/write/remove`, names opaque to the backend) — see below.

## What the interface should gain, and what it should not

The temptation is to widen the shared interface to the union of both platforms. That is how this
rots: every consumer then has to handle a method that is absent half the time, which is the
`writable?` flag problem repeated for a dozen operations.

**Belongs in the shared interface** (both platforms can honour it, and consumers need it):

- the current read surface, unchanged;
- the write surface **already in `ofw.ts`** — `getFileHandle`, `getDirectoryHandle`,
  `createWritable` — because Chromium genuinely provides it and the app already depends on it;
- `writable`, promoted from an optional hint to the honest answer, and read by
  `dirSupportsWriteBack` instead of duck-typing.

**Should stay desktop-only, reached through a capability check rather than the shared type:**

- **streaming reads.** `walk()` currently does `getFile()` then `arrayBuffer()` on every file it
  visits, so a scan holds the entire library in memory at once. A real path can stream, and a
  multi-GB card is exactly where that matters — but the browser cannot, so this is a second
  method, not a change to `getFile()`.
- **delete and rename.** Genuinely useful for card management; no current consumer needs them.
  Adding them speculatively means two implementations to keep honest for no caller.
- **watching for changes.** Attractive, and a large behaviour change (a scan that re-runs itself).
  It belongs to a later step with its own design, not to the seam.

**Should stay browser-only:** `InputDirHandle` and the `<input webkitdirectory>` plumbing. The web
build still needs them; the desktop build should never see them.

### OPFS

`BlobCacheBackend` (`sources/blobCache.ts:102`) is already the right shape — `available`, `list`,
`stat`, `read`, `write`, `remove`, with names opaque to the backend and a `StorageQuota` seam
beside it. A directory-backed implementation is a small, self-contained piece of work and needs
**no change to the interface**. The one thing to decide is where that directory lives, since on
desktop it is a real location a user can find, back up, or delete underneath us.

## The device path is orthogonal — explicitly out of scope

WebUSB/SWD is a **separate concern** the owner did not choose. Nothing in this plan touches it,
and the desktop build can ship with WebUSB exactly as it is today.

For the record, a later native-USB step would touch `packages/swd-transport` (the `SwdTransport`
interface and its two implementations), `engine/transport.ts`, and `device.svelte.ts` — and it
would inherit every hardware constraint in `CLAUDE.md`'s ST-Link section, which is the real cost.
Do not fold it into this work.

## Risks worth naming

- **Renderer security.** Loading this app in a renderer with Node integration enabled would give
  page content full filesystem access. The standard answer is `contextIsolation` on, Node off in
  the renderer, and a narrow preload bridge exposing only the seam above. That bridge is the
  security boundary and should be reviewed as one.
- **The Pages build must keep working.** The web build is the shipping product today and the
  desktop build must not regress it. Anything the seam gains has to be a no-op for the browser.
- **Bundler-free packages.** `CLAUDE.md`'s golden rule keeps `packages/*` dependency-free and
  bundler-free. A node-only implementation must not leak `node:` imports into anything the
  browser bundles. `fsNode.ts` has no importer in `apps/web/src`, so the Vite bundle never sees
  it — but nothing enforces that yet, and a guard would be cheap.
- **Testing without installing Electron.** The seam is testable without Electron, as
  `test/fsnode.mjs` shows. Anything that can only be tested by launching a shell should be kept
  as small as possible for exactly that reason.
- **`File` in the renderer.** The proof relies on Node's global `File`. In a renderer with Node
  integration off, `File` is the DOM one — compatible, but the implementation must not assume
  which it got.

## Staged plan

1. **Unify the two interface declarations.** Move `romScan.ts`'s and `ofw.ts`'s into one module,
   with the write surface optional and `writable` as the honest answer. Make
   `dirSupportsWriteBack` read the flag. No behaviour change; the gates prove it.
2. **A capability-checked streaming read**, so `walk()` stops holding a whole library in memory
   where the platform allows it. This is worth doing for its own sake and pays off on desktop.
3. **A directory-backed `BlobCacheBackend`**, since that seam is already sufficient.
4. **The Electron shell**: main process, `contextIsolation`, a preload bridge exposing only the
   seam. Nothing above depends on this, which is the point of doing it fourth.
5. **Retire what evaporates on desktop** — `needs-permission`, the ZIP fallback, handle
   persistence — behind whatever platform check step 4 establishes.
6. **Report the SD card's real free space.** A browser cannot: the File System Access API
   exposes no capacity and `navigator.storage.estimate()` answers about the browser profile,
   so `sdStorage` can compute USED bytes and has no denominator. The web build's workaround is
   a user-picked nominal size with a safety margin, backed by a computed table of usable
   capacity per size and filesystem; the owner named it a workaround when he chose it. On
   desktop a real path makes the question answerable, which retires the selector the same way
   step 5 retires `needs-permission`. Cluster size matters as much as capacity here, because
   every ROM and cover rounds up to a cluster.

## Open questions for the owner

1. **Does the desktop build replace the web build, or ship alongside it?** Every "evaporates"
   above becomes a conditional rather than a deletion if the web build stays. The plan assumes it
   stays, because it is the shipping product.
2. **Where does the blob cache live on disk?** A user-visible location invites tidying it away
   underneath us; a hidden one is harder to reclaim when it grows.
3. **Should the desktop build remember paths silently?** It is the main ergonomic win over the
   browser, and it also means the app reads a folder with no gesture at all. That is a change in
   posture worth agreeing deliberately.
4. **Is watching for changes wanted?** It is the largest behaviour change available here — the
   library could stop needing a rescan at all — and it is the one thing on this list that changes
   how the app feels rather than what it can reach.
