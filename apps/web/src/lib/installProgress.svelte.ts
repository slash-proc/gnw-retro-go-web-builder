// Store-level state for the "install progress" modal (flash/SD sync operations). Deliberately
// mirrors device.stubPrompt / device.connectGatePrompt / library.folderGatePrompt: state lives at
// module-singleton scope, NOT as component-local $state, so no `{#if}`-driven unmount of the
// calling component (e.g. Advanced.svelte's connection gate) can ever destroy an in-flight
// operation's UI. See docs plan "Fix install-progress modal vanishing mid-flash".
//
// This module must NOT import device.svelte.ts (one-directional dependency: device.svelte.ts
// imports this file to log a line on handleLost(), not the other way around — avoids a cycle).

import { FlashVerifyError, type FlashBlockRef } from "@gnw/gnw-flasher";
import { download, timestamp } from "./util.js";
import { lipProgress } from "./lipProgress.svelte.js";
import { literal, msg, renderLog, toEntry, type LogEntry, type LogLine } from "./logEntry.js";
import { locale } from "./i18n/locale.svelte.js";
import { en, type Strings } from "./i18n/en.js";
import { loadSel, saveSel } from "./persist.js";
import { dbg } from "./debug.js";

const LOG_OPEN_KEY = "install-log-open";

export type PhaseId = string;
export type SubstepId = string;
export type SubstepDef = { id: SubstepId; label: string };
/** A phase may pre-declare its fixed, named sub-steps up front (same idea as `phases: PhaseDef[]`
 *  being declared up front by each call site before `run()` starts) so the whole nested checklist
 *  renders immediately in "pending" state, then fills in live as the operation progresses. Only
 *  declare `substeps` where a phase has real, distinguishable internal work — an atomic phase
 *  should omit it. */
export type PhaseDef = { id: PhaseId; label: string; substeps?: SubstepDef[] };
export type PhaseStatus = "pending" | "active" | "done" | "error";
export type SubstepStatus = "pending" | "active" | "done" | "error";
/** `unit: "bytes"` renders the counter as a byte fraction (`[1.6/3.4 MB]`); the default
 *  renders it as an item fraction (`[137/137]`). Both forms come from the approved artboard
 *  docs/design/mockups/GuidedFlashing.dc.html. */
export type SubstepProgress = { value: number; max: number; unit?: "bytes" };
export type PhaseState = {
  status: PhaseStatus;
  substeps: SubstepDef[];
  substepStatus: Record<SubstepId, SubstepStatus>;
  /** Per-substep counters (e.g. "63/63 files") — keyed independently from the phase's own
   *  `progress` below. May be pre-seeded (e.g. `[0, total]`) before a sub-step goes active, so
   *  the checklist can show a known total ahead of time (owner's mockup: "Remove de-selected
   *  games [0/2]" shown while still pending). */
  substepProgress: Record<SubstepId, SubstepProgress>;
  progress?: SubstepProgress;
};

/** The store's own handle on the reporter: identical, minus the `readonly` on `signal`, which
 *  exists to stop a CALLER swapping the signal out from under a running operation. */
type MutableReporter = Omit<PhaseReporter, "signal"> & { signal: AbortSignal };

export interface PhaseReporter {
  /** Aborts when the user stops the run from the progress modal.
   *
   *  THE ONLY WAY A CANCEL REACHES THE DEVICE. `exec()` must forward this into every call that
   *  writes or waits -- `flashInstallToDevice`, `flashFrogfsRegion`, `writeFilesToDeviceLfs`,
   *  `patchAndFlash`, `restoreStock` all take an `abortSignal` for exactly this. A call that
   *  drops it cannot be stopped, and the footer's Cancel would then be a lie on that path.
   *
   *  It is a property rather than a `run()` argument so that an `exec` closure written before
   *  cancelling existed keeps compiling, and so the signal travels with the same object the
   *  call site already threads through its helpers. */
  readonly signal: AbortSignal;
  /** Flip a phase to "active". */
  start(id: PhaseId): void;
  /** Flip a phase to "done". */
  finish(id: PhaseId): void;
  /** Flip a phase's named sub-step to "active". */
  subStart(id: PhaseId, substepId: SubstepId): void;
  /** Flip a phase's named sub-step to "done". */
  subFinish(id: PhaseId, substepId: SubstepId): void;
  /** Flip a phase's named sub-step to "error". */
  subError(id: PhaseId, substepId: SubstepId): void;
  /** Append a tagged line to the single shared audit log — `[Phase]` or `[Phase — Substep]`.
   *  `line` is either a keyed entry (`msg((t) => t.area.key, …params)`, rendered at DISPLAY
   *  time so the same entry can be shown translated and copied as English) or a plain runtime
   *  string — a path, filename or device-derived line — which is stored verbatim. */
  log(id: PhaseId, line: string | LogEntry, substepId?: SubstepId): void;
  /** Report progress for a phase (or a phase's sub-step, if `substepId` given). `unit` picks
   *  the counter's rendering — byte fraction vs item fraction. */
  progress(id: PhaseId, done: number, total: number, substepId?: SubstepId, unit?: "bytes"): void;
}

/** `cancelled` is terminal like `done`/`error`, and is none of the three: the operation neither
 *  finished nor failed, the user stopped it. It is its own phase because what the modal must say
 *  differs -- a stop leaves bytes written, which a failure message would not convey and a success
 *  message would deny. */
export type ModalPhase = "confirm" | "running" | "done" | "error" | "cancelled";

/** An optional checkbox shown in the confirm step (e.g. "Migrate Games"). Read live values via
 *  `installProgress.checkboxValues[id]` from inside `exec` — checkboxes are rendered inside the
 *  confirm step itself, not by the calling component, so `exec`'s closure can't read local
 *  component state for these; it must read the store's `checkboxValues`. */
export type CheckboxDef = { id: string; label: string; default?: boolean };

/** An optional gate on the confirm step's primary action — e.g. "you must pick an SD card
 *  folder before you can Install". While `ready()` is false, the modal renders THIS button
 *  (label + onClick) INSTEAD of the normal confirm button; once `ready()` becomes true
 *  (reactively — it's called directly from the template, so any $state it reads is tracked),
 *  the normal confirm button takes over. `onClick` should be a fire-and-forget action (e.g.
 *  opening a folder picker) that eventually makes `ready()` true — it does not itself resolve
 *  the confirm step. */
export type ConfirmGate = { label: string; ready: () => boolean; onClick: () => void | Promise<void> };

/** One option in the confirm step's version picker. `value` is the release's `tag`. */
export type VersionOption = { value: string; label: string };

/**
 * An optional version picker on the confirm step — "which release am I about to install", asked
 * where the user is already deciding what carries over.
 *
 * CALLBACKS, NOT VALUES, for the same reason `ConfirmGate.ready` is a function: `prompt` is
 * plain data written once by `run()`, so a snapshot taken there would freeze at whatever the
 * caller happened to hold at that instant. These are called directly from the template, so any
 * `$state` they read is tracked and a refetched list or a changed selection re-renders.
 *
 * The selected value is NOT mirrored into this store, unlike `checkboxValues`. Checkboxes need
 * that because nothing outside the modal owns them; a version picker's caller already holds the
 * list and the choice as its own state, and `exec`'s closure reads them directly. A second
 * home for the same value would be one more thing to keep in step.
 */
export type VersionPicker = {
  /** Names the control. */
  label: string;
  /** Newest first, as the index publishes them. */
  options: () => VersionOption[];
  /** The `value` currently chosen. */
  selected: () => string;
  onSelect: (value: string) => void;
  /** Refetches the index. Awaited, so the control spins for exactly as long as it runs. */
  onRefresh: () => Promise<void>;
  /** Title and accessible name for the refresh beside the picker. */
  refreshLabel: string;
};

interface PromptConfig {
  title: string;
  body: string;
  /** A plain label, or a function when it depends on live state — a confirm button beside a
   *  `VersionPicker` reads Upgrade, Reinstall or Downgrade depending on what is selected, and a
   *  string captured at `run()` would freeze at whichever face happened to be showing then. */
  confirmText: string | (() => string);
  danger: boolean;
  phases: PhaseDef[];
  checkboxes: CheckboxDef[];
  confirmGate: ConfirmGate | null;
  versionPicker: VersionPicker | null;
  exec: (r: PhaseReporter) => Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
}

class InstallProgressStore {
  // The confirm-step's static config, set by run(); null = no operation in flight/prompted.
  prompt = $state<PromptConfig | null>(null);

  // Live state once running — survives regardless of which component (if any) is mounted.
  modalPhase = $state<ModalPhase>("confirm");
  phaseState = $state<Record<PhaseId, PhaseState>>({});
  error = $state<string | null>(null);
  /** Set only when the thrown error was a `FlashVerifyError` — the device programmed a block,
   *  read it back, and its own hash did not match, three times over. The blocks are what
   *  docs/design/mockups/FlashFailure.dc.html's "Blocks that failed" table draws; `attempts`
   *  is the per-block budget the flasher spent (retries = attempts - 1). Null for every other
   *  failure, where the modal falls back to the raw message. */
  errorBlocks = $state<FlashBlockRef[] | null>(null);
  errorAttempts = $state<number>(0);
  /** Live checkbox values for the current confirm-step's `checkboxes`, keyed by id. */
  checkboxValues = $state<Record<string, boolean>>({});
  /** Single shared, tagged, always-visible audit trail for the WHOLE operation — replaces the
   *  old per-phase `lines`/`expanded` log-box concept. */
  auditLog = $state<LogLine[]>([]);

  /** Whether the shared audit log is expanded. Sticky across separate operations (unlike the
   *  rest of this store's state, which `run()` resets each time) — persisted via persist.ts,
   *  same pattern as device.svelte.ts's "target-media" / OverviewTab's "skip-screenshot-confirm".
   *  Defaults closed. */
  logOpen = $state<boolean>(loadSel(LOG_OPEN_KEY, false));

  toggleLog(): void {
    this.logOpen = !this.logOpen;
    saveSel(LOG_OPEN_KEY, this.logOpen);
  }

  /** Open while the user is being asked to confirm a stop. Separate from `modalPhase`, because
   *  the run is still running underneath it -- the question is a second dialog over a live
   *  operation, not a state of that operation. */
  cancelPrompt = $state<boolean>(false);
  /** True from the moment the user confirms the stop until the run actually unwinds. The stop
   *  lands on the next 256 KiB block boundary, so there is a real interval here, and leaving the
   *  footer looking untouched through it is what makes a UI feel ignored. */
  cancelling = $state<boolean>(false);

  /** Aborted by `confirmCancel()`; handed to `exec` as `reporter.signal`. Recreated per run, so
   *  a stopped run can never leave the next one pre-aborted. */
  private controller: AbortController | null = null;

  private activePhaseId: PhaseId | null = null;
  private activeSubstepId: SubstepId | null = null;

  /** Called by RomSection/Wizard/RomManagementTab instead of rendering <InstallProgressModal>
   *  locally. Returns once the user closes the modal (after done/error/cancelled) or cancels at
   *  the confirm step.
   *
   *  A RUNNING operation IS stoppable: `requestCancel` / `confirmCancel` below abort the
   *  per-run controller, `exec` receives it as `reporter.signal`, and GnwFlasher.flash() checks
   *  it at every 256 KiB chunk boundary, so a stop lands on a block boundary and never
   *  mid-erase. Drawn by docs/design/mockups/FlashingCancel.dc.html and
   *  FlashingCancelConfirm.dc.html; covered by apps/web/test/flashcancel.mjs, which asserts at
   *  the writer rather than at the flag. */
  run(opts: {
    title: string;
    body?: string;
    confirmText?: string | (() => string);
    danger?: boolean;
    phases: PhaseDef[];
    checkboxes?: CheckboxDef[];
    confirmGate?: ConfirmGate;
    versionPicker?: VersionPicker;
    exec: (r: PhaseReporter) => Promise<void>;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.modalPhase = "confirm";
      this.phaseState = Object.fromEntries(
        opts.phases.map((p) => [
          p.id,
          {
            status: "pending",
            substeps: p.substeps ?? [],
            substepStatus: Object.fromEntries((p.substeps ?? []).map((s) => [s.id, "pending" as SubstepStatus])),
            substepProgress: {},
          } as PhaseState,
        ]),
      );
      this.error = null;
      this.errorBlocks = null;
      this.errorAttempts = 0;
      this.auditLog = [];
      this.cancelPrompt = false;
      this.cancelling = false;
      this.controller = null;
      this.activePhaseId = null;
      this.activeSubstepId = null;
      const checkboxes = opts.checkboxes ?? [];
      this.checkboxValues = Object.fromEntries(checkboxes.map((c) => [c.id, c.default ?? false]));
      this.prompt = {
        title: opts.title,
        body: opts.body ?? "",
        confirmText: opts.confirmText ?? "Confirm",
        danger: opts.danger ?? false,
        phases: opts.phases,
        checkboxes,
        confirmGate: opts.confirmGate ?? null,
        versionPicker: opts.versionPicker ?? null,
        exec: opts.exec,
        resolve,
        reject,
      };
    });
  }

  setCheckbox(id: string, value: boolean): void {
    this.checkboxValues = { ...this.checkboxValues, [id]: value };
  }

  private ensure(id: PhaseId): PhaseState {
    let s = this.phaseState[id];
    if (!s) {
      s = { status: "pending", substeps: [], substepStatus: {}, substepProgress: {} };
      this.phaseState[id] = s;
    }
    return s;
  }

  private phaseLabel(id: PhaseId): string {
    return this.prompt?.phases.find((p) => p.id === id)?.label ?? id;
  }

  private substepLabel(id: PhaseId, substepId: SubstepId): string {
    return this.phaseState[id]?.substeps.find((s) => s.id === substepId)?.label ?? substepId;
  }

  /** The reporter object passed into an in-flight exec(). Also usable externally (e.g.
   *  device.svelte.ts's handleLost()) to log a line into whichever phase is currently active. */
  readonly reporter: MutableReporter = {
    // ASSIGNED PER RUN by confirm(), not captured once: `reporter` is one long-lived object on
    // the store while the controller is per-run, so a signal captured here would be the FIRST
    // run's forever and every later cancel would abort nothing. The initial value is a
    // controller nobody holds, so a reporter used outside a run (device.svelte.ts's
    // handleLost() logs through this same object) reads a signal that simply never aborts.
    signal: new AbortController().signal,
    start: (id) => {
      this.activePhaseId = id;
      this.activeSubstepId = null;
      const s = this.ensure(id);
      s.status = "active";
      this.phaseState = { ...this.phaseState };
    },
    finish: (id) => {
      const s = this.ensure(id);
      s.status = "done";
      // Any sub-step still pending/active when the phase finishes is swept to "done" — a phase
      // reporting "finish" implies all of its declared sub-work completed.
      for (const k of Object.keys(s.substepStatus)) {
        if (s.substepStatus[k] !== "error") s.substepStatus[k] = "done";
      }
      this.phaseState = { ...this.phaseState };
    },
    subStart: (id, substepId) => {
      this.activePhaseId = id;
      this.activeSubstepId = substepId;
      const s = this.ensure(id);
      s.substepStatus = { ...s.substepStatus, [substepId]: "active" };
      this.phaseState = { ...this.phaseState };
    },
    subFinish: (id, substepId) => {
      const s = this.ensure(id);
      s.substepStatus = { ...s.substepStatus, [substepId]: "done" };
      this.phaseState = { ...this.phaseState };
    },
    subError: (id, substepId) => {
      const s = this.ensure(id);
      s.substepStatus = { ...s.substepStatus, [substepId]: "error" };
      this.phaseState = { ...this.phaseState };
    },
    log: (id, line, substepId) => {
      const tag = substepId ? `${this.phaseLabel(id)} — ${this.substepLabel(id, substepId)}` : this.phaseLabel(id);
      // Timestamp and tag are captured NOW (both are locale-independent runtime facts); only the
      // message body stays unrendered until display.
      this.auditLog = [...this.auditLog, { time: timestamp(), tag, entry: toEntry(line) }];
    },
    progress: (id, done, total, substepId, unit) => {
      const s = this.ensure(id);
      if (substepId) {
        s.substepProgress = { ...s.substepProgress, [substepId]: { value: done, max: total, unit } };
      } else {
        s.progress = { value: done, max: total, unit };
      }
      this.phaseState = { ...this.phaseState };
      // The lip draws the OPERATION, not its individual transfers. A flash writes in 256 KiB
      // context loads, so the per-transfer observer swept the lip once per load; a scan issues
      // ~1400 reads and swept it ~1400 times. One thing the user asked for, one sweep.
      if (total > 0) lipProgress.operationProgress("install", Math.min(1, Math.max(0, done / total)));
    },
  };

  /** Log a line into whichever phase/sub-step is currently active — used by device.svelte.ts's
   *  handleLost() to surface an expected mid-operation USB blip inside the modal instead of
   *  silently. No-op if nothing is running or no phase is active. */
  logActive(line: string | LogEntry): void {
    if (this.modalPhase !== "running" || !this.activePhaseId) return;
    this.reporter.log(this.activePhaseId, line, this.activeSubstepId ?? undefined);
  }

  /** Ask before stopping. Drawn by docs/design/mockups/FlashingCancelConfirm.dc.html.
   *  Never aborts by itself -- that is the whole point of the pair. */
  requestCancel(): void {
    if (this.modalPhase !== "running" || this.cancelling) return;
    this.cancelPrompt = true;
  }

  /** Close the question, leaving the run alone. `Keep writing` on the board. */
  dismissCancel(): void {
    this.cancelPrompt = false;
  }

  /** Stop the run. `Stop` on the board.
   *
   *  The abort lands where the flasher next checks it -- the top of a 256 KiB chunk -- so this
   *  returns long before the operation unwinds, and `cancelling` is what the footer reads in
   *  the meantime. Nothing is rolled back: bytes already written stay written, which is what
   *  the confirmation says. */
  confirmCancel(): void {
    if (this.modalPhase !== "running") return;
    this.cancelPrompt = false;
    this.cancelling = true;
    this.controller?.abort();
    // Keyed, not literal: this is UI copy, and the log is read on screen in the user's language
    // and copied in English. `logActive` no-ops safely when no phase has started yet.
    this.logActive(msg((t) => t.shared.installProgressModal.logStopping));
  }

  async confirm(): Promise<void> {
    const p = this.prompt;
    if (!p) return;
    this.modalPhase = "running";
    // Per run, and handed to exec through the reporter. Made HERE rather than in run() so that
    // a prompt sitting unconfirmed on screen holds no controller at all.
    this.controller = new AbortController();
    this.reporter.signal = this.controller.signal;
    // Every long-running device operation in the app funnels through run()/confirm(), so this
    // single hold covers flash installs, SD sync, erase, OFW patch/flash, dumps and the
    // halt-based screenshot without any view needing to know about the warning. Released in
    // `finally` — the warning then drops to "settling", NOT to "safe".
    deviceSafety.hold();
    try {
      await p.exec(this.reporter);
      this.modalPhase = "done";
    } catch (e) {
      // A STOP IS NOT A FAILURE. The throw that unwinds an aborted run is an ordinary Error
      // ("Operation aborted") raised at whichever abort check saw the flag first, so the signal
      // itself is what identifies it -- matching on the message would break the moment one of
      // the several places that raise it words it differently.
      if (this.controller?.signal.aborted) {
        // Untagged, like the error line below it: it belongs to the run, not to a phase.
        this.auditLog = [
          ...this.auditLog,
          { time: timestamp(), tag: null, entry: msg((t) => t.shared.installProgressModal.logStopped) },
        ];
        this.modalPhase = "cancelled";
        return;
      }
      // `text`, not `msg`: `msg` is this module's imported keyed-entry builder, and a local of
      // that name shadows it for the whole catch block.
      const text = e instanceof Error ? e.message : String(e);
      this.error = text;
      if (e instanceof FlashVerifyError) {
        this.errorBlocks = e.blocks;
        this.errorAttempts = e.attempts;
      }
      // The phase that was in-flight when the error was thrown flips to "error"; any sub-step
      // in-flight flips to "error" too; every phase after it stays "pending" (never started).
      if (this.activePhaseId) {
        const s = this.ensure(this.activePhaseId);
        s.status = "error";
        if (this.activeSubstepId) s.substepStatus = { ...s.substepStatus, [this.activeSubstepId]: "error" };
        this.phaseState = { ...this.phaseState };
      }
      // Untagged, and a literal: the message is an Error's own text, not a string-table key.
      this.auditLog = [...this.auditLog, { time: timestamp(), tag: null, entry: literal(`✗ ${text}`) }];
      this.modalPhase = "error";
    } finally {
      // A failed operation is if anything MORE likely to have left the device mid-write, so
      // the error path releases exactly like the success path — into "settling".
      deviceSafety.release();
      // And hand the lip back, on both paths, or it stays frozen at wherever the operation
      // stopped and every later transfer is ignored.
      lipProgress.operationProgress("install", null);
    }
  }

  /** The audit log rendered to plain text. Defaults to the ACTIVE locale (what the modal shows);
   *  pass `en` to get the same log in English for a bug report, without any second log call. */
  logText(t: Strings = locale.t): string[] {
    return renderLog(this.auditLog, t);
  }

  /** Save the shared audit log as a plain-text file. Drawn as the failure modal's quiet
   *  footer-left action in docs/design/mockups/FlashFailure.dc.html. Purely a local
   *  download of state the store already holds — it never touches the device. */
  saveLog(): void {
    this.downloadLog(this.logBody());
  }

  /** Put the audit log on the clipboard **in English**, whatever language the UI is running in,
   *  so a pasted bug report always reads the same. Drawn beside `Save log` in the failure
   *  footer of docs/design/mockups/FlashFailure.dc.html. The active locale is untouched — the
   *  English table is passed straight to `logText()`, and the on-screen log keeps rendering
   *  from `locale.t`.
   *
   *  The clipboard write can be REJECTED for reasons that are none of the user's doing: a
   *  non-secure context, a denied permission, a document that is not focused. That must not be
   *  silent and must not throw into the UI, and the artboard states no error copy — so rather
   *  than invent a message, the failure falls back to the OTHER way the same text already
   *  leaves the app: it downloads it (English, exactly what would have been copied). The user
   *  sees a file instead of a clipboard, and still has the log to attach. The rejection itself
   *  goes to the console for anyone debugging the app.
   *
   *  Returns which of the two happened, so a caller (and the test suite) can tell them apart. */
  async copyLog(): Promise<"copied" | "saved"> {
    const body = this.logBody(en);
    try {
      const clip = globalThis.navigator?.clipboard;
      if (!clip || typeof clip.writeText !== "function") throw new Error("clipboard API unavailable");
      await clip.writeText(body);
      return "copied";
    } catch (e) {
      dbg(`[log] the clipboard write was rejected, saving the log instead: ${e instanceof Error ? e.message : String(e)}`);
      this.downloadLog(body);
      return "saved";
    }
  }

  /** The log plus the trailing error line, as one blob of text. Defaults to the ACTIVE locale
   *  (what `Save log` writes); `copyLog()` passes the English table. */
  private logBody(t: Strings = locale.t): string {
    return this.logText(t).join("\n") + (this.error ? `\n${this.error}\n` : "\n");
  }

  private downloadLog(body: string): void {
    const name = `gnw-install-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    download(name, new Blob([body], { type: "text/plain" }));
  }

  cancel(): void {
    const p = this.prompt;
    if (!p) return;
    this.prompt = null;
    p.resolve();
  }

  close(): void {
    const p = this.prompt;
    this.prompt = null;
    if (p) p.resolve();
  }
}

export const installProgress = new InstallProgressStore();

// ---------------------------------------------------------------------------------------
// Disconnect safety
// ---------------------------------------------------------------------------------------

/** Three-state answer to "can the user pull the USB cable right now?".
 *
 *  - "writing"   — a device operation holds the link. Unplugging mid-erase/mid-program is the
 *                  real corruption case.
 *  - "settling"  — every write has RETURNED, but nothing has yet attested that the device is
 *                  back to answering on its own. The last chunk's program/erase/hash-verify is
 *                  driven by the on-device firmware and finishes on the device's clock, not
 *                  ours, and the flows leave the RAM stub running with a reset pending.
 *  - "safe"      — the device answered a liveness ping AFTER the last hold was released, with
 *                  no operation holding the link.
 *
 *  IMPORTANT: this deliberately does NOT clear when a progress modal closes. Modal lifetime is
 *  a UI fact; disconnect safety is a device fact. The only thing that clears "settling" is
 *  `markQuiet()`, called from device.svelte.ts's liveness poll (the one place in the app that
 *  actually talks to the target while idle), or `reset()` when there is no live link left to
 *  corrupt.
 *
 *  Honest limitation: the target firmware exposes no "I am quiesced and bootable" flag, and
 *  the host has no way to ask for one. A successful post-write ping is the strongest signal
 *  available — it proves the device survived and is responding, not that its flash image is
 *  semantically complete. Treat "safe" as "the write path is idle and the device is alive",
 *  which is the closest honest approximation of the real answer.
 *
 *  Lives here (not in device.svelte.ts) so it can be raised by anything long-running without
 *  a dependency on the device store, preserving this module's one-directional import rule. */
export type DisconnectSafety = "safe" | "writing" | "settling";

class DeviceSafetyStore {
  state = $state<DisconnectSafety>("safe");

  /** Reference-counted: nested holds (a flow that itself boots the RAM stub inside an
   *  already-held install) must not let the inner release drop the warning early. */
  private holds = 0;

  /** Injected by device.svelte.ts: true when there is no live link that could be corrupted
   *  (nothing connected). Without a link there is nothing to attest, so a released hold goes
   *  straight to "safe" instead of waiting forever for a ping that will never come — e.g. an
   *  SD-card sync run with no device attached. */
  private noLinkProbe: (() => boolean) | null = null;

  get unsafe(): boolean {
    return this.state !== "safe";
  }

  setNoLinkProbe(fn: () => boolean): void {
    this.noLinkProbe = fn;
  }

  /** Raise the warning for the duration of a device operation. Always pair with `release()`
   *  in a `finally`. */
  hold(): void {
    this.holds++;
    this.state = "writing";
  }

  release(): void {
    if (this.holds > 0) this.holds--;
    if (this.holds > 0) return;
    this.state = this.noLinkProbe?.() ? "safe" : "settling";
  }

  /** Called by the liveness poll when the target answered while the link was idle. Only
   *  meaningful for "settling" — it must never pull the warning down out from under a hold. */
  markQuiet(): void {
    if (this.holds === 0 && this.state === "settling") this.state = "safe";
  }

  /** The link is gone (deliberate disconnect, or a lost adapter): there is nothing left that
   *  our warning can protect, so stop nagging.
   *
   *  Deliberately a no-op while an operation still holds the link: a lost link DURING a flash
   *  is usually the expected brief USB re-enumeration of a stub-boot reset, and dropping the
   *  warning there would clear it at the single worst moment. That operation's own `release()`
   *  decides instead, once it actually returns. */
  linkGone(): void {
    if (this.holds > 0) return;
    this.state = "safe";
  }
}

export const deviceSafety = new DeviceSafetyStore();
