<script lang="ts">
  import type { SourceSystemDetail } from "../sources/sourceDetails.js";
  import { systemLogoStyle } from "../sources/systemLogoStyle.js";

  let {
    systems,
    density = "compact",
  }: {
    systems: SourceSystemDetail[];
    density?: "compact" | "comfortable";
  } = $props();
</script>

{#if systems.length > 0}
  <span class="systems" class:comfortable={density === "comfortable"}>
    {#each systems as system (system.id)}
      <span class="system">
        <span class="name">
          {#if system.logoDataUrl}
            <span class="logo" style={systemLogoStyle(system.logoDataUrl, density === "comfortable" ? 17 : 14)} role="img" aria-label={system.name}></span>
          {:else}
            {system.name}
          {/if}
        </span>
        {#if system.extensions.length > 0}
          <span class="extensions">
            {#each system.extensions as extension (`${system.id}:${extension}`)}
              <code>{extension}</code>
            {/each}
          </span>
        {/if}
      </span>
    {/each}
  </span>
{/if}

<style>
  .systems {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-self: flex-start;
    gap: 4px;
    width: fit-content;
    max-width: 100%;
    min-width: 0;
  }
  .system {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    width: fit-content;
    max-width: 100%;
    padding: 3px 5px;
    border: 1px solid color-mix(in srgb, var(--zelda-green) 18%, var(--hairline));
    border-radius: 7px;
    background: color-mix(in srgb, var(--tint-select) 38%, var(--surface));
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-chip);
    font-weight: 600;
    line-height: 1.35;
    color: var(--ink);
  }
  .logo {
    display: inline-block;
    flex: 0 0 auto;
    width: var(--system-logo-width);
    height: var(--system-logo-height);
    background: currentColor;
    -webkit-mask: var(--system-logo) center / contain no-repeat;
    mask: var(--system-logo) center / contain no-repeat;
  }
  .extensions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ink) 6%, var(--surface));
    color: var(--ink-soft);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.4;
  }
  .comfortable .system {
    gap: 5px;
    padding: 4px 6px;
  }
  .comfortable .name {
    font-size: var(--fs-btn-sm);
  }
  .comfortable code {
    padding: 3px 6px;
    font-size: var(--fs-chip);
  }
</style>
