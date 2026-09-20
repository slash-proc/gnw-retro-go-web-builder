# Library model and cover pipeline

This document describes the metadata-first Library architecture. The library may contain
thousands of files; opening it must not materialize ROM or cover bytes for every entry.

## LibraryRom

`apps/web/src/lib/sources/libraryModel.ts` defines the serializable representation of one file.
`LibraryRom` contains file metadata (`relativePath`, filename, extension, size and optional
modification time), its `DirectorySourceRef`, the recognized system and role, installation state,
conversion metadata, and cover paths. It never contains ROM bytes, directory handles, object URLs,
or decoded image data.

The source relationship is available through both forms:

```ts
rom.system.primaryCoreSourceId
rom.system.source?.id
rom.system.source?.kind // repository | bundle | raw-binary
```

The ID fields are the stable/indexable form. The source object is the ergonomic serialized
reference. A `DirectorySourceRef` identifies where the file came from; it is distinct from the
core source that recognized the system.

## Scanning and identity

Directory scans enumerate metadata and keep file contents lazy. ZIP verdicts are cached by source,
relative path, size and modification time; the cache stores no archive bytes. A source-qualified
path index prevents two directory sources containing the same relative path from collapsing into
one ROM. Byte hashes are reserved for workflows that genuinely need byte identity, such as input
matching or verified artifacts—not routine library enumeration.

The `All` view is a filtered view over the complete metadata list. The list itself is virtualized;
only the visible rows and a small overscan window become DOM rows.

## Cover tiers

Original PNG/JPEG cover files remain beside the ROM in their source directory and are addressed by
the source-relative paths recorded in `LibraryRom.cover`. They are loaded lazily for the detail view.

The carousel uses a derived device-format `.img` tier as its low-resolution scrub surface. Derived
`.img` bytes are persisted through the existing OPFS cover cache and keyed by source ID, relative
path, source size and modification time. A changed source file therefore produces a new cache key;
different directory sources cannot reuse each other's derived art. Conversion is deferred until an
SD sync needs device-format covers, so opening the library does not read or convert the full cover
collection.

The UI keeps separate object-URL budgets for low-resolution and full-resolution art. Low-resolution
art is allowed a broad neighborhood for smooth scrubbing; full-resolution art is LRU-bounded and
requested only when motion is slow enough to resolve it visually.

## Carousel loading policy

`Carousel.svelte` always retains the low-resolution surface during fast movement. It measures tile
velocity and starts full-resolution requests at or below 100 tiles/second. Neighboring requests are
issued at a 240 Hz cadence, pending requests outside the active neighborhood are cancelled, and
timers/image requests are cleaned up when the carousel is destroyed. This keeps the all-library
carousel responsive without imposing a limit on the number of ROMs.

## Invariants

- A library scan must not retain one ROM byte buffer per ROM.
- A `LibraryRom` must remain serializable and metadata-only.
- Original cover files are never replaced by conversion.
- Derived cover cache entries are disposable; a miss regenerates the `.img`.
- Rescanning an unchanged source reuses metadata and ZIP verdicts.
- A source change does not require rescanning unrelated sources.
- UI search and the `All` category operate on metadata, not loaded ROM bytes.
