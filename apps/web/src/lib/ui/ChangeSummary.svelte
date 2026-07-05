<script module lang="ts">
  // A reusable, auditable list of changes/status rows. Shown inline (e.g. in a drop-down) and
  // re-used verbatim inside ConfirmModal (via its `summary` snippet) so the user audits the same
  // summary they confirm. Purely presentational — now a thin wrapper over the shared
  // StatPanel.svelte (was its own hand-rolled box before this session's stat-panel unification).
  export interface ChangeItem {
    label: string;
    status: string;
    kind?: "ok" | "warn" | "muted" | "info";
    detail?: string;
    /** Compact "+N −M"-style addendum shown beside the value (StatRow's `delta`), not
     *  wrapped to its own line below like `detail` — for the ROMs/Homebrew/Cheats-style
     *  "what's changing" counts, which read better inline next to the main count. */
    delta?: { text: string; direction: "up" | "down" };
    /** Marks this as the trailing aggregate total row (StatRow's `total`) — divider above,
     *  bolder label/value, so it reads as "what the rows above add up to". */
    total?: boolean;
  }
</script>

<script lang="ts">
  import StatPanel, { type StatRow } from "./StatPanel.svelte";

  // `bare`: drop this component's own box chrome (border/background/padding) when it's being
  // nested inside another already-styled container (e.g. RomManagementTab's combined SD summary
  // card) — avoids a "box within a box" look. Every other call site is unaffected (defaults to
  // the normal boxed appearance).
  let { items, bare = false }: { items: ChangeItem[]; bare?: boolean } = $props();

  const rows = $derived<StatRow[]>(
    items.map((it) => ({ label: it.label, value: it.status, tone: it.kind, detail: it.detail, delta: it.delta, total: it.total })),
  );
</script>

<StatPanel {rows} variant={bare ? "bare" : "card"} />
