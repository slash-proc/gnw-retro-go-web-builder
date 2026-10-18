# Retro-Go repository sources

This document records the source model and user experience for adding multiple Retro-Go
firmware repositories, inspecting their curated projects, and making those projects available
alongside manually added Cores and Homebrew. Firmware repositories use the same source-list and
configure-detail rhythm as the existing Cores and Homebrew panes.

## The three different things called a source

Keep these identities separate in the UI and data model:

1. **Firmware repository** — an `owner/repo` whose `versions.json` describes Retro-Go firmware
   releases. Each release can point to a manifest and a curated `projects.json`.
2. **Curated project reference** — an entry in one specific firmware release's project list.
   It points to a project's own `versions.json` and identifies the version selected for that
   firmware release's curated set. The curated set is release/version-specific.
3. **Core or Homebrew repository** — the project's canonical `owner/repo`. Its own
   `versions.json` controls the versions available in the project's configuration page and the
   version actually used by the Library. Project identity is repository-specific.

The firmware repository's version is not the project's version. A curated project entry is a
reference to a project repository; it is not a second project repository identity or a pin on
the project's release. The current default firmware repository is
`slash-proc/game-and-watch-retro-go-sd`.

## Existing Cores and Homebrew behavior to preserve

The source catalogue is the user's set of known project repositories. Core and Homebrew are
separate kinds because they declare different install roles, but they share the same source
management workflow. A visual redesign must preserve all of the following:

- Add by repository reference, add from an offline bundle, and the existing raw-core import
  path where available.
- One row per canonical project repository, with project title, repository identity, the
  useful kind-specific metadata, current project release, and active/inactive state.
- Row selection, configure, activate/deactivate, and individual retry for a failed source.
- Select-all and per-row checkboxes, followed by bulk activate/deactivate from the footer.
- Pane-level refresh-all and add actions.
- Configuration details: release metadata, available project versions, additional required
  files, install artifacts and their sizes, local source folders, and remove.
- A selected project's pinned version remains persistent and is the version used by install;
  choosing a version in the detail page is not display-only.
- Active state continues to determine which cores and homebrew titles are offered to the
  Library and install workflows. Selecting a row is only navigation/selection and must not
  imply activation.
- Bundle provenance and offline behavior remain distinct from a network-backed repository.
  A bundle's own release does not gain a version picker that would fetch another release.
- Manifest text remains untrusted text. Never render repository metadata as markup.

Current implementation details and source/install accounting remain in
[SOURCES.md](./SOURCES.md) and [SOURCE_INSTALL_ACCOUNTING.md](./SOURCE_INSTALL_ACCOUNTING.md).

## Multiple firmware repositories

Firmware repositories are an independent catalogue. Each repository has an enabled state, and
any number can be enabled at once. Enabling a repository makes its curated projects available
for source discovery and its releases available in Advanced firmware installation. The
**Default source** is a separate choice used by Guided Setup. It must always refer to an enabled
repository. Advanced firmware installation may choose any enabled repository for that operation
without changing the Guided Setup default. Selecting a row to inspect or configure it does not
enable it or make it the default.

Each configured firmware repository should expose its published metadata, including its title,
canonical repository, release link, retained release count, and version entries. Its release
versions belong to the firmware repository. Selecting a release lets the user inspect that
release's manifest and curated project references.

When compacting repository labels, use the shortest label that is unambiguous in the current
list: show `repo` when unique and `owner/repo` when names collide. Keep the canonical
`owner/repo` available in detail and use it for every comparison, persistence key, and request.
Never compare by project title or display label.

## Curated overlap and adding projects

The same project may be curated by multiple firmware repositories or firmware releases. Treat
the canonical project `owner/repo` as its identity and deduplicate it in the Cores/Homebrew
catalogue. Preserve each firmware release that provides it as provenance, so the user can see
why it appeared and which curated project version that release references.

From a firmware release's curated list, provide a direct add control for an individual project
that is not yet in the user's source catalogue. If that repository is already present, show its
existing state and offer navigation to its source configuration rather than creating a duplicate.
Adding a curated project makes its repository available; it does not by itself activate it,
install it, or pin its version globally.

If two curated entries point to the same project repository, retain both provenance records.
The project catalogue still has one repository row and one independently selected project
version. Do not silently change that selection when another curated list is inspected or added.
Show each providing firmware repository and release as separate provenance values.

Projects with the same title but different canonical repositories are distinct sources. Keep
both and use repository identity to disambiguate them throughout the source list, configuration,
Library, Guided Setup, install summaries, and installed-state comparisons.

## Conflicts and installed state

Configured, active, selected for setup, included by a curated list, installed on the device, and
selected for the current install are separate states. The UI should name these states directly
and avoid one generic “selected” checkbox standing in for several meanings.

When different repositories provide overlapping projects or install paths, preserve each
repository as a distinct source and surface the conflict at the decision point that can resolve
it. Do not silently merge artifacts or let one repository overwrite another based only on a
matching title or filename. Conflict handling must be based on the resolved manifest and
candidate install paths, with a clear choice of which source/version supplies the conflicting
content.

Installed matching should use canonical repository identity wherever the device metadata
provides it. If the device only exposes a title or filename, present the match as uncertain and
allow the user to inspect it; do not claim exact repository provenance from a name alone.

## Guided Setup and source selection

Guided Setup should continue to be a simple path through adding and activating the sources
needed for the chosen setup. Its source picker should make available, active, installed, and
curated-provided state distinguishable, while retaining a compact checkbox interaction for
the action the wizard is asking the user to take. The wizard should not require the user to
understand firmware repository internals just to install the normal curated set.

The Sources modal should summarize the sources already configured and the sources provided by
the firmware repository/release being considered. Selecting an item should reuse an existing
canonical source where possible. New project versions should be selectable from each project's
own release list; a firmware version selector must never be presented as if it were a core or
homebrew version selector.

## Visual direction for source pages

The Cores, Homebrew, and Retro-Go pages should share one visual language and responsive layout
while preserving their different metadata. Source identity is the strongest text, the canonical
repo is a quieter but legible second line, and kind-specific facts sit below as short readable
tokens. Release and source state are grouped at the trailing edge on wide screens and move under
the identity on narrow screens. For Retro-Go, enabled state and **Default source** are distinct
controls; neither is row selection or project activation.

Configuration should read as one coherent project profile: identity and kind, release/version
information, required local files, install contents, and source folders. Important actions stay
easy to find and consistent across Core and Homebrew detail pages. Empty, loading, error, and
bundle states must remain distinguishable without hiding retry or provenance information.

The redesign should use the app's existing typography, spacing, color, and motion tokens, keep
keyboard focus visible, respect reduced-motion settings, and preserve all text through i18n.
Apply this shared visual language to Cores, Homebrew, and Retro-Go source management.
