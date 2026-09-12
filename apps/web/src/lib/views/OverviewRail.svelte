<script lang="ts" module>
  // Overview's rail — `docs/design/proposals/overview-v2/README.md` "Structure":
  //
  //     CONSOLE          LOGS
  //       Status           Activity
  //       Details          Device log
  //
  // This replaced a stack of accordions. Exactly one pane is mounted at a time, chosen from the
  // rail; the pane components render only their own body, and the rail supplies the page title
  // and the anchored footer bar.
  //
  // The idiom is `advanced/FirmwareRail.svelte`'s, deliberately and not by coincidence: the
  // owner asked for the Firmware/Sources rail pattern specifically, so this reuses its grid, its
  // `PaneFooter` slot and its pane-head shape rather than inventing a second rail.
  export type OverviewRailId = "status" | "details" | "activity" | "log";
  export const OVERVIEW_RAIL_IDS: OverviewRailId[] = ["status", "details", "activity", "log"];
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { auditLog } from "../auditLog.svelte.js";
  import { createPaneFooterSlot } from "../advanced/paneFooter.svelte.js";
  import StatusPane from "../ui/StatusPane.svelte";
  import DetailsPane from "../ui/DetailsPane.svelte";
  import ActivityPane from "../ui/ActivityPane.svelte";
  import DeviceLogPane from "../ui/DeviceLogPane.svelte";

  const footer = createPaneFooterSlot();

  let {
    selected,
    onSelect,
    connected,
    disconnected,
  }: {
    selected: OverviewRailId;
    onSelect: (id: OverviewRailId) => void;
    /** Whether a device is attached. Only Status depends on it; see `disconnected`. */
    connected: boolean;
    /**
     * What Status shows with no device. The rail itself is drawn either way, because
     * `StatusNoDevice.dc.html` is explicit that "Activity stays live in the rail": the audit
     * log fills up from Sources and the Library with no device in the room, and a rail that
     * vanished on disconnect would take the session's whole record with it. Passed in rather
     * than rendered here so `StatusPane` stays the connected pane and nothing else.
     */
    disconnected: Snippet;
  } = $props();

  const t = $derived(locale.t.overviewRail);

  // The rail's own labels. Only `Details` is new copy: Status, Activity and Device log are the
  // names those surfaces already carry, read from where they live.
  const label = $derived.by((): Record<OverviewRailId, string> => ({
    status: locale.t.overview.status.title,
    details: t.details,
    activity: locale.t.shared.auditLog.title,
    log: locale.t.overview.log.heading,
  }));

  const groups = $derived([
    { heading: t.groupConsole, items: ["status", "details"] as OverviewRailId[] },
    { heading: t.groupLogs, items: ["activity", "log"] as OverviewRailId[] },
  ]);

  // "Colour instead of counting": the rail shows a dot beside Activity only when an error is
  // waiting, never a badge with a number. `notifications` is unseen-and-error by construction
  // (auditLog.svelte.ts), which is exactly the condition the README states.
  const errorWaiting = $derived(auditLog.notifications.length > 0);
</script>

<div class="split">
  <nav class="rail" aria-label={locale.t.overview.status.title}>
    {#each groups as g (g.heading)}
      <div class="group">
        <h3 class="railhead">{g.heading}</h3>
        {#each g.items as id (id)}
          <button
            class="item"
            class:selected={selected === id}
            aria-current={selected === id ? "true" : undefined}
            onclick={() => onSelect(id)}
          >
            <span>{label[id]}</span>
            {#if id === "activity" && errorWaiting}
              <span class="dot" aria-hidden="true"></span>
            {/if}
          </button>
        {/each}
      </div>
    {/each}
  </nav>

  <div class="pane">
    <div class="panebody">
      <header class="pagehead">
        <h2 class="pagetitle">{label[selected]}</h2>
      </header>
      {#if selected === "status"}
        {#if connected}<StatusPane />{:else}{@render disconnected()}{/if}
      {:else if selected === "details"}
        <DetailsPane />
      {:else if selected === "activity"}
        <ActivityPane />
      {:else}
        <DeviceLogPane />
      {/if}
    </div>
    {#if footer.content || footer.summary}
      <div class="panefoot">
        <span class="sum">{footer.summary ?? ""}</span>
        {#if footer.content}<div class="actions">{@render footer.content()}</div>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* A FULL-BLEED `244px minmax(0, 1fr)` grid with `gap: 0`, so the rail's border-right is the
     region edge: it reaches the page edge on the left (Advanced.svelte's `.tabpane.bleed` drops
     the cap and side padding) and runs the region's full height rather than stopping at content
     height. Both columns own their own padding, which is why the pane is not inside
     `.page-body`. Identical to FirmwareRail's `.split` on purpose. */
  .split {
    display: grid;
    grid-template-columns: 244px minmax(0, 1fr);
    gap: 0;
    align-items: stretch;
    flex: 1;
    width: 100%;
  }
  .rail {
    border-inline-end: 1px solid var(--hairline);
    /* LOGICAL, not `padding: 32px 20px 40px var(--page-pad-x)`. The rail is the grid's leading
       column and `border-inline-end` beside it already mirrors, so the page gutter has to as
       well. Physically pinned to the left it stayed there when the grid mirrored under
       `dir=rtl`, moving the 40px page gutter to the rail's INNER edge and leaving the page
       edge with the 20px meant for the inside. Artboard: `padding: 32px 20px 40px 40px`. */
    padding-block: 32px 40px;
    padding-inline: var(--page-pad-x) 20px;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .railhead {
    margin: 0;
    padding-bottom: 6px;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .item {
    font: inherit;
    font-size: 14px;
    text-align: start;
    background: transparent;
    border: none;
    color: var(--ink);
    padding: 7px 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .item.selected {
    font-weight: 600;
    color: var(--ink);
    /* The marker sits on the rail's own edge, not inset. */
    box-shadow: inset 2px 0 0 var(--zelda-green);
    padding-inline-start: 14px;
    margin-inline-start: -14px;
  }
  /* Not a count. One dot, present or absent. */
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--danger);
    flex: none;
  }
  /* The column carries no padding of its own: it is the artboards' `flex-column;
     justify-content: space-between` wrapper holding the padded body and the full-width footer
     bar. NO `overflow` here — `.tabpane` is the page's only general scroll container, and a
     pane column that scrolled itself would silently clip with no scrollbar. */
  .pane {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .panebody {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 32px var(--page-pad-x) 40px;
    max-width: 880px;
  }
  .panefoot {
    border-top: 1px solid var(--hairline);
    background: var(--surface);
    padding: 0 var(--page-pad-x);
    min-height: 72px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .sum {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    margin-inline-start: auto;
  }
  .pagehead {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pagetitle {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
</style>
