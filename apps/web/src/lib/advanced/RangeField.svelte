<script lang="ts">
  // The flash-range field the design specifies: one number input with an attached
  // unit picker (hex / KB / MB). It replaces the quick-fill chips
  // (docs/design/mockups/README.md: "Start + size with a unit picker (hex / KB / MB)
  // replaces the quick-fill buttons").
  //
  // Byte-exactness: the component NEVER changes what value reaches the engine. It owns
  // display state (`text` + `unit`) and writes the canonical byte string back into the
  // caller's existing string, which the caller still runs through `parseAddr()` exactly
  // as before. hex → the literal text; KB/MB → a plain decimal byte count. Unit switches
  // convert through the parsed byte count, and the /1024 and /(1024*1024) round trips are
  // exact in IEEE-754 for every value below 2^53, so switching units cannot move a byte.
  import { parseAddr, hex } from "./addr.js";
  import { locale } from "../i18n/locale.svelte.js";

  type Unit = "hex" | "kb" | "mb";

  let {
    label,
    value = $bindable(""),
    disabled = false,
    placeholder = "",
  }: {
    label: string;
    value: string;
    disabled?: boolean;
    placeholder?: string;
  } = $props();

  const SCALE: Record<Unit, number> = { hex: 1, kb: 1024, mb: 1024 * 1024 };

  let text = $state("");
  let unit = $state<Unit>("hex");
  // Last string this component wrote into `value`; anything else is an external write
  // (a partition-bar click) and re-seeds the display.
  let emitted = $state<string | null>(null);

  function compose(t: string, u: Unit): string {
    const s = t.trim();
    if (s === "" || u === "hex") return s;
    const n = Number(s);
    if (!Number.isFinite(n)) return s; // let parseAddr reject it, as before
    return String(Math.round(n * SCALE[u]));
  }

  $effect(() => {
    const v = value;
    if (v === emitted) return;
    const n = parseAddr(v);
    if (v.trim() === "" || !Number.isFinite(n)) {
      unit = "hex";
      text = v;
    } else {
      unit = "hex";
      text = hex(n);
    }
    emitted = v;
  });

  function onInput(e: Event) {
    text = (e.currentTarget as HTMLInputElement).value;
    emitted = compose(text, unit);
    value = emitted;
  }

  function onUnit(e: Event) {
    const next = (e.currentTarget as HTMLSelectElement).value as Unit;
    const n = parseAddr(compose(text, unit));
    unit = next;
    if (Number.isFinite(n)) text = next === "hex" ? hex(n) : String(n / SCALE[next]);
    emitted = compose(text, unit);
    value = emitted;
  }
</script>

<label class="field">
  <span>{label}</span>
  <span class="control" class:disabled>
    <input class="mono" value={text} {disabled} {placeholder} oninput={onInput} />
    <select aria-label={locale.t.advanced.unitLabel} value={unit} {disabled} onchange={onUnit}>
      <option value="hex">hex</option>
      <option value="kb">KB</option>
      <option value="mb">MB</option>
    </select>
  </span>
</label>

<style>
  /* Write.dc.html:85 / Dump.dc.html:84-85 — the field label is `13px/500/#5c5c5c`
     and sits 8px above its control. */
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--fs-caption);
    min-width: 0;
  }
  .field > span:first-child {
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  /* Write.dc.html:85 / Dump.dc.html:84-85 — the range field is a 40px bordered control. */
  .control {
    display: flex;
    align-items: stretch;
    min-height: 40px;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    min-width: 0;
  }
  .control:focus-within {
    outline: 2px solid var(--zelda-green);
    outline-offset: 1px;
  }
  .control.disabled {
    opacity: 0.5;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 0 12px;
    border: none;
    background: transparent;
    color: var(--ink);
  }
  /* Dump.dc.html:84-85 / Write.dc.html:85 — the unit segment draws its OWN chevron
     (`M5 8l5 5 5-5`, 11px, 1.8 stroke, --ink-soft) 7px after the unit word, so the native
     UA arrow is suppressed and replaced rather than left to vary by platform. */
  /* The popup this control opens is painted by the UA, and the UA takes its ground from the
     select's own computed background. `transparent` here made dark theme composite the list on
     Chromium's light popup ground while the options kept the author `color` (--ink-soft) — the
     same defect the header language picker had (DeviceHeader.svelte:454). --surface is what
     `.control` around it already paints, so the closed control is pixel-identical in both
     themes; only the popup changes, and it now follows the theme. */
  select {
    font: inherit;
    font-weight: 600;
    color: var(--ink-soft);
    background: var(--surface);
    border: none;
    border-inline-start: 1px solid var(--hairline);
    padding: 0 10px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 20 20' fill='none' stroke='%235c5c5c' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-inline-end: 28px;
  }
  option {
    background: var(--surface);
    color: var(--ink);
  }
  input:focus,
  select:focus {
    outline: none;
  }
  /* Dark theme: the chevron is a baked-in data URI, so its stroke is restated at the dark
     --ink-soft (#9b9b9b, tokens.css:193/231) rather than inherited. */
  :global(:root[data-theme="dark"]) select {
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 20 20' fill='none' stroke='%239b9b9b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E");
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) select {
      background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 20 20' fill='none' stroke='%239b9b9b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E");
    }
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
