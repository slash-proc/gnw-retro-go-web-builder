<script lang="ts">
  // Shared pill-shaped status chip, extracted from RomManagementTab's `.gchip*`
  // rules (UI redesign phase 1). `kind` is the VISUAL kind and matches the `cls`
  // values getActionState() returns — it is NOT the state-kind key (`state.label`,
  // e.g. "not installed"), which stays untouched in RomManagementTab.
  //
  // Renders a <button> when `onclick` is given, otherwise a <span>, so the same
  // chip covers both the clickable action chips and the static console tag.
  import type { Snippet } from "svelte";

  // Widened to `string` on purpose: RomManagementTab passes getActionState()'s
  // `cls` field, which is typed `string` there. Unknown values just render the
  // unstyled base chip.
  type Kind = "installed" | "new" | "muted" | "uninstall" | "caution" | "console" | (string & {});

  let {
    kind = "muted",
    disabled = false,
    style = "",
    class: className = "",
    onclick,
    children,
  }: {
    kind?: Kind;
    disabled?: boolean;
    style?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  } = $props();
</script>

{#if onclick}
  <button
    type="button"
    class="chip {kind} {className}"
    class:clickable={!disabled}
    {disabled}
    {style}
    {onclick}
  >
    {@render children?.()}
  </button>
{:else}
  <span class="chip {kind} {className}" {style}>{@render children?.()}</span>
{/if}

<style>
  .chip {
    display: inline-block;
    flex-shrink: 0;
    border: none;
    border-radius: 999px;
    font: inherit;
    font-size: var(--fs-chip);
    font-weight: 600;
    /* Labels stay lowercase — the state-kind keys are lowercase by design. */
    text-transform: none;
    padding: 4px 12px;
    min-width: 5rem;
    text-align: center;
    white-space: nowrap;
  }
  .clickable {
    cursor: pointer;
  }
  .chip:disabled {
    cursor: not-allowed;
  }

  .installed {
    color: #ffffff;
    background: var(--zelda-green);
    box-shadow: var(--chip-inset);
  }
  /* "new" is the visual class the "install" state uses. */
  .new {
    color: #ffffff;
    background: var(--info-blue);
    box-shadow: var(--chip-inset);
  }
  /* not installed / prepare / extracting… / missing rom */
  .muted {
    color: var(--ink-soft);
    background: var(--surface-sunk);
    box-shadow: var(--chip-inset-soft);
  }
  .uninstall,
  .caution {
    color: var(--ink-on-face);
    background: var(--caution);
    box-shadow: var(--chip-inset);
  }

  /* The system tag ("GB", "NES", …) — narrower, squared, uppercase. */
  /* Audit S1.5. Roms.dc.html's system tag is a QUIET grey label, not an inverted
     near-black chip: 10px/600, letter-spacing 0.07em, #5c5c5c on #e8e8e8, radius 2px,
     width 40px. The old `#333`/`#fff` literals were also dark-theme-fixed. */
  .console {
    width: 40px;
    min-width: 40px;
    padding: 3px 5px;
    border-radius: var(--r-control);
    font-size: var(--fs-badge);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    background: var(--surface-sunk);
    color: var(--ink-soft);
    box-shadow: none;
    margin-inline-end: 0.5rem;
  }
</style>
