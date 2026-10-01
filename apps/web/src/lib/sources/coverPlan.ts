import { stripFinalFilenameExtension } from "../filename.js";

/** One selected game's source cover and its canonical logical install path. */
export interface CoverTarget {
  owner: string;
  sourcePath: string;
  /** Other source identities that produce the same installed ROM (converter input, etc.). */
  sourceCandidates?: { path: string; sourceId?: string }[];
  sourceId?: string;
  devicePath: string;
}

export interface CoverGameInput {
  /** Canonical library key for the input ROM. */
  key: string;
  /** Present when the converted output was found in a folder or on the device. */
  outputKey?: string;
  /** Published/derived filename when conversion output only exists in app memory. */
  outputName?: string;
  owner: string;
  sourcePath: string;
  sourceId?: string;
}

/** Resolve a ROM's device cover path from the same output identity used by installation.
 *
 * `outputName` matters before a converted ROM has been materialized as an `outputKey`; use the
 * converter's declared output name rather than guessing from the input filename.
 */
export function coverTargetForGame(input: CoverGameInput): CoverTarget | null {
  const outputPath = input.outputKey ?? (input.outputName
    ? `${input.key.slice(0, input.key.lastIndexOf("/") + 1)}${input.outputName}`
    : input.key);
  const canonicalOutput = outputPath.replace(/^roms\//i, "");
  const slash = canonicalOutput.lastIndexOf("/");
  if (slash < 1) return null;
  const filename = canonicalOutput.slice(slash + 1);
  const stem = stripFinalFilenameExtension(filename);
  return {
    owner: input.owner,
    sourcePath: input.sourcePath,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    devicePath: `covers/${canonicalOutput.slice(0, slash)}/${stem}.img`,
  };
}

/** Homebrew's device title is its published display name, so both sides share that identity. */
export function coverTargetForHomebrew(
  owner: string,
  displayName: string,
  sourcePath: string,
  sourceId?: string,
): CoverTarget {
  return {
    owner,
    sourcePath,
    ...(sourceId ? { sourceId } : {}),
    devicePath: `covers/homebrew/${displayName}.img`,
  };
}
