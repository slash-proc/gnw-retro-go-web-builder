<script lang="ts">
  // --- Add a source (ReposAdd artboard) ---------------------------------------------------
  //
  // The two import paths, one page: a repo URL we resolve over the network, and an offline
  // bundle zip (spec/06-bundle.md). Neither path is implemented here — both end in `sources`
  // store calls (`add()` / `importBundleFile()`), which own resolution, validation and the
  // sha256 verification. This component is the form and nothing else.
  //
  // ReposAdd makes the URL path TWO steps: `Look up` resolves the repo and shows a "Found"
  // summary, and only then does `Add` keep it. The look-up is a plain `resolveSource()` —
  // deliberately NOT a store call, because looking is not adding: nothing is kept, persisted
  // or selected until the user confirms. Confirming hands THAT resolve to
  // `sources.addResolved()`, which runs the same guards and builds the row through the same
  // code path `add()` does; it is not re-resolved, so the summary the user approved and the
  // row that gets stored can never describe two different releases.
  //
  // The confirming `Add` lives in the page's ONE footer bar, not in this panel, so the caller
  // drives it: `canAdd` says whether there is anything to add, `submit()` performs it.
  import { locale } from "../i18n/locale.svelte.js";
  import { sources } from "../sources/store.svelte.js";
  import { errorText } from "../sources/errorText.js";
  import { normaliseRepoRef, resolveSource } from "../sources/client.js";
  import { SourceError, isCoreKind, type ResolvedSource, type Target } from "../sources/types.js";
  import { device } from "../device.svelte.js";
  import { abiSatisfies } from "../engine/firmwareAbi.js";
  import { formatSize } from "../util.js";
  import Button from "./Button.svelte";

  let {
    onDone,
    canAdd = $bindable(false),
  }: {
    /** Called after an import succeeds, so the owner can leave the add view. */
    onDone: () => void;
    /** Read by the owner to enable the footer bar's Add. Never written by the owner. */
    canAdd?: boolean;
  } = $props();

  const t = $derived(locale.t.sources);

  let addMode = $state<"url" | "bundle">("url");
  let urlInput = $state("");
  /** The look-up result. Cleared the moment the URL it describes stops being the typed one. */
  let found = $state<ResolvedSource | null>(null);
  let looking = $state(false);

  const busy = $derived(looking || sources.adding);
  $effect(() => {
    canAdd = addMode === "url" && found !== null && !busy;
  });

  /** Resolve the typed repo WITHOUT keeping it. Errors land in the same place add's do. */
  async function lookUp(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    sources.addError = null;
    found = null;
    const repo = normaliseRepoRef(urlInput);
    if (!repo) {
      sources.addError = { code: "bad-url" };
      return;
    }
    looking = true;
    try {
      found = await resolveSource(repo);
    } catch (err) {
      const e2 = err instanceof SourceError ? err : new SourceError("network");
      sources.addError = { code: e2.code, detail: e2.detail };
    } finally {
      looking = false;
    }
  }

  /** The footer bar's Add. Exposed to the owner through `bind:this`. */
  export async function submit(): Promise<void> {
    if (!canAdd) return;
    if (found && sources.addResolved(found)) {
      urlInput = "";
      found = null;
      onDone();
    }
  }

  /**
   * Read the picked zip and hand it to the store. The file is read here rather than in
   * `sources/` so that module never has to know about the DOM; everything below the store
   * boundary sees bytes.
   *
   * The input is CLEARED afterwards on purpose: without it, picking the same file again after
   * a failure fires no `change` event, and the user is left with an error and a control that
   * appears not to respond.
   */
  async function pickBundle(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || sources.adding) return;
    const data = new Uint8Array(await file.arrayBuffer());
    input.value = "";
    if (await sources.importBundleFile(data)) onDone();
  }

  /** This device family's target, the same pick `store.svelte.ts`'s `toCard` makes. */
  const foundTarget = $derived.by<Target | undefined>(() => {
    const targets = found?.manifest.targets;
    if (!targets || targets.length === 0) return undefined;
    return targets.find((x) => x.platform === "game-and-watch") ?? targets[0];
  });

  /**
   * Three-valued like every other ABI read in this tab: `null` is "we do not know" — nothing
   * connected, or a firmware that publishes no ABI table. Unknown makes NO claim, so the
   * artboard's green "· supported" is simply absent rather than negated.
   */
  const foundAbiOk = $derived.by<boolean | null>(() => {
    const abi = device.firmwareAbi;
    const requires = found?.entry.requiresAbi;
    if (!abi || !requires) return null;
    return abiSatisfies(abi, requires);
  });

  /** A published date as the artboard writes it ("4 Sep 2026"), or the raw text if unparsed. */
  function published(raw: string): string {
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return raw;
    return new Date(ms).toLocaleDateString(locale.current, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
</script>

<div class="add">
  <!-- ReposAdd's mode switch is two underlined text tabs, not a segmented button group. -->
  <div class="modes">
    <button
      type="button"
      class="mode"
      class:on={addMode === "url"}
      onclick={() => (addMode = "url")}>{t.modeUrl}</button
    >
    <button
      type="button"
      class="mode"
      class:on={addMode === "bundle"}
      onclick={() => (addMode = "bundle")}>{t.modeBundle}</button
    >
  </div>

  {#if addMode === "url"}
    <form class="urlform" onsubmit={lookUp}>
      <input
        type="text"
        aria-label={t.urlLabel}
        bind:value={urlInput}
        oninput={() => {
          found = null;
          sources.addError = null;
        }}
        placeholder={t.urlPlaceholder}
        disabled={busy}
      />
      <Button variant="action" type="submit" disabled={busy || !urlInput.trim()}>
        {looking ? t.adding : t.lookUp}
      </Button>
    </form>

    {#if found}
      {@const target = foundTarget}
      <div class="section">
        <div class="cap">{t.found.caption}</div>
        <div class="panel">
          <div class="prow">
            <span class="plabel">{t.found.name}</span>
            <span class="pval">{found.index.title}</span>
          </div>
          <div class="prow">
            <span class="plabel">{t.found.type}</span>
            <span class="pval"
              >{isCoreKind(found.entry.kind) ? t.colCores : t.colHomebrew}</span
            >
          </div>
          <div class="prow">
            <span class="plabel">{t.detail.version}</span>
            <span class="pval">{found.entry.tag}<span class="sep"></span>{published(found.entry.publishedAt)}</span
            >
          </div>
          <div class="prow">
            <span class="plabel">{t.detail.abiLabel}</span>
            <span class="pval" class:good={foundAbiOk === true} class:bad={foundAbiOk === false}
              >{found.entry.requiresAbi.version}{#if foundAbiOk === true}<span class="sep"
              ></span>{t.found.abiSupported}{/if}</span
            >
          </div>
          {#if target && target.artifacts.length > 0}
            <div class="prow">
              <span class="plabel">{t.found.installs}</span>
              <span class="pval mono files">
                {#each target.artifacts as a (a.filename)}
                  <span>{a.filename}<span class="sep"></span>{formatSize(a.bytes)}</span>
                {/each}
              </span>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <p class="hint">{t.urlHint}</p>
    {/if}

    {#if sources.addError}
      <p class="err">{errorText(t, sources.addError.code, sources.addError.detail)}</p>
    {/if}
  {:else}
    <!-- The offline path (spec/06-bundle.md). Everything the manifest names is verified
         against its declared size and sha256 during the import, so a large bundle spends a
         visible moment here; `sources.adding` is what the label reflects. -->
    <label class="field">
      <span class="label">{t.bundleLabel}</span>
      <input
        type="file"
        accept=".zip,application/zip"
        onchange={pickBundle}
        disabled={sources.adding}
      />
    </label>
    {#if sources.adding}<p class="hint">{t.importing}</p>{/if}
    {#if sources.addError}
      <p class="err">{errorText(t, sources.addError.code, sources.addError.detail)}</p>
    {/if}
  {/if}
</div>

<style>
  /* ReposAdd puts this form straight on the page ground — no surface, no border, no card
     padding; only the "Found" summary below it is a white panel (audit 2.6). */
  .add {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 760px;
  }
  /* Underlined text tabs: the active one carries the green 2px underline, the other is
     plain soft ink. No box, no fill (audit 2.5). */
  .modes {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .mode {
    font: inherit;
    font-size: var(--fs-btn);
    font-weight: 500;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .mode.on {
    font-weight: 600;
    color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--zelda-green);
  }
  .mode:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
  }
  .urlform {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }
  .label {
    font-size: var(--fs-label);
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  input[type="text"] {
    flex: 1;
    min-width: 0;
    height: 44px;
    box-sizing: border-box;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-btn);
    padding: 0 14px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
  }

  /* The "Found" summary: the same caption-over-borderless-white-panel idiom the detail
     view uses, with the same label/value rows. */
  /* ReposAdd.dc.html: `gap: 12px; padding-top: 6px` — the Found block sits slightly
     further from the URL row than the 22px form gap alone gives. */
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 6px;
  }
  .cap {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .panel {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 2px 18px;
  }
  .prow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 9px 0;
  }
  .prow + .prow {
    border-top: 1px solid var(--rule);
  }
  .plabel {
    font-size: var(--fs-btn);
    color: var(--ink-soft);
  }
  /* The separator the artboards draw between a tag and its date. A 3px element, not a
     `·` glyph: that character is banned across this project's copy. `currentColor` so it
     follows `.pval.good` / `.pval.bad` -- ReposAdd draws the "supported" dot green. */
  .sep {
    display: inline-block;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.5;
    vertical-align: middle;
    margin: 0 6px;
  }
  .pval {
    font-size: var(--fs-btn);
    font-weight: 600;
    text-align: end;
    overflow-wrap: anywhere;
  }
  .pval.mono {
    font-family: var(--font-mono);
  }
  .pval.good {
    color: var(--zelda-green);
  }
  .pval.bad {
    color: var(--danger);
  }
  /* A target may ship more than the artboard's single file; they stack, one per line. */
  .files {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint,
  .err {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .err {
    color: var(--danger);
  }
</style>
