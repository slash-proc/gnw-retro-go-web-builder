# SD card usable capacity table

The app cannot ask the browser how big a user's SD card is: the File System
Access API exposes no capacity, and `navigator.storage.estimate()` reports the
browser profile's storage quota, not the card. Instead the UI lets the user
pick their card's nominal size from a short list (2, 4, 8, 16, 32, 64, 128,
256 GB) and looks up a precomputed usable-space figure, minus a safety margin,
from `apps/web/src/lib/data/sdCapacity.json`.

## Method: measured, not computed

The numbers in the committed JSON are **measured**, not derived from the FAT32
/ exFAT specifications on paper. For each nominal size the generator:

1. Creates a sparse file of the size the partition would actually be (see
   "Partition alignment" below) with `truncate -s`.
2. Formats it for real with `mkfs.vfat -F32` (dosfstools) or `mkfs.exfat`
   (exfatprogs) -- the same tools and code paths that format a real card.
3. Reads the free space back from the filesystem metadata itself, without
   mounting: `fsck.fat -n -v` for FAT32 (parses "N/M clusters" and the bytes
   per cluster from its dry-run consistency report), `dump.exfat` for exFAT
   (prints cluster size and free-cluster count directly).

No loop device and no mount is used or needed, so this runs in an unprivileged
container. The whole run (all 8 sizes x 2 filesystems, up to a 256 GB sparse
image) takes a few seconds because the images are sparse: formatting only
touches the boot sectors, FAT/bitmap tables and root directory, not the bulk
of the (never-allocated) data region.

This is only possible because `dosfstools` and `exfatprogs` are **not** part
of the dev container image. They were installed ephemerally for this work
with:

```
docker compose exec dev sh -c 'apt-get update && apt-get install -y dosfstools exfatprogs mtools'
```

That install disappears the next time the container is recreated. Re-running
`scripts/sdcapacity/measure.sh` (directly, or via `generate.mjs`, which is
what actually produces the committed JSON) requires installing those packages
again first. This is a deliberate, one-time, host-uninstalled step -- consistent
with this repo's "never install to the host" rule, since it only ever runs
inside the disposable container.

## Partition alignment (computed, not measured)

A raw, freshly-formatted card is not "one giant filesystem": there is a
partition table (commonly MBR) and an alignment gap before the first
partition's data begins. SD cards are conventionally imaged with the first
partition aligned to a 4 MiB erase-block boundary -- this is what the SD
Association's own SD Formatter tool and things like Raspberry Pi Imager do.
The generator reserves a flat 4 MiB (4,194,304 bytes) before the simulated
partition starts, then rounds the remainder down to a whole 512-byte sector.
This part is arithmetic, not measurement, because there is no card to
partition; it is spelled out here so it can be checked:

```
usableAfterPartitionBytes = floor((nominalBytes - 4194304) / 512) * 512
```

## Nominal size assumption and real-world spread

"Nominal" GB in the table means **decimal** gigabytes: 1 GB = 1,000,000,000
bytes, matching both the label printed on the card and the SD Association's
own convention. This is deliberately *not* 2^30 bytes (a "16 GB" card is never
close to 16 * 2^30 = 17,179,869,184 bytes) and it is also not exactly
1,000,000,000 * N on a real card either -- actual raw capacity is set by the
SD specification's addressable sector count for that capacity class and
varies slightly by vendor (reserved area for bad-block sparing, firmware,
etc). A spot data point found while researching this: a 32 GB SanDisk card
reports 62,333,952 sectors of 512 bytes = 31,914,983,424 bytes, about 0.27%
under the 32,000,000,000-byte decimal nominal figure used here.

The table therefore slightly **overstates** true usable space for any given
real card, typically by somewhat less than half a percent, on top of already
being a "your mileage may vary by vendor" figure. That is the right direction
to err in for a user-facing capacity picker feeding a "does my selection fit"
check: the alternative (assuming the worst case up front) would then be wrong
in the other direction for the many cards that hit the nominal figure closely.
No single fixed number can be exact for every physical card; this document
says so rather than implying false precision.

## Cluster size

Every row records the filesystem's cluster size, because it determines real
consumption as much as raw capacity does: every file rounds up to a whole
cluster, so a library of many small files loses much more to slack against a
128 KiB cluster than a 4 KiB one. Measured cluster sizes follow the
size-dependent rules built into `mkfs.vfat`/`mkfs.exfat`, not a flat
percentage -- see the table below (`clusterSizeBytes` per filesystem per row
in the JSON). FAT32 cluster size grows in coarse steps (4 KiB up to ~8 GB, up
to 32 KiB by 64 GB); exFAT defaults to a flat 32 KiB up to 32 GB then jumps to
128 KiB at 64 GB and above in this build of exfatprogs.

## The safety margin

The JSON's top-level `safetyMarginBytes` (100 MiB = 104,857,600 bytes) is kept
as its own field, separate from the measured `usableBytes`, so the raw
measured figure and the margin stay distinguishable and the margin can be
retuned without re-measuring anything. Each size/filesystem entry also carries
a precomputed `usableAfterMarginBytes` for convenience.

**Is 100 MB a sensible margin across the whole range? Not uniformly.** As a
fraction of usable space it runs from about **5.3% at 2 GB** down to about
**0.04% at 256 GB**:

| Nominal | Margin as % of usable (FAT32) |
|---|---|
| 2 GB | 5.26% |
| 4 GB | 2.63% |
| 8 GB | 1.31% |
| 16 GB | 0.66% |
| 32 GB | 0.33% |
| 64 GB | 0.16% |
| 128 GB | 0.08% |
| 256 GB | 0.04% |

A flat 100 MB is a reasonable, slightly-generous safety margin at the large
end of the range (a rounding error), but at the small end -- a 2 GB card,
which is the smallest size this table bothers to cover -- it eats over 5% of
the card's usable space, which is not negligible if that card is ever
actually offered as a real option. If 2 GB and 4 GB cards are expected to see
real usage (as opposed to being included only for completeness / testing),
consider scaling the margin (a small percentage with a 100 MB floor, say)
rather than a flat constant. This document flags it; the constant itself is
left as specified rather than silently changed, since that is a product
decision, not an arithmetic one.

## The table

All figures are bytes unless noted. `usableAfterMarginBytes` = `usableBytes -
104,857,600`.

| Nominal | FS | Cluster size | Usable bytes | Usable after 100 MB margin |
|---|---|---|---|---|
| 2 GB | FAT32 | 4,096 | 1,991,860,224 | 1,887,002,624 |
| 2 GB | exFAT | 32,768 | 1,993,605,120 | 1,888,747,520 |
| 4 GB | FAT32 | 4,096 | 3,987,963,904 | 3,883,106,304 |
| 4 GB | exFAT | 32,768 | 3,993,600,000 | 3,888,742,400 |
| 8 GB | FAT32 | 4,096 | 7,980,167,168 | 7,875,309,568 |
| 8 GB | exFAT | 32,768 | 7,993,589,760 | 7,888,732,160 |
| 16 GB | FAT32 | 8,192 | 15,980,142,592 | 15,875,284,992 |
| 16 GB | exFAT | 32,768 | 15,992,520,704 | 15,887,663,104 |
| 32 GB | FAT32 | 16,384 | 31,980,126,208 | 31,875,268,608 |
| 32 GB | exFAT | 32,768 | 31,990,349,824 | 31,885,492,224 |
| 64 GB | FAT32 | 32,768 | 63,980,044,288 | 63,875,186,688 |
| 64 GB | exFAT | 131,072 | 63,992,233,984 | 63,887,376,384 |
| 128 GB | FAT32 | 32,768 | 127,964,446,720 | 127,859,589,120 |
| 128 GB | exFAT | 131,072 | 127,990,104,064 | 127,885,246,464 |
| 256 GB | FAT32 | 32,768 | 255,933,186,048 | 255,828,328,448 |
| 256 GB | exFAT | 131,072 | 255,985,844,224 | 255,880,986,624 |

Both filesystems format and mount cleanly at every size in this range with the
tools used here, including FAT32 at 256 GB (dosfstools's `mkfs.vfat` does not
enforce the ~32 GB ceiling that Windows' own formatter GUI does) and exFAT at
2 GB (exFAT has no meaningful lower-size restriction with exfatprogs). No row
was skipped.

## Where the pieces live and why

- `scripts/sdcapacity/measure.sh` -- the measurement script (bash + dosfstools/
  exfatprogs), alongside this repo's other one-off scripts (`scripts/`).
- `scripts/sdcapacity/generate.mjs` -- reshapes `measure.sh`'s raw
  per-(size,filesystem) rows into the final JSON shape and adds the safety
  margin fields; also this repo's convention (small `node` scripts, no
  bundler, no external deps) for anything that needs post-processing beyond
  what a shell script does cleanly.
- `apps/web/src/lib/data/sdCapacity.json` -- the data file, placed under
  `apps/web/src/lib` (the real UI's source tree, per `CLAUDE.md`) rather than
  the repo root or `frontend/`, so `apps/web` code can import it directly as a
  normal module (Vite handles `.json` imports natively; no build step or
  import-map entry is needed).
- `apps/web/test/sdcapacity.mjs` -- a guard, run the same way as this
  project's other `apps/web/test/*` scripts: parses the JSON, checks it covers
  exactly the 8 nominal sizes x 2 filesystems, and re-derives every piece of
  *pure arithmetic* in each row (the decimal nominal-bytes conversion, the
  partition-alignment subtraction, cluster-size divisibility, the margin
  subtraction) to catch drift between the committed JSON and the constants in
  `generate.mjs`. It deliberately does **not** re-run `mkfs`/`fsck.fat`/
  `dump.exfat` -- those tools are not part of the base container image, so a
  gate that needed them would fail in any environment that has not run the
  `apt-get install` above. Verified to actually fail: perturbing one row's
  `usableBytes` by 4096 (a plausible small drift) without updating its
  `usableAfterMarginBytes` produces:

  ```
  FAIL: 2GB fat32: usableAfterMarginBytes 1887002624 != usableBytes - safetyMarginBytes (1887006720)

  1 failure(s).
  ```

  and exits non-zero.

No UI reads this table yet -- this work is data, script and document only, per
scope.
