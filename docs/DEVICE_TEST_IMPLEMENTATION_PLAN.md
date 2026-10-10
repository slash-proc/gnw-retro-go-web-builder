# Persistent test environments: implementation checklist

Runtime profiles, firmware blobs and reports belong in ignored `dev-local/` (or the
location selected by root `device-test.yaml`). Recipes and harness code are tracked.

1. **Finish seed integration.** Verify the native directory seed truly headless,
   register it with the CLI, and standardize distribution Chromium and HTTPS
   provisioning. Provisioning adds all sources, closes Chromium, reopens the same
   profile, chooses **Allow on every visit**, reloads and returns to Directory
   Sources, then verifies all native handles after another browser restart.
2. **Clone seeds per run.** Give each run an independent working copy. Verify
   concurrent copies and prove the reusable seed is unchanged.
3. **Connect seeds to modular tests.** Reuse workflows for sources, large-library
   settling, status, backup, patch/unlock, Retro-Go installation and library sync.
   Ordered test selections share one browser/device session. The native seed must
   never be replaced with synthetic directory handles.
4. **Add browser presets.** Support clean, fully provisioned and partially configured
   start points; presets are recipes and generated machine-local seeds.
5. **Add GWemu presets.** Provision pristine locked stock and unlocked stock. Clone
   device media per run and express locking as device state, not firmware content.
   Provision Retro-Go through gwprov using released firmware, the official
   bootloader, cores and game content; verify Status and a modular Library sync.
6. **Add media verification and long-term upgrade state.** Keep one explicitly
   selected local device workspace across installs. Ordinary tests use ephemeral
   media and retain sorted FrogFS/LittleFS/FAT tables and hashes instead of image
   snapshots. Record observed baselines; compare with gwprov as needed.
7. **Finish CLI and documentation.** Explain profiles, repeated `--test`, ordered
   suites, provisioning, reuse, diagnostics and troubleshooting.
8. **Run the regression battery.** Cover essential workflows and large-library
   behavior at least once per session; retain at most 10 reports.
9. **Add an opt-in changed-test recommender.** Compare the working tree with a
   selected local or remote base, identify changed files and symbols, and suggest
   relevant modular tests/suites with a short reason. Keep this separate from
   mandatory build checks and do not silently skip broad validation. Agree the
   selection rules and CLI before implementing it. **Implemented as the
   advisory `recommend --base REF` command.**

## Authorized sequence

Implement 1–8 autonomously, including validation. The user authorized Retro-Go
provisioning and then agreed the step-6 revision: durable local media plus small
deterministic verification records, without image snapshots per install. Step 9
remains a separately agreed follow-on.

## Progress

- **1 complete:** Distribution Chromium on `https://localhost/` provisions real
  directory handles; “Allow on every visit”, reload, another restart and a true
  headless check all passed. CLI publication is verified.
- **2 complete:** Two concurrent tests used independent copies and passed; the
  published seed fingerprints were unchanged. The `roms-only` derived profile
  and `clean` profile also passed headless checks.
- **3 complete for available workflows:** Ordered modular steps share one browser
  and GWemu session. The locked-device run adds an isolated backup source,
  verifies a pristine backup, patches/unlocks, presses B to return to stock,
  and visits Status to assert **Connected (Stock)** and **Unlocked**. Latest
  verification: `20261007-212145-22b69271a037`. Device screenshot attachments are
  real PNGs. Additional destructive Advanced scenarios remain future coverage.
- **4 complete:** `clean`, `directories`, `roms-only`, `roms-bios`,
  `no-backups`, `full-library`, and `full-library-atlas` recipes are registered.
  The atlas seed was built from the verified native seed and survived a separate
  browser restart with 361 saved pages and a matching 5,927-item signature.
- **5 complete:** Stock locked/unlocked seeds represent protection separately in
  `rdp-state.bin`. All new presets use gwprov subcommands. The Retro-Go seed uses
  released flash firmware in bank 2, official v1.0.8 bootloader in bank 1, GB core
  and Doom/shareware in 64 MiB extflash. Status, Recovery, Tetris sync, rescan and
  the exact **Installed** assertion passed repeatedly. Both reusable seed
  fingerprints stay unchanged. Selection and the enabled Sync footer must settle
  before clicking. Dual-boot installation also passed with media inventory capture
  in `20261007-222015-68db1e46efb4`.
- **6 implemented:** Every native device run records before/after inventories
  through `gwprov media inventory`. Default media are deleted after the run;
  `--device-state NAME` reuses one local workspace, serialized with a lock.
  `--reset-device-state` explicitly restores it from its seed. Passing runs may
  save named JSON expectations; comparisons use filesystem tables/file hashes
  by default, with full-image hashes available explicitly. Persistent history
  retains small inventories and report links, not copies of media. Durable
  profile creation and restart/comparison passed in
  `dev-local/reports/20261007-191626-af74f22669ca` and
  `dev-local/reports/20261007-191736-3fa240955fe9`. Repeated real UI sync and filesystem comparison passed in
  `20261007-193429-342af6d053f1`; raw marker timestamps differed, while
  CRC-validated semantic hashes matched. Historical firmware-version upgrade
  matrices are future scenarios composed from the same building blocks.
- **7 complete:** Native CLI, durable state, ephemeral cleanup,
  expectation recording/comparison and gwprov inspection commands are documented.
- **8 battery run and reported:** Locked backup → patch/unlock → return-to-stock
  Status, dual-boot install, native source persistence, navigation, Guided Setup,
  the 5,927-item library settle and fast core checks passed. The library-sync UI
  also passed through recovery, install, B, and one Up; the device screenshots
  show Doom then Tetris. Contents comparison against the existing
  `tetris-synced-v2` observation failed only because the current output contains
  four additional empty LittleFS directories (`data/doom`, `data/gb`,
  `data/gbc`, `data/homebrew`). A full-instrumentation rerun reproduced the same
  difference. The expected baseline was preserved pending the user's correctness
  decision. Off and full instrumentation log-burst checks both retained all
  2,025 app audit entries and 1,025 generated `console.debug` lines. See
  `dev-local/regression-summary.md` for report links. The simulated GBA flash
  test skipped because its asset fixture is missing. Planned browser
  compatibility and Advanced destructive-operation scenarios remain outside
  available coverage.
- The complete `npm run check` logic suite passed after repairing four stale
  test fixtures. It reported the GBA end-to-end and simulated-flash suites as
  skipped because local GBA assets were unavailable; the run explicitly marks
  itself green but incomplete. Full output is in
  `dev-local/app-check-20261007.log`. Separate `svelte-check` diagnostics still
  report 66 errors and 32 warnings across 20 files; the audit-store change has
  no reported diagnostic.
- The native app's audit capture now uses a conditional sink in the audit store,
  so production-style nginx runs no longer depend on importing a Vite-only
  source URL. Status-page validation captured 24 audit entries and 30 console
  records with profiling off (`20261007-223637-8b2da0bd7b07`). The audit-log
  unit check's stale blanket ban on Library audit-log references was replaced
  with assertions for the intended multiple-cover warning and no row-level
  verdict copy; it now passes all 40 checks.
- **9 complete:** `python3 tools/device-test/run.py recommend --base REF` compares
  the selected Git ref to staged, unstaged, and untracked worktree changes;
  reports changed paths and best-effort changed declarations; and suggests
  catalog tests/suites with reasons. Unmapped files are explicit. It never runs
  or skips tests; full validation remains a separate required gate. See the
  harness guide for examples and limitations.
- Virtual desktops default to **1920×1080 (1080p)**; 2560×1440 remains an
  explicit override.
- The first full-library native atlas build passed in **4.9 minutes**. The
  current working tree configures one atlas worker and a 4 MiB input batch; the
  batch limit is not a 50 MiB total worker-memory cap. Docker had no CPU or RAM
  quota. See the harness guide for this measured first-build cost.

Report identifiers above refer to ignored `dev-local/reports/`. Reports are pruned
at ten runs, so historical identifiers may no longer exist. The current battery
summary is `dev-local/regression-summary.md`; named expectations and durable
history outlive individual reports.
