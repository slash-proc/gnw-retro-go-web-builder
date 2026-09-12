# Core/Homebrew ABI migration — research notes (2026-09-03)

> **Historical record. Much of what this doc proposes has since shipped** — read
> the code before acting on anything here.
>
> Landed since: the manifest client and sandboxed WASM converter host
> (`apps/web/src/lib/sources/`); the firmware distribution client
> (`firmwareDist/`, `dist/versions.json` on Pages) which **replaced the CORS
> worker this doc weighs in §5 — `infra/cors-proxy/` is deleted**; the core
> registry that makes a source's declared systems drive the Library
> (`sources/coreRegistry.ts`); and per-project publishing under the
> `gwrg-dist-spec`. The UI rename from "Emulator" to "Core" has since landed too,
> in the copy (all seven locales) and in internal identifiers; what a core *is*
> is defined in [ARCHITECTURE.md](./ARCHITECTURE.md), "Cores and homebrew".
>
> Kept for the reasoning behind those decisions, and for §3's ABI details.

Original status (2026-09-03): **research only, nothing implemented.** Captures
what changes for this web app now that retro-go-sd is moving cores/homebrew off
in-tree overlays and onto the firmware ABI + a standalone SDK template.

Sources read:

- `sylverb/retro-go-sd-templates` @ HEAD — `SDK_VERSION` says
  `FIRMWARE_ABI_VERSION=2`, synced 2026-08-31. Files: `README.md`,
  `sdk/tools/pack_core.py`, `sdk/tools/pack_homebrew.py`,
  `sdk/src/gw_core_entry.S`, `sdk/include/Core/Inc/retro-go/gw_firmware_abi.h`,
  `scripts/stage_release.py`, `.github/workflows/ci.yml`
- siblings `../smw`, `../zelda3` — `docs/spec/abi.md`,
  `docs/spec/distribution.md`, `docs/host-integration.md`, both
  `manifest.json`
- ours — `apps/web/src/lib/artifacts.ts`, `engine/homebrew.ts`,
  `engine/consoles.ts`, `engine/flashInstall.ts`, `views/RomManagementTab.svelte`,
  `lib/sources/**` (the manifest client + WASM converter host that replaced
  `engine/restool.ts` and `engine/homebrew.ts`, both now deleted)

## 1. Cores are no longer build-coupled overlays

`gw_core_entry.S` + `gw_firmware_abi.h` show the core locates the firmware ABI
table by reading **VTOR at runtime** (`GW_VTOR_ADDRESS 0xE000ED08`), not via
absolute firmware pointers baked in at link time. Everything goes through
`gw_firmware_abi()->…` accessors and `core_*` trampolines in
`sdk/src/gw_core_bridge.c`.

**Consequence:** the INTFLASH_BANK axis disappears for cores. That is the
premise behind `artifacts.ts`'s four-tree `ContentKey` matrix
(`bank1`/`bank2`/`sd_bank1`/`sd_bank2`) and its "instant hardfault at
PC=0x0810cdcc" comment — that hazard is gone in the new model. Firmware blobs
stay bank-specific; cores do not.

**Unresolved:** whether the SD_CARD axis survives. Cores link with
`sdk/ld/core_ram_emu.ld`, which the README says "must match firmware". If
RAM_EMU's base/size differs between SD_CARD=0 and SD_CARD=1 firmware builds,
cores remain SD-axis-specific. Needs a look at the firmware's RAM_EMU layout
across both builds.

## 2. Compatibility is a declared number

Every packed `.bin` embeds `required_abi_version` + `required_abi_min_size`
(from `GW_CORE_BUILT_ABI_*`). The firmware refuses to load a binary asking for
a newer/larger ABI than it provides. Our check becomes "firmware ABI >= what
the core asks", not "did these come out of the same zip".

Bump rules (template README): appending a fn ptr to `gw_firmware_abi_t` grows
`required_abi_min_size` without a version bump; changing a ctl signature or
adding a ctl op bumps `GW_FIRMWARE_ABI_VERSION`.

We need the firmware's ABI version exposed to us — in the firmware manifest
from our producer workflow, and ideally readable from the device.

## 3. On-disk headers we can parse in-browser

### CORE (`sdk/tools/pack_core.py`, `GNW_CORE_META_VERSION = 3`)

```
0   "CORE" magic (4B)
4   header_version  u16
6   header_length   u16   = sizeof(gnw_core_meta_t) + sum(logo sizes)
8   gnw_core_meta_t:
      u32 required_abi_version, required_abi_min_size, flags, segments_count
      segments[4]  "<III" (region, code_size, bss_size)   region: 0=ram_emu 1=itcm 2=ram_uc
      u32 systems_count
      systems[4]   "<32s16s32sIIIII8s8s" (116B):
                   system_name[32], dirname[16], extensions[32], 5x u32,
                   cheat_ext[8], reserved[8]     parse: 0=rom 1=cdrom
      version major/minor/patch (3 bytes), core_name[24], reserved[5]
...   pad/header 1bpp logo blobs (u16 w, u16 h, packed rows), in systems[] order
8+header_length  payload: segment 0 (RAM_EMU, entry at offset 0), then 1..3
```

Max 4 systems / 4 segments. One core can register several launcher tabs
(e.g. PC Engine + PC Engine CD from one `pce.bin`).

### GWHB (`sdk/tools/pack_homebrew.py`, `GWHB_META_VERSION = 1`)

```
0   "GWHB" magic
4   header_version u16
6   header_length  u16  = 96 + cover_size
8   gwhb_meta_t "<IIIIIII32sBBBB32s" (96B):
      required_abi_version, required_abi_min_size, flags,
      code_size, bss_size, cover_offset, cover_size,
      name[32], ver maj/min/patch, pad, reserved[32]
...  optional cover JPEG (decodes <=186x100, <=10 KiB)
8+header_length  code payload (RAM_EMU, entry at offset 0)
```

So the app can read a core's identity, launcher tabs, ROM extensions, cheat
format, semver and logos **from the bytes**, trusting the binary over any
manifest — the same rule smw/zelda3's `host-integration.md` already states.

## 4. Hand-maintained tables become derived data

- `engine/consoles.ts`'s `LABELS` map → `system_name`/`dirname` from installed
  core headers.
- ROM scan folder+extension classification → `extensions` from core headers.
- Cheat file format per system → `cheat_ext` (`ggcodes`/`pceplus`/`mcf`) from
  core headers instead of our table.
- `engine/homebrew.ts`'s `HOMEBREW_TITLES` → mostly dissolves (see 6).
  **DONE (2026-09):** the file is deleted; titles are a `$derived` over the active
  sources' manifests in `lib/sources/homebrewTitles.svelte.ts`, keyed
  `owner/repo#targetId`. The `celeste` special case became a manifest-derived
  `selfContained` flag. Not carried over: `virtualConsole` — see `originalSystem`
  in HANDOVER.md's open questions.

## 5. Distribution: half solved, half not

smw/zelda3 solved it and wrote it down (`docs/spec/distribution.md`).
**GitHub release assets are not CORS-fetchable from a browser** — measured:
`api.github.com` release *metadata* sends `access-control-allow-origin: *`,
but `github.com/.../releases/download/...` redirects to
`release-assets.githubusercontent.com` which sends no CORS header at all.
`raw.githubusercontent.com`, `cdn.jsdelivr.net/gh`, and `*.github.io` do send
it.

Their model: on every `v*` tag, CI publishes the same files to a **`dist`
branch** under `<tag>/` and `latest/` (machine channel), to the GitHub release
(humans/curl/immutable record), and to Pages. A consumer does:

```
GET raw.githubusercontent.com/<owner>/<repo>/dist/latest/manifest.json
GET <module url resolved against it>
verify(bytes)          # never trust the manifest for this
```

**The gap:** `retro-go-sd-templates`' CI (`.github/workflows/ci.yml` +
`scripts/stage_release.py`) publishes **only two release zips**
(`<name>-vX.Y.Z.zip` with `cores/`|`homebrews/`, and `-debug.zip`). A browser
cannot fetch those. Either the template adopts the dist-branch publish
(cleanest, upstream change) or we mirror through our CORS worker
(`infra/cors-proxy/`, works today, makes us a chokepoint).

> **Resolved:** the first option won. Projects publish `dist/versions.json` and a
> per-release `manifest.json` to GitHub Pages, which is CORS-fetchable, so no
> mirror is needed. The worker and `infra/cors-proxy/` are deleted, and
> `apps/web/test/firmwarecutover.mjs` fails the build if either returns.

## 6. Homebrew is now two repos per title

"Super Mario World" = an app `.bin` from a template-derived repo **plus**
`smw_assets.dat` produced by the `smw` repo's WASM extractor. The extractor
manifest already carries what our hand-list encodes: `inputs[]` (roles,
`required`, sha1 `variants`, `maxBytes`, i18n labels), `outputs[]` (exact
filenames + i18n labels), a `reference` run for a match verdict, and `flags`
bits. So a title entry reduces to "which app repo + which extractor repo",
with the rest read from manifests.

## 7. Pyodide goes away — **DONE (2026-09)**

`engine/restool.ts` / `restool.worker.ts` ran upstream Python restool scripts
shipped inside `web-artifacts.zip`. Both files and the `packages/gnw-restool`
workspace are deleted. The replacement — the ABI-1 WASM host per
`smw/docs/spec/abi.md` + `host-integration.md` — is implemented in
`apps/web/src/lib/sources/` (`converter.ts`, `wasmVerify.ts`, `inputGate.ts`),
covered by `sources/test/validate.mjs` (44 checks), and does all of:

- hash the fetched module, compare to manifest `sha256`, refuse on mismatch
- run `verify.mjs`, then `WebAssembly.instantiate` with **no import object**
- re-derive the ABI from the binary; manifest is convenience, never truth
- bound every length before allocating; re-read `memory.buffer` after any call
  that can grow memory
- `run_begin` + `run_step` loop in a **Worker with a timeout** (the ABI has no
  cancel flag and cannot have one; terminating the Worker is the only stop)
- module strings via `textContent` only; validate output names against a strict
  pattern *and* the manifest's `outputs[]`
- reject unknown `abi_version()` / `spec`

`extract.mjs` + `verify.mjs` in those repos are meant to be copied, not
reimplemented. Warning from their README: both are loaded by browsers as well
as node — a shebang or bare `process.argv` throws at import time and takes the
importing page down *silently*.

## 8. Path inconsistency to settle upstream

Template README says homebrew lands at `/roms/homebrew/<name>.bin`;
`pack_homebrew.py`'s docstring says loaded from `/homebrews/`;
`stage_release.py` zips into `homebrews/`. Cores are consistently `/cores/`.
This lands directly in our FrogFS dest-map — needs an authoritative answer.

## 9. Implications for this app

- `artifacts.ts` splits: firmware-bundle fetch (stays, shrinks — no content
  trees) + a new catalog/registry client (repo -> `dist/latest/manifest.json`
  -> `.bin`).
- New CORE/GWHB header parser, naturally beside `fs-builders`' FrogFS parser;
  feeds both "what's installed on the device" and "what's in the catalog".
- Installed content gains a version dimension — cores/homebrew become
  independently updatable, so a "Cores & Apps" surface showing installed
  (device header) vs latest (dist manifest) becomes a real UI need.
- Trust surface changes materially: we would install third-party executable
  code onto a brickable device. Argues for a curated catalog with pinned
  sha256 plus a distinct, explicit "arbitrary repo URL" path.

## Open questions (unanswered as of writing)

1. dist-branch upstream vs our own CORS mirror?
2. Who owns the catalog — curated JSON we control, GitHub topic discovery,
   user-pasted URLs, or tiers of all three?
3. One manifest schema (extend smw/zelda3 schemaVersion 1 with
   `kind: "core" | "homebrew"`) or a separate core manifest?
4. Does the SD_CARD axis survive for cores? (see 1)
5. Which homebrew SD path is authoritative? (see 8)
