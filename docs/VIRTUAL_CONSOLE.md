# Virtual Console: feasibility

Research only. Nothing here is implemented. Scope: GWemu as the Electron app's
preview backend, and gnw-twin embedded in the browser build.

Everything below was read in this session. Paths are cited where a claim rests on
them. Where a claim could not be checked from here, it says so.

## Verdict

GWemu over GDB is not a feasibility question. It worked, end to end, in July 2026
on branch `feat/qemu-adapter`, against a QEMU fork that was patched in the same
week to make it work. The cost is a merge and a topology change, not a build.

The twin is a different question than the brief assumed. It has no GDB stub and
does not want one. Integrating it is not a smaller version of the GWemu work.

## 1. What already exists

`feat/qemu-adapter`, six commits, 615 insertions. Branch point `13e4c90`.

| File | Lines added |
|---|---|
| `apps/web/src/lib/engine/qemuTransport.ts` | 315 (new) |
| `packages/swd-transport/src/index.ts` | 80 |
| `backend/src/server.ts` | 50 |
| `apps/web/src/lib/engine/transport.ts` | 34 |
| `apps/web/src/lib/device.svelte.ts` | 28 |
| `packages/gnw-flasher/src/index.ts` | 18 |
| `apps/web/src/lib/ui/DeviceHeader.svelte` | 12 |
| `apps/web/vite.config.ts` | 2 |

`GdbTransport` (in `packages/swd-transport`) is an `SwdTransport` whose
`_readMemRaw`/`_writeMemRaw`/`_readCoreReg`/`_writeCoreReg` delegate to an injected
`GdbRemoteLike`. `qemuTransport.ts` implements that interface as a GDB Remote Serial
Protocol client over a WebSocket, because a browser cannot open the raw TCP socket
that gnwmanager's `--qemu` backend uses. `backend/src/server.ts` relays the bytes.

### Six traps already paid for, not four

The branch's commit subjects name four. Two more are in the STATUS.md text that
`a18b429` added, and both were performance, not correctness:

1. QEMU's gdbstub would not service `m`/`M`/`p`/`P` while running (`7d8285b`).
2. The 300ms liveness poll was a full halt/resume round trip per ping, and was the
   dominant source of the reported flicker (`d2288db`). The WS bridge already gives
   an explicit lost-link signal, so the poll was dropped to 5s and `onLost` wired to
   `handleLost()`.
3. Auto-resume needed a 75ms debounce, because one logical read becomes many chunked
   `readMemory` calls at the `BaseTransport` layer (`9967e40`).
4. The bridge runs inside the dev container, so `localhost` was the container's own
   loopback and QEMU on the host was unreachable (`2b0dfc6`). Fixed with
   `host.docker.internal` plus `extra_hosts: host-gateway` in `docker-compose.yml`.
5. `gnw-flasher`'s mailbox status poll was 10ms, faster than the 75ms resume debounce,
   so every poll cancelled the pending resume before the guest got meaningful run time.
   A starvation hang, not slowness. Raised to 150ms (`STATUS_POLL_INTERVAL_MS`).
6. The bridge socket had no `TCP_NODELAY`, so Nagle plus the peer's delayed-ACK timer
   added roughly 40ms to every RSP round trip. Fixed with `sock.setNoDelay(true)`,
   measured at about 33x on the mailbox cadence.

### It depends on a patched QEMU, and that is load-bearing

Trap 1 was not worked around, it was fixed on the QEMU side.
`~/Nerd/git/qemu-gnw/gdbstub/gdbstub.c` carries a fork-local patch at roughly lines
2355 and 2503: the halt-while-running gate moved from per-byte in `gdb_read_byte` to
just before dispatch, and is skipped for `m` and `M`. `cpu_memory_rw_debug()` is the
same accessor the monitor's `x`/`xp` use live, so it is safe from a running VM.

`qemuTransport.ts` was then changed to stop wrapping memory ops in `withHalted()`.
That change is only correct against the fork. Pointed at stock QEMU, memory access
halts the VM on every op and traps 1, 3 and 5 all return at once.

Two GWemu device-model bugs were also found by driving it from this app, and fixed
there (`qemu-gnw` CHANGELOG, 2026-07-13):

- HASH was `create_unimplemented_device`. gnwmanager's RAM stub calls
  `HAL_HASHEx_SHA256_Start(..., HAL_MAX_DELAY)` after every internal-flash write, so
  the digest-complete flag never set and every write wedged permanently.
- Internal-flash erase was a register stub with no connection to backing memory.
  Erase completed instantly and changed nothing.

Both are fixed. Both were found because the app exercised them, which is the strongest
evidence available that the flashing path really ran.

## 2. The seam, and what the Electron topology changes

The seam is `ProbeHandle` in `apps/web/src/lib/engine/transport.ts`. It already carries
the two fields the emulator path needs: an optional `device` (absent for QEMU, which has
no WebUSB device) and an optional `onLost` callback (present for QEMU, absent for the
WebUSB backends, which use the `navigator.usb` disconnect event). That shape was
designed for this and survives untouched on `feat/ui-redesign`.

**The WebSocket bridge exists only because a browser cannot open a TCP socket. Electron's
main process can.** So the desktop topology deletes a component rather than porting it:

- Browser today: renderer -> WS -> `backend/src/server.ts` -> TCP -> QEMU. Dev-only,
  since it needs the Express server, which the Pages build does not have.
- Electron: renderer -> `contextBridge` -> main process -> TCP -> QEMU.

`desktop/src/preload.js` is empty on purpose and its header already names itself as the
seam the desktop filesystem layer will arrive through, and as the security boundary for
anything crossing it. A GDB channel is a second thing crossing it. That matters, because
GWemu's own GUI defaults its stub to loopback on the grounds that it is unauthenticated
full guest-memory access (`qemu-gnw` CHANGELOG, 2026-07-26). Exposing a socket-opening
API to renderer content is a wider grant than exposing a directory handle. It should be
a fixed endpoint the main process owns, not a host and port the renderer supplies.

`apps/web/src/lib/fsNode.ts` is unrelated to this path. It backs `FsDirHandle`, which is
about the user's folders, not the device. It matters only in that both features want the
same preload bridge, so they should be designed together rather than in sequence.

### Merge cost

`transport.ts` and `backend/src/server.ts` have not been touched on `feat/ui-redesign`
since the branch point, so those two apply clean. Three files have moved under the branch:

| File | Redesign-side change since branch point | QEMU-side change |
|---|---|---|
| `packages/swd-transport/src/index.ts` | +44 | +80, pure addition |
| `packages/gnw-flasher/src/index.ts` | +308 | +18 / -4 |
| `apps/web/src/lib/device.svelte.ts` | +425 | +28 / -4 |

The `swd-transport` addition is a new interface and a new class, so it should not conflict.
The `gnw-flasher` and `device.svelte.ts` edits are small and land in files that have grown
a lot, so expect to re-apply by hand rather than merge.

One redesign-side change the branch predates: the golden lip is now driven by a
process-wide transfer observer in `swd-transport` (`emitTransfer` in `readMemory`/
`writeMemory`). `GdbTransport` extends `BaseTransport` and inherits those, so the lip
would light up for emulator traffic with no extra work. Whether that is wanted is a
design question, not a technical one.

## 3. What actually works against GWemu

GWemu boots retro-go and stock/CFW Mario and Zelda end to end, interactive and playable,
with display, audio, input, SD card and persistence (`qemu-gnw/docs/STATUS.md`, v0.0.16,
2026-07-26). It is a real STM32H7B0 machine model, not a fault-trap shim.

| Flow | Against GWemu | Why |
|---|---|---|
| Flash write, internal | Real | HASH and flash-erase device models were fixed specifically for this. |
| Flash erase | Real | Wired to the actual bank memory, `memset` to `0xff`. |
| FrogFS / LittleFS install | Real | It is flash writes plus the RAM stub, both modelled. |
| `readFlash` | Real | Dual-bank SPI/OSPI flash is modelled. |
| RAM stub load and run | Real | Blank internal flash is a supported state; Lockup stands down under `RUN_STATE_DEBUG` so a flash loader can be loaded and run from RAM. |
| Persistence across runs | Real | `bank1-image`/`bank2-image`/`extflash-image` back the regions with files via `memory_region_init_ram_from_file` with `RAM_SHARED`, so guest writes land in the file live. |
| Device scan / classification | Real | It reads flash and registers, both modelled. |
| Screenshot halt/read/resume | Works, for the wrong reason. See below. |
| Liveness poll | Deliberately near-disabled on this path. 5s, and loss is detected by the bridge closing instead. |
| Unlock (RDP 1 to 0) | Not verified. Not checked in this session, and `FLASH_R` is modelled but option-byte and RDP behaviour specifically was not confirmed. Assume it needs its own investigation. |

### The screenshot path is a trap, and it is the most important finding here

`BaseTransport.halt()` sets both watchdog freeze bits before halting:
`DBGMCU.APB3FZ1` bit 6 (`DBG_WWDG1`) and `DBGMCU.APB4FZ1` bit 18 (`DBG_IWDG1`), at
`packages/swd-transport/src/index.ts:188-191`. CLAUDE.md records at length that omitting
them was the actual cause of the device resetting mid-screenshot.

Two facts combine badly:

1. `GdbTransport` **overrides** `halt()` with a bare `this.gdb.halt()`. The freeze-bit
   writes never execute on the emulator path.
2. In GWemu, `WWDG` and `IWDG` are register-array shadows with correct reset values and
   no side effects (`qemu-gnw/docs/peripheral-coverage.md:45`). `DBGMCU` is the same
   (line 46). There is no watchdog to bite and no freeze bit that does anything.

So the screenshot works under GWemu, and would keep working if someone deleted the freeze
bits entirely. **GWemu cannot validate that logic, and a preview mode that looks like it
covers the halt/read/resume path will quietly not cover it.** Anything that touches
`BaseTransport.halt()` still needs a real device. This is worth a comment next to the
freeze-bit writes if the Virtual Console ships.

## 4. The twin is a different integration

The brief framed the twin as GWemu with less capacity, limited by OPFS. That is not what
it is.

- **No GDB stub, by design.** `dev/diag.js:13` states it directly: it reads the result
  struct straight off the bus, "no GDB stub needed", because the engine is in-process.
  `grep -rn gdb` across `dist/twin.js` and `devices.js` returns nothing.
- **It exposes a synchronous bus instead.** `m.bus.read32(addr)`, `m.bus.read8(addr)`
  (`dev/diag.js:47,66`). That is a closer fit to `SwdTransport`'s
  `_readMemRaw`/`_writeMemRaw`/`readWord`/`writeWord` than RSP is, and needs no packet
  framing, no WebSocket, no bridge, and no backend. A `TwinTransport` would plausibly be
  smaller than `qemuTransport.ts`'s 315 lines.
- **Storage is already solved there, at 8 GB.** `dist/sd-opfs.js` backs the SD card with
  an OPFS file through `createSyncAccessHandle()`, offers card sizes up to 8 GB, and
  already maps `QuotaExceededError` to its own `'quota'` error code. It runs in a worker
  because the sync handle is worker-only, which is where the engine already runs.
- **It is mature.** 39+ device tests pass with the JIT on; `dev/test-diag.js` is 135 OK /
  0 FAIL / 0 UNRUN against the same conformance suite scored on real silicon
  (`gnw-twin/HANDOFF.md`). It runs doom, quake and retro-go workloads
  (`dev/probe-profile.html`).

What is genuinely unresolved for the twin is not size, it is **whether it models what this
app writes to.** The app's job is flashing: internal flash banks, external flash, FrogFS
and LittleFS images. The twin boots firmware from those regions. Whether it models an
erase/program cycle, the FLASH_R control registers and the RAM-stub mailbox protocol the
way GWemu now does was not established in this session, and it is the question that decides
the whole thing. If it does not, the browser Virtual Console is a viewer, not a target, and
the app cannot install into it.

### Storage quota, honestly

I could not measure a browser quota from this environment: no browser, no network. What is
verifiable:

- `navigator.storage.estimate()` reports the **origin's** quota, not any device's capacity.
  `apps/web/src/lib/sdStorage.svelte.ts:12` already records that, and the Details pane
  deliberately draws no SD capacity for exactly this reason.
- Quota is per-origin and set by browser policy against free disk. It is not a fixed number
  and should be measured on the target machine, not cited.
- The twin already treats exhaustion as a first-class error rather than assuming headroom.

The sharper point is that quota is **shared**, not merely finite. In the browser build the
twin's SD image would sit in the same origin as our own OPFS blob cache
(`apps/web/src/lib/sources/blobCache.ts`) and both IndexedDB databases, all of which already
go through `scoped()` (`apps/web/src/lib/storageScope.ts`). An 8 GB card image and a bundle
cache competing for one quota is a design problem regardless of how large the quota turns
out to be. If the browser twin ships, its card size wants to be a deliberate small default,
not the twin's own 8 GB maximum.

## 5. Cost

Rough. Stated as ranges because several depend on findings not yet made.

| Piece | Size | Confidence |
|---|---|---|
| Merge `feat/qemu-adapter` forward, re-apply the three moved files | Small | High. Two files apply clean; the other three edits total 46 lines added. |
| Move the bridge from the Express backend into the Electron main process | Small to medium | High. It is a socket relay; the work is the preload contract and its security review, not the relay. |
| Preload bridge design shared with the `fsNode` filesystem work | Medium | Medium. Should be designed once for both, which is a scheduling constraint more than an engineering one. |
| Ship or locate a GWemu binary per platform | Medium to large | Low, and this is the least examined part. The built binary here is 145 MB (`~/Nerd/git/qemu-gnw/build/qemu-system-arm`). Bundling that into the Electron release changes the release story on every platform, and the desktop build is already unsigned on both macOS and Windows. Locating a user-installed GWemu instead is smaller but pushes setup onto the user. Not investigated. |
| Verify unlock / RDP against GWemu | Small | Low. Unknown whether it is modelled at all. |
| Guard the freeze-bit gap so nobody trusts the emulator for it | Trivial | High. |
| `TwinTransport` against `m.bus` | Small, IF the twin models flash writes | Low, because that premise is unverified. |
| Establish whether the twin models erase/program and the mailbox | Unknown | This is the next thing to find out, and it gates everything else on the browser side. |

## 6. Recommendation

Take the Electron path. It is a merge plus a topology simplification against a backend
that already boots the real firmware, and it was working two months ago.

Treat the browser twin as a separate proposal that is not blocked on quota and is blocked
on one unanswered question: does it model flash writes. Answer that before sizing anything
else.

Two things to carry into whatever ships:

- The Virtual Console must not be described, in UI or in docs, as a way to test the app
  against a device. It does not cover the halt/read/resume path, and cannot.
- The GDB stub is unauthenticated full guest-memory access. GWemu's own GUI defaults it to
  loopback for that reason. The Electron main process should own the endpoint outright.
