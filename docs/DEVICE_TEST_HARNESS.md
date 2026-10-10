# Device test harness

## Status and implementation plan

The harness runs Dockerized Playwright tests against the web app and GWemu,
with reusable UI workflows, selected screenshots, app debug logs and
GDB/QMP diagnostics. Expensive browser profiling is opt-in. The native Chromium
profile path is published and usable; older scenarios still use a directory
bridge.

The agreed implementation sequence and stopping point are in
[DEVICE_TEST_IMPLEMENTATION_PLAN.md](DEVICE_TEST_IMPLEMENTATION_PLAN.md).
That checklist is authoritative for unfinished work. Current evidence:

- Native directory source creation through the app has passed on distribution
  Chromium over `https://localhost/` through the nginx container.
- **Allow on every visit**, followed by reload and navigation back to Directory
  Sources, grants access to all three sources. The app can initially display
  only the triggering source as granted until reload.
- All three native handles remained granted and readable after a further
  visible Chromium restart. The local profile is `directories-ci`.
- The `directories-ci` seed passed true headless validation. Two concurrent
  tests on independent copies passed without changing the seed.
- `clean`, `directories`, `roms-only`, `roms-bios`, `no-backups`, and
  `full-library` recipes have passed their available headless checks.
- The native modular locked flow passed: locked Status → add an isolated OFW
  backup source → pristine firmware backup → patch and unlock → press B to
  return to stock → Status asserts **Connected (Stock)** and **Unlocked**.
  The latest run is `dev-local/reports/20261007-212145-22b69271a037`.
- GWemu screenshots in Playwright reports are decoded from QMP's P6 PPM output
  and stored as actual PNG files. The latest device screenshots were checked
  for PNG signatures; previously mislabeled PPM screenshots in retained reports
  were repaired.
- Stock locked/unlocked and gwprov-provisioned Retro-Go presets passed Status
  checks. Step 6 uses durable local media and hash/table records instead of
  per-install image snapshots.
- The composed Retro-Go sync run at
  `dev-local/reports/20261007-222148-e2237fae467d` completed the UI sync,
  pressed B after the RAM flasher, captured Doom on GWemu, pressed UP once,
  and captured Tetris. The two QMP screenshots and OCR confirm the selection
  changed to Tetris. Browser and device seed fingerprints stayed unchanged.
  Its contents comparison flagged four additional empty LittleFS directories
  against the older `tetris-synced-v2` observation; file entries and hashes
  matched. The same discrepancy reproduced with full instrumentation in
  `dev-local/reports/20261007-222553-18617c2c25ee`. The baseline remains
  unchanged pending a correctness decision.
- The large-library composed run at
  `dev-local/reports/20261007-221915-32390aaf0eee` passed directory persistence,
  navigation, Guided Setup and full collection settle: 5,927 games were visible.
- The stock-to-dual-boot Retro-Go install passed in
  `dev-local/reports/20261007-222015-68db1e46efb4`.
- Both instrumentation modes passed bounded-ring/log-burst checks. Each report
  retained all 2,025 generated app audit entries and 1,031 console lines,
  including a 1,025-line `console.debug` burst:
  `20261007-221753-6476e5b669ec` (off) and
  `20261007-221833-de056a9926e2` (full).
- A production-style Status run verified the shared fixture captures the actual
  app audit stream as well as every browser console level:
  `20261007-223637-8b2da0bd7b07` contains 24 app audit entries and 30 console
  records. This also guards against the previous Vite-source import hook, which
  did not work through the built app served by nginx.
- The bounded-ring/log-burst test was repeated after that fix in both modes:
  `dev-local/reports/audit-capture-off` and `dev-local/reports/audit-capture-full`.
  Each retained 2,025 audit records and 1,025 generated `console.debug` lines.
- Xvfb desktop tests default to 1920×1080 (1080p); set
  `GNW_TEST_DESKTOP_SIZE=2560x1440` for 1440p.
- Reports are capped at 10 timestamped runs. The retention cleanup now also
  recognizes older descriptive report names and files owned by the current
  Chromium test container.

Do not treat current-session readability as proof of permanent permission.

## Configuration and local files

Copy the example into the repository root:

```sh
cp tools/device-test/config.example.yaml device-test.yaml
```

The ignored YAML contains external data locations, plus an optional local
artifact directory. It is not a test scenario definition:

```yaml
dev_local: ./dev-local
roms:
  - ~/Emulation/Roms
firmware_bios:
  - ~/Emulation/BIOS
ofw_backups:
  - ~/Emulation/OFW Backups
```

Each group is a list. Every configured directory must be mounted into the
browser container. For native profiles, paths beneath the developer home are
translated to `/home/user`; for example `~/Emulation/Roms` becomes
`/home/user/Emulation/Roms`. Other paths use
`/inputs/<group>/<index>/<basename>`. Native handles refer to these stable
container paths. Browser HOME should also be `/home/user`.

Local artifacts belong under the configured `dev_local` directory:

| Directory | Contents |
| --- | --- |
| `browser-profiles/<name>/browser/` | Chromium user-data directory, native handles and permissions |
| `browser-profiles/<name>/profile.json` | Published seed manifest after validation |
| `gwemu-profiles/<name>/` | Device media and device-state manifest |
| `runs/` | Disposable working environments |
| `reports/` | Playwright reports, screenshots and diagnostic evidence |
| `cache/` | Downloaded release files and preparation cache |

`dev-local/` and `device-test.yaml` are ignored. A custom artifact directory
outside `dev-local/` must also be excluded from Git by the developer. Recipes in
`tools/device-test/profiles/recipes.json` describe portable presets; proprietary
blobs and actual browser profiles are never committed. Existing old artifact
directories migrate to this layout on first use. `device-test-reports/` is a
compatibility link to `dev-local/reports/`, not a second report store.

Prerequisites: Docker, Python with PyYAML, and Docker Compose. The app runs in
the Compose `dev` service; HTTPS is supplied by `proxy` (nginx). GWemu lock
state is a property of the emulated device, independent of whether OFW is stock
or patched.

## Native directory seed procedure

1. Start a fresh distribution Chromium profile in Docker. Mount every configured
   source and open `https://localhost/` through nginx.
2. Add all sources through the app and native picker: ROMs shared, firmware/BIOS
   dedicated to BIOS, OFW backups dedicated to OFW backup.
3. Verify the saved paths and roles, then close Chromium cleanly.
4. Reopen the same profile and navigate to Sources → Directories.
5. Open one source with Configure. Chromium's restore popup lists the saved
   directories together. Click **Allow on every visit**, not **Allow this time**.
6. Reload, then return to Sources → Directories. Verify all expected native
   handles are granted and enumerate successfully.
7. Close Chromium; verify the same permissions in another browser process.
   The final publication check must run truly headless.
8. Publish the stopped profile as a seed. Tests run on independent copies.

Native picker and browser-chrome interactions require a headed browser. They
can use a normal desktop or Xvfb + Openbox inside Docker. Xvfb defaults to
1920×1080 (1080p); set `GNW_TEST_DESKTOP_SIZE=2560x1440` for 1440p. For visible
offscreen runs, VNC is bound to `127.0.0.1:5901`; Remmina connects to that address.
Keep the viewer visible during interactive debugging. Normal feature tests
should run truly headless once their seed is ready.

The older bridge supplies test directory handles every run and can operate
headlessly. It reads real configured files but does not establish Chromium's
native persistent directory permissions. It must not replace native handles
when a native seed is selected. Permissions are tied to the origin and paths;
HTTP and HTTPS profiles cannot substitute for each other.

## CLI: current interface and integration boundary

The public entry point is `python3 tools/device-test/run.py`:

```sh
python3 tools/device-test/run.py --list-tests
python3 tools/device-test/run.py --list-suites
python3 tools/device-test/run.py --browser-profile roms-bios \
  --browser-preset roms-bios \
  --gwemu-profile stock-locked --suite locked-backup-patch --virtual-desktop
python3 tools/device-test/run.py --browser-profile full-library-native \
  --suite full-library
```

Select local seeds with `--browser-profile NAME` and `--gwemu-profile NAME`,
then append `--test tab/feature` selections and `--suite NAME`. Their command
line order is preserved. A composed run shares its browser and device session.
Missing presets are generated from explicit recipes; a verified seed is copied
into a new working directory before any test changes it.

Available browser recipes are `clean`, `directories`, `roms-only`, `roms-bios`,
`no-backups`, `full-library`, and `full-library-atlas`; available GWemu recipes
are `stock-locked` and `stock-unlocked`, plus `retro-go`. Native directory
creation requires a visible or virtual desktop; resuming a published seed can
run headless. Device seed provisioning runs gwprov subcommands on the host; the
test target runs in Docker.

The `directory-source-seed` suite performs native permission provisioning and
publishes the directory seed when used with a new `--browser-profile`; the
runner prepares the missing profile before it executes the suite. The first
provisioning requires `--virtual-desktop` or `--view-desktop` for the native
picker and persistent permission prompt. `directory-source-resume` checks an
already published seed in a later browser process and can run headless.
`locked-backup-patch` composes the locked Status, backup, patch/unlock,
return-to-stock and unlocked Status checks in one session. The command above
uses a ROM + BIOS seed without an OFW backup source because the backup step
creates an isolated run-local destination.

### Browser instrumentation

Browser profiling defaults to `off`, for both modular and legacy CLI runs.
Normal runs capture all browser console levels, including `console.debug`, and
app audit entries including debug. Logs are copied in batches when new entries
arrive; the harness does not repeatedly scan the audit ring, and earlier entries
remain in the report after the app's bounded buffer evicts them. Selected
screenshots and minimal workflow progress checks remain enabled. Periodic heap
reads, DOM/image inventory walks, diagnostic snapshots, memory polling and
Playwright traces are disabled.

Audit capture uses a conditional bridge in the app's audit store, activated only
when the Playwright fixture exposes its sink. It works with both Vite and the
built nginx-served app; the fixture does not import a development-only `/src/`
URL. `app-debug.jsonl` and `app-debug.log` hold the current page-load audit
entries. `browser-console.log` independently retains all console levels.

When a run fails, repeat the same command with
`--browser-instrumentation full`. Full mode enables renderer heap and UI
sampling, app library phase
timings, periodic GDB/carousel/cover snapshots, and Playwright traces retained
on failure. Legacy runs also collect container and Chromium process memory.
The report records the instrumentation mode. For example:

```sh
python3 tools/device-test/run.py --browser-profile full-library-atlas \
  --suite full-library --browser-instrumentation full
```

For the older workflow interface, place the option after `--legacy`, for
example `run.py --legacy --browser-instrumentation full --session`. Runs using
durable `--device-state` alter that state; reset it from its seed before
repeating a failing write workflow.

Prepare a large-library seed explicitly before using it as a named source:

```sh
python3 tools/device-test/run.py --browser-profile full-library-native \
  --prepare-browser-profile full-library --virtual-desktop
```

The `full-library` recipe retains all configured sources and validates their
saved directory handles; it does not scan the Library. The `full-library` suite
performs full collection coverage each time it runs.

Create a separate warm-cache seed from a verified native directory seed. It
builds the carousel atlas, closes Chromium, then restarts Chromium to confirm
the saved OPFS pages decode and match the current full-library signature:

```sh
python3 tools/device-test/run.py \
  --browser-profile full-library-atlas \
  --from-browser-profile full-library-native \
  --prepare-browser-profile full-library-atlas
```

The first preparation scans the configured collection and can take several
minutes on a cold cache. The report records the full-library count, atlas page
and source counts, and the cache read after restart. Use the seed for subsequent
large-library checks or other tests that benefit from precomputed covers:

```sh
python3 tools/device-test/run.py --browser-profile full-library-atlas \
  --suite full-library
```

Use `full-library-native` for a cold-cache atlas build measurement. Use
`full-library-atlas` when the test should start with the saved atlas pages.

Existing workflow flags remain accessible with `--legacy`:

```sh
python3 tools/device-test/run.py --legacy --directory-sources-only
python3 tools/device-test/run.py --legacy --pristine-backup-unlock-e2e
python3 tools/device-test/run.py --legacy --dualboot-install-e2e
```

The native modular pristine scenario uses an empty run-local backup destination,
backs up a locked device, verifies the backup, patches OFW and flashes the
bootloader, presses B to return to stock, then asserts Unlocked on Overview →
Status. The legacy pristine scenario follows the same device sequence through
the older runner.
The legacy supplied-backup dual-boot scenario skips the fresh backup, patches
OFW, installs the live published Retro-Go release, and installs original Game
Boy Tetris. `Game Boy/Tetris.zip` is expected beneath a configured ROM root.
The native modular `dualboot-install` suite currently ends after the Retro-Go
install; `library/sync-tetris` is a separate building block backed by the gwprov-generated
Retro-Go seed. Long-term runs explicitly select a durable device state.

Legacy source profiles use synthetic handles and re-register them. Native seed
integration must preserve real handles and avoid this re-registration. Legacy
independent spec invocations do not yet share a browser session.

## GWemu seeds provisioned through gwprov

Install gwprov with its dist/media dependencies, then put its executable on PATH
or select it in root `device-test.yaml`:

```yaml
gwprov:
  command: /path/to/gwprov-venv/bin/gwprov
  # Alternatively: [/path/to/python, -m, gwprov]
gwemu_presets:
  retro-go:
    variant: flash
    repo: sylverb/game-and-watch-retro-go-sd
    # version: v2.0.0-rc1  # Optional pin; omitted resolves the newest release.
    bootloader_version: v1.0.8
    extflash_mib: 64
    littlefs_mib: 2
    projects: [tgb, doom]
```

`GNW_TEST_GWPROV=/path/to/gwprov` overrides the default PATH lookup when no
`gwprov.command` is configured. A command string is an executable path, not shell
code; use a list for multiple arguments. The example config includes project
input/firmware/game overrides, each translated to the matching gwprov CLI option.
Only gwprov constructs firmware or media: stock presets use `profile stock`, and
Retro-Go uses `retro-go install`, `project install`, and `profile create`.

The default Retro-Go recipe contains the GB core and Doom with shipped shareware.
Tetris is deliberately absent so the Library sync test performs a real install.
The official v1.0.8 base-address bootloader occupies bank 1; released Retro-Go is
in bank 2. Protection state is a separate `rdp-state.bin` initialized by gwprov.
The flash capacity is pinned to 64 MiB for current emulator compatibility; SD seed
assembly is not supported yet. Project/firmware versions and computed hashes are
retained in the seed's gwprov `provision.json` and harness `profile.json`.

```sh
# Prepare once; publication is atomic and existing seeds are never overwritten.
python3 tools/device-test/run.py --gwemu-profile retro-go-gwprov \
  --prepare-gwemu-profile retro-go

# Validate visible Status and retain browser + device screenshots.
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-gwprov --suite retro-go-ready

# Sync through the web UI against fresh copies, without changing either seed.
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-gwprov --suite library-sync

# Generate missing media automatically when selecting the Retro-Go preset.
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-new --gwemu-preset retro-go --suite retro-go-ready
```

Use an already published native browser seed for these headless commands. The
runner clones both seeds for each session, preserves the complete media and RDP
state, and compares fingerprints afterwards. No startup halt is requested.
Provisioning command output is stored beside the device seed in
`<name>-provision.log`; subsequent reports copy the seed metadata and log to
`device-profile.json` and `device-provision.log`. Failed provisioning never
publishes a seed. Choose a new seed name to change its recipe.

## Coverage and priorities

Reusable building blocks live in `tools/device-test/workflows/`. Navigation
encodes tab dependencies: Device log is reached through Overview. Separate
workflows cover sources, Guided Setup, backup, patch, Retro-Go installation,
Library settling/sync and Status verification. The scenario inventory and
frequency live in `tools/device-test/scenarios/matrix.json`.

### Changed-test recommendations

The optional recommender compares an available commit/ref with the complete
current worktree, including staged, unstaged, and untracked files:

```sh
python3 tools/device-test/run.py recommend --base origin/main
python3 tools/device-test/run.py recommend --base HEAD~1 --json
```

Use a fetched remote ref such as `origin/main`, a local branch, or a commit hash.
The tool reports changed paths and nearby changed function/class declarations,
then maps affected areas to existing `--test` and `--suite` choices with a
reason. Declaration discovery is a lightweight source heuristic, not a full
language parser. Unmapped files are listed explicitly. Recommendations are
advisory: the command never runs tests, suppresses tests, or changes CI behavior.
Run the normal broad validation gate as usual; for example:

```sh
npm --prefix apps/web run check
```

The mapping rules live in `tools/device-test/recommend.py` beside the CLI
catalog, so adding a test or suite can be followed by updating its relevant
change rules.

| Surface | Essential coverage | Periodic or remaining coverage |
| --- | --- | --- |
| Overview | connection, lock state after patch, recovery transitions | Details, Activity, Device log navigation |
| Firmware · Guided | verified backup, patch/unlock, bootloader and Retro-Go install | other setup branches, interruption/recovery |
| Firmware · Advanced | install and underlying read/write correctness | file browser, write/dump/erase panes and ranges |
| Sources | native persistence, shared/dedicated roles, BIOS and OFW inventory | cache/configuration variants |
| Library | supported systems, real collection, settled covers/atlas, sync | filtering/selection variants |

Backups, flashing, Retro-Go installation and Library sync are critical. Use
fast non-browser checks for underlying logic and representative browser writes
for integration; avoid redundant long flash matrices. Run
`npm --prefix apps/web run check:core-workflows` separately. The legacy runner
also records that command's output in its report; the native composed CLI does
not run it automatically. These checks complement browser tests; they do not
replace verification of the visible workflow.

Run a full real-library scan at least once per development test session. Settled
means source scanning and all cover/atlas/decode queues have finished, with the
progress indicator hidden. A Tetris-only collection or merely starting cover
preparation does not satisfy it. No memory cap is currently applied to the
full-library diagnostic run; report actual usage rather than narrowing sources.

On 2026-10-07, the first native full-library atlas build completed in 4.9
minutes. During the run the browser container used about 945 MiB, with no
Docker CPU or memory quota and no CPU throttling. The current working tree sets
atlas concurrency to one worker and limits each input batch to 4 MiB; that is
not a cap on total worker memory because decoded pixels and atlas pages also
occupy memory. This is a first-build measurement; saved atlas caches can make
later local runs faster.

## Reports and target behavior

Reports live in `dev-local/reports/`. The standalone `playwright-report.html`
opens through `file://` and preserves Playwright steps and embedded screenshots.
`html/` contains the original report and assets. Relevant runs also contain
`run.json`, app debug logs, operation progress, GDB transport evidence, device
screenshots and failure diagnostics. Native composed runs save captures under
`screenshots/` with increasing numeric prefixes and a `screenshot-index.json`
manifest, so browser and GWemu images sort in capture order. Long backup,
patch, Retro-Go install, and Library sync operations capture at each named
progress transition and every 10–15 seconds while a stage remains active. The
default report retention is **10**; active runs must be preserved.

Published Retro-Go releases include matching debug symbols. Local source trees
are optional for development; tests normally use the live published artifacts
and curated content.

Headless GWemu uses its Docker image by default. `-display none` disables the
emulator's host GUI; it does not preserve firmware, halt the CPU, or freeze its
screen. Media persistence comes from explicitly selected local device profiles. Tests must
not pause/reset GWemu to simulate app actions: halts/resets come from the app;
QMP inputs simulate console buttons where a physical user action is needed.

GWemu's `rdp-locked` and `rdp-image` parameters represent initial/persistent
**device protection state**, not properties embedded in OFW images. Stock and
patched OFW are separate firmware states. gwprov owns media provisioning and
console input tooling; the harness composes its CLI commands. `REMOTE_INPUT`
requires firmware compiled with REMOTE_INPUT enabled.

## Durable device state and small verification records

Normal native runs clone seed media, record `media-before.json` and
`media-after.json` through gwprov, then remove the run's media. The records contain
sorted filesystem tables, file sizes/hashes, partition hashes and image hashes.
Inspection happens with GWemu stopped; it never formats or writes filesystems.

Use `--device-state NAME` to reuse **one** local device workspace across runs:

```sh
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-gwprov --device-state daily \
  --suite retro-go-ready --record-media initial

# Restart the same device media and compare its filesystem contents.
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-gwprov --device-state daily \
  --suite retro-go-ready --expect-media dev-local/expectations/initial.json

# Real UI write on fresh ephemeral media; record a small observed baseline.
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-gwprov --suite library-sync --record-media synced
python3 tools/device-test/run.py --browser-profile roms-bios \
  --gwemu-profile retro-go-gwprov --suite library-sync \
  --expect-media dev-local/expectations/synced.json
```

The durable workspace lives in `dev-local/device-states/NAME/`, with initial seed
identity and `history.jsonl` containing run results and small inventories. It is
locked against concurrent use; it is never implicitly reset. Add
`--reset-device-state` to a run to explicitly discard that state and recopy its
seed. Failed durable runs retain their modified device state. Browser sessions
still use independent copies of the selected browser seed.

Named expectations live in `dev-local/expectations/NAME.json`; successful new
records also have `.meta.json` with tests, source provenance and report identity.
Existing expectations are not overwritten. Record new names for later stages.
No media snapshots are retained for each stage. Reports keep at most 10 runs;
the durable history and named expectation records remain independently available.

Comparison defaults to sorted filesystem tables and file hashes, ignoring
allocation order, filesystem timestamps and unused space. A CRC-valid 80-byte
`data/INSTALL` v1 marker also receives a comparison hash that excludes only its
`installedAt` timestamp and dependent CRC. Its raw hash and timestamp remain in
the inventory; malformed markers are compared byte for byte. FrogFS hashes represent stored
file bytes and record compression; LittleFS/FAT hashes represent file contents.
`--compare-media image` additionally requires raw image/partition hashes to match.
Pin inputs/releases for repeatable runs. Baselines record observed output; they
are not an independent declaration of correctness.

To compare gwprov output with an app-written profile directly:

```sh
gwprov media inventory --profile /path/to/gwprov-profile --output provisioned.json
gwprov media inventory --profile /path/to/app-written-profile --output written.json
gwprov media compare provisioned.json written.json
```

Current default recipes generate flash profiles. Inventory also supports bundled
FAT SD images and standalone `--image ... --filesystem fatfs --offset ...`.
LittleFS uses Retro-Go's reversed block addressing. The older `--legacy` runner
is outside this new inventory/state lifecycle; use named native profiles.
