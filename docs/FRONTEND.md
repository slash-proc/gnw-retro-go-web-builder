# Frontend invariants

Read this in full before editing anything under `apps/web/src/lib/`: components, stores,
styles or routing. These are the rules that no compiler and, in several cases, no gate will
enforce for you.

## State

- Access device properties explicitly using the `firmware` property, not the `type` property (e.g., `if (device.firmware === 'retro-go')`). The central `device` store (`device.svelte.ts`) maps classification explicitly to `.firmware`.

## Layout, scrolling and routing

- **The page is a fixed viewport and `.tabpane` is its ONLY general scroll container.**
  `App.svelte`'s `.app` is `height: 100vh; overflow: hidden`, and `.tabpane`
  (`Advanced.svelte`) carries `min-height: 0; overflow-y: auto` on its **base** rule —
  `.library`/`.guided`/`.bleed` override padding only, never overflow. `App.svelte`'s `.landing`
  is not a `.tabpane`, so it has its own copy.
  `global.css` states the same fact at the root: `html, body { height: 100%; overflow: hidden }`.
  It does **not** set `scrollbar-gutter` — a `stable` gutter lived there briefly and reserved
  scrollbar width on the right for a scrollbar that can never appear, so every full-bleed row
  (header band, nav band, footer bars) stopped short of the right edge by that width. Don't
  reintroduce it: `.tabpane`'s scrollbar is taken from inside the pane, below the chrome, so
  nothing above or below it moves when that scrollbar toggles. `--page-pad-top-guided`/
  `--page-pad-bottom-guided` are retired; `.tabpane.guided` is `justify-content: safe center`.
  Adding `overflow: hidden` to `.tabpane`, `.shell` or `.page` silently turns every tab from
  scrollable into clipped-with-no-scrollbar, and **no gate in this repo detects it** —
  svelte-check, `vite build` and every suite pass on a clipped page. Anything using
  `position: fixed` anchored to page content must also follow the pane: `SplitButton.svelte`'s
  menu listens for `scroll` in **capture phase**, because `scroll` does not bubble and the
  emitter is `.tabpane`, not the document.
- **`lib/nav.ts` is the only owner of `history`, and a bare `location.hash =` is load-bearing.**
  Browser Back navigates inside the app now: `navigate(hash, push)` pushes for a navigation the
  user performed and replaces for one the app derived, and `onRoute(fn)` pings subscribers to
  *read* `location`, never to write it. `lib/sourcesRoute.ts` parses `<pane>/<id>/config`
  positionally, because a source id is itself `owner/name`.
  The trap: `pushState`/`replaceState` fire **neither** `popstate` nor `hashchange`, while a bare
  `location.hash = ...` assignment fires **only** `hashchange`. Both listeners are wired
  deliberately. So the remaining bare assignments are what makes those cross-tab deep links
  reach the readers at all: `DeviceHeader.svelte:30`, `StatusPane.svelte:161` and
  `DetailsPane.svelte:171`, those three and no others. **Do not "tidy" them into `navigate()`**,
  which would look neater and silently break them. (This list previously named `OverviewTab.svelte`
  and `App.svelte`; the Overview rail moved those writes into the panes and `App.svelte` has none.
  Re-derive it with `grep -rn 'location\.hash\s*=' apps/web/src` rather than trusting prose.) Guarded by
  `apps/web/test/history.mjs`, which drives a miniature history stack rather than counting calls.
  `ModalShell` registers with `pushDismiss` only when it has an `onDismiss`, so a modal is
  Back-dismissable exactly when backdrop-click and Escape would close it (a flash in progress is
  not, and becomes so the moment it finishes).
- **`--maxw` (`src/styles/tokens.css`) is the GLOBAL page-width cap**, applied by `.page-body`
  (`src/styles/global.css`) — which every tab's pane uses, not just whichever one you're working
  on. Don't change the token to fix one tab; that was tried once and silently resized every other
  tab too. **There is no per-tab width escape hatch any more**: `Advanced.svelte`'s
  `.shell.wide`/`.narrow` were reinstated for vertical *padding* only and their width caps are
  gone for good (Overview/Library/Sources deliberately share one body width). A tab that looks
  wrong is a question about that tab's own content, not about the page cap.
  Relatedly: a CSS Grid column declared in `fr` units (e.g. `grid-template-columns: 2fr 3fr`)
  always stretches to fill its container's width regardless of what its content actually needs —
  if a grid row looks "too wide," the container's own max-width or the fr ratio is almost always
  the fix, not restructuring the row into a separate shrink-wrapped flex layout (tried once on
  `OverviewTab.svelte`'s dashboard, made the two rows stop lining up in columns, reverted).

- **Every `z-index` comes from the scale in `src/styles/tokens.css`**, and
  `apps/web/test/zlayers.mjs` fails the build on a raw one. Layers bottom-up:
  `--z-raised` (lifted inside one component) · `--z-dock` · `--z-sticky` · `--z-popover` ·
  `--z-tooltip` · `--z-modal` · `--z-modal-prompt` · `--z-modal-alert`. Read the comment block
  beside them for which to pick. Two intra-component exceptions are allowed by name and must
  isolate themselves (`Carousel`'s per-slide order). The Library dock/carousel bug this replaced
  was **not** a number problem: `.dock` was a *static* flex sibling, and CSS paints positioned
  descendants above non-positioned blocks whatever their order — so no z-index on the carousel
  could have fixed it. When layering looks impossible, check for a missing stacking context
  before reaching for a bigger number.
- **Every persisted name goes through `scoped()` (`lib/storageScope.ts`).** localStorage keys,
  both IndexedDB databases and the OPFS directory. Production's scope is empty so its names are
  unchanged; the `/wip/` Pages build sets `PUBLIC_STORAGE_SCOPE` and gets its own storage, which
  is what stops a tester's session from reading and migrating real users' data on the same
  origin. `apps/web/test/storagescope.mjs` enumerates the names and fails if a new one bypasses
  the helper — so a new persisted key is a two-line change, not a one-line one.

## Svelte footguns

- **No TS optional parameters (`foo?: T`) in a `.svelte` `<script lang="ts">`.** The
  Svelte TS-stripping transform drops the type but leaves the `?` behind, emitting
  `function f(a, b?)` — invalid JavaScript. `svelte-check` stays green (the
  TypeScript itself is valid; type checking can't catch a bug in type *stripping*),
  so the only gate that catches it is `vite build` — and it has reached the browser
  as a blank white page once already (commit `d3493c5`). Fix: widen to an explicit
  union with a default, e.g. `done: (() => void) | undefined = undefined`. Optional
  *properties* in a type literal, `?.`, and `?:` in a type position are all fine —
  it's only parameter lists. Guarded by
  `apps/web/test/svelte-optional-params.mjs` (parses each `<script>` with the real
  TypeScript parser, flags parameter declarations carrying a question token, skips
  type-position ones), which now runs first in both `npm run check` and
  `npm run build` for `@gnw/web`, or standalone:
  `docker compose exec dev sh -c 'cd /app/apps/web && node test/svelte-optional-params.mjs'`.

## Reusable primitives — check before adding a new one

open) consolidated several
duplicated patterns into shared modules. Check these before hand-rolling the equivalent again:
- `apps/web/src/lib/engine/addr.ts` — `EXTBASE`/`BANK_BASE`/`MemReadFn` (device memory-map
  constants + the shared read-closure type).
- `apps/web/src/lib/engine/chunkedRead.ts` — `readMemoryPaced()` for small-chunk/no-delay
  reads. Do NOT use for `screenshot.ts`'s framebuffer read (needs large 64KiB chunks — see the
  watchdog note above).
- `apps/web/src/lib/engine/timeout.ts` — `raceWithFallback()` for simple single-race/no-retry
  timeouts. The other 3 timeout/retry shapes in the codebase are deliberately different and
  already reviewed — don't try to fold them in.
- `apps/web/src/lib/localCrypt.ts` — `obfuscate()`/`deobfuscate()` (AES-GCM, bundle-embedded
  key — obfuscation not real security) for any localStorage value that shouldn't sit around as
  bare plaintext but must be recoverable (e.g. a credential re-sent to a remote API — a
  one-way hash can't work for that case).
- `apps/web/src/lib/ui/ModalShell.svelte` — shared modal backdrop/CSS/dismiss-handling for any
  new modal.
- **Rails: there are two, and there must not be a third.** `advanced/FirmwareRail.svelte` is the
  original; `views/OverviewRail.svelte` reuses its `244px minmax(0, 1fr)` full-bleed grid, its
  `createPaneFooterSlot()` / `PaneFooter` arrangement (the bar is drawn as the pane column's
  second child, not by the pane itself) and its pane-head shape. That reuse is deliberate,
  because the owner asked for the Firmware/Sources rail pattern by name. A new grouped-navigation surface
  extends one of these, it does not invent a third idiom. Overview's rail mounts exactly one of
  `status | details | activity | log` (`OVERVIEW_RAIL_IDS`), deep-linked as `#info/<pane>`.
- `apps/web/src/lib/ui/BankCard.svelte` — the internal-flash bank-bar visualization (stacked
  segment bar + title + optional footer snippet), originally extracted from `OverviewTab.svelte`
  and now drawn by `DetailsPane.svelte` (the bank cards moved there with the Overview rail).
  Supports a non-interactive mode and a `selectable`/`selected`/`onSelect` clickable mode
  (`RomSection.svelte`'s bank picker). Reuse for any future bank-visualization need.
- `apps/web/src/lib/util.ts`'s `download(name, data)` — accepts `Uint8Array | Blob`, use for
  any new download-triggering code instead of a hand-rolled createObjectURL/click/revoke.
- `apps/web/src/lib/auditLog.svelte.ts` is the GLOBAL audit log, distinct from the
  install-progress modal's own per-run log. Four severities, `debug | info | warning | error`, ordered by
  `SEVERITY_RANK` and compared with `atLeast()`. Two rules the owner set, both load-bearing:
  **the bell is errors only** (`notifications` is unseen-and-`error` by construction, so a
  converter's own progress note can never ring it), and **`debug` is a capture mode, not a peer**
  of the other three, so the pane's `"all"` filter excludes it and it sits behind its own toggle.
  `dbg()` (`lib/debug.ts`) feeds it through an **injected** sink (`setDbgSink`), so `debug.ts`
  stays store-free; its `/api/debug` POST only ever reached the Express dev server, which meant
  every diagnostic line was discarded in the deployed build, which is exactly the build where
  someone is asked for a bug report. **Debug has its own 200-entry budget** (`MAX_DEBUG_ENTRIES`) held apart
  from the 500-entry `MAX_ENTRIES` cap, and that separation is the thing that makes the wiring
  safe rather than the pane hiding it: `dbg()` fires per game, cover, cheat and core, so one
  library sync would otherwise flush every error out of a shared ring. Hidden is not evicted.
- **`dbg()` WRITES `$state`, SO WHERE YOU CALL IT IS LOAD-BEARING.** This took down two tabs in
  one afternoon and neither failure named itself. `dbg()` goes through its sink into
  `auditLog.add()`, which assigns `$state`, so:
  - inside a **`$derived`** it throws `state_unsafe_mutation` (Svelte 5 forbids assigning state
    while computing derived state) and whatever read that derived is dead;
  - synchronously inside an **`$effect`** it re-dirties the batch the effect belongs to, so the
    effect reruns, writes again, and the runtime ends it with `effect_update_depth_exceeded`.
    **That error aborts the WHOLE flush**, so every effect declared after the offending one
    silently stops running. A cheats diagnostic is what stopped the Saves tab from loading its
    tree, and nothing pointed at the diagnostic.
  - **`untrack()` fixes neither** — measured, not assumed: synchronous 301 effect runs,
    `untrack(write)` 301, `queueMicrotask(write)` 1.
  **The working shape is to build the line inside and hand it to `dbg()` via `queueMicrotask`.**
  `apps/web/test/effectloop.mjs` pins this by driving the real `auditLog` through a real
  reactive graph, and the same hazard applies to any other store write reachable from a derived
  or an effect — the favourites store hit it with a lazy `load()` called from a `$derived`, which
  left the stars empty for the life of the page and then persisted that emptiness over the real
  list. A store restore belongs in a **constructor or a field initializer**, never a lazy getter.
- `apps/web/src/lib/installProgress.svelte.ts` + `apps/web/src/lib/ui/InstallProgressModal.svelte`
  — the shared phase-checklist/sub-step/audit-log progress modal for ANY device-write or
  long-running operation (flash, SD sync, etc.); call `installProgress.run({title, body, phases,
  checkboxes?, exec})` instead of rendering a modal locally. Its state is store-level singleton
  state (like `device.stubPrompt`/`connectGatePrompt`), not component-local — this is deliberate:
  a component-local version of this modal was once destroyed mid-flash by an unrelated `{#if}`
  unmount elsewhere in the tree (see `docs/AUDIT_NOTES.md` item #17). Any future "must never
  disappear mid-operation" modal must follow this same store-backed-singleton-rendered-at-
  App.svelte-root pattern, never local `$state` inside a conditionally-rendered view.
- `apps/web/src/lib/ui/StatPanel.svelte` — the shared "label / bold value" stat-row list (see its
  own header comment for the three things it replaced). Variants are not interchangeable —
  `card` (standalone bordered box), `bare` (the same rows, no box), `footer` (a light single
  inline caption line under a `GeometryBar`, only fits 1-2 short stats —
  `InstallGeometry.svelte`), `panel-footer` (a fuller boxed footer, several stats one-per-row,
  border-top divider + page background — `DetailsPane.svelte`'s External flash panel), and
  `grid` (a three-column name/After/Change table — `RomManagementTab.svelte`); check the
  `variant` union in the component rather than this list. Rows can set
  `total: true` to render as a trailing aggregate (divider above, bolder) instead of a peer
  category — e.g. RomManagementTab's "Total projected size" row.
See `.claude/projects/.../memory/code-cleanup-audit-2026-07.md` and
`.claude/projects/.../memory/install-progress-modal.md` for the full list, including
several "looked like duplication, turned out not to be" false positives (Card.svelte/
Button.svelte adoption, tokens.css's dark-theme block) — don't re-attempt those.
