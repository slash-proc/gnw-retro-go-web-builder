/** Medium independent file set selected for one Library Sync.
 *
 * This is deliberately built before Flash/SD placement. The same paths and bytes feed the
 * Flash filesystem planner and the SD incremental writer; only their destination/diff rules
 * differ. Keeping the merge order here also makes converter output and sidecars visible to the
 * summary from the same candidate set the writers receive.
 */
export type InstallFileKind = "library" | "prepared" | "generated";

export interface LogicalInstallPlan {
  /** Complete selected source tree, keyed by the app's canonical install-relative paths. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Which layer supplied the final bytes at each path, useful for diagnostics and summaries. */
  readonly kinds: ReadonlyMap<string, InstallFileKind>;
  /** Paths where a later, higher-priority layer replaced an earlier candidate. */
  readonly overrides: readonly { path: string; previous: InstallFileKind; next: InstallFileKind }[];
}

export interface LogicalInstallInputs {
  /** Materialized selected games and BIOS, plus prepared device-ready covers. */
  libraryFiles: ReadonlyMap<string, Uint8Array>;
  /** Selected manifest artifacts and converter outputs, already selection-gated. */
  preparedFiles: ReadonlyMap<string, Uint8Array>;
  /** Generated cheat files; these intentionally override a same-path library candidate. */
  generatedFiles?: ReadonlyMap<string, Uint8Array>;
}

function assertInstallPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid logical install path: ${JSON.stringify(path)}`);
  }
}

/** Merge the selected file layers with explicit, stable precedence: library, prepared, generated. */
export function buildLogicalInstallPlan(input: LogicalInstallInputs): LogicalInstallPlan {
  const files = new Map<string, Uint8Array>();
  const kinds = new Map<string, InstallFileKind>();
  const overrides: { path: string; previous: InstallFileKind; next: InstallFileKind }[] = [];
  const add = (source: ReadonlyMap<string, Uint8Array>, kind: InstallFileKind) => {
    for (const [path, bytes] of source) {
      assertInstallPath(path);
      const previous = kinds.get(path);
      if (previous) overrides.push({ path, previous, next: kind });
      files.set(path, bytes);
      kinds.set(path, kind);
    }
  };
  add(input.libraryFiles, "library");
  add(input.preparedFiles, "prepared");
  if (input.generatedFiles) add(input.generatedFiles, "generated");
  return { files, kinds, overrides };
}
