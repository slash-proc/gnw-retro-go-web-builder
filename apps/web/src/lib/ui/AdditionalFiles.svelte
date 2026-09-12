<script lang="ts">
  // --- Additional files (ReposDetail artboard) --------------------------------------------
  //
  // The files a source needs and cannot ship. Two kinds, one section, because they are one
  // idea: a core's BIOS slots (sources/bios.ts) and a homebrew converter's declared
  // inputs (tools[].inputs). The Library tab renders the same BIOS state in its game list;
  // both read `biosState`, neither owns it.
  //
  // Lifted out of `views/Sources.svelte` unchanged. It reads `biosState`/`prepareState`
  // directly rather than being handed rows, so the medium policy stays where it already is
  // (`biosState.installable`) and is not restated here.
  //
  // The row-COMPOSITION rule (which slots, which inputs, and the three states) is not here
  // either: it is `sources/fileRows.ts`, pure and rune-free so a node test can pin it. This
  // component resolves the stores, calls it, and owns every string.
  //
  // The prompt modal is COMPONENT-LOCAL, not a store singleton: two mounted views must not
  // render the same modal twice.
  //
  // NOTE: the `biosState.refresh()` effect deliberately stays in the parent view. It has to
  // run for `biosState` to have rows at all, and this component only mounts once there are
  // rows — an effect in here would never get the chance to fire.
  import { locale } from "../i18n/locale.svelte.js";
  import { library } from "../library.svelte.js";
  import { pickFolder } from "../romScan.js";
  import { device } from "../device.svelte.js";
  import FilePromptModal from "./FilePromptModal.svelte";
  import type { SourceRow } from "../sources/store.svelte.js";
  import { biosState } from "../sources/biosState.svelte.js";
  import type { BiosStatus } from "../sources/bios.js";
  import { prepareTool } from "../sources/converter.js";
  import { prepareText } from "../sources/errorText.js";
  import type { ConverterInput } from "../sources/converterTypes.js";
  import { pickText, slotsLeft } from "../sources/inputPrompt.js";
  import type { GateResult, OfferedFile } from "../sources/inputGate.js";
  import { prepareState } from "../sources/prepareState.svelte.js";
  import { adoptInputFolder, discoverForSource, discoverySignature } from "../sources/discoveryWire.svelte.js";
  import { homebrew, type HomebrewTitle } from "../sources/homebrewTitles.svelte.js";
  import {
    biosRequired,
    biosRowState,
    converterRowState,
    dedupeInputsById,
    drawnFiles,
    heldFileList,
    rowOffersPicker,
    rowOffersRemove,
    selectBiosNeeds,
    type FileRowState,
    type DrawnFile,
  } from "../sources/fileRows.js";

  let { source }: { /** The selected source this section is for. */ source: SourceRow } = $props();

  const t = $derived(locale.t.sources);

  /** One "Additional files" row: a name, how badly it is needed, and where it stands. */
  type FileRow = {
    key: string;
    name: string;
    /** The artboards' monospace second line: the BIOS filenames, or the input's extensions. */
    meta: string;
    /** How badly it is needed, already localised — three phrasings, see `needNote`. */
    note: string;
    /** Manifest-declared `allowMultiple`; a BIOS slot has no such field and never takes more than one file. */
    allowMultiple: boolean;
    /** WHICH files this row is holding, one drawn row each — see `heldFileList`. Always empty
     *  on a BIOS slot, which takes exactly one file and states it with the hash. */
    held: DrawnFile[];
    /** Can this input still take another file? Drawn as the `+` being there or not — never as
     *  a change of wording, which is the antipattern this row is being fixed for. */
    canAdd: boolean;
    /** Same three states for both kinds. A converter input is "found" once the user has
     *  supplied a file the gate accepted for it (`prepareState.supplied`), "add" otherwise —
     *  "ok" is a BIOS-only claim, since it means the published hash matched. */
    state: FileRowState | null;
    /** Is the satisfying file one the HOST holds, so `Remove` can genuinely take it out?
     *  See `rowOffersRemove` — a BIOS found on the device or in the folder scan is not. */
    removable: boolean;
    bios?: BiosStatus;
    /** Set on a converter-input row: the source's inputs are what its "Add a file" asks for. */
    converter?: boolean;
    /** The manifest input id, carried rather than re-parsed out of `key`. */
    inputId?: string;
  };

  /**
   * The selected core's BIOS slots — EVERY slot it declares, not just the ones this medium
   * would write.
   *
   * This read `biosState.installable`, and that is the bug the owner hit on far more projects
   * than Doom: on Flash, `installable` drops a slot whose system has no games yet. So fceumm
   * (`nes/disksys`), pce-go (`pcecd/syscard3`) and SMSPlusGX (`col/coleco`) announced "Needs
   * user files: Yes" in the release panel above and then offered nothing at all to supply —
   * and could not, because a user with no NES games yet has no other route to a BIOS, and
   * adding the games first is the wrong order for a card that will not boot them without it.
   *
   * The medium policy is NOT weakened: `biosState.installable` still governs what an install
   * writes, what the Library nags about (`outstanding`) and what the summary counts. This is
   * the CONFIGURE page — "what this source can take from you", which is a property of the
   * source, not of today's install. `sorted` still puts what is wrong first.
   */
  const biosRows = $derived.by<BiosStatus[]>(() =>
    selectBiosNeeds(biosState.sorted, biosState.all, source.repo),
  );

  /** The selected homebrew source's converter inputs, deduplicated across its tools. A tool
   *  this host cannot run contributes nothing rather than emptying the section. */
  const converterInputs = $derived.by<ConverterInput[]>(() => {
    // KIND IS NOT A GATE HERE, and it used to be (`card.kind !== "homebrew"` returned early).
    // That is the Configure-page half of the owner's "neither is working": a CORE may declare
    // a converter too — Doom's `.wad` -> `.whd` tool is on a core target — and the whole
    // section for it rendered empty, so its input could not be supplied from this page at all.
    // What decides whether there is anything to ask for is whether a tool PARSES, which the
    // loop below already establishes: a source with no runnable tool contributes no rows and
    // the section does not render.
    const perTool: ConverterInput[][] = [];
    for (const tool of source.manifest?.tools ?? []) {
      try {
        perTool.push(prepareTool(tool).inputs);
      } catch {
        /* unsupported or malformed tool: its code is read by `rejectedToolCode`, below */
      }
    }
    return dedupeInputsById(perTool);
  });

  /**
   * Tools this host REFUSED, as opposed to tools the source does not have.
   *
   * zelda3 v0.3.0 is the live case: its inputs still carry the pre-spec key `repeatable` and
   * omit `allowMultiple`, so `inputGate.ts`'s narrowing throws `malformed` — correctly, and it
   * must keep throwing (accepting `repeatable` would bless pre-spec manifests forever). What
   * was wrong is that the refusal was SILENT: the section simply had no rows, which reads as
   * "this source asks nothing of you" rather than "we could not read what it asks". The count
   * is turned into the same mapped failure line a failed prepare already produces, so the user
   * sees the source named as broken instead of an empty panel.
   */
  const rejectedToolCode = $derived.by<string | undefined>(() => {
    for (const tool of source.manifest?.tools ?? []) {
      try {
        prepareTool(tool);
      } catch (err: unknown) {
        // The THROWN code, not a fabricated one. This line used to render
        // `convertFailed("malformed")` with the code hardcoded, which produced the owner's
        // "Konnte nicht vorbereitet werden: malformed" — a translated sentence wrapped around
        // an identifier that was not even read from the failure. `prepareText` maps whatever
        // was actually thrown to a sentence; the code itself goes to the log, not here.
        return typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : undefined;
      }
    }
    return undefined;
  });

  /**
   * The requirement note. THREE phrasings, because the manifest states the requirement in two
   * different ways and spec/07 lets a BIOS slot use either: a plain `required` boolean, or
   * `requiredFor` — a list of extensions the file is mandatory FOR. The artboard only draws
   * the `requiredFor` case ("Required for .cue"), so the other two keep the plain words.
   * The extensions are manifest text and are joined, never translated.
   */
  function needNote(required: boolean, requiredFor: string[] | undefined): string {
    if (requiredFor && requiredFor.length > 0) return t.additional.requiredFor(requiredFor.join(" "));
    return required ? t.additional.required : t.additional.optional;
  }

  const fileRows = $derived.by<FileRow[]>(() => {
    const lang = locale.current;
    const rows: FileRow[] = biosRows.map((b) => ({
      key: b.key,
      name: pickText(b.entry.label, lang) ?? b.filenames[0],
      // Every accepted name for ONE file (spec/07): `filename` may be an array, but it is a
      // list of names that satisfy the slot, never permission to supply several files.
      meta: b.filenames.join(" "),
      note: needNote(biosRequired(b.need), b.requiredFor),
      allowMultiple: false,
      held: [],
      // A BIOS slot takes exactly one file and its picker is unconditional (`rowOffersPicker`),
      // which is how a wrong dump gets replaced. There is no second file to add, so no `+`.
      canAdd: false,
      state: biosRowState(b),
      // Only a file supplied through the prompt this session can be taken back out; a candidate
      // the device or the folder scan reported is a file on a real filesystem we do not own.
      removable: biosState.hasUserFiles(b),
      bios: b,
    }));
    for (const input of converterInputs) {
      // The variant's own label, in the reader's locale, resolved here for the same reason the
      // input's `name` is: `pickText` needs the locale, and `fileRows.ts` stays free of i18n.
      const byId = new Map(input.variants.map((v) => [v.id, v]));
      const held = drawnFiles(
        heldFileList(
          prepareState.suppliedNames(source.repo ?? "", input.id),
          prepareState.discoveredFor(source.repo ?? "", input.id).map((f) => f.filename),
          (filename) => {
            const id = prepareState.variantFor(source.repo ?? "", input.id, filename);
            const v = id === undefined ? undefined : byId.get(id);
            return v?.label === undefined ? undefined : pickText(v.label, lang);
          },
        ),
      );
      rows.push({
        key: `tool:${input.id}`,
        name: pickText(input.label, lang) ?? t.filePrompt.fallbackInputLabel(input.id),
        // Schema-verbatim, dot included (`^\.[A-Za-z0-9]+$`) — ".sfc .smc".
        meta: input.extensions.join(" "),
        note: needNote(input.required, undefined),
        allowMultiple: input.allowMultiple,
        held,
        // `slotsLeft` is the modal's own rule for the identical question, reused rather than
        // restated: one file for a single-file slot, `maxCount` for a repeatable one, unbounded
        // when the manifest declares no cap. A full slot simply loses its `+`.
        canAdd: slotsLeft(input, held.length) > 0,
        // `isSatisfied`, not `hasSupplied`: a file discovery found in the user's own folders
        // answers this input exactly as a picked one does (`prepareState.isSatisfied`), and a
        // row that read "add" about a file we are holding could never offer to remove it.
        state: converterRowState(prepareState.isSatisfied(source.repo ?? "", input.id)),
        removable: true,
        converter: true,
        inputId: input.id,
      });
    }
    return rows;
  });

  /** The open BIOS prompt: one system at a time, with every slot that system declares — the
   *  same shape `ModalFilesBios` shows and the same sink (`biosState.addUserFiles`). */
  let biosPromptFor = $state<{ systemName: string; needs: BiosStatus[] } | null>(null);

  const biosPromptInputs = $derived.by<ConverterInput[]>(() =>
    (biosPromptFor?.needs ?? []).map((b) => ({
      id: b.key,
      required: biosRequired(b.need) && (!b.present || b.blocked),
      allowMultiple: false,
      extensions: b.filenames.map((f) => f.slice(f.lastIndexOf(".") + 1)).filter((e) => e !== ""),
      // A BIOS is kilobytes; the ceiling only stops something absurd being read into memory.
      maxBytes: Math.max(b.entry.bytes ?? 0, 1024 * 1024),
      // `strict` is only honoured with a published `sha1`: the gate refuses everything matching
      // no variant, so a strict input with no variants would reject every file.
      variants: b.entry.sha1
        ? [
            {
              id: b.entry.id,
              sha1: b.entry.sha1,
              ...(b.entry.bytes !== undefined ? { bytes: b.entry.bytes } : {}),
            },
          ]
        : [],
      strict: b.entry.sha1 !== undefined && b.entry.strict !== false,
      label: b.entry.label,
      description: b.entry.description,
    })),
  );

  async function openBiosPrompt(from: BiosStatus): Promise<void> {
    const needs = biosState.all.filter((b) => b.repo === from.repo && b.systemId === from.systemId);
    if (needs.length === 0) return;
    try {
      // The file is stored in the folder scan, so there has to be one. Existing gate, no new copy.
      await library.ensureFolders(device.targetMedia === "sd");
    } catch {
      return;
    }
    biosPromptFor = { systemName: from.systemName, needs };
  }

  function acceptBiosFiles(files: OfferedFile[]): void {
    const p = biosPromptFor;
    biosPromptFor = null;
    if (!p) return;
    for (const need of p.needs) {
      const mine = files.filter((f) => f.inputId === need.key);
      if (mine.length > 0) biosState.addUserFiles(need, mine);
    }
    void biosState.refresh();
  }

  // --- Converter inputs: the same "prepare" the Library runs, driven from this tab.
  //
  // The rows here are per-SOURCE (inputs deduplicated across its tools), so one prompt asks for
  // all of them at once and the answer is dispatched to every title of this source whose tool
  // wanted one of the offered files. Nothing else is decided here: the flow, the gate verdict
  // and the error copy are all `sources/prepareState.svelte.ts`'s, exactly as on the Library
  // tab — and selection stays a Library policy, so a prepare from here selects nothing.
  let converterPromptOpen = $state(false);

  /** The active source's titles that actually have a converter to feed — homebrew titles AND
   *  cores with a converter, since `homebrewTitles.svelte.ts` now yields both. */
  const converterTitles = $derived.by<HomebrewTitle[]>(() => {
    const repo = source.repo;
    if (!repo) return [];
    return homebrew.titles.filter((title) => title.repo === repo && title.tool !== undefined);
  });

  // --- Automatic discovery: a declared input the user's own folders already satisfy ---------
  //
  // The owner: "They should be recognized automatically. I've added my rom folder that has
  // doom/*.wad and I also added doom as a dedicated source folder." So before the picker is
  // ever offered, `sources/inputDiscovery.ts` is asked what the registered folders already
  // hold — and the row simply reads as satisfied, with its APPROVED copy ("Found" + check),
  // because from the user's side "you do not have to go and find this" is the same statement
  // however the file arrived. Nothing is converted here: auto-prepare is off the table.
  //
  // The two halves of the candidate list, and why there are two: a library folder is
  // already walked by the library scan and its bytes are in memory, so it costs NOTHING; a
  // folder the scan never touches (the dedicated one) is walked here, extension-filtered, with
  // sizes read from metadata and bytes read only for a file that survives every cheaper test.
  const converterTargetKeys = $derived(converterTitles.map((t) => t.key));

  /**
   * A run's own verdicts are NOT rendered here, and that is the rule rather than an omission.
   *
   * This panel used to carry every failure and every notice its source's titles produced. The
   * owner had exactly that class removed from the Library rows ("get rid of ANY messages
   * there") and it survived only here. Both now have one home: an error rings the bell and
   * lands in the activity log, a note lands in the log alone. What stays below is not a
   * message about a run at all, it is the panel's own state.
   */

  /** Re-run only when something that could change the answer changed. */
  let lastDiscoverySig = "";
  let lastDiscoveryScan: unknown = null;

  $effect(() => {
    const repo = source.repo ?? "";
    const ids = converterInputs.map((i) => i.id);
    const sig = discoverySignature(repo, ids, converterTargetKeys);
    const scan = library.scan;
    if (sig === lastDiscoverySig && scan === lastDiscoveryScan) return;
    lastDiscoverySig = sig;
    lastDiscoveryScan = scan;
    void discoverForSource(repo, converterInputs, converterTargetKeys);
  });

  /** Take a BIOS file back out and re-resolve, the mirror image of `acceptBiosFiles`. */
  function removeBiosFile(need: BiosStatus): void {
    biosState.removeUserFiles(need);
    void biosState.refresh();
  }

  /**
   * Take a converter input's file back out. `converterTitles` is passed so the shared flow can
   * drop what it CONVERTED from that input — see `prepareState.unsupply`; an output whose input
   * is gone can neither be reproduced nor verified, so it goes with it.
   */
  function removeConverterFile(inputId: string): void {
    prepareState.unsupply(source.repo ?? "", inputId, converterTitles);
  }

  /**
   * Take ONE held file back out. The `x` beside its own row, which is the whole point: the
   * single row-level `Remove` this replaced dropped every file an input held at once, and the
   * user could not see which files those were to begin with.
   */
  function removeOneFile(inputId: string, filename: string): void {
    prepareState.unsupplyFile(source.repo ?? "", inputId, filename, converterTitles);
  }

  /**
   * Pair each accepted file with the variant the gate matched it to.
   *
   * The gate reports the match in `verdicts`, not on the file: `inputDiscovery.ts` tests
   * `gate.accepted` membership by IDENTITY, so the gate cannot hand back copies carrying the
   * id. Pairing on `inputId` + `filename` is what the verdict itself is keyed by.
   *
   * Unmatched stays unmatched: a `strict: false` input accepts files no variant describes, and
   * those rows lead with their filename because nothing else is known about them.
   */
  function withVariants(r: { files: OfferedFile[]; gate: GateResult }): OfferedFile[] {
    const byFile = new Map<string, string>();
    for (const v of r.gate.verdicts) {
      if (v.variantId !== undefined) byFile.set(`${v.inputId}\u0000${v.filename}`, v.variantId);
    }
    return r.files.map((f) => {
      const id = byFile.get(`${f.inputId}\u0000${f.filename}`);
      return id === undefined ? f : { ...f, variantId: id };
    });
  }

  function acceptConverterFiles(files: OfferedFile[], unrecognised: string[]): void {
    converterPromptOpen = false;
    for (const title of converterTitles) {
      const ids = new Set(title.tool?.inputs.map((i) => i.id) ?? []);
      const mine = files.filter((f) => ids.has(f.inputId));
      // A title that got nothing is not this answer's business — its own artifacts-only
      // prepare is the Library's "prepare" action, not a side effect of adding a file here.
      if (mine.length > 0) void prepareState.run(title, mine, unrecognised);
    }
  }
</script>

<!-- The picker chip's glyph, shared by both branches of the row above. -->
{#snippet uploadIcon()}
  <svg
    width="12"
    height="12"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"><path d="M4 13v3h12v-3M10 4v9M6.5 7.5L10 4l3.5 3.5" /></svg
  >
{/snippet}

{#if fileRows.length > 0 || rejectedToolCode !== undefined}
  <!-- ReposDetail artboard: an uppercase caption over one row per file the source needs. -->
  <div class="addfiles">
    <h4>{t.additional.heading}</h4>
    <div class="filelist">
      {#each fileRows as row (row.key)}
        <!-- One input is a HEADER plus the files it holds, not a single line that changes its
             wording with the count. The owner, on the line this replaced: "what does remove do?
             there are 2 files there. What files are there? each should be its own row with its
             own remove button ffs." The shape is `FilePromptModal`'s `.addedbox` — the same
             list, on the page where a file is managed after the fact rather than chosen. -->
        <div class="fileitem">
          <div class="filerow">
            <div class="filemain">
              <span class="filename">{row.name}</span>
              <span class="filedesc">{row.meta}</span>
            </div>
            <span class="need">{row.note}</span>
            {#if row.state === "ok"}
              <span class="state good">{t.additional.hashMatches} &#10003;</span>
            {:else if row.state === "found"}
              <!-- ReposDetailReady draws the satisfied row as the matched variant's NAME plus a
                   green check. The header says only THAT the input is answered; WHICH files
                   answer it is the list below, so no number appears here. -->
              <span class="state good">{t.filePrompt.found} &#10003;</span>
            {/if}
            <!-- The picker is UNCONDITIONAL, not `state === "add"` only.
                 A satisfied row still has to be manageable: a user who supplied the wrong dump,
                 or wants a different language patch, replaces it by choosing again — the prompt
                 is the only place a file for this slot/input can be supplied at all, so hiding
                 its opener the moment one arrives makes the choice permanent. -->
            {#if row.bios && rowOffersPicker(row.state)}
              {@const need = row.bios}
              <button type="button" class="chip" onclick={() => void openBiosPrompt(need)}>
                {@render uploadIcon()}{t.additional.chooseFile}
              </button>
            {:else if row.converter && row.canAdd && rowOffersPicker(row.state)}
              <!-- ONE label, never pluralised. `Choose file` / `Choose files` swapped by
                   `allowMultiple` was, in the owner's words, "an antipattern the user will not
                   immediately notice": a one-letter difference that looks like it says
                   something. Whether more can be added is carried by this control being here at
                   all — a full slot (`slotsLeft` = 0) simply has none. -->
              <button type="button" class="chip" onclick={() => (converterPromptOpen = true)}>
                {@render uploadIcon()}{t.additional.chooseFile}
              </button>
            {/if}
            <!-- `Remove` stays on the ROW for a BIOS slot, which holds exactly one file and can
                 say so unambiguously. A converter input's files are removed one at a time,
                 below — a row-level Remove there dropped every file at once. -->
            {#if row.bios && rowOffersRemove(row.state, row.removable)}
              {@const bios = row.bios}
              <button type="button" class="remove" onclick={() => removeBiosFile(bios)}
                >{t.remove}</button
              >
            {/if}
          </div>
          {#if row.held.length > 0}
            {@const inputId = row.inputId ?? ""}
            <ul class="held">
              {#each row.held as file (file.filename)}
                <li>
                  <!-- The variant's name leads where it identifies this file; the filename is
                       subordinate to it. Where nothing attributed the file, or the label is
                       shared with another file this row holds, the filename leads alone
                       (`drawnFiles`). No wording changes between the two: what moves is which
                       element is there. -->
                  {#if file.lead}
                    <span class="hlead">{file.lead}</span>
                    <span class="hname hsub">{file.filename}</span>
                  {:else}
                    <span class="hname">{file.filename}</span>
                  {/if}
                  <button
                    type="button"
                    class="drop"
                    aria-label={t.remove}
                    title={t.remove}
                    onclick={() => removeOneFile(inputId, file.filename)}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg
                    >
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
    <!-- A tool this host REFUSED, which is why the rows above are missing rather than a report
         on any run. Without it the section reads as "this source asks nothing of you" instead
         of "we could not read what it asks". The sentence is mapped from the code that was
         actually thrown; the code goes to the activity log. -->
    {#if rejectedToolCode !== undefined}
      <p class="fileerr">
        {locale.t.roms.selectGames.errorPrefix(prepareText(locale.t.sources, rejectedToolCode))}
      </p>
    {/if}
  </div>
{/if}

{#if converterPromptOpen}
  <FilePromptModal
    open={true}
    subject={source.card?.title ?? source.repo}
    inputs={converterInputs}
    converts={true}
    submitText={t.filePrompt.submitPrepare}
    prefill={converterInputs.flatMap((i) => prepareState.discoveredFor(source.repo ?? "", i.id))}
    onPickFolder={async () => {
      const handle = await pickFolder("gnw-converter-input");
      return handle ? await adoptInputFolder(handle, converterTargetKeys) : null;
    }}
    onCancel={() => (converterPromptOpen = false)}
    onSubmit={(r) => acceptConverterFiles(withVariants(r), r.gate.unrecognised.map((v) => v.filename))}
  />
{/if}

{#if biosPromptFor}
  <FilePromptModal
    open={true}
    subject={biosPromptFor.systemName}
    inputs={biosPromptInputs}
    note={t.filePrompt.subtitleBios(biosPromptFor.systemName)}
    monoDescriptions={true}
    submitText={t.filePrompt.submitAddToLibrary}
    onCancel={() => (biosPromptFor = null)}
    onSubmit={(r) => acceptBiosFiles(r.files)}
  />
{/if}

<style>
  .addfiles {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .addfiles h4 {
    margin: 0;
    font-size: var(--fs-label);
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* ReposDetailReady's "Additional files" panel: a real object (the manifest's file rows),
     so it keeps its surface — but borderless, like every other panel there (audit 2.6). */
  .filelist {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 2px 18px;
  }
  .filerow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 0;
  }
  /* The rule now separates INPUTS (header + its files), not lines: a file list belongs to the
     header above it, so a rule between the two would cut one input in half. */
  .fileitem + .fileitem {
    border-top: 1px solid var(--rule);
  }
  /* The held files. `FilePromptModal`'s `.addedbox` shape — the file's own name and its own
     control — indented under the header so the list reads as belonging to it. No `overflow`
     here: `.tabpane` is the page's only scroll container and a growing list must lengthen the
     pane, not clip inside a box (CLAUDE.md; no gate in this repo detects that). */
  .held {
    list-style: none;
    margin: 0 0 13px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .held li {
    display: flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    max-width: 100%;
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    /* Inline: the wider side is the filename's, the narrower the trailing remove control's. */
    padding-block: 4px;
    padding-inline: 10px 6px;
  }
  .hname {
    font-size: var(--fs-caption);
    font-family: var(--font-mono, ui-monospace, Menlo, monospace);
    overflow-wrap: anywhere;
  }
  /* The variant's name, when it identifies this file. Body type at the row's own weight, so it
     reads as the subject and the monospace filename beside it reads as the reference. */
  .hlead {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  /* …and the filename demoted behind it. Same face as a filename anywhere else on this page,
     one step quieter, because the label is now what names the thing. */
  .hsub {
    color: var(--ink-soft);
  }
  /* The `x`. A 20px hit target, quiet until hovered — the file's name is the content, this is
     the action on it. */
  .drop {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    color: var(--ink-soft);
    background: none;
    border: 0;
    border-radius: var(--r-control);
    padding: 0;
    cursor: pointer;
  }
  .drop:hover {
    color: var(--ink);
    background: var(--surface);
  }
  .filemain {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .filename {
    font-size: var(--fs-body);
    font-weight: 600;
  }
  /* SourcesCoreConfig.dc.html moved the requirement out of the name line and onto its
     own column beside the picker, as plain 12px grey prose — not the boxed uppercase badge
     ModalFilesBios draws. It has to hold "Required for .cue", which a 10px tracked badge
     cannot. */
  .need {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .filedesc {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    font-family: var(--font-mono, ui-monospace, Menlo, monospace);
    overflow-wrap: anywhere;
  }
  /* The low-profile picker chip: a bordered 13px control, not a link. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    padding: 5px 12px;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--surface-sunk);
  }
  /* ReposDetailReady.dc.html draws the right-hand state at 13px/600. */
  .state {
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .state.good {
    color: var(--zelda-green);
  }
  /* Plain grey 13px text, deliberately NOT a second chip (SourcesFilesSupplied.dc.html). */
  .remove {
    font-family: inherit;
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    background: none;
    border: 0;
    padding: 0;
    white-space: nowrap;
    cursor: pointer;
  }
  .remove:hover {
    color: var(--ink);
  }
  .fileerr {
    margin: 0.5rem 0 0;
    font-size: var(--fs-caption);
    color: var(--danger);
    white-space: pre-line;
  }

</style>
