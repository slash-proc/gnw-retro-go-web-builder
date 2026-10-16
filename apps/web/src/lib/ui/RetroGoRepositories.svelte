<script lang="ts">
  import { locale } from "../i18n/locale.svelte.js";
  import { firmwareRepositories } from "../firmwareDist/repositories.svelte.js";

  const t = $derived(locale.t.sources);
  let repoInput = $state("");
  firmwareRepositories.load();

  async function addRepo(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (firmwareRepositories.adding) return;
    if (await firmwareRepositories.add(repoInput)) repoInput = "";
  }
</script>

<div class="repos">
  <p>{t.retroGoReposHint}</p>
  <div class="list">
    {#if firmwareRepositories.rows.length === 0}
      <p class="empty">{t.emptyColumn}</p>
    {:else}
      {#each firmwareRepositories.rows as row (row.repo)}
        {@const owner = row.repo.split("/")[0] ?? row.repo}
        <div
          class="row"
          class:selected={firmwareRepositories.selectedRepo === row.repo}
          role="button"
          tabindex="0"
          aria-pressed={firmwareRepositories.selectedRepo === row.repo}
          onclick={() => firmwareRepositories.select(row.repo)}
          onkeydown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              firmwareRepositories.select(row.repo);
            }
          }}
        >
          <span class="marker" aria-hidden="true"></span>
          <div class="main">
            <div class="identity">
              <span class="name">{owner}</span>
              <span class="repo">{row.repo}</span>
            </div>
            <div class="meta">{t.retroGoRepoVersions(row.versions)}</div>
          </div>
          <div class="side">
            <span class="pill" class:on={firmwareRepositories.selectedRepo === row.repo}>
              {firmwareRepositories.selectedRepo === row.repo ? t.active : t.inactive}
            </span>
            <button
              type="button"
              class="remove"
              aria-label={`${t.removeRetroGoRepo}: ${row.repo}`}
              title={t.removeRetroGoRepo}
              onclick={(e) => {
                e.stopPropagation();
                firmwareRepositories.remove(row.repo);
              }}
            >×</button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
  <form onsubmit={addRepo}>
    <input
      aria-label={t.retroGoReleases}
      placeholder={t.retroGoRepoPlaceholder}
      bind:value={repoInput}
      disabled={firmwareRepositories.adding}
    />
    <button type="submit" disabled={firmwareRepositories.adding || !repoInput.trim()}>
      {firmwareRepositories.adding ? "…" : t.addRetroGoRepo}
    </button>
  </form>
  {#if firmwareRepositories.error}
    <p class="error">
      {firmwareRepositories.error === "invalid"
        ? t.retroGoRepoInvalid
        : firmwareRepositories.error === "duplicate"
          ? t.retroGoRepoDuplicate
          : t.retroGoRepoFailed}
    </p>
  {/if}
</div>

<style>
  .repos { margin: 0 40px; color: var(--ink); }
  .repos > p { margin: 0 0 12px; color: var(--ink-soft); font-size: var(--fs-caption); }
  .list { margin-bottom: 16px; padding: 2px 18px; border-radius: var(--r-card); background: var(--surface); }
  .empty { margin: 0; padding: 11px 0; color: var(--ink-soft); font-size: var(--fs-caption); }
  .row { display: flex; align-items: center; gap: 14px; padding: 11px 0; cursor: pointer; box-sizing: border-box; }
  .row + .row { border-top: 1px solid var(--rule); }
  .row.selected { width: calc(100% + 36px); margin: 0 -18px; padding: 11px 18px; background: var(--tint-select); box-shadow: inset 2px 0 0 var(--zelda-green); }
  .marker { width: 16px; height: 16px; flex: none; border: 1px solid var(--ink-faint); border-radius: 50%; }
  .row.selected .marker { border: 5px solid var(--zelda-green); }
  .main { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
  .identity { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .name { flex: 0 1 auto; overflow: hidden; min-width: 0; font-size: var(--fs-lede); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .repo { flex: 1 1 auto; overflow: hidden; min-width: 0; color: var(--ink-soft); font-family: var(--font-mono); font-size: var(--fs-micro); text-overflow: ellipsis; white-space: nowrap; }
  .meta { padding-top: 3px; color: var(--ink-soft); font-size: var(--fs-btn-sm); }
  .side { display: flex; width: 120px; flex: 0 0 120px; align-items: center; justify-content: flex-end; gap: 8px; }
  .pill { padding: 3px 12px; border: 1px solid var(--ink-faint); border-radius: 999px; background: var(--surface); color: var(--ink-soft); font-size: var(--fs-chip); font-weight: 600; }
  .pill.on { border-color: var(--zelda-green); background: var(--zelda-green); color: #fff; box-shadow: var(--chip-inset); }
  .remove { width: 28px; height: 28px; flex: none; border: 0; border-radius: var(--r-control); background: transparent; color: var(--ink-soft); font: inherit; font-size: 20px; cursor: pointer; }
  .remove:hover { background: color-mix(in srgb, var(--danger) 9%, transparent); color: var(--danger); }
  form { display: flex; gap: 8px; }
  input { min-width: 0; flex: 1; height: 40px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: var(--r-control); background: var(--surface); color: inherit; }
  form button { padding: 0 14px; border: 0; border-radius: var(--r-control); background: var(--zelda-green); color: white; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .error { margin: 8px 0 0; color: var(--danger); }
  @media (max-width: 560px) { .repos { margin-inline: 20px; } .side { width: auto; flex-basis: auto; } .pill { padding-inline: 8px; } }
</style>
