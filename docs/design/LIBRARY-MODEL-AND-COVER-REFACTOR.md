# Library model and cover pipeline refactor

Status: design proposal. This document records the agreed direction; implementation is not yet
complete.

## Why this refactor exists

The Library currently uses one `Map<string, LibraryFile>` (`library.scan.userRoms`) for several
different jobs:

- listing and searching ROMs;
- determining which system and core source owns a file;
- automatic converter-input discovery;
- duplicate merging;
- cover lookup and preview generation;
- device installation and SD synchronisation.

That makes the lifetime of file bytes much broader than necessary. A large library can be scanned
successfully and still fill the browser heap when an unrelated consumer calls `romBytes()` across
many entries.

The target is a metadata-first Library whose memory use is proportional to metadata, the visible
UI, the active cover window and the current install operation — not to the total size of the
user's ROM and cover collection.

This is a considerable refactor, not a request to impose a maximum ROM count.

## Evidence from the memory investigation

The heap analyzer is retained at `tools/analyze-heap.mjs`:

```sh
node --max-old-space-size=8192 tools/analyze-heap.mjs PROFILE.heaptimeline
```

The investigation found:

1. `LazyRom.cached` retained about 1 GB of ROM backing storage when duplicate-folder hashing
   read colliding files and did not release them.
2. SD cheat-baseline loading resolved every scanned file before checking whether it was a cheat.
3. Automatic converter discovery in `sources/inputDiscovery.ts` read 763 files (about 1.1 GB)
   because manifests without variant sizes made every matching-extension file hash-plausible.
4. Releasing those buffers reduced retained memory, but still caused unacceptable allocation churn
   during a single startup operation.
5. Bounding broad automatic discovery reduced observed memory to roughly 260 MB.

The runtime diagnostic is available in the browser console after a fresh load:

```js
copy(JSON.stringify(gnwLazyBytesReport(), null, 2))
```

It reports reads, bytes read, releases, released bytes and call sites. This instrumentation should
remain until the refactor has stable regression coverage, then either remain as a low-cost debug
facility or be gated behind a development flag.

## Terminology and entities

Use the project's established terms:

- `DirectorySource` — a user-selected directory, with its persisted identity, label, folder name,
  status and associations.
- `CoreSource` — a source that provides a core/system definition and its artifacts. It may be
  repository-backed, bundle-ZIP-backed or represented by a raw binary artifact.
- `HomebrewTitle` — the existing manifest/title concept for homebrew content and its artifacts;
  do not create a competing title vocabulary without a demonstrated gap.
- `CoreRegistry` / `RegisteredSystem` — the resolved system vocabulary already used by the app.
- `ConverterInput` / `InputVariant` — the manifest-declared converter input and its recognized
  variants.
- `FileRole` — the existing `installable` / `ingestable` / `unknown` classification.
- `LibraryRom` — the proposed structured metadata object for a user/library file.

The browser does not expose an absolute filesystem path. A ROM therefore stores a
`relativePath` within its `DirectorySource`; the source object supplies the directory identity and
folder name.

## Proposed LibraryRom shape

The exact TypeScript shape may evolve, but it should carry all facts needed throughout the normal
workflow without reparsing path strings:

```ts
interface LibraryRom {
  id: string;

  file: {
    relativePath: string;
    filename: string;
    extension: string;
    size: number;
    lastModified?: number;
  };

  directorySourceId: string;

  system: {
    id: string;
    folder: string;
    shortName: string;
    longName: string;
    coreSourceIds: string[];
    primaryCoreSourceId?: string;
  };

  role: FileRole;

  conversion?: {
    inputId: string;
    status: "unmatched" | "matched" | "prepared";
    matchedVariantId?: string;
    outputArtifactId?: string;
  };

  device: {
    installed: boolean;
    path?: string;
    size?: number;
  };

  cover?: CoverInfo;
}
```

The object is metadata and relationships, not a byte container. It must not retain a
`Uint8Array`, decoded image, object URL or per-ROM closure.

The runtime may expose resolved references for ergonomic use (`rom.system.primaryCoreSource.id`),
but persisted data should use IDs and normalized entity tables to avoid copying the same source
object into thousands of ROM records and to avoid circular JSON structures.

Useful indexes should be explicit:

```ts
romsById: Map<string, LibraryRom>;
romsByPath: Map<string, LibraryRom>;
romsBySystem: Map<string, LibraryRom[]>;
```

Three to nine thousand metadata objects are expected to cost only a few to a few tens of MB. The
engineering budget for the complete ROM metadata/index layer is approximately 20 MB; byte data is
not part of that budget.

## Source relationships

The model must represent more than user ROM folders:

```text
DirectorySource
  └── user file / LibraryRom

CoreSource or HomebrewTitle
  ├── ConverterInput
  │     └── InputVariant
  │           ├── SHA-1 recognition value
  │           └── optional canonical output filename
  ├── shipped games
  └── core/assets/artifacts
```

A core source can be repository-backed, bundle-ZIP-backed or raw-binary-backed. A shipped core game
is source-owned and must not be represented as if it came from a `DirectorySource`.

## Identity, installed state and hashes

General Library identity does not require a byte hash. For the ordinary UI, installed matching can
use canonical system/path, filename and size. This is immediate, cheap and sufficient for the
device-management workflow in normal cases.

Byte hashes remain valid for a narrower purpose: converter recognition. Doom demonstrates why:

```text
DOOM.WAD
  └── SHA-1 matches InputVariant
        └── variant.filename = The Ultimate Doom.whd
```

`outputName` must never be guessed from the input filename when a matched `InputVariant` supplies
the canonical name. An unrecognized input under `strict: false` may use the documented fallback
name, but that is distinct from a variant match.

The Doom source also publishes a ready-to-process shareware `.whd`; that shipped game is separate
from a user's WAD conversion and is represented as a source-owned artifact/game.

General deduplication is optional. If implemented later, it should use a separately persisted,
incremental hash index rather than making byte hashes a prerequisite for listing every ROM.

## Scanning and incremental updates

### Normal scan

A DirectorySource scan should first collect metadata only:

```text
source ID
relative path
filename / extension
size
lastModified when available
directory placement
```

It should not inflate ZIP entries or read ordinary ROM payloads merely to build the Library list.

### Persistent metadata index

Persist the scan index in the existing browser storage architecture, with a versioned schema. A
file fingerprint is at minimum:

```text
DirectorySource ID + relativePath + size + lastModified
```

When a source is rescanned, unchanged entries reuse their metadata, classification and any cached
converter result. New, removed and changed entries are reconciled. A deliberate full rescan remains
available and is not prohibited; it is simply not the default response to an unrelated source or
registry change.

### Byte providers

Each LibraryRom has a runtime-only provider that can read its bytes on demand:

```ts
interface RomByteProvider {
  read(): Promise<Uint8Array>;
  release?(): void;
}
```

The provider may represent a loose file or a ZIP entry. It is not serialized. `LazyRom` can remain
the implementation for this layer, but its cache lifetime must be owned by the operation that read
it, not by the existence of the LibraryRom object.

For hashing large loose files, prefer incremental/chunked hashing so peak memory is bounded by a
chunk rather than the file size. ZIP-entry hashing can be added separately where the decompressor
supports incremental output.

## Covers: three tiers

Every cover has three conceptual representations:

1. **Authoritative original** — the user's original PNG/JPEG stored beside the ROM in the actual
   DirectorySource. This is the source of truth and must not be silently replaced by a derivative.
2. **Carousel asset** — normally the original itself; otherwise a generated display derivative for
   oversized/pathological originals.
3. **Retro-Go asset** — the generated `.img` used for device transfer.

The current bug where an applied high-resolution cover can fail to land beside its ROM must be
fixed as part of this work, not papered over with an OPFS-only copy.

### Carousel eligibility

Use dimensions primarily and file size secondarily. Initial thresholds:

```text
max dimension:        768 px
max decoded pixels:   approximately 600,000
max source file size:  2 MB
```

A 600×600 original normally qualifies and should be reused directly. Only an oversized cover gets
a carousel derivative. File size alone is not a sufficient quality rule because compression varies
widely.

### Storage and memory

The original remains in the DirectorySource. OPFS (or the project's durable derivative cache,
after its final storage choice is settled) stores generated carousel derivatives and `.img` files,
not redundant copies of every authoritative original.

The decoded high-resolution cache has a hard target of approximately 300 MB, with 400 MB as an
absolute emergency ceiling. It is an LRU around the current carousel position, with a starting
prefetch window of 25–50 neighboring covers. The low-resolution `.img` layer may remain broadly
resident because the expected collection footprint is small.

The carousel never waits for high-resolution data to avoid a dirty frame:

```text
fast scrub       → low-resolution .img
scrub slows      → predicted high-resolution landing window
release/pause    → current original loaded immediately
decode complete  → high-resolution crossfade/swap
```

The browser's configured monitor refresh rate is not reliably exposed. Measure actual
`requestAnimationFrame` cadence and keep synchronous work below the measured frame interval. At
120 Hz the frame budget is about 8.33 ms. Image decode and file reads must be asynchronous.

Prefetch distance should be adaptive:

```text
distance = observed scrub velocity × (observed load latency + decode latency + safety margin)
```

The system should use recent P90 latency measurements and cap concurrent storage reads so HDDs are
not made slower by hundreds of random requests. If the user scrubs faster than storage can serve
high-resolution images, the low-resolution layer remains the visible fallback; every intermediate
high-resolution cover need not be decoded.

## Rendering and search

The “All” category remains a first-class view. Searching 3,500–9,000 ROMs is a metadata operation
and should be fast.

The list should use virtualized rows: the data set may contain every matching ROM, but the DOM
contains only the visible rows plus a small overscan window. This prevents thousands of mounted
components, image elements and reactive subscriptions from becoming a second memory problem.

The carousel and list should use the same `LibraryRom` records but separate image lifetimes.

## Device transfer rules

Authoritative high-resolution PNG/JPEG files are source-side assets and must not be copied to the
device merely because they exist beside a ROM. Device transfer should materialize only the compact
Retro-Go `.img` covers, along with the files otherwise required by the selected install/sync.

This separation is essential: original cover disk usage may reach gigabytes while device transfer
and device storage remain bounded by the `.img` derivatives.

## Migration plan

1. Introduce the entity types and indexes without changing the visible UI.
2. Convert the existing scan result into `LibraryRom` metadata plus runtime byte providers.
3. Move system/core/source resolution into the object-construction step.
4. Make installed-state matching consume ROM objects rather than reparsing path strings.
5. Make converter discovery operate on ROM metadata first and hash only narrowed converter inputs.
6. Add persistent metadata/fingerprint storage and incremental DirectorySource reconciliation.
7. Centralize authoritative source-side cover resolution and repair apply/save behavior.
8. Add OPFS-backed carousel and `.img` derivative records with versioned invalidation.
9. Replace direct cover reads with the adaptive low-res/high-res carousel cache.
10. Virtualize the All/library list.
11. Remove transitional string-search and whole-map byte-loading paths after regression coverage is
    complete.

### Current implementation status

The metadata-first `LibraryRom` seam, source-qualified identity, in-memory source reconciliation,
and the versioned `library-metadata-index.v1` metadata cache are implemented. Source-relative cover
resolution now lives on the Library store, and SD sync reuses the completed card inventory instead
of blindly rescanning the card. The cache contains
only `{ relativePath, filename, extension, size, lastModified }` records keyed by DirectorySource;
it never stores handles, byte providers, ROM payloads, or image data. `LibraryRom` construction is
centralized in `libraryModel.ts`. Converter discovery is also metadata-first: merged-library
candidates carry size plus deferred readers, and bytes are read only after extension/size
narrowing. The remaining string-based operations are intentional boundaries: source-wide
enumeration for export/dirty-file processing, and compatibility rows that have no source-backed
`LibraryRom` (device-only or manifest-owned homebrew entries). They do not perform whole-library
byte reads or replace model-backed UI lookups.

## Non-goals

- Do not impose a maximum number of ROMs.
- Do not discard user originals to save browser memory.
- Do not require byte hashes for ordinary library listing or installed-state display.
- Do not treat shipped core games as user-directory ROMs.
- Do not copy high-resolution source covers to the device.
- Do not make the UI wait for high-resolution cover availability during fast scrubbing.

## Required regression coverage

- A 3,500+ metadata-only library remains searchable without ROM reads.
- A source rescan updates only new/changed/removed entries by default.
- A deliberate full rescan still works.
- Installed matching works by canonical path/name/size.
- Converter variant matching uses the manifest SHA-1 and canonical variant filename.
- Doom WAD conversion and shipped shareware WHD remain separate and correct.
- Duplicate hashing, when used, releases temporary byte buffers.
- Original covers are written beside their ROMs in the owning DirectorySource.
- Carousel reuses qualifying originals and generates derivatives only when required.
- Derivatives invalidate when the source cover changes.
- The device payload includes `.img`, not source PNG/JPEG.
- Low-resolution scrubbing remains responsive at measured 60/120 Hz frame cadence.
- High-resolution decoded memory stays within the configured cache budget.
