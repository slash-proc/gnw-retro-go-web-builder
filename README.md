# GNW Web Builder

A **browser app** that flashes firmware to a Nintendo **Game & Watch** (the 2020
*Super Mario Bros.* and *Zelda* units, STM32H7B0) and manages its games/assets —
**entirely client-side** over WebUSB/SWD. You bring your own ROMs and your own
firmware backups; nothing leaves your machine, so the hosted app carries no
copyrighted material.

It is, in effect, a from-scratch browser reimplementation of the host side of
[**gnwmanager**](https://github.com/BrianPugh/gnwmanager) plus the firmware
patcher, with the heavy firmware/core binaries pre-built by CI and fetched on
demand. See [`docs/`](./docs) for the core technical documentation.

> Requires a Chromium browser (Chrome/Edge/Opera) — WebUSB is not available in
> Firefox/Safari. Needs an SWD debug probe (ST-Link v2, or a Raspberry Pi
> debugprobe/picoprobe on CMSIS-DAP **v2** firmware).

## Status

The engine works end-to-end and is hardware-tested. See [`STATUS.md`](./STATUS.md) for a full breakdown.

| Capability | State |
|---|---|
| Connect probe (ST-Link **or** CMSIS-DAP), read device info | ✅ |
| Boot the gnwmanager RAM stub (`gnwmanager info` parity) | ✅ |
| **Flash** internal/external flash (LZMA-compressed, device-verified) | ✅ |
| **Dump** a region to a file | ✅ |
| **Patch** stock Mario/Zelda firmware → retro-go dual-boot (byte-exact) | ✅ |
| Byte-exact `liblzma` (WASM) for the patcher | ✅ |
| retro-go ROM/asset management, FrogFS/LittleFS builders, CI matrix | ✅ |
| Real UI (`apps/web`, Svelte 5 + Vite) — Setup / Manage flows | ✅ |
| On-hardware LittleFS install, Covers/Cheats | ⏳ In-Progress |

## Quick start (Docker — nothing is installed on your host)

All build/dependency work happens inside the container.

```bash
git clone --recurse-submodules <this repo>   # or: git submodule update --init --recursive
docker compose up --build
```

Open <https://gnw-builder.local> (or <http://localhost:3000>) in Chrome/Edge for the real app (Svelte + Vite):
connect your probe + a Game & Watch, then use the Easy Setup or Advanced mode tabs. 

See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for the dev workflow, tests, and gotchas.

## How it's built

The real logic lives in zero-dependency TypeScript packages (a layered "engine").
**`apps/web/`** is the real UI (Svelte 5 + Vite) that drives it. The production
app is a static, client-side site (GitHub Pages) with no server.

```
packages/
  swd-transport/  L1 — one SwdTransport interface, two WebUSB backends (dapjs / webstlink)
  gnw-flasher/    L2 — gnwmanager mailbox protocol in JS (startStub/info/flash/dump)
  thumb-asm/      in-house ARM Thumb-2 assembler (replaces keystone) used by the patcher
  gnw-patch/      firmware patcher: stock OFW → retro-go build, byte-exact (+ WASM liblzma)
  builder-core/   L3 — orchestrator "endpoint" API (build descriptor, artifacts, flash)
  fs-builders/    L-FS — FrogFS/LittleFS/SD image builders and orchestrator
apps/web/         The real UI — Svelte 5 + Vite SPA (connect-first wizard + advanced tabs)
backend/          Dev-only Express server (legacy harness + /packages, /api)
frontend/         Throwaway single-page test harness (served at /dev)
docker/           Dockerfile and Nginx local proxy configurations
references/        Pinned submodules (gnwmanager, retro-go) used as porting references
docs/              Documentation (start at docs/README.md)
```

The defining design idea: **OpenOCD/gnwmanager's "host" is just memory
read/write + halt/resume over SWD**, which `dapjs`/`webstlink` already provide in
the browser — so the whole stack reduces to a thin transport (L1), the
gnwmanager mailbox protocol replayed on top (L2), and on-device blobs reused
as-is. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Correctness

Anything that must match an upstream tool byte-for-byte is validated against a
**reference oracle**, not eyeballed:

- the **Thumb assembler** vs the upstream Python assembler (341k inputs) *and*
  keystone's own cached output (1122 real instructions);
- the **WASM `liblzma`** vs Python's `liblzma` 5.4.1 (72 vectors);
- the **firmware patcher** vs the real gnwmanager patcher run on real backups
  (patched images match SHA-1 exactly, for both Mario and Zelda).
- the **FrogFS / LittleFS builders** vs the original Python generator scripts.

## Documentation

Start at [`docs/README.md`](./docs/README.md). The documentation has been strictly consolidated into 5 core documents:

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — The layers, packages, design decisions, and the **Master Glossary**.
- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — Build workflows, CI Artifact pipeline, and oracle testing.
- [`docs/FILESYSTEMS.md`](./docs/FILESYSTEMS.md) — The definitive guide on FrogFS / LittleFS and data structures.
- [`docs/PATCHING.md`](./docs/PATCHING.md) — How the firmware patcher works.
- [`docs/UX_DESIGN.md`](./docs/UX_DESIGN.md) — The UI component structure and Svelte workflows.

## Licensing & ethics

ROMs and firmware backups are **user-supplied and never uploaded**. Reference
submodules (`gnwmanager`, retro-go) keep their own licenses; vendored device
blobs and novel-code payloads from gnwmanager are Apache-2.0 (see the relevant
`PROVENANCE.md` files). This tool is for working with hardware **you own**.
