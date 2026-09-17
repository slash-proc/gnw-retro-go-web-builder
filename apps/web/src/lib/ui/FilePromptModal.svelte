<script lang="ts">
  /**
   * The manifest-driven file prompt.
   *
   * A converter's `tools[].inputs[]` says what files it wants: a localised label and
   * description, an `extensions[]` hint for the picker, a `maxBytes` ceiling, a `variants[]`
   * hash table of known-good files, and `strict` deciding what happens to a file that matches
   * none of them. This renders exactly that, one section per input, and answers with the
   * verdict `sources/inputGate.ts` reaches — it does not decide anything itself.
   *
   * **It is not a converter dialog.** The same manifest question is asked by a core
   * core's `targets[].systems[].bios[]` (spec/07 "BIOS"), whose entries carry the same two
   * localised fields — `label` and `description` — and the approved artboards
   * (`ModalFilesConvert`, `ModalFilesBios`) are structurally identical because of it. So every
   * piece of subject matter arrives as a prop the caller derived from ITS manifest:
   * `subject` (the name the title is built around), `note` (a manifest line under it), and
   * `inputs[]`. Nothing here knows which manifest it is looking at. The single line that is
   * NOT manifest text — "converted in your browser, nothing is uploaded" — is a property of
   * how converters work rather than of any one project, so it stays an i18n string, selected
   * by the `converts` flag (itself a manifest fact: the target declares a `uses[].tool`).
   *
   * Three things it is deliberately careful about:
   *
   *  - **The gate owns the rules.** Every accept/refuse decision here comes from `gateInputs`.
   *    `sources/inputPrompt.ts` holds only presentation (locale pick, `accept` hint, the
   *    size preflight that stops a huge file being READ before the same ceiling refuses it).
   *  - **A refused file says so where it was picked.** The approved artboard
   *    (`ModalFilesBiosError`) shows one short invalid line plus an Expected SHA-1 / Current
   *    pair, so that is exactly what is rendered — no prose about why.
   *  - **Manifest text is text.** `label`, `description`, variant names and filenames are
   *    third-party strings interpolated by Svelte (which escapes), never `{@html}`, and never
   *    put into a path. The one manifest value reaching an attribute (`accept`) is filtered by
   *    `acceptAttr` down to plain extension tokens.
   *
   * It runs no converter and touches no device state: it emits the gated files and closes.
   */
  import ModalShell from "./ModalShell.svelte";
  import Button from "./Button.svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { formatSize } from "../util.js";
  import { gateInputs, sha1Hex, type GateResult, type OfferedFile } from "../sources/inputGate.js";
  import { discoverInput, folderCandidates } from "../sources/inputDiscovery.js";
  import type { ConverterInput } from "../sources/converterTypes.js";
  import type { PreparedTool } from "../sources/converter.js";
  import { acceptsFolder, acceptAttr, optionalTailStartsOpen, oversize, pickText, slotsLeft, splitPrompt } from "../sources/inputPrompt.js";

  let {
    open = false,
    tool,
    subject,
    inputs: inputsProp,
    note,
    converts,
    monoDescriptions = false,
    submitText,
    prefill,
    onCancel,
    onPickFolder,
    onSubmit,
  }: {
    open?: boolean;
    /**
     * The converter shorthand: a whole `PreparedTool` supplies `subject` (its localised
     * `title`), `inputs` and `converts` in one prop, because a caller that has one has all
     * three. It is not a mode — everything it sets can be set directly instead, and the BIOS
     * caller does exactly that. Explicit props win over it.
     */
    tool?: PreparedTool;
    /**
     * The manifest name the title is built around — a tool's `title`, a system's `longName`.
     * Rendered as text. Falls back to `tool`'s localised title.
     */
    subject?: string;
    /** What to ask for. Manifest-derived and gate-shaped; drives every section below. */
    inputs?: ConverterInput[];
    /**
     * One manifest line under the title — spec/07's `bios[].description`. Untrusted text.
     * Takes precedence over the converter assurance when both would apply.
     */
    note?: string;
    /**
     * These files feed a converter. Selects the "converted in your browser" assurance, which
     * is true of the mechanism rather than of any one manifest, so it cannot come from one.
     */
    converts?: boolean;
    /** Render input descriptions monospaced — for slots whose description IS a filename. */
    monoDescriptions?: boolean;
    /** The submit label — "Prepare" (convert) or "Add to library" (BIOS). */
    submitText: string;
    /** Backdrop click, Escape, or the Cancel button. The caller closes the modal. */
    onCancel: () => void;
    /**
     * Raise a directory picker and REGISTER what comes back, returning the handle (or null when
     * the user cancelled). Absent means this prompt offers files only.
     *
     * The registration is the caller's for the same reason nothing else here touches a store:
     * this modal gates files and closes. It hands back a handle; who that folder belongs to,
     * and whether it becomes a local source, is a decision only the caller's manifest context
     * can make.
     */
    onPickFolder?: () => Promise<unknown | null>;
    /**
     * Files this input is ALREADY holding when the prompt opens — what discovery found in the
     * user's own registered folders.
     *
     * The owner: "pre-populate but with multiple optional files, prompt the user still in case
     * that's not everything." Both halves matter and they are decided in different places.
     * WHETHER the prompt opens is `prepareState.needsPrompt` -> `closedByDiscovery`, which
     * keeps an optional repeatable input open until `maxCount` for exactly this reason. WHAT it
     * shows when it does is this: without it the dialog opened blank over files the app was
     * already holding, so the user could not see what was there and would re-pick it.
     *
     * Seeded as `ok`, because these files have already passed the same gate — discovery runs
     * them through it (`sources/inputDiscovery.ts`) and keeps what it accepted. They count
     * against `slotsLeft` like any other pick, so a full slot opens with no `+`.
     */
    prefill?: OfferedFile[];
    /**
     * The user committed and the gate raised no errors. `files` is ready for `runConverter`'s
     * `files` / `input_add`; `gate` carries the per-file verdicts, including
     * `gate.unrecognised` for anything accepted under `strict: false`.
     */
    onSubmit: (result: { files: OfferedFile[]; gate: GateResult }) => void;
  } = $props();

  /** One file the user picked, with whatever the gate has said about it so far. */
  type Slot = {
    /** Stable identity for keying/patching — object identity is not reliable through
     *  Svelte 5's deep `$state` proxies. */
    id: number;
    inputId: string;
    filename: string;
    size: number;
    bytes?: Uint8Array;
    /** "checking" while the bytes are being read/hashed. */
    state: "checking" | "ok" | "unrecognised" | "error";
    variantId?: string;
    /** Already-translated copy; the gate's error codes are mapped once, on arrival. */
    error?: string;
    /** The file's own SHA-1, shown beside the input's expected one when it was refused. */
    sha1?: string;
  };

  let slots = $state<Slot[]>([]);
  let submitting = $state(false);
  let formError = $state<string | null>(null);
  let dialog = $state<HTMLDivElement | null>(null);
  let tailOpen = $state(false);
  let seq = 0;

  const t = $derived(locale.t.sources.filePrompt);
  // The three pieces of subject matter, whichever way the caller supplied them. A tool is
  // itself a manifest fact that a converter will run, so it answers `converts` too.
  const subjectText = $derived(
    subject ?? (tool ? (pickText(tool.title, locale.current) ?? tool.id) : ""),
  );
  const inputs = $derived(inputsProp ?? tool?.inputs ?? []);
  const showConverted = $derived(converts ?? tool !== undefined);
  /**
   * Required sections are always visible; optional ones live behind one disclosure — ALL of
   * them or none of them. The artboard's literal "8 more optional files" implied a partial
   * tail (some optional inputs shown, the rest hidden), which the owner ruled out: a count
   * that only describes the remainder tells the user nothing about what is there.
   */
  const split = $derived(splitPrompt(inputs));

  // Reset whenever a fresh prompt opens: a dialog reopened for another subject must not
  // inherit the previous run's picks.
  $effect(() => {
    if (open) {
      void subjectText;
      void inputs;
      // Seeded, not empty: see `prefill`. `seq` keeps ids unique across a reopen, and only
      // files belonging to an input this prompt actually declares are taken, so a stale list
      // cannot smuggle a section in.
      const declared = new Set(inputs.map((i) => i.id));
      slots = (prefill ?? [])
        .filter((f) => declared.has(f.inputId))
        .map((f) => ({
          id: ++seq,
          inputId: f.inputId,
          filename: f.filename,
          size: f.bytes.length,
          bytes: f.bytes,
          state: "ok" as const,
        }));
      formError = null;
      submitting = false;
      // NOT a flat `false`. A prompt with nothing required has only the tail to act on, so
      // collapsing it opens a dialog over its own single control -- which is what the GBA BIOS
      // prompt did. `optionalTailStartsOpen` owns that judgement; see its comment.
      tailOpen = optionalTailStartsOpen(inputs);
      queueMicrotask(() => dialog?.focus());
    }
  });

  // A whole-set error can name an input inside the tail, so never report one the user cannot see.
  $effect(() => {
    if (formError) tailOpen = true;
  });

  function labelFor(spec: ConverterInput): string {
    return pickText(spec.label, locale.current) ?? t.fallbackInputLabel(spec.id);
  }
  function descriptionFor(spec: ConverterInput): string | undefined {
    return pickText(spec.description, locale.current);
  }
  /** A variant's own localised name — manifest text, so the "German zelda3_de.sfc" chip the
   *  artboard shows needs no string of ours. Absent for most inputs; the chip then shows the
   *  filename alone. */
  function variantName(spec: ConverterInput, id: string | undefined): string | undefined {
    if (!id) return undefined;
    const v = spec.variants.find((x) => x.id === id);
    return v ? pickText(v.label, locale.current) : undefined;
  }
  function held(spec: ConverterInput): Slot[] {
    return slots.filter((s) => s.inputId === spec.id);
  }
  /**
   * May this input take another file?
   *
   * `slotsLeft` is the one rule: one file for a non-`allowMultiple` slot, `maxCount` files for
   * a bounded multiple one, unbounded otherwise. The ceiling matters here and not only in the
   * gate because with `runPerFile` the run count IS the file count — the gate refuses the
   * whole set past `maxCount` (`input-too-many`), so a picker that kept taking files would only
   * be arranging a refusal the user then has to undo one file at a time.
   */
  function canAdd(spec: ConverterInput): boolean {
    // Errored slots do not count: `submit()` only ever offers the usable ones, so they are not
    // files the gate will see, and a bad pick must not lock the picker away.
    return slotsLeft(spec, held(spec).filter((p) => p.state !== "error").length) > 0;
  }

  /** The gate's codes are the only source of an error message; nothing is invented here. */
  function errorCopy(code: string, spec: ConverterInput): string {
    if (code === "input-too-large") return t.errTooLarge(formatSize(spec.maxBytes));
    if (code === "input-unrecognised") return t.errInvalid(labelFor(spec));
    if (code === "input-not-multiple") return t.errNotMultiple;
    if (code === "input-missing") return t.errMissing;
    return t.errUnusable;
  }

  async function pick(spec: ConverterInput, e: Event) {
    const el = e.target as HTMLInputElement;
    const chosen = [...(el.files ?? [])];
    el.value = ""; // so the same file can be re-picked after a removal
    formError = null;

    for (const file of chosen) {
      if (!canAdd(spec)) break;
      const id = ++seq;
      const slot: Slot = {
        id,
        inputId: spec.id,
        filename: file.name,
        size: file.size,
        state: "checking",
      };
      // `maxBytes` before the read: the gate applies the same ceiling, but only once it has
      // the bytes. Knowing `File.size` means a 4 GB pick is never read at all.
      if (oversize(spec, file.size)) {
        slot.state = "error";
        slot.error = t.errTooLarge(formatSize(spec.maxBytes));
        slots = [...slots, slot];
        continue;
      }
      slots = [...slots, slot];

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        patch(id, { state: "error", error: t.errRead });
        continue;
      }

      // One file through the real gate, against this input's spec alone. Arity is checked
      // again over the whole set on submit — this pass is for immediate per-file feedback.
      const result = await gateInputs([spec], [{ inputId: spec.id, filename: file.name, bytes }]);
      const verdict = result.verdicts[0];
      if (verdict?.error) {
        patch(id, { state: "error", error: errorCopy(verdict.error.code, spec), sha1: verdict.sha1 });
      } else if (verdict?.recognised) {
        patch(id, { state: "ok", bytes, variantId: verdict.variantId });
      } else {
        // Accepted under `strict: false`. The user is told, in place, before committing.
        patch(id, { state: "unrecognised", bytes });
      }
    }
  }

  /**
   * Answer one input from a whole DIRECTORY.
   *
   * The rule is `sources/inputDiscovery.ts`'s, unchanged and un-duplicated: `folderCandidates`
   * walks the tree extension-first reading nothing but metadata, and `discoverInput` then
   * narrows by the variants' published `bytes` before hashing a single file. A Tomb Raider
   * install of 400 files costs 400 `getFile()` calls and hashes only the handful that could be
   * a declared level — the same cost rule the automatic case is held to, because it IS the
   * automatic case, run against one folder on demand.
   *
   * Everything below the walk is the gate's: `discoverInput` returns only what `gateInputs`
   * accepted, so `maxBytes`, `strict` and the variant table decide here exactly as they do for
   * a hand-picked file. `folderId` is "" because these candidates are not being attributed to a
   * registered folder — the caller has already done that with the handle.
   */
  async function pickFolder(spec: ConverterInput) {
    if (!onPickFolder) return;
    formError = null;
    let handle: unknown | null = null;
    try {
      handle = await onPickFolder();
    } catch {
      // The picker threw (no permission, no API). A folder that cannot be opened adds nothing;
      // the file picker beside it is still there.
      return;
    }
    if (!handle) return; // cancelled, which is not an error

    let result: Awaited<ReturnType<typeof discoverInput>>;
    try {
      const candidates = await folderCandidates(handle, "", spec.extensions);
      result = await discoverInput(spec, candidates, { hash: sha1Hex });
    } catch {
      return;
    }

    // `discoverInput` caps at the input's own `maxCount`; this caps again at what is LEFT after
    // whatever the user already picked by hand, which only this side knows.
    const room = slotsLeft(spec, held(spec).filter((p) => p.state !== "error").length);
    const taken = result.files.slice(0, room === Infinity ? undefined : room);
    const unrecognised = new Set(result.unrecognised);
    for (const [i, file] of taken.entries()) {
      // Discovery may already have prefilled this exact file from a broader registered source
      // (for example Downloads). Choosing its narrower folder must not append a second slot.
      const duplicate = slots.some((slot) =>
        slot.inputId === spec.id &&
        slot.filename.toLowerCase() === file.filename.toLowerCase() &&
        slot.bytes !== undefined &&
        slot.bytes.length === file.bytes.length &&
        slot.bytes.every((value, index) => value === file.bytes[index]),
      );
      if (duplicate) continue;
      slots = [
        ...slots,
        {
          id: ++seq,
          inputId: spec.id,
          filename: file.filename,
          size: file.bytes.byteLength,
          bytes: file.bytes,
          state: unrecognised.has(file.filename) ? "unrecognised" : "ok",
          ...(result.found[i]?.variantId !== undefined ? { variantId: result.found[i].variantId } : {}),
        },
      ];
    }
  }

  /** Replace one slot by its stable id. */
  function patch(id: number, next: Partial<Slot>) {
    slots = slots.map((s) => (s.id === id ? { ...s, ...next } : s));
  }

  function remove(slot: Slot) {
    slots = slots.filter((s) => s.id !== slot.id);
    formError = null;
  }

  /** The one hash the artboard's "Expected SHA-1" row can name — only meaningful when the
   *  input publishes exactly one known variant. */
  function expectedSha(spec: ConverterInput): string | undefined {
    return spec.variants.length === 1 ? spec.variants[0].sha1 : undefined;
  }

  const busy = $derived(slots.some((s) => s.state === "checking"));
  const usable = $derived(slots.filter((s) => s.bytes && s.state !== "error"));
  const ready = $derived(
    !busy &&
      !slots.some((s) => s.state === "error") &&
      inputs.every((spec) => !spec.required || usable.some((s) => s.inputId === spec.id)),
  );

  async function submit() {
    submitting = true;
    formError = null;
    try {
      const offered: OfferedFile[] = usable.map((s) => ({
        inputId: s.inputId,
        filename: s.filename,
        bytes: s.bytes as Uint8Array,
      }));
      // The authoritative pass: the same gate over the whole set, so the arity rules
      // (`required`, `allowMultiple`) it alone can check are the ones that decide.
      const gate = await gateInputs(inputs, offered);
      if (gate.errors.length > 0) {
        const first = gate.errors[0];
        const spec = inputs.find((i) => first.detail?.startsWith(i.id)) ?? inputs[0];
        formError = errorCopy(first.code, spec);
        return;
      }
      onSubmit({ files: gate.accepted, gate });
    } finally {
      submitting = false;
    }
  }

  /**
   * Focus trap. ModalShell already handles the backdrop click and Escape (its keydown is on
   * the backdrop, so it fires for anything focused inside), but it does not confine Tab —
   * so that part, and only that part, is here.
   */
  function trap(e: KeyboardEvent) {
    if (e.key !== "Tab" || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <ModalShell onDismiss={submitting ? null : onCancel} maxWidth="38.75rem" padded={false}>
    {#snippet children()}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="wrap"
        bind:this={dialog}
        role="document"
        tabindex="-1"
        aria-label={t.title(subjectText)}
        onkeydown={trap}
      >
        <header class="head-block">
          <h3>{t.title(subjectText)}</h3>
          {#if note}
            <p class="sub">{note}</p>
          {:else if showConverted}
            <p class="sub">{t.subtitleConverted}</p>
          {/if}
        </header>

        <div class="body">
        {#each split.required as spec (spec.id)}
          {@render section(spec)}
        {/each}

        {#if split.optional.length > 0}
          <button
            class="tail"
            type="button"
            aria-expanded={tailOpen}
            onclick={() => (tailOpen = !tailOpen)}
          >
            <svg class="chev" class:open={tailOpen} width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 8l5 5 5-5" />
            </svg>
            <span>{t.optionalTail(split.optional.length)}</span>
          </button>
          {#if tailOpen}
            {#each split.optional as spec (spec.id)}
              {@render section(spec)}
            {/each}
          {/if}
        {/if}

        {#if formError}<p class="note err form">{formError}</p>{/if}
        </div>

        <footer class="actions">
          <Button variant="cancel" onclick={onCancel} disabled={submitting}>{locale.t.shared.common.cancel}</Button>
          <Button variant="action" onclick={submit} disabled={!ready || submitting}>
            {submitText}
          </Button>
        </footer>
      </div>
    {/snippet}
  </ModalShell>
{/if}

{#snippet section(spec: ConverterInput)}
          {@const picked = held(spec)}
          {@const good = picked.filter((p) => p.state !== "error")}
          {@const bad = picked.filter((p) => p.state === "error")}
          <section class="input">
            <div class="head">
              <div class="what">
                <div class="titleline">
                  <span class="name">{labelFor(spec)}</span>
                  <span class="tag" class:req={spec.required}>{spec.required ? t.required : t.optional}</span>
                </div>
                {#if descriptionFor(spec)}
                  <p class="desc" class:mono={monoDescriptions}>{descriptionFor(spec)}</p>
                {/if}
              </div>
              <div class="act">
                {#if good.length > 1}
                  <span class="state ok">{t.addedCount(good.length)}</span>
                {:else if good.length === 1}
                  <span class="state ok">
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                    </svg>{t.found}
                  </span>
                {/if}
                <!-- The picker disappears once a non-`allowMultiple` input is satisfied (only
                     "✓ Found" remains); an `allowMultiple` one keeps a 24px square + instead of the
                     word, because it is an "add another", not the first choice. -->
                <!-- A whole directory, for an input that says it takes many files
                     (`acceptsFolder`). Quiet and second: the file picker stays the primary
                     control, and a folder is the shortcut for the shelf the user already has. -->
                {#if canAdd(spec) && onPickFolder && acceptsFolder(spec)}
                  <button
                    class="folder"
                    type="button"
                    title={t.chooseFolder}
                    aria-label={t.chooseFolder}
                    onclick={() => void pickFolder(spec)}
                  >
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M2.5 5.5h5l1.5 2h8.5v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />
                    </svg>
                  </button>
                {/if}
                {#if canAdd(spec)}
                  <label class="add" aria-label={spec.allowMultiple ? t.choose : undefined}>
                    {#if spec.allowMultiple}
                      <span class="plus" title={t.choose}>
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                          <path d="M10 4v12M4 10h12" />
                        </svg>
                      </span>
                    {:else}
                      <span class="cap">{t.choose}</span>
                    {/if}
                    <input
                      type="file"
                      accept={acceptAttr(spec.extensions) || undefined}
                      multiple={spec.allowMultiple}
                      onchange={(e) => pick(spec, e)}
                    />
                  </label>
                {/if}
              </div>
            </div>

            {#each bad as slot (slot.id)}
              <div class="refusal">
                <span class="rhead">{slot.error}</span>
                {#if expectedSha(spec) || slot.sha1}
                  <div class="hashes">
                    {#if expectedSha(spec)}
                      <span class="hlabel">{t.expectedSha}</span>
                      <code class="hval">{expectedSha(spec)}</code>
                    {/if}
                    {#if slot.sha1}
                      <span class="hlabel gap">{t.currentSha}</span>
                      <code class="hval bad">{slot.sha1}</code>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </section>

          {#if good.length > 0}
              <div class="addedbox">
                <span class="alabel">{t.added}</span>
                <ul class="chips">
                  {#each good as slot (slot.id)}
                    <li>
                      <button
                        class="chip"
                        type="button"
                        aria-label={locale.t.sources.remove}
                        title={locale.t.sources.remove}
                        onclick={() => remove(slot)}
                      >
                        {#if variantName(spec, slot.variantId)}
                          <span class="vname">{variantName(spec, slot.variantId)}</span>
                        {/if}
                        <span class="fname">{slot.filename}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
{/snippet}


<style>
  /* The shell's body padding is off (padded={false}) so the footer rule can run edge to edge:
     the three bands pad themselves instead, and only the middle one scrolls. */
  .wrap {
    outline: none;
    display: flex;
    flex-direction: column;
    max-height: 74vh;
  }
  .head-block {
    padding: 22px 26px 4px;
  }
  .body {
    padding: 10px 26px 4px;
    overflow-y: auto;
  }
  h3 {
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 0.25rem;
  }
  .sub {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  /* Sections separate with a rule, not a box — a container earns a border only when it wraps a
     real object (docs/design/mockups/README.md). The last row in the body drops its rule so it
     does not double up with the footer's. */
  .input {
    padding: 13px 0;
  }
  .input:not(:last-child) {
    border-bottom: 1px solid var(--rule);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .titleline {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }
  .name {
    font-size: var(--fs-caption);
    font-weight: 600;
  }
  /* required/optional are badges, not adjectives — the tint pair exists for exactly this
     (--tint-required behind --danger). */
  .tag {
    /* ModalFilesBios.dc.html: 10px/0.06em. --fs-label (11px) was standing in. */
    font-size: var(--fs-badge);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    background: var(--chip-fill);
    border-radius: var(--r-control);
    padding: 3px 6px;
    white-space: nowrap;
  }
  .tag.req {
    color: var(--danger);
    background: var(--tint-required);
  }
  .desc {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    margin-top: 3px;
  }
  /* A BIOS slot's description IS its accepted filename(s) (ModalFilesBios), so it is set as
     one — the converter case keeps prose in the body face. */
  .desc.mono {
    font-family: var(--font-mono);
  }
  /* The optional-file disclosure. It holds EVERY optional input or the modal renders none of
     it — see splitPrompt(). */
  .tail {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: 0;
    padding: 13px 0;
    width: 100%;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .chev {
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }
  .chev.open {
    transform: rotate(180deg);
  }
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .state.ok {
    color: var(--zelda-green);
  }
  .state svg {
    flex-shrink: 0;
  }
  .note {
    margin-top: 0.4rem;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .note.err {
    color: var(--danger);
  }
  .note.form {
    margin-top: 0.9rem;
  }
  /* A refused file is one of the few things that earns a container: a tinted panel with a
     danger rule down its leading edge (ModalFilesBiosError). The two hashes stack —
     label over value, full width, broken anywhere — so the eye can run down them and find
     the character that differs. The offending one carries --danger; the expected one is
     plain ink, so which is which is legible without reading the labels. */
  .refusal {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.55rem;
    padding: 0.55rem 0.75rem;
    background: var(--tint-danger);
    border-inline-start: 2px solid var(--danger);
    border-radius: 0 3px 3px 0;
  }
  .rhead {
    font-size: var(--fs-micro);
    font-weight: 600;
    color: var(--danger);
  }
  .hashes {
    display: flex;
    flex-direction: column;
  }
  .hlabel {
    font-size: var(--fs-label);
    color: var(--ink-soft);
  }
  .hlabel.gap {
    padding-top: 0.25rem;
  }
  .hval {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--ink);
    word-break: break-all;
  }
  .hval.bad {
    color: var(--danger);
  }
  /* ModalFilesConvert draws Added as a SEPARATE block below the last input row's rule —
     `padding: 12px 0 13px`, outside the section, which is why the section above it keeps
     its own border-bottom. */
  .addedbox {
    padding: 12px 0 13px;
  }
  .alabel {
    font-size: var(--fs-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-dim);
  }
  .chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin: 7px 0 0;
    padding: 0;
  }
  /* A chip is a filled token, not an object: no border. It names the variant the gate matched
     and the file it came from — the size the gate already accepted tells the user nothing. */
  .chip {
    display: flex;
    align-items: baseline;
    gap: 8px;
    background: var(--chip-fill);
    border: 0;
    border-radius: 3px;
    padding: 5px 9px;
    font: inherit;
    cursor: pointer;
  }
  .vname {
    font-size: var(--fs-micro);
    color: var(--ink);
    white-space: nowrap;
  }
  .fname {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 16rem;
  }
  .add {
    display: inline-block;
    cursor: pointer;
  }
  .add input {
    display: none;
  }
  /* Same silver cap as FilePick.svelte. FilePick itself is not reused here: it holds its own
     single chosen-file name and reports a File, whereas this needs a multi-file list with a
     per-file verdict, and must never show a name the gate has refused. */
  /* An outlined ink cap, not the silver function-button face: inside a modal row this is a
     quiet picker, and the red submit in the footer is the only filled control. */
  .cap {
    display: inline-block;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--ink);
    border-radius: 4px;
    padding: 5px 14px;
    font-weight: 600;
    font-size: var(--fs-micro);
    white-space: nowrap;
  }
  /* The folder shortcut sits beside the file picker at the same 24px square, but WITHOUT the
     outline: two identically framed controls would read as a pair of equal choices, and the
     file picker is the one that answers every input. */
  .folder {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: none;
    border: 0;
    color: var(--ink-soft);
    cursor: pointer;
    flex-shrink: 0;
  }
  .folder:hover {
    color: var(--ink);
  }
  .plus {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--ink);
    border: 1px solid var(--ink);
    border-radius: 4px;
    flex-shrink: 0;
  }
  /* A real footer band: full-bleed, ruled off the body, outside its padding. The small
     dialogs (ModalConnect/ModalFolder/ModalInstallConfirm) deliberately have no such rule. */
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    justify-content: flex-end;
    border-top: 1px solid var(--hairline);
    padding: 16px 26px;
    flex-shrink: 0;
  }
</style>
