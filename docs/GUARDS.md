# Guards: what the build enforces

Read this in full before adding a test, changing a doc that a guard reads, or wondering why
a green `svelte-check` did not catch something.

All of these run in `npm run check` and `npm run build` for `@gnw/web`. Each was written
after the bug it prevents, and each is **general** rather than a restatement of the one case
that prompted it, so a differently-named instance of the same mistake still fails.

## Documentation guards

- `apps/web/test/conformance-counts.mjs` — re-derives the per-status counts of both artboard
  surveys by the rule `docs/CONFORMANCE.md` states, and diffs them against that file's
  scoreboard table. Five passes once produced five conflicting answers; the two parser traps
  that caused it (the empty leading cell of a `|`-prefixed markdown row; the trailing full stop
  on `**BLOCKED**.`) are implemented explicitly in the guard — read it before re-deriving
  anything by hand. It covers the live scoreboard table only, not the dated prose figures.
- `apps/web/test/artboard-index.mjs` — every `docs/design/mockups/*.dc.html` must appear in the
  README index table and in `canvas.json`, and neither may name a board that does not exist
  (an audit once found 23 of 57 boards unindexed after a nine-name spot check declared it fine).
- Both exit non-zero if they cannot actually run (missing file, unparseable table, zero rows
  parsed) rather than printing a green line. Do not "fix" a survey status cell to make a count
  guard pass — the header is the thing that is wrong.

## Code guards

Three that constrain how you write, not just what you document. Each was written after the bug
it now prevents, and each is **general** rather than a restatement of the one case that prompted
it, so a differently-named instance of the same mistake still fails.
- `apps/web/test/errorsurface.mjs` — **an error a user can hit must reach the activity log.**
  Nothing may report only to the browser console (a deployed build cannot show it and a bug
  report cannot carry it), and an error captured into store state must carry that failure into
  the log. The census that produced it: **273 catch sites in `src/`, exactly one reached
  `auditLog.add`.** A failed Recovery Mode boot wrote `device.error`, which no component renders,
  so a real race read as a button that did nothing. Deliberate silence is still allowed (storage
  in private mode, optional probes) — the guard checks the sites that capture, not every catch.
- `apps/web/test/direction.mjs` — **no physical inline CSS property anywhere in `src/`.** No
  `padding-left`/`margin-right`/`text-align: left`/`float`, no asymmetric four-value shorthand;
  use `padding-inline-start`, `text-align: start` and friends. Arabic is wired and the app
  mirrors, and a physical property looks correct in LTR precisely because the physical side
  happens to coincide. Physical insets must be symmetric, a centring pair, or in the guard's
  named exception list with a reason.
- `apps/web/test/effectloop.mjs` — the `dbg()`-inside-an-effect hazard described in the
  `auditLog` bullet above. Pinned by driving the real store through a real reactive graph,
  because no static gate sees it.
- **Rendering beats reading for anything in a `.svelte` file.** `activitypane.mjs`,
  `choosercommit.mjs`, `landingshift.mjs`, `libraryrow.mjs` and `sdpane.mjs` compile the real
  component with the real Svelte compiler and assert over the rendered markup;
  `optionsmodal.mjs` and `direction.mjs` read the **emitted** stylesheet rather than the source,
  because Svelte scopes rules inside `:where(...)`, which carries **zero specificity** — reasoning
  about the source gets the cascade wrong. Three static gates and 22 targeted checks all passed
  on a component whose tabs did not work; only a rendering check caught it.
- **No hand-written file in `apps/web` may carry a raw NUL byte** (`src/lib/sources/test/validate.mjs`,
  near the end). Write the escape, not the byte. This is not cosmetic: **`git` and `grep` classify
  such a file as binary and skip it**, so a grep-based audit reports clean on a file it never read,
  and a diff shows `Bin` instead of the change. It has happened twice — first in
  `sources/outputNames.ts`, then in `test/sourceremoval.mjs`, both a composite map-key separator
  written as the byte instead of the escape its sibling (`prepareState.svelte.ts`'s `NOTICE_SEP`)
  uses correctly. The guard was scoped to `src/lib/sources` when the second one landed, which is
  exactly why it landed; it now walks `src/` and `test/` together.
