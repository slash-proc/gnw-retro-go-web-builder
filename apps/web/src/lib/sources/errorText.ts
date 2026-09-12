/**
 * Why a source failed, as one line of user-facing copy.
 *
 * This lives here, not in a component, because TWO independent places render it: the
 * add-source form's `sources.addError` (ui/AddSource.svelte) and a row's meta line
 * (views/Sources.svelte, via `metaFacts.ts`'s `error` fact). They must never drift.
 *
 * Pure and rune-free ON PURPOSE, like `metaLine.ts` and `metaFacts.ts`: no `$state`, no store
 * import, no `locale`. The rule and the lookup are split so both are testable:
 *
 *  - `errorMessageKind()` is the RULE — which codes share a message. That is the part worth
 *    guarding: two codes deliberately do not get copy of their own.
 *  - `errorText()` is the LOOKUP. `metaLine.ts`'s convention is that the caller resolves
 *    anything localised and hands it in; here the whole strings table is what gets handed in,
 *    because a token-per-code would only push an identical switch into both callers.
 *
 * `detail` is untrusted third-party text (a URL, a schemaVersion). It is interpolated into a
 * string that the components render with `{...}` — text semantics, never markup.
 */
import type { SourceErrorCode } from "./types.js";

/** The distinct messages a failure can carry. Fewer than there are codes, by design. */
export type ErrorMessageKind =
  | "bad-url"
  | "no-pages"
  | "no-versions"
  | "malformed"
  | "unsupported-schema"
  | "bundle-invalid"
  | "bundle-missing-file"
  | "bundle-conflict"
  | "network";

/**
 * Which message a code carries.
 *
 * Two deliberate collapses:
 *  - `artifact-size-mismatch` reads as `malformed`. Bytes that disagree with the manifest ARE
 *    a malformed release; the distinction is for the log, not the user.
 *  - EVERYTHING else — `network`, `aborted`, and an undefined code — reads as `network`. A row
 *    in the error state always has something to say, so the fallback is a real message rather
 *    than an empty line.
 */
export function errorMessageKind(
  code: SourceErrorCode | undefined,
): ErrorMessageKind {
  switch (code) {
    case "bad-url":
    case "no-pages":
    case "no-versions":
    case "malformed":
    case "unsupported-schema":
    case "bundle-invalid":
    case "bundle-missing-file":
    case "bundle-conflict":
      return code;
    case "artifact-size-mismatch":
      return "malformed";
    default:
      return "network";
  }
}

/** The only shape of the strings table this module reads. `SourcesStrings` satisfies it. */
export interface SourceErrorStrings {
  errBadUrl: string;
  errNoPages: string;
  errNoVersions: string;
  errMalformed: string;
  errUnsupportedSchema: (version: string) => string;
  errBundleInvalid: string;
  errBundleMissingFile: string;
  errBundleConflict: string;
  errNetwork: string;
}

/** The localised line for a failure. `t` is the caller's already-resolved strings table. */
export function errorText(
  t: SourceErrorStrings,
  code: SourceErrorCode | undefined,
  detail: string | undefined,
): string {
  switch (errorMessageKind(code)) {
    case "bad-url":
      return t.errBadUrl;
    case "no-pages":
      return t.errNoPages;
    case "no-versions":
      return t.errNoVersions;
    case "malformed":
      return t.errMalformed;
    case "unsupported-schema":
      return t.errUnsupportedSchema(detail ?? "?");
    case "bundle-invalid":
      return t.errBundleInvalid;
    case "bundle-missing-file":
      return t.errBundleMissingFile;
    case "bundle-conflict":
      return t.errBundleConflict;
    case "network":
      return t.errNetwork;
  }
}

// --- Why a PREPARE failed -----------------------------------------------------------------
//
// The same split as above, for the other error family. `prepareState.run()` catches both a
// `ConverterError` (27 codes, converterTypes.ts) and a `SourceError` (the artifact fetch), and
// rendered `convertFailed(err.code)` — which interpolates the raw kebab-case identifier into a
// translated sentence. The owner saw the result in German: "Konnte nicht vorbereitet werden:
// malformed". Half a sentence, half an identifier, and nothing he could act on.
//
// Grouped by WHAT THE USER CAN DO, not by code, because that is the only distinction a
// sentence can carry. Four groups cover 39 codes:
//
//   unreadable   the project published something this tool cannot run. Not the user's file,
//                and nothing here will fix it.
//   input        a file the user supplied was refused. Supplying a different one is the move.
//   collision    two of the user's own files are one file on the card. Theirs to resolve, and
//                the only group whose wording is already drawn (ModalNameCollision.dc.html).
//   interrupted  the run did not finish. Trying again is meaningful.
//
// THE CODE IS NOT LOST. It stays on the `ConverterError`/`SourceError` and reaches the
// activity log through `prepareState`'s `convertFailed(code)` — which is why that key keeps
// its untranslated `${reason}` shape and its "diagnostic" comment. A maintainer reads the log;
// a user reads this.
export type PrepareMessageKind = "unreadable" | "input" | "collision" | "interrupted";

/**
 * Which of the four a failure belongs to.
 *
 * Takes a plain `string` rather than a union: `prepareState` also reaches here with an
 * `Error.message` from an unexpected throw, and narrowing the parameter would only push a cast
 * to the call site. Anything unrecognised is `interrupted` — the least misleading default,
 * because it neither blames the publisher for something we did not diagnose nor tells the user
 * their file was at fault.
 */
export function prepareMessageKind(code: string | undefined): PrepareMessageKind {
  switch (code) {
    // The module itself: refused before it ran, or misbehaved once it did. Either way the
    // bytes came from the project, not from the user.
    case "bad-binary":
    case "imports-forbidden":
    case "missing-export":
    case "bad-export":
    case "extra-export":
    case "unbounded-memory":
    case "memory-too-large":
    case "binary-hash":
    case "unsupported-processor":
    case "unsupported-abi":
    case "instantiate-failed":
    case "module-error":
    case "no-progress":
    case "alloc-failed":
    case "out-of-bounds":
    case "output-too-large":
    case "output-name":
    case "unknown-output":
    case "bad-utf8":
    // The artifact/manifest half (SourceError), reached through the same catch.
    case "bad-url":
    case "no-pages":
    case "no-versions":
    case "malformed":
    case "unsupported-schema":
    case "artifact-size-mismatch":
    case "bundle-invalid":
    case "bundle-missing-file":
    case "bundle-conflict":
      return "unreadable";

    // The gate, before a run is spent. Every one of these is about a file the user chose.
    case "input-too-large":
    case "input-unrecognised":
    case "input-missing":
    case "input-not-multiple":
    case "input-too-many":
      return "input";

    // Its own group because it is the only failure the user resolves by choosing differently
    // between two things they already have.
    case "name-collision":
      return "collision";

    case "timeout":
    case "worker-failed":
    case "network":
    case "aborted":
      return "interrupted";

    default:
      return "interrupted";
  }
}

/** The only shape of the strings table `prepareText` reads. `SourcesStrings` satisfies it. */
export interface PrepareErrorStrings {
  errPrepareUnreadable: string;
  errPrepareInput: string;
  errPrepareCollision: string;
  errPrepareInterrupted: string;
}

/**
 * The localised line for a failed prepare.
 *
 * No `detail` parameter, deliberately. `detail` is untrusted developer text — a module's own
 * message, or `describeCollision`'s `roms/doom: "DOOM.whd" (derived) collides with ...` — and
 * appending it would reproduce the exact defect this replaces. It goes to the log instead.
 */
export function prepareText(t: PrepareErrorStrings, code: string | undefined): string {
  switch (prepareMessageKind(code)) {
    case "unreadable":
      return t.errPrepareUnreadable;
    case "input":
      return t.errPrepareInput;
    case "collision":
      return t.errPrepareCollision;
    case "interrupted":
      return t.errPrepareInterrupted;
  }
}
