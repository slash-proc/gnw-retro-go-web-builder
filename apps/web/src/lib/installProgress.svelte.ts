// Store-level state for the "install progress" modal (flash/SD sync operations). Deliberately
// mirrors device.stubPrompt / device.connectGatePrompt / roms.folderGatePrompt: state lives at
// module-singleton scope, NOT as component-local $state, so no `{#if}`-driven unmount of the
// calling component (e.g. Advanced.svelte's connection gate) can ever destroy an in-flight
// operation's UI. See docs plan "Fix install-progress modal vanishing mid-flash".
//
// This module must NOT import device.svelte.ts (one-directional dependency: device.svelte.ts
// imports this file to log a line on handleLost(), not the other way around — avoids a cycle).

import { timestamp } from "./util.js";
import { loadSel, saveSel } from "./persist.js";

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
export type SubstepProgress = { value: number; max: number; label?: string };
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
  /** Whether the nested sub-step checklist is expanded. Every phase starts collapsed
   *  regardless of status; only an explicit user click (via `toggle()`) expands one, and
   *  `finish()` always forces it back closed (see owner's "tidy up as we move on" request). */
  expanded: boolean;
};

export interface PhaseReporter {
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
  /** Append a tagged line to the single shared audit log — `[Phase]` or `[Phase — Substep]`. */
  log(id: PhaseId, line: string, substepId?: SubstepId): void;
  /** Report a mini progress bar for a phase (or a phase's sub-step, if `substepId` given). */
  progress(id: PhaseId, done: number, total: number, label?: string, substepId?: SubstepId): void;
}

export type ModalPhase = "confirm" | "running" | "done" | "error";

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

interface PromptConfig {
  title: string;
  body: string;
  confirmText: string;
  danger: boolean;
  phases: PhaseDef[];
  checkboxes: CheckboxDef[];
  confirmGate: ConfirmGate | null;
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
  /** Live checkbox values for the current confirm-step's `checkboxes`, keyed by id. */
  checkboxValues = $state<Record<string, boolean>>({});
  /** Single shared, tagged, always-visible audit trail for the WHOLE operation — replaces the
   *  old per-phase `lines`/`expanded` log-box concept. */
  auditLog = $state<string[]>([]);

  /** Whether the shared audit log is expanded. Sticky across separate operations (unlike the
   *  rest of this store's state, which `run()` resets each time) — persisted via persist.ts,
   *  same pattern as device.svelte.ts's "target-media" / OverviewTab's "skip-screenshot-confirm".
   *  Defaults closed. */
  logOpen = $state<boolean>(loadSel(LOG_OPEN_KEY, false));

  toggleLog(): void {
    this.logOpen = !this.logOpen;
    saveSel(LOG_OPEN_KEY, this.logOpen);
  }

  private activePhaseId: PhaseId | null = null;
  private activeSubstepId: SubstepId | null = null;

  /** Called by RomSection/Wizard/RomManagementTab instead of rendering <InstallProgressModal>
   *  locally. Returns once the user closes the modal (after done/error) or cancels at the
   *  confirm step — the actual device operation itself is NOT cancellable once started (same
   *  as before), this promise is purely about the confirm/close UX. */
  run(opts: {
    title: string;
    body?: string;
    confirmText?: string;
    danger?: boolean;
    phases: PhaseDef[];
    checkboxes?: CheckboxDef[];
    confirmGate?: ConfirmGate;
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
            expanded: false,
          } as PhaseState,
        ]),
      );
      this.error = null;
      this.auditLog = [];
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
        exec: opts.exec,
        resolve,
        reject,
      };
    });
  }

  setCheckbox(id: string, value: boolean): void {
    this.checkboxValues = { ...this.checkboxValues, [id]: value };
  }

  /** Toggle a phase's sub-step checklist open/closed — only meaningful for phases with
   *  declared substeps; a click on an atomic phase (no substeps) is a no-op in the view. */
  toggle(phaseId: PhaseId): void {
    const s = this.ensure(phaseId);
    s.expanded = !s.expanded;
    this.phaseState = { ...this.phaseState };
  }

  private ensure(id: PhaseId): PhaseState {
    let s = this.phaseState[id];
    if (!s) {
      s = { status: "pending", substeps: [], substepStatus: {}, substepProgress: {}, expanded: false };
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
  readonly reporter: PhaseReporter = {
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
      // Auto-collapse on completion (owner: "collapse each step as we complete it and move on
      // to the next one") — regardless of whatever the user had toggled it to.
      s.expanded = false;
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
      this.auditLog = [...this.auditLog, `${timestamp()} [${tag}] ${line}`];
    },
    progress: (id, done, total, label, substepId) => {
      const s = this.ensure(id);
      if (substepId) {
        s.substepProgress = { ...s.substepProgress, [substepId]: { value: done, max: total, label } };
      } else {
        s.progress = { value: done, max: total, label };
      }
      this.phaseState = { ...this.phaseState };
    },
  };

  /** Log a line into whichever phase/sub-step is currently active — used by device.svelte.ts's
   *  handleLost() to surface an expected mid-operation USB blip inside the modal instead of
   *  silently. No-op if nothing is running or no phase is active. */
  logActive(line: string): void {
    if (this.modalPhase !== "running" || !this.activePhaseId) return;
    this.reporter.log(this.activePhaseId, line, this.activeSubstepId ?? undefined);
  }

  async confirm(): Promise<void> {
    const p = this.prompt;
    if (!p) return;
    this.modalPhase = "running";
    try {
      await p.exec(this.reporter);
      this.modalPhase = "done";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      // The phase that was in-flight when the error was thrown flips to "error"; any sub-step
      // in-flight flips to "error" too; every phase after it stays "pending" (never started).
      if (this.activePhaseId) {
        const s = this.ensure(this.activePhaseId);
        s.status = "error";
        if (this.activeSubstepId) s.substepStatus = { ...s.substepStatus, [this.activeSubstepId]: "error" };
        this.phaseState = { ...this.phaseState };
      }
      this.auditLog = [...this.auditLog, `${timestamp()} ✗ ${msg}`];
      this.modalPhase = "error";
    }
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
