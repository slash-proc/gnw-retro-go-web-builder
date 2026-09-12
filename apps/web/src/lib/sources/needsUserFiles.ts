/**
 * "Must the user go and find a file before this works?" -- spec/02-versions.md's derivation,
 * in ONE place.
 *
 * TWO FIELDS ARE NAMED `required` AND THEY ANSWER DIFFERENT QUESTIONS. This is the whole point
 * of the module, and reading the wrong one is the bug it exists to prevent:
 *
 *   - `uses[].required` -- "false if the install works without it". Does the INSTALL need this
 *     tool at all?
 *   - `inputs[].required` -- whether the tool can run at all, once you are running it.
 *
 * Until a project could ship a game those had the same answer, so nothing exposed the
 * conflation. Doom broke the tie: it ships the shareware episode and converts the WADs a user
 * owns, so its converter still cannot run without a WAD (`inputs[].required` stays true) while
 * the install no longer needs one (`uses[].required` is false). The spec is blunt about the
 * consequence of reading the wrong one: "every such project warns about files it is about to
 * install itself".
 *
 * THE BIOS HALF HAS THE SAME SHAPE. A required BIOS the project SHIPS (one carrying a `url`)
 * needs nothing from the user, so it does not count -- "otherwise every MSX install would warn
 * about files it was about to install itself". A conditionally required one (`requiredFor`)
 * DOES count: the flag warns that files may be needed, and it cannot know which games somebody
 * intends to play.
 *
 * Mirrors `site/check.js`'s `checkVersion` in gwrg-dist-spec deliberately and line for line.
 * The publisher's checker REFUSES an index that disagrees with the manifest, so a consumer
 * deriving it differently would be reading a value no conformant publisher can emit.
 */
import type { Manifest, Target } from "./types.js";

/**
 * The only part of a tool this derivation reads.
 *
 * Structural on purpose, and `inputs` is deliberately `unknown[]`: the RAW manifest type says
 * exactly that (the shape is only narrowed by `parseToolInputs`, which throws on a malformed
 * tool), while a `PreparedTool` carries fully typed `ConverterInput`s. Both satisfy this, so
 * the synthesise path, the store and the titles list can all call one function rather than
 * three hand-rolled loops that drift apart. `required === true` is an explicit identity test
 * because an unparsed input is `unknown`.
 */
export interface ToolLike {
  id: string;
  inputs?: readonly unknown[];
}

function hasRequiredInput(tool: ToolLike | undefined): boolean {
  return (tool?.inputs ?? []).some((i) => (i as { required?: unknown } | null)?.required === true);
}

/**
 * Does the INSTALL of this target need a file from the user, through a converter?
 *
 * A tool the target does not require asks for nothing, however required its own inputs are.
 * Note that a target with no `uses[]` at all needs no tool and so needs nothing -- which is
 * every plain core, and is why the BIOS half exists.
 */
export function targetNeedsToolInput(target: Target, tools: readonly ToolLike[]): boolean {
  const byId = new Map(tools.map((t) => [t.id, t]));
  return (target.uses ?? []).some(
    (u) => u?.required === true && hasRequiredInput(byId.get(u.tool)),
  );
}

/** Does any system of this target want a BIOS the project does not ship? */
export function targetNeedsBios(target: Target): boolean {
  return (target.systems ?? []).some((sys) =>
    (sys.bios ?? []).some(
      (b) => !b.url && (b.required === true || (b.requiredFor ?? []).length > 0),
    ),
  );
}

/** The spec's rule for one target, both halves. */
export function targetNeedsUserFiles(target: Target, tools: readonly ToolLike[]): boolean {
  return targetNeedsToolInput(target, tools) || targetNeedsBios(target);
}

/**
 * The spec's rule for a whole manifest: true when ANY target needs something.
 *
 * The index carries one flag for the release, so the derivation is over every target the
 * manifest declares, exactly as the checker does it.
 */
export function manifestNeedsUserFiles(manifest: Manifest): boolean {
  const tools = manifest.tools ?? [];
  return (manifest.targets ?? []).some((t) => targetNeedsUserFiles(t, tools));
}
