<script lang="ts" module>
  import { sources } from "../sources/store.svelte.js";
  import { BIOS_USED_BY_KEY, isCoreKind, systemKey, targetOf } from "../sources/types.js";
  import { homebrew } from "../sources/homebrewTitles.svelte.js";
  import { targetKey, OFW_BACKUP_USED_BY_KEY } from "../sources/localFolders.svelte.js";

  /** One pickable association: a manifest target key and the label to draw for it. */
  export interface UsedByOption {
    key: string;
    label: string;
  }

  /**
   * Every console the added sources publish, ONE ENTRY PER SYSTEM.
   *
   * NOT THE CORE, AND NOT THE PLATFORM. `target.label` names the platform and every core
   * publishes the same one -- `"label": "Game & Watch (Retro-Go SD)"` is a constant in the
   * manifest generator -- so the list drew fourteen identical rows. The project name (`title`)
   * was the first fix and is still the fallback, but it collapses a multi-system core into one
   * answer: tgb-dual is Game Boy AND Game Boy Color, and a folder of PC Engine CD images is not
   * a folder of HuCards. Those are different answers to the question this control asks, so they
   * are different rows, each with its own checkbox and its own key.
   *
   * A core declaring NO systems -- a homebrew-shaped core, or a manifest predating `systems[]`
   * -- has nothing to list, so it falls back to the project name under the bare target key.
   * Several nameless core targets in one repo would collapse to one name again, so those are
   * qualified with the target's own id.
   *
   * All of it is manifest text -- untrusted third-party strings, rendered with `{...}`
   * (textContent) and never used to build a path.
   */
  /**
   * Alphabetical, by the label the user actually reads.
   *
   * The lists are built by walking sources and then targets, so their order was the order the
   * user happened to add sources in -- stable, but meaningless to read. `localeCompare` rather
   * than `<`, because these are display names in whatever language the publisher wrote them.
   * The key breaks ties so two systems sharing a `longName` cannot swap places between renders.
   */
  function byLabel(a: UsedByOption, b: UsedByOption): number {
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
      || a.key.localeCompare(b.key);
  }

  export function coreOptions(): UsedByOption[] {
    const out: UsedByOption[] = [];
    for (const row of sources.rows) {
      const targets = (row.manifest?.targets ?? []).filter((t) => isCoreKind(t.kind));
      const title = row.manifest?.title ?? row.card?.title ?? row.repo;
      for (const target of targets) {
        const systems = (target.systems ?? []).filter((sys) => !!sys?.id);
        if (systems.length === 0) {
          out.push({
            key: targetKey(row.repo, target.id),
            label: targets.length > 1 ? `${title} (${target.id})` : title,
          });
          continue;
        }
        for (const sys of systems) {
          out.push({
            key: systemKey(row.repo, target.id, sys.id),
            // `longName` is the manifest's own display name for the system; its id is all we
            // have if the publisher left it out.
            label: sys.longName || sys.id,
          });
        }
      }
    }
    return out.sort(byLabel);
  }

  /**
   * The selection, with any key persisted before this menu listed systems expanded to the rows
   * that now stand for it.
   *
   * `usedBy` IS PERSISTED USER DATA and older rows hold a bare `owner/repo#targetId`, which
   * means the whole target -- every system it declares. That reading is kept everywhere the
   * association is USED (`types.ts`'s `targetOf`), so nothing is broken by leaving it alone.
   * Here it also has to be DRAWN, and an unexpanded legacy key would tick no box at all and
   * make a narrowed folder read as "Any": the user would see their choice as lost, and the next
   * edit would write that back. Expanding is what makes the old value visible and editable;
   * because only a toggle persists, the rewrite happens when the user edits and not before.
   *
   * A legacy key matching no option is KEPT as it is. A core that is not resolved yet, or was
   * removed, must not have its association silently dropped by opening this menu.
   */
  export function expandSelection(value: readonly string[], options: readonly UsedByOption[]): string[] {
    const out: string[] = [];
    for (const key of value) {
      if (options.some((o) => o.key === key)) {
        out.push(key);
        continue;
      }
      const owned = options.filter((o) => targetOf(o.key) === key).map((o) => o.key);
      out.push(...(owned.length > 0 ? owned : [key]));
    }
    return [...new Set(out)];
  }

  /**
   * The BIOS option: one entry, always offered, belonging to no source.
   *
   * It is not derived from the added sources like the other two groups, because a BIOS is not a
   * core's to own -- the same `disksys.rom` fills whichever NES core is added today. Marking a
   * folder with it says "this directory holds BIOS files", and that is the whole of it: the
   * folder is then scanned (`isLibrarySource`) and its loose files are placed under `bios/`
   * (`dedicatedFolderPlacement`), which is exactly the shape `biosState` already recognises.
   *
   * Always offered, including with no sources added at all: a user can have the file before the
   * core that wants it, and telling them to add a core first would be the wrong order.
   */
  export function biosOption(label: string): UsedByOption {
    return { key: BIOS_USED_BY_KEY, label };
  }

  /** The firmware backup directory association, always offered with system files. */
  export function ofwBackupOption(label: string): UsedByOption {
    return { key: OFW_BACKUP_USED_BY_KEY, label };
  }

  /** Every homebrew title, from the catalogue that already derives them from the manifests. */
  export function homebrewOptions(): UsedByOption[] {
    return homebrew.titles.map((t) => ({ key: t.key, label: t.label })).sort(byLabel);
  }
</script>

<script lang="ts">
  // --- USED BY control (SourcesAddRoms / SourcesAddHomebrewDir artboards) -------------------
  //
  // ONE menu covering BOTH kinds of target, under the two group headings the artboard draws
  // (Cores, Homebrew), each row a checkbox. Closed it reads "Any" in muted text.
  //
  // "Any" is not an option in the list and never a row to tick: the model states association
  // by EMPTINESS (`localFolders.svelte.ts`), so picking nothing IS Any. That is the default
  // and the permissive case — a folder serves every core and every homebrew title until
  // the user narrows it, which they only need to do if they hit a problem (a thousand ROMs
  // being hashed for a target that will never want them).
  //
  // The menu expands IN FLOW, sharing the closed field's border, exactly as the artboard
  // draws it, and it stays in flow: a `position: fixed` popover (ui/SplitButton.svelte) is for
  // menus that must escape a clipping ancestor, and this one has a scroll region to grow into.
  //
  // THE OLD REASON GIVEN HERE WAS WRONG and the bug it caused is worth stating. It claimed
  // "the page's only scroll container is `.tabpane`, so an in-flow menu simply makes that pane
  // taller". `.tabpane` is indeed the only PAGE-level scroller, but Sources.svelte's `.pagecol`
  // is `flex: 1 1 auto; min-height: 0` inside a viewport-height column, so it never grows: it
  // shrinks below its content and spills, and the footer `.bar` painted over the spill. The
  // pane's own scroll regions are what a growing menu actually needs, and the local panes were
  // the ones that had none (`views/Sources.svelte`'s `.panebody`, added for this).
  //
  // Opening near the bottom of a scroll region would still put the menu below the fold, so the
  // menu asks to be brought into view. `block: "nearest"` is what keeps that correct at the TOP
  // of a short page too: it does nothing at all when the menu is already fully visible.
  import { locale } from "../i18n/locale.svelte.js";

  let {
    value = $bindable([]),
    onchange = undefined,
  }: {
    /** The selected target keys. EMPTY IS "ANY" — see the header. */
    value: string[];
    /** Called with the new list on every toggle, for callers that persist rather than bind. */
    onchange: ((keys: string[]) => void) | undefined;
  } = $props();

  const t = $derived(locale.t.sources);

  const cores = $derived(coreOptions());
  const homebrews = $derived(homebrewOptions());
  /** What the boxes are drawn from: the stored value with legacy target keys expanded. */
  const bios = $derived(biosOption(t.folders.biosUsedBy));
  const ofwBackup = $derived(ofwBackupOption(t.folders.ofwBackupUsedBy));
  const selected = $derived(expandSelection(value, [...cores, ...homebrews, bios, ofwBackup]));

  let open = $state(false);
  let menuEl = $state<HTMLDivElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    // Reads `open` and `menuEl` and writes neither, so this cannot re-trigger itself.
    if (open && menuEl) menuEl.scrollIntoView({ block: "nearest" });
  });

  /** The closed field's value. The artboard states one word for the picked case as well as
   *  the empty one — "Any" — and no artboard states a summary line for a narrowed folder, so
   *  the picked labels themselves stand in rather than a count sentence nobody wrote. */
  const chosen = $derived(
    [...cores, ...homebrews, bios, ofwBackup].filter((o) => selected.includes(o.key)).map((o) => o.label),
  );

  function toggle(key: string): void {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    value = next;
    onchange?.(next);
  }
</script>

<svelte:window onpointerdown={(event) => {
  if (!open || !rootEl || !(event.target instanceof Node)) return;
  if (!rootEl.contains(event.target)) open = false;
}} />

<div class="usedby" class:open bind:this={rootEl}>
  <button class="field" type="button" aria-expanded={open} onclick={() => (open = !open)}>
    {#if chosen.length === 0}
      <span class="any">{t.folders.any}</span>
    {:else}
      <span class="picked">{chosen.join(", ")}</span>
    {/if}
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg
    >
  </button>
  {#if open}
    <div class="menu" bind:this={menuEl}>
      {#if cores.length > 0}
        <div class="grouphead">{t.colCores}</div>
        {#each cores as o (o.key)}
          <button class="opt" type="button" onclick={() => toggle(o.key)}>
            <span class="box" class:on={selected.includes(o.key)}></span>
            <span class="optlabel">{o.label}</span>
          </button>
        {/each}
      {/if}
      {#if homebrews.length > 0}
        <div class="grouphead">{t.colHomebrew}</div>
        {#each homebrews as o (o.key)}
          <button class="opt" type="button" onclick={() => toggle(o.key)}>
            <span class="box" class:on={selected.includes(o.key)}></span>
            <span class="optlabel">{o.label}</span>
          </button>
        {/each}
      {/if}
      <!-- Its own group, and last: it answers a different question from the two above. Those
           name WHICH project a folder feeds; this one names WHAT the folder holds. -->
      <div class="grouphead">{t.folders.biosGroup}</div>
      <button class="opt" type="button" onclick={() => toggle(bios.key)}>
        <span class="box" class:on={selected.includes(bios.key)}></span>
        <span class="optlabel">{bios.label}</span>
      </button>
      <button class="opt" type="button" onclick={() => toggle(ofwBackup.key)}>
        <span class="box" class:on={selected.includes(ofwBackup.key)}></span>
        <span class="optlabel">{ofwBackup.label}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .usedby {
    display: flex;
    flex-direction: column;
  }
  /* Artboard: a 40px white field, hairline border, 2px radius. Opening darkens the border to
     ink and squares the bottom corners so the field and the menu read as one box. */
  .field {
    height: 40px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 12px;
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    text-align: start;
    cursor: pointer;
  }
  .usedby.open .field {
    border-color: var(--ink);
    border-radius: 2px 2px 0 0;
  }
  .picked {
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .any {
    color: var(--ink-soft);
  }
  .menu {
    background: var(--surface);
    border: 1px solid var(--ink);
    border-top: none;
    border-radius: 0 0 2px 2px;
    padding-bottom: 6px;
    /* THE MENU SCROLLS ITSELF rather than growing without bound. With a dozen cores and every
       homebrew below them the list ran past the footer and the last entries were unreachable.
       (The footer is not "fixed to the viewport", as this note used to say: `.bar` is an
       in-flow sibling with `margin-top: auto`. It covered the menu because the pane the menu
       sits in had no scroll region -- see the script block.)
       It stays IN FLOW. The cap is viewport-relative so a short window gets a short menu, and
       `overflow-y: auto` here is scoped to this box -- it is not the `.tabpane` overflow rule
       that CLAUDE.md warns against touching. */
    max-height: min(52vh, 420px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .grouphead {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: 0.11em;
    color: var(--ink-soft);
    text-transform: uppercase;
    padding: 12px 12px 4px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 8px 12px;
    width: 100%;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink);
    text-align: start;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--surface-sunk);
  }
  .box {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    border: 1px solid var(--hairline);
    background: var(--surface);
    flex-shrink: 0;
  }
  .box.on {
    background: var(--zelda-green);
    border-color: var(--zelda-green);
  }
  .optlabel {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
