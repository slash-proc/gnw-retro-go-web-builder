<script lang="ts">
  /**
   * The small icon-only refresh control.
   *
   * Modelled on `advanced/RomSection.svelte`'s version refresh, which is the treatment the
   * owner pointed at by name when he asked for one in the Library.
   *
   * IT DOES NOT YET REPLACE THAT ONE, deliberately. There are three sites, not two: RomSection,
   * `views/Wizard.svelte`'s guided Install step, and now this. `test/versionrefresh.mjs` states
   * that the first two are "the deliberate shape (a snippet each, not a shared component)" and
   * asserts each separately, precisely so a fix landing on one and not the other is caught.
   * Converting two of the three would leave the codebase in a mixed idiom and weaken that guard
   * for the one left behind, so unification is a follow-up that must take all three at once and
   * carry the guard with it. This component is the sink that change should pour into.
   *
   * It owns the two pieces of state that are the same wherever this control appears: whether a
   * fetch is in flight (the spin) and the lockout after one (the grey-out). What it does NOT
   * own is the work: the caller passes an async `onRefresh`, so the version picker keeps its
   * "a refresh must not move a choice the user made" rule and the Library keeps its rescan.
   *
   * The 10 s lockout is the whole rate limit, by the owner's instruction on the original: the
   * control greys out on press and comes back. No queueing, no retry, no spinner state
   * machine. `busy` is separate from the lockout because only the former spins -- a control
   * that keeps spinning after its work is done is lying about what it is waiting for.
   *
   * Icon only: the row it sits in already says what it is about, and a second word here would
   * be the narration docs/UI_VOICE.md rules out. The accessible name says what the control
   * DOES.
   */
  const COOLDOWN_MS = 10000;

  let {
    onRefresh,
    label,
    disabled = false,
  }: {
    /** The work. Awaited, so the spin lasts exactly as long as it does. */
    onRefresh: () => Promise<void>;
    /** Title and accessible name. Says what the control does. */
    label: string;
    /** Held down by the caller for a reason of its own (no device, nothing to scan). */
    disabled?: boolean;
  } = $props();

  let busy = $state(false);
  let cooling = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  async function run(): Promise<void> {
    if (busy || cooling) return;
    busy = true;
    cooling = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (cooling = false), COOLDOWN_MS);
    try {
      await onRefresh();
    } finally {
      busy = false;
    }
  }

  $effect(() => () => {
    if (timer) clearTimeout(timer);
  });
</script>

<button
  type="button"
  class="refresh"
  onclick={() => void run()}
  disabled={disabled || busy || cooling}
  title={label}
  aria-label={label}
>
  <svg viewBox="0 0 16 16" aria-hidden="true" class:spin={busy}>
    <path
      d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <path
      d="M13.6 2.4v3.2h-3.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</button>

<style>
  .refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    flex: none;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .refresh:hover:not(:disabled) {
    color: var(--ink);
  }
  .refresh:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .refresh svg {
    width: 15px;
    height: 15px;
  }
  /* Only while the work is in flight. The lockout is deliberately silent. */
  .refresh svg.spin {
    animation: refresh-spin 900ms linear infinite;
  }
  @keyframes refresh-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .refresh svg.spin {
      animation: none;
    }
  }
</style>
