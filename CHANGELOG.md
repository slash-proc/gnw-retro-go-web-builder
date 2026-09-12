# Changelog

Notable changes to the Game & Watch Web Builder. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file records what a user or a contributor would notice. The commit history is the record
of how it was built, and is not repeated here.

## [2.0.0-alpha]: unreleased

A rewrite of the app around a new UI, plus device, library and SD card handling that the
previous version did not have. It replaces the 1.x app, whose source is kept at the
`v1-legacy` tag.

### Added

- **Guided Setup shows the plan before you commit to it.** The initial question draws the
  choices on the left and the steps each one produces on the right, updating as you move between
  them. Choosing commits in place instead of replacing the page.
- **The SD card is a source.** It appears under Local sources in the Sources tab, holds one
  selection, and has its own page: a contents table broken into nine categories, a fill bar, and
  the states for a card that is missing, unreadable, unnamed or only partly readable.
- **Stated card capacity.** No browser API reports a picked directory's volume, so you tell the
  app the card's nominal size and it looks up the real usable figure from a table measured by
  formatting sparse images, minus a safety margin. Sizes the card has already outgrown are
  refused.
- **Legacy homebrew migration.** A card still holding `roms/homebrew` is offered a move to
  `/homebrews`, file by file, copying and verifying each before deleting the original. Files
  already present at the destination with differing content are never overwritten.
- **A version picker when installing firmware**, in the modal that asks what to carry over. One
  control reads as Upgrade, Reinstall or Downgrade depending on the release you pick.
- **The Library list sorts** by system, filename, size or action, in either direction, in the
  active locale's collation. Unsized rows sort last in both directions rather than as zero.
- **Favourites**, marked from the game list and carried into the on-device favourites file.
- **The Activity log is split by page load**, with each session listed and selectable, and the
  live one drawn as a session with no end time yet.
- **Cover art lookup covers 250 systems** via a shipped ScreenScraper snapshot, resolved through
  a reliability ladder rather than a single guess.
- **Fifteen languages**: English, German, Arabic, Spanish, French, Italian, Japanese, Korean,
  Norwegian, Polish, Portuguese, Russian, Ukrainian, Simplified and Traditional Chinese. Arabic
  mirrors the whole interface.
- **A desktop shell** (Electron) that loads the same build. Packaging exists for Windows, macOS
  and Linux; the native filesystem work it is meant to enable has not started.

### Changed

- **Recovery Mode no longer fights the device.** Entering it used to intermittently leave a
  black screen needing several attempts. Every path that boots the RAM stub now silences the
  liveness poll first, so the poll cannot interrupt the boot.
- **Writing an SD card touches only the SD card.** Choosing a card in Sources now also puts the
  app in SD mode, so Sync Library runs the card path rather than the device path.
- **The Library counts only games.** Only `roms/<console>/` and the homebrew directories hold
  games; cores, fonts, languages, screenshots and saves no longer appear as consoles.
- **BIOS files install only when a core needs one.** A general BIOS collection no longer ships
  its whole contents to the device.
- **Covers install with their games** rather than in bulk.
- **The firmware's boot logo is never overwritten** by a file from a user's BIOS folder.
- **Errors reach the Activity log.** Previously one error path in the whole app did; failures
  that wrote to internal state nobody rendered now surface, and nothing reports only to the
  browser console.

### Fixed

- Directory sources no longer disappear on reload, and neither do favourites or the chosen SD
  card.
- The install size projection no longer reports a change when nothing is selected: it keeps the
  cores already on the device instead of treating them as removals, and it fetches a shipped
  game's bytes before projecting rather than after.
- Cheat auto-detection finds titles again for filenames carrying an inverted article
  (`Legend of Zelda, The - ...`) or only a subtitle.
- Uninstalling games, cancelling a flash, and recovering from a dropped USB handle all work
  where they previously could fail silently.
- Screen capture is exactly 320x240, matching the original hardware.
- Layout fixes across the app: no unnecessary horizontal scrollbar, no jump between the first
  two setup steps, no clipped panel in the options modal, and the Arabic layout no longer loses
  the gutter beside the screenshot pane.

### Security

- The project is now licensed under **AGPL-3.0-or-later**. See [`LICENSE`](./LICENSE) and the
  README's licensing section for how it combines with the MIT and Apache-2.0 components it
  builds on.

## [1.x]

The previous app. It has no changelog; its history is the `main` branch before the 2.0 work
landed, kept at the `v1-legacy` tag. It is not deployed anywhere, and republishing it is
deferred: see `STATUS.md`, "Known open". The tag predates the AGPL-3.0 licensing, so the
1.x source carries no licence of its own.
