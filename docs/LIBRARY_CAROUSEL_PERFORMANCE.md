# Library carousel performance

## Observed behavior

The Library must remain responsive with roughly 3,500 games, including fast selection from the
list, rapid scrubbing, and background source validation. Low-resolution art must be immediately
available; original art should replace it near the current selection without delaying input.

The September 24, 2026 captures `Trace-20260924T122558.json` and
`Heap-20260924T121536.heapprofile` point to image residency rather than JavaScript execution:

- The list click took about 5 ms to process. The rendered document had 485–504 elements and
  the recorded JavaScript heap ranged from 82–115 MiB.
- In the 12 seconds after that click, Chrome started 30 image decode tasks. Many consumed
  0.8–1.2 seconds of decoder CPU time. CSS atlas paints used 3072×4096 WebP images; 12
  distinct atlas URLs appeared in the paint events.
- Renderer tasks lasting 0.75–1.36 seconds consumed only 0.09–0.17 seconds of renderer CPU
  time, while those image decodes overlapped them. The trace does not expose every native wait,
  but the timing is consistent with decoding and raster work delaying presentation.
- The heap profile samples JavaScript allocations, not native image or GPU allocations. Its
  roughly 21 MiB of sampled allocations cannot account for the reported 1.5 GB process peak.

An old 16×16 atlas page at 192×256 pixels per tile expands to 48 MiB of RGBA pixels. Pages
for separate sources can be partly empty, yet each still incurs the full page size when decoded.
Thirty such pages would require 1.41 GiB before other browser memory. Even perfectly packed,
3,500 tiles at that resolution require 656 MiB decoded. A successful `HTMLImageElement.decode()`
does not give the application ownership of permanent decoded pixel residency; repeated decode
events for the same pixel references appear in the trace.

The apparent "Reading library files" memory spike can overlap atlas work. Cached library
metadata is published to `library.scan` before directory validation; that publication starts
atlas preparation while the file scan progress bar is still active. The directory scanner itself
mostly reads metadata and creates lazy file entries.

## Current code pressure

`Carousel.svelte` renders only a small window of cards, but each atlas card references an entire
page as a CSS background. It does not explicitly warm atlas pages around the visual center.
The preload loop also requested 241 original-art URLs for a cache that held only 120. Cache
evictions, new file reads, object URL creation, and global `coverVersion` updates could therefore
feed further preload passes without a stable resident set. The full-resolution preload radius
was set to 240, but the outer loop stopped at 120, making the effective radius 120.

The immediate correction uses 4×4 pages at 128×170 pixels per tile, still encoded at WebP
quality 0.9. A decoded page is now 1.33 MiB; 3,500 perfectly packed tiles require 291 MiB.
The render settings are part of the atlas cache signature, so this change requires one cache
rebuild. Original-art readahead is limited to 60 games in either direction with a 128-URL cache.
Browser page decoding runs at most four pages concurrently. Atlas workers release each consumed
cover buffer and terminate after each page; a batch normally carries no more than 24 MiB of
compressed input. This bounds retained worker inputs, but the browser does not expose a reliable
way to force GC or cap the native decoder's temporary memory for a single oversized cover.
These changes reduce pressure; they do not establish a total process-memory guarantee.

The cached library index is published before filesystem validation. That can start a browser
atlas load while "Reading library files" is displayed; a validated scan may then change the
atlas input signature. Previously a refresh read and decoded every page again, holding the old
page set until the replacement was complete. Refreshes now wait for an aborted predecessor to
finish cleanup, reuse unchanged source atlases directly, compare rebuilt pages by encoded bytes,
and decode only pages that differ. The progress denominator for browser page decoding is now
the number of new or changed pages, not the entire library. This avoids a known transient
double-residency path, but the progress label alone still cannot attribute all browser-process
memory to directory scanning rather than image decode or raster caches.

## Renderer decision

Keep the Library list and controls in Svelte. The captures show little DOM or JavaScript work at
the moment of the stall. Rewriting those pieces in WebAssembly would leave browser WebP decoding,
CSS painting, and bitmap residency unchanged.

The current smaller-page CSS atlas is a short-term test. If it still shows blank cards, long
decodes, or excessive memory after the one-time rebuild, replace the carousel's pixel path with
an explicitly owned low-resolution buffer and a WebGL2 renderer:

1. Convert original covers in a worker when added or changed. Persist fixed-size raw tiles and
   a keyed index in OPFS; do not convert device `.img` files for browser display.
2. Load the low-resolution tile data into application-owned memory at startup. At 128×170,
   RGB565 costs about 145 MiB for 3,500 opaque covers; RGBA8 costs about 291 MiB. Preserve
   transparency with RGBA8 or a separate mask where needed.
3. Upload only the visible and imminent tiles to a bounded WebGL2 texture cache. Render the
   coverflow as textured quads. Keep original-art textures in a separate, smaller cache and
   prioritize the selected game. Motion blur can then be a directional shader effect.
4. Keep conversion and persistence off the UI thread. Treat source scans, original-cover reads,
   conversion, and browser/GPU uploads as one resource budget rather than independently allowing
   four workers for each stage.

WebGL2 provides explicit texture lifetime and a cheap path from raw tile bytes to pixels. A
worker-owned `OffscreenCanvas` is an option if rendering itself later measures as expensive;
the current captures do not show that. WebAssembly may be useful for one-time pixel conversion
if profiling justifies it, but it does not remove the browser's image or graphics pipeline.

## Verification

Use the same library with 164 Atari 7800, 373 Lynx, 605 GBC, and all roughly 3,500 games.
Check far-list selection and repeated fast scrubs after a fresh load and after scans settle.
Record first visible low-resolution frame, blank-card count, long renderer tasks, image-decode
count and duration, and process memory. A renderer change earns its complexity only if it
removes the decode stalls and keeps memory bounded while retaining immediate low-resolution art.
