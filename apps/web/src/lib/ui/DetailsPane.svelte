<script lang="ts">
  /**
   * Overview > Console > Details — `docs/design/proposals/overview-v2/Details.dc.html`.
   *
   * "The same console with the working shown, visualised rather than tabulated." Status answers
   * what this console IS; this pane is where the bytes are. Nothing here is a health verdict and
   * nothing here is a sentence: every section is a heading, a visual, and label/value rows whose
   * value column stands alone.
   *
   * Reused, not reinvented, exactly as the README lists: `BankCard` for the two banks,
   * `GeometryBar` for the flash chip, `StatPanel` grids for adapter and app state. The bank and
   * external-flash blocks moved here from `OverviewTab.svelte` unchanged in behaviour — the boot
   * modal, the empty-bank prompts and the legend's read-the-rendered-paint trick are all the
   * originals, because a rail is a relocation, not a rewrite.
   *
   * TWO SECTIONS THE BOARD DRAWS AND THIS DOES NOT, both because the data does not exist rather
   * than because they were dropped:
   *
   *  - **Storage.** The board draws a card label, a capacity bar and a Games/Covers/Saves
   *    breakdown. Three of those four are now obtainable and one still is not, so this is a
   *    copy decision rather than a data one.
   *
   *    `lib/sdStorage.svelte.ts` measures the breakdown for real: it walks the connected card
   *    reading `File.size` only, and buckets by the same `InstallPaths` roles `sdDestPath()`
   *    writes to, so what it counts as Covers is by construction where the sync puts covers.
   *    Saves is the `data` role, which is what the firmware means by `ODROID_BASE_PATH_SAVES`.
   *    The card label is the picked folder's own `name`.
   *
   *    CAPACITY IS NOT OBTAINABLE, and it is the same shape as the chip name below. A directory
   *    handle does not expose its volume, and `navigator.storage.estimate()` reports THIS
   *    ORIGIN's quota — a real number about the browser profile, unrelated to the card, and
   *    therefore a fabrication that would survive any check asking only whether a number was
   *    present. So the board's "12.4 GB free of 29.7 GB" cannot be drawn, and neither can a bar
   *    whose width means fullness.
   *
   *    What is left is a bar of proportions OF WHAT IS ON THE CARD, which is a different claim
   *    from the board's and has to be said in words the owner has not yet written. Adopting the
   *    store is therefore blocked on that copy, not on the data: see the store's header.
   *  - **The external-flash chip NAME** (`MX25U51245G` on the board). This one is not a matter
   *    of plumbing a value we already have, and the reason is worth writing down so nobody
   *    re-attempts it from the board alone.
   *
   *    The gnwmanager FIRMWARE does read the JEDEC id and does hold the authoritative name
   *    table: `references/gnwmanager/Core/Src/flash.c` issues `CMD_RDID` (`0x9F`) in
   *    `OSPI_Init` and matches it against `jedec_map[]`, nineteen entries mapping an id to a
   *    part name, a command set and a size. But the mailbox struct it publishes to the host
   *    (`Core/Src/gnwmanager.c`, the `flash_size` / `min_erase_size` block) carries only those
   *    two numbers. `flash.jedec_id` and `flash.name` stay firmware-private and reach nothing
   *    but a `DBG()` print, which is why `DeviceInfo` has no field for them: there is none to
   *    read. Our stub is a pinned upstream blob with no symbol map in the repo, so fishing the
   *    id out of stub RAM would mean guessing an address inside a prebuilt binary.
   *
   *    Size cannot stand in for it either. `flash.size` IS assigned from the matched row, so it
   *    is a function of the id, but not an injective one: eight rows in that table are 64 MB,
   *    carrying six distinct part names (MX25U51245G, MX25L51245G, MX25U51245G-54, S25FS512S,
   *    W25Q512NW-Q/N, W25Q512NW-M). Naming a part from a capacity would be a guess wearing a
   *    fact's clothes, which is the one thing this pane must not do.
   *
   *    Unblocking it means the firmware publishing the id, which is upstream work, not ours.
   */
  import { tick } from "svelte";
  import { device } from "../device.svelte.js";
  import { APP_VERSION } from "../appVersion.js";
  import { locale } from "../i18n/locale.svelte.js";
  import GeometryBar from "./GeometryBar.svelte";
  import BankCard from "./BankCard.svelte";
  import StatPanel, { type StatRow } from "./StatPanel.svelte";
  import ConfirmModal from "./ConfirmModal.svelte";
  import Button from "./Button.svelte";
  import PaneFooter from "../advanced/PaneFooter.svelte";
  import { attachFlasher } from "../engine/flasher.js";
  import { extflashSegments, intflashSegments } from "../engine/classify.js";
  import type { GeoSegment } from "../engine/classify.js";
  import type { IntflashBank } from "../engine/intflashscan.js";
  import { formatSize } from "../util.js";
  import { sources, type SourceRow } from "../sources/store.svelte.js";
  import { blobCache } from "../sources/blobCache.js";

  const t = $derived(locale.t.overviewRail);
  const ov = $derived(locale.t.overview);

  // --- internal flash ----------------------------------------------------------------------
  const intSegs = $derived(intflashSegments(device.banks));
  const bank1Segs = $derived(intSegs.filter((s) => s.bank === 1));
  const bank2Segs = $derived(intSegs.filter((s) => s.bank === 2));
  const bootableBank = (n: 1 | 2) =>
    device.banks.some(
      (b) => b.index === n && b.type !== "empty" && b.type !== "unknown" && b.type !== "unreadable",
    );
  // Bank order is fixed: every Overview board draws Bank 1 left, Bank 2 right.
  const BANKS: (1 | 2)[] = [1, 2];
  const bank1Bootable = $derived(bootableBank(1));
  const bank2Bootable = $derived(bootableBank(2));

  // --- empty-bank next step ----------------------------------------------------------------
  // RESTORED. This moved here with the bank cards and I dropped it in the move; it is not
  // something the design removed. `Details.dc.html` does not draw these prompts, but the banks
  // themselves live on this pane now, and the README's own rule for `Back up now` applies to
  // them too: a row that can be acted on carries its action rather than being promoted
  // elsewhere. Removing the route to guided setup would be an owner's decision, not a side
  // effect of moving markup.
  //
  // An empty bank offers the step that fits THIS device's state, never a generic "Install".
  // Everything below is read off store fields that already exist:
  //   device.deviceClass.ofw / bank.ofw  -> is there stock firmware, and is it patched
  //   bank.type (bootableBank)           -> does either bank hold anything at all
  //   device.partitions                  -> is there anything in external flash
  // A state we cannot tell apart from those gets NO prompt rather than an invented one.
  const anyOfw = $derived(device.deviceClass?.ofw ?? device.banks.map((b) => b.ofw).find(Boolean) ?? null);
  // "Is an app (Retro-Go) already in a bank?" — the SAME expression classify.ts uses for its own
  // `hasApp` (engine/classify.ts:65): a bank holding something readable that is not official
  // firmware. Read off `bank.type` rather than `deviceClass.kind`, because a bank can hold an app
  // whose version string did not parse, which leaves kind as "unknown" — still not an empty slot.
  const appPresent = $derived(
    device.banks.some(
      (b) => !["empty", "unknown", "unreadable"].includes(b.type) && !b.type.includes("OFW"),
    ),
  );
  const nothingInstalled = $derived(
    !anyOfw && !bank1Bootable && !bank2Bootable && device.partitions.length === 0,
  );
  // `mode` is the sub-mode to request on the Firmware tab. Setting it (not just the hash) is what
  // actually makes "Guided Setup" open Guided Setup — the hash alone lands on whichever sub-mode
  // was last selected.
  type BankPrompt = { label: string; hash: string; mode?: "wizard" | "advanced" };
  const bankOfw = (n: 1 | 2) => device.banks.find((b) => b.index === n)?.ofw ?? null;
  // Per-bank, derived from THAT bank's own scanned state — the artboards put a different action
  // on each bank (StockUnpatched: "Patch stock firmware" on the occupied bank 1, "Install
  // Retro-Go" on the empty bank 2), so one device-wide value cannot express them.
  const bankPrompt = (n: 1 | 2): BankPrompt | null => {
    if (!device.deviceClass) return null; // not scanned yet — say nothing
    const occupied = n === 1 ? bank1Bootable : bank2Bootable;
    if (occupied) {
      // The only action an occupied bank carries beyond booting it: unpatched stock firmware
      // still needs patching (StockUnpatched.dc.html, bank 1). Anything else — patched OFW,
      // Retro-Go — is already finished, so the boot button is the whole footer.
      const o = bankOfw(n);
      if (o && !o.patched) {
        return { label: ov.bankEmpty.patchStock, hash: "firmware/ofw" };
      }
      return null;
    }
    // --- empty bank -----------------------------------------------------------------------
    if (nothingInstalled) {
      // BothEmpty.dc.html — the same offer on both banks.
      return { label: ov.bankEmpty.guidedSetup, hash: "guided", mode: "wizard" };
    }
    if (!anyOfw) {
      // NoStockBank2.dc.html offers "Install stock firmware" on the empty bank 1;
      // NoStockBank1.dc.html offers NOTHING on the empty bank 2. Stock firmware only ever boots
      // from bank 1 (0x08000000), so the offer belongs to bank 1 alone.
      return n === 1 ? { label: ov.bankEmpty.installStock, hash: "firmware/ofw" } : null;
    }
    if (!appPresent) {
      // Stock firmware present (patched or not) and no app in either bank — the empty bank is
      // where Retro-Go goes. StockUnpatched.dc.html's bank 2 offers exactly this.
      return { label: ov.bankEmpty.installRetroGo, hash: "firmware/install" };
    }
    // Stock firmware AND an app already installed — every bank that could be filled has been.
    // The remaining empty bank is a free slot, not a missing step, so it gets no prompt.
    return null;
  };
  const bank1Prompt = $derived(bankPrompt(1));
  const bank2Prompt = $derived(bankPrompt(2));
  // A bare `location.hash =` assignment is deliberate and load-bearing: it is the ONLY write
  // that fires `hashchange`, which is how `lib/nav.ts`'s readers pick up a cross-tab jump.
  // `nav.navigate()` uses pushState and fires nothing, so routing this through it would look
  // tidier and silently break the link.
  const goPrompt = (p: BankPrompt) => {
    if (p.mode) device.firmwareMode = p.mode;
    location.hash = p.hash;
  };

  // --- external flash ----------------------------------------------------------------------
  const extBytes = $derived(device.info?.externalFlashSizeBytes ?? 0);
  const extSegs = $derived(extflashSegments(device.partitions, extBytes));
  const extFreeBytes = $derived(
    extSegs.filter((sg) => sg.kind === "free").reduce((a, sg) => a + (sg.size ?? 0), 0),
  );

  // The legend's swatch paint is READ OFF the rendered bar rather than restated here: the
  // segment palette is still an open question, and a legend that hardcoded a colour would bake
  // in the unruled answer and then silently disagree with the bar when it is ruled on.
  let extBarEl = $state<HTMLElement | null>(null);
  type LegendEntry = { label: string; bytes: number; color: string };
  let extLegend = $state<LegendEntry[]>([]);
  $effect(() => {
    const segs = extSegs;
    const el = extBarEl;
    if (!el) {
      extLegend = [];
      return;
    }
    void tick().then(() => {
      const nodes = el.querySelectorAll<HTMLElement>(".gseg");
      const out: LegendEntry[] = [];
      segs.forEach((sg, i) => {
        if (sg.kind === "free" || !sg.label) return;
        const hit = out.find((e) => e.label === sg.label);
        if (hit) {
          hit.bytes += sg.size ?? 0;
          return;
        }
        const node = nodes[i];
        out.push({
          label: sg.label,
          bytes: sg.size ?? 0,
          color: node ? getComputedStyle(node).backgroundColor : "transparent",
        });
      });
      extLegend = out;
    });
  });

  const extRows = $derived.by((): StatRow[] => {
    if (!device.info) return [];
    return [
      { label: t.capacity, value: formatSize(extBytes) },
    ];
  });

  // --- adapter -----------------------------------------------------------------------------
  // Four facts about the link between this browser and that console. `Read protection` and
  // `Firmware backup` also appear on Status, and that is not duplication: there they are a
  // precondition with a dot and possibly an action, here they are a recorded value.
  const adapterRows = $derived.by((): StatRow[] => {
    const rows: StatRow[] = [{ label: t.probe, value: device.probeName ?? ov.info.unknownValue }];
    if (device.deviceUid) rows.push({ label: t.deviceUid, value: device.deviceUid });
    rows.push({
      label: ov.info.readProtection,
      value:
        device.info == null
          ? ov.info.unknownValue
          : device.info.locked
            ? ov.info.lockLocked
            : ov.info.lockUnlocked,
    });
    return rows;
  });

  // --- this app ----------------------------------------------------------------------------
  let cacheBytes = $state<number | null>(null);
  $effect(() => {
    blobCache()
      .usage()
      .then((u) => {
        cacheBytes = u.total;
      })
      .catch(() => {});
  });
  const appRows = $derived.by((): StatRow[] => {
    const rows: StatRow[] = [
      {
        label: t.sources,
        value: t.sourcesCount(sources.rows.length, sources.rows.filter((r: SourceRow) => r.active).length),
      },
    ];
    if (cacheBytes != null) rows.push({ label: t.browserCache, value: formatSize(cacheBytes) });
    // `APP_VERSION` is null only where Vite did not build the bundle (a node suite, a bare
    // svelte-check). The unknown value is the same fallback the probe row above uses rather
    // than a second spelling of "we do not know".
    rows.push({ label: t.appVersion, value: APP_VERSION ?? ov.info.unknownValue });
    return rows;
  });

  // --- boot modal (moved verbatim; startBank needs the SWD transport, not the stub) ---------
  let bootModalOpen = $state(false);
  let bootBank = $state<1 | 2>(1);
  let bootTargetName = $state("");
  let bootTargetAddr = $state("");
  let hoveredBank = $state<1 | 2 | null>(null);

  function handleDblClickInt(s: GeoSegment) {
    if (s.bank) {
      bootBank = s.bank;
      bootTargetName = s.label || ov.bootModal.bankFallbackLabel(s.bank);
      bootTargetAddr = s.detail[1]?.split("·")[0]?.trim() || (s.bank === 1 ? "0x08000000" : "0x08100000");
      bootModalOpen = true;
    }
  }

  function getBankButtonLabel(bank: IntflashBank) {
    if (bank.ofw) {
      return ov.bankButton.startFirmware(bank.ofw.model === "mario" ? "Mario" : "Zelda");
    }
    if (bank.retroGoVersion || bank.type.includes("Retro-Go")) {
      return ov.bankButton.startRetroGo;
    }
    return ov.bankButton.startType(bank.type);
  }

  async function runBoot() {
    if (!device.transport) throw new Error("Not connected.");
    const flasher = device.flasher ?? attachFlasher(device.transport);
    await flasher.startBank(bootBank);
  }

  /**
   * `Copy details` (Details.dc.html's footer, beside Rescan). The pane exists so someone can
   * read the working; this hands the same working to whoever is helping them. Built from the
   * rows this pane actually rendered rather than re-derived, so the text and the screen cannot
   * disagree. English labels are NOT used: a bug report is read by whoever receives it, so the
   * user's own locale is what they can check against their screen.
   */
  function copyDetails(): void {
    const lines: string[] = [];
    const section = (heading: string, rows: StatRow[]) => {
      if (!rows.length) return;
      lines.push(heading);
      for (const r of rows) lines.push(`  ${r.label}: ${r.value}`);
      lines.push("");
    };
    lines.push(ov.banks.heading);
    for (const b of device.banks) lines.push(`  ${ov.status.bank(b.index)}: ${b.type}`);
    lines.push("");
    if (device.partitions.length) {
      lines.push(t.externalFlash);
      lines.push(`  ${ov.extFlash.freeOfTotal(formatSize(extBytes))}: ${formatSize(extFreeBytes)}`);
      for (const e of extLegend) lines.push(`  ${e.label}: ${formatSize(e.bytes)}`);
      for (const r of extRows) lines.push(`  ${r.label}: ${r.value}`);
      lines.push("");
    }
    section(t.adapter, adapterRows);
    section(t.thisApp, appRows);
    void navigator.clipboard?.writeText(lines.join("\n").trimEnd());
  }

  let extScanErr = $state<string | null>(null);
  async function enterRecoveryToScan() {
    extScanErr = null;
    try {
      await device.ensureStub();
      await device.runScan("details pane");
    } catch (e) {
      if (e instanceof Error && e.message.includes("cancelled")) return;
      extScanErr = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="details">
  <section class="sect">
    <h4 class="seclabel">{ov.banks.heading}</h4>
    <div class="banks">
      {#if device.banks.length}
        {#each BANKS as n (n)}
          <BankCard
            bankNum={n}
            segs={n === 1 ? bank1Segs : bank2Segs}
            {hoveredBank}
            onSegmentDblClick={handleDblClickInt}
            footer={(n === 1 ? bank1Bootable || bank1Prompt : bank2Bootable || bank2Prompt)
              ? (n === 1 ? bank1Footer : bank2Footer)
              : undefined}
          />
        {/each}
      {/if}
    </div>
  </section>

  <section class="sect">
    <h4 class="seclabel">{t.externalFlash}</h4>
    {#if device.partitions.length}
      <div class="ext-card">
        <div class="ext-capacity">
          <span class="ext-free">{formatSize(extFreeBytes)}</span>
          <span class="ext-of">{ov.extFlash.freeOfTotal(formatSize(extBytes))}</span>
        </div>
        <div bind:this={extBarEl}>
          <GeometryBar size="slim" segments={extSegs} />
        </div>
        {#if extLegend.length}
          <div class="ext-legend">
            {#each extLegend as e (e.label)}
              <div class="legend-item">
                <span class="legend-dot" style="background: {e.color}"></span>
                <span class="legend-label">{e.label}</span>
                <span class="legend-value mono">{formatSize(e.bytes)}</span>
              </div>
            {/each}
          </div>
        {/if}
        {#if extRows.length}
          <StatPanel rows={extRows} variant="panel-footer" />
        {/if}
      </div>
    {:else if device.scanning}
      <p class="placeholder">{ov.extFlash.scanningPleaseWait}</p>
    {:else}
      <div class="scanblock">
        <Button variant="action" onclick={enterRecoveryToScan}>
          {device.utilLoaded ? ov.extFlash.scan : ov.extFlash.enterRecoveryToScan}
        </Button>
        {#if extScanErr}<p class="err">{extScanErr}</p>{/if}
      </div>
    {/if}
  </section>

  <section class="sect">
    <h4 class="seclabel">{t.adapter}</h4>
    <StatPanel rows={adapterRows} variant="card" />
  </section>

  <section class="sect">
    <h4 class="seclabel">{t.thisApp}</h4>
    <StatPanel rows={appRows} variant="card" />
  </section>
</div>

{#snippet bankFooterBody(index: 1 | 2, addr: string, prompt: BankPrompt | null)}
  {#each device.banks.filter((b) => b.index === index) as bank (bank.index)}
    {#if bank.type !== "empty" && bank.type !== "unknown" && bank.type !== "unreadable"}
      <button
        class="bank-action"
        onclick={() => {
          bootBank = bank.index;
          bootTargetName = bank.type;
          bootTargetAddr = addr;
          bootModalOpen = true;
        }}
        onmouseenter={() => (hoveredBank = bank.index)}
        onmouseleave={() => (hoveredBank = null)}
      >
        <span>{getBankButtonLabel(bank)}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M7 4l6 6-6 6" />
        </svg>
      </button>
    {/if}
  {/each}
  {#if prompt}
    <!-- The subordinate/grey treatment is BothEmpty.dc.html's — the ONE artboard whose bank
         action is muted rather than the accent green, and the one case where the prompt is the
         guided-setup offer. -->
    <button class="bank-action" class:subtle={prompt.mode === "wizard"} onclick={() => goPrompt(prompt)}>
      <span>{prompt.label}</span>
      <svg
        width="13"
        height="13"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M7 4l6 6-6 6" />
      </svg>
    </button>
  {/if}
{/snippet}

{#snippet bank1Footer()}
  {@render bankFooterBody(1, "0x08000000", bank1Prompt)}
{/snippet}

{#snippet bank2Footer()}
  {@render bankFooterBody(2, "0x08100000", bank2Prompt)}
{/snippet}

<!-- Details.dc.html's footer: Copy details beside Rescan. `Rescan` is overview.status.rescan,
     the same string and the same operation the Status pane's footer runs. -->
<PaneFooter>
  <button class="footlink" type="button" onclick={copyDetails}>{t.copyDetails}</button>
  <Button variant="action" disabled={!device.isConnected} onclick={() => void device.runScan("details rescan button")}>
    {ov.status.rescan}
  </Button>
</PaneFooter>

<ConfirmModal
  open={bootModalOpen}
  title={ov.bootModal.title}
  body={ov.bootModal.body(bootTargetName, bootTargetAddr)}
  confirmText={ov.bootModal.confirm}
  onClose={() => (bootModalOpen = false)}
  run={runBoot}
/>

<style>
  /* The pane's own column. `OverviewRail`'s `.panebody` supplies the padding and the cap, so
     this only sets the rhythm between sections — the same 32px the Firmware panes use. */
  .details {
    display: flex;
    flex-direction: column;
    gap: 32px;
    min-width: 0;
  }
  .sect {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .seclabel {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .banks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    min-width: 0;
  }
  .ext-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-panel);
    background: var(--surface);
    padding: 16px;
    min-width: 0;
  }
  /* Free space leads, with the total as a muted clause beside it. The figures are runtime
     data; only "free of" is copy. */
  .ext-capacity {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ext-free {
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  .ext-of {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .ext-legend {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-caption);
  }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  .legend-label {
    color: var(--ink-soft);
  }
  .legend-value {
    margin-inline-start: auto;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .placeholder {
    margin: 0;
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }
  .scanblock {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-caption);
  }
  .footlink {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink-soft);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .bank-action.subtle {
    color: var(--ink-soft);
  }
  .bank-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--zelda-green);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
</style>
