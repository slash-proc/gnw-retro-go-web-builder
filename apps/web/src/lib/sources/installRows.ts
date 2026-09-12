/**
 * The COMPOSITION rule for "What gets installed" — the built-state list of a source's
 * Configure page (ReposDetailReady.dc.html).
 *
 * It says what this source puts on the device: the files the publisher SHIPS
 * (`targets[].artifacts[]`) and the files a converter DERIVES (`uses[] -> tools[].outputs[]`)
 * — the same two halves `prepareState.run()` assembles, so the table cannot promise a file
 * the install would not write.
 *
 * Lives here, not inline in `views/Sources.svelte`, for the same reason `fileRows.ts` does:
 * this is a real claim made to the user about what is about to be written, and inline in a
 * `$derived` it was unguardable. It was deleted once (commit cffb0d3) and restored; a pure
 * module with a test is what makes that visible next time.
 *
 * Pure and rune-free ON PURPOSE, like `fileRows.ts`/`metaFacts.ts`: no `$state`, no store
 * import, no `locale`. The caller resolves the stores into the plain inputs below (the built
 * bytes come from `prepareState.get`) and maps each returned row to its own localised strings.
 */

/** How a row is categorised. The component turns each into the artboard's own chip word. */
export type InstallRowType = "binary" | "data" | "built";

/** One row of "What gets installed". `bytes` is absent only for a not-yet-built output. */
export interface InstallRow {
  key: string;
  type: InstallRowType;
  filename: string;
  bytes?: number;
}

/** The shape of a target this rule reads. Structural, so a real `Target` passes as-is. */
export interface InstallTarget {
  artifacts?: readonly { filename: string; bytes?: number }[];
  uses?: readonly { tool: string; outputs: readonly string[] }[];
}

/** The shape of a manifest this rule reads. Structural, so a real `Manifest` passes as-is. */
export interface InstallManifest {
  tools?: readonly {
    id: string;
    outputs: readonly { id: string; filename?: string }[];
  }[];
}

/** Answers "how many bytes has this filename been built to", or `undefined` if not yet. */
export type BuiltBytes = (filename: string) => number | undefined;

/**
 * The files a DERIVED output has actually produced, empty before it has run.
 *
 * A derived output declares an extension rather than a filename and is named per input file,
 * so its rows cannot be read off the manifest — only off the run. The caller resolves this
 * from `prepareState`'s own provenance; this module stays free of stores.
 */
export type BuiltDerived = (toolId: string, outputId: string) => readonly { filename: string; bytes: number }[];

/**
 * The rows for one source's target.
 *
 * Shipped artifacts first, in declaration order, then each declared use's outputs in the order
 * the target asks for them — the install order, so the list reads as the plan it is.
 *
 * A shipped file is `binary` if its name ends `.bin` and `data` otherwise; that is the
 * artboard's own two-way split and nothing else is derived from it.
 *
 * An output that declares no `filename` is named ONLY BY ITS RUN. `filename` XOR `extension`
 * (types.ts): an extension-only output is named per input file, off a stem the user brings, so
 * before the run there is no name to show and nothing is emitted — a placeholder would be a
 * promise about a filename the manifest never made. AFTER the run the names are real, and
 * `builtDerived` supplies them: one row per produced file. Omitting them is what let OpenLara's
 * page total its 136.62 KB binary and silently drop every converted `.PKD` level.
 *
 * An unknown tool id, or an output id the tool does not declare, contributes nothing rather
 * than emptying the list — manifests are untrusted third-party data.
 */
export function composeInstallRows(
  target: InstallTarget | undefined,
  manifest: InstallManifest | undefined,
  builtBytes: BuiltBytes,
  builtDerived: BuiltDerived = () => [],
): InstallRow[] {
  if (!target || !manifest) return [];
  const rows: InstallRow[] = (target.artifacts ?? []).map((a) => ({
    key: `a:${a.filename}`,
    type: a.filename.toLowerCase().endsWith(".bin") ? ("binary" as const) : ("data" as const),
    filename: a.filename,
    ...(a.bytes === undefined ? {} : { bytes: a.bytes }),
  }));
  for (const use of target.uses ?? []) {
    const tool = (manifest.tools ?? []).find((x) => x.id === use.tool);
    if (!tool) continue;
    for (const id of use.outputs) {
      const spec = tool.outputs.find((o) => o.id === id);
      if (!spec) continue;
      if (spec.filename === undefined) {
        for (const built of builtDerived(tool.id, spec.id)) {
          rows.push({ key: `o:${built.filename}`, type: "built", filename: built.filename, bytes: built.bytes });
        }
        continue;
      }
      const bytes = builtBytes(spec.filename);
      rows.push({
        key: `o:${spec.filename}`,
        type: "built",
        filename: spec.filename,
        ...(bytes === undefined ? {} : { bytes }),
      });
    }
  }
  return rows;
}

/**
 * The artboard's Total row exists ONLY once every row has a real size (ReposDetailReady):
 * a sum that quietly omitted the one file still to be built would understate the install.
 * `null` means "do not draw the row".
 */
export function installTotal(rows: readonly InstallRow[]): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const r of rows) {
    if (r.bytes === undefined) return null;
    sum += r.bytes;
  }
  return sum;
}
