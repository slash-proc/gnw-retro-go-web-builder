/**
 * The one decision behind automatic unlocking, extracted so the ORDERING can be tested.
 *
 * The owner's rule: "the device should be unlocked if they're using this tool to change
 * anything on the device. It should just automatically happen. We don't care about locking
 * because there's no benefit to it."
 *
 * So there is no opt-in checkbox and no "unlock first, then come back" dead end. A write flow
 * calls `ensureUnlocked()` and it either returns (already unlocked, or unlocked just now) or
 * throws (the user declined the one prompt that survives, or the hardware refused).
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES INSIDE THE STORE. Clearing RDP mass-erases both
 * flashes, and the stock firmware is unique per unit -- it carries per-unit data and cannot be
 * re-downloaded. So the order is not a detail, it is the whole safety story:
 *
 *     a backup of this unit exists  ->  unlock  ->  proceed
 *
 * `unlock()` must never be reached before that question has been answered. Written inline that
 * invariant is a comment; written here it is `unlockGate.mjs`, which drives this function with
 * a recording harness and fails if `unlock` is called before the backup check, or at all after
 * a declined prompt.
 *
 * THE ONE SURVIVING PROMPT. A locked device's internal flash cannot be read over SWD at all,
 * so when no backup exists there is nothing to save first and unlocking destroys the original
 * firmware irrecoverably. That is genuinely one-way, so it asks. Everything else just happens.
 *
 * (gnwmanager's full `unlock` command avoids that prompt by backing up ITCM + external flash,
 * flashing an XOR-obfuscated payload that dumps internal flash to SRAM across a user-performed
 * power cycle, and only then clearing RDP. Porting that -- it needs `blobs/unlock.bin`, which
 * is already vendored -- would turn most of these prompts into automatic backups. It is not
 * built; see docs/ARCHITECTURE.md "Device Scan & Classification".)
 */

/** What `ensureUnlocked` did, for the caller's audit-log line. */
export type UnlockOutcome = "already-unlocked" | "unknown-state" | "unlocked";

export interface UnlockGateDeps {
  /** `device.locked`: true = RDP set, false = clear, null = not scanned yet. */
  locked: boolean | null;
  /** `device.backupTaken`: a stock backup of THIS unit exists on the user's disk. */
  backupTaken: boolean;
  /**
   * Ask the user to accept losing the original firmware forever. Resolves on accept and
   * REJECTS on decline -- a decline must abort the write flow, never fall through to unlock.
   * Only called when `backupTaken` is false.
   */
  confirmDestructive: () => Promise<void>;
  /** `flasher.unlock()`: the four option-byte writes plus a reset. */
  unlock: () => Promise<void>;
  /** Re-read the device after the reset, so `locked`/`info` stop describing the old state. */
  afterUnlock: () => Promise<void> | void;
  /** Audit-log sink. Called for the decision, not for every step. */
  note: (event: UnlockNote) => void;
}

export type UnlockNote =
  | { kind: "skipped"; reason: UnlockOutcome }
  | { kind: "confirming" }
  | { kind: "declined" }
  | { kind: "unlocking"; backedUp: boolean }
  | { kind: "unlocked" };

/**
 * Make the device writable, unlocking it if it is locked.
 *
 * @throws whatever `confirmDestructive` rejects with (the user declined), or whatever
 *         `unlock` throws (the hardware refused). Either way the caller must not write.
 */
export async function ensureUnlocked(deps: UnlockGateDeps): Promise<UnlockOutcome> {
  // `null` means the scan has not answered yet. Do NOT guess in either direction: guessing
  // "unlocked" lets a write flow proceed into a device that will reject it, and guessing
  // "locked" would mass-erase a device on a stale read. The caller scans first.
  if (deps.locked === null) {
    deps.note({ kind: "skipped", reason: "unknown-state" });
    return "unknown-state";
  }
  if (deps.locked === false) {
    deps.note({ kind: "skipped", reason: "already-unlocked" });
    return "already-unlocked";
  }

  // The backup question is answered BEFORE `unlock` is reachable. This is the ordering the
  // suite pins; moving the `deps.unlock()` call above this block is the mutation it catches.
  const backedUp = deps.backupTaken;
  if (!backedUp) {
    deps.note({ kind: "confirming" });
    try {
      await deps.confirmDestructive();
    } catch (e) {
      deps.note({ kind: "declined" });
      throw e;
    }
  }

  deps.note({ kind: "unlocking", backedUp });
  await deps.unlock();
  await deps.afterUnlock();
  deps.note({ kind: "unlocked" });
  return "unlocked";
}
