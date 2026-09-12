# Advanced mode — implementation notes

> **HISTORICAL — this is the build record of the ORIGINAL Advanced-mode landing, not a
> description of the code as it stands.** The redesign has since deleted several of the
> files named below. Verified gone as of 2026-09-08:
> `lib/advanced/AccordionSection.svelte`, `FlashTab.svelte`, `DeferredSection.svelte`,
> `ExpertCorner.svelte`, and `lib/views/Manage.svelte` (see "Files changed" item 6 and
> "Uncertainties" item 6 — that deletion did happen). `lib/ui/FilePick.svelte` is also gone
> (`863290c`). For the shape of the tab today read `lib/advanced/**` directly. Kept because
> the §-references into `docs/UX_ADVANCED.md` and the reasoning in "Uncertainties" are still
> the only record of why these choices were made.

Implements `docs/UX_ADVANCED.md`. Svelte 5 runes throughout, mirroring existing
components. No new tokens/colors; reused Card/Button/ConfirmModal/Progress/FilePick.
*(Today `lib/advanced/**` imports Button, Progress, SplitButton, BankCard and GeometryBar
from `lib/ui/`; FilePick no longer exists and ConfirmModal is no longer used here.)*

## Files created

- `src/lib/views/Advanced.svelte` — the shell. Tab strip (role=tablist, Left/Right
  arrows), multi-open accordion bookkeeping, `#advanced/<tab>/<sec,sec>` hash
  deep-link (read on mount + on `hashchange`, written via `history.replaceState`),
  Collapse-all (keeps running sections open), and the `#expert` hash gate.
- `src/lib/advanced/addr.ts` — shared `parseAddr` (richer §4.3 parser: hex/dec +
  k/m/g[b] suffix), `hex`/`hex8`/`commas`, `BANKS`/`BANK_BASE`, `regionSize`,
  `alignFor`.
- `src/lib/advanced/AccordionSection.svelte` — reusable disclosure panel. Running
  section can't collapse (`aria-disabled` + caret→pulsing dot, §2.4). Status chip
  (§5.5) with kinds idle/running/success/error/deferred/locked.
- `src/lib/advanced/DumpSection.svelte` — **REAL** §A.2. `dumpRegion` (→ readFlash),
  cancelable `tick`-throws-"Canceled" pattern, quick-fill chips, mono region-map
  well, locked-bank guard (banks 1/2 → caution notice, no Unlock button).
- `src/lib/advanced/FlashSection.svelte` — **REAL** §A.3. `flashImage` (→ flash).
  FilePick, bank/offset, Transfer-options sub-disclosure (compress/verify), mono
  write-plan well, alignment + overrun validation pre-modal, bank-1 ack checkbox
  (gates the button), blocking `ConfirmModal`.
  *(Superseded: the `FilePick` component was deleted in `863290c`; the file control is now
  the artboard's 40px `.filefield` wrapping a visually-hidden native input, built in
  `0bfd2db` at `FlashSection.svelte:199-206`, styled `:413-427`. `ConfirmModal` is no longer
  imported by this file either.)*
- `src/lib/advanced/FlashTab.svelte` — mounts Dump + Flash, wires open/running.
- `src/lib/advanced/DeferredSection.svelte` — honest §5.4 deferred panel
  (will/needs copy + inert disabled control + "Coming soon" chip).
- `src/lib/advanced/RetroGoTab.svelte` — **DEFERRED** panels B.1–B.5; whole tab
  gated/dimmed when `device.firmware !== "retro-go"`.
- `src/lib/advanced/ExpertCorner.svelte` — **DEFERRED** Manual re-lock + raw patch
  options; reached only via `#expert`.

## Files changed

- `src/App.svelte` — mode pill renamed "Manage" → "Advanced"; `Mode` type now
  `"wizard" | "advanced"`; mounts `Advanced` instead of `Manage`. (Manage.svelte
  left in place but no longer referenced — safe to delete later.)
- `src/lib/engine/flasher.ts` — `flashImage` gained an `opts: { compress?, verify? }`
  param (defaults both true) so the Transfer-options toggles flow into
  `flash(..., { compress, verify })`. compress:false → raw transfer.

## Engine calls per real section

- Dump flash → `dumpRegion(device.flasher, bank, offset, length, onProgress)`.
- Flash image → `flashImage(device.flasher, bank, offset, data, report, undefined, { compress, verify })`.

## Uncertainties to verify on build

1. **ConfirmModal has no snippet/checkbox slot.** It only takes a `body` STRING.
   So the bank-1 ack checkbox lives INLINE in FlashSection (gates the button)
   rather than inside the modal, and the resolved plan is passed as the `body`
   string. If the reviewer wants the ack inside the modal, ConfirmModal needs a
   `children`/`extra` prop — not done here to avoid touching shared code.
2. **`$derived` ordering** in FlashSection/DumpSection: several `$derived` refer to
   earlier ones (base, region, padTarget). Svelte 5 handles this, but confirm no
   "used before declaration" lint.
3. **`onToggle` from child to shell.** AccordionSection calls `onToggle(id)`; the
   shell owns the open-set and re-passes `open`. Confirm reactivity (Set replaced,
   not mutated — I always build a new Set).
4. **hash effect cleanup**: the `$effect` adds a `hashchange` listener and returns
   a teardown. Confirm the listener isn't double-registered across re-runs (effect
   has no reactive deps read before the listener, so it runs once).
5. **`device.locked` is `boolean | null`** — guards use `=== true` so null (unknown)
   doesn't falsely lock. Confirm that's the intended gating.
6. **Manage.svelte** is now orphaned. Left untouched; delete if desired.
7. TODO (§4.6): undo-validation layer not built here (Easy-setup's job, per spec).
