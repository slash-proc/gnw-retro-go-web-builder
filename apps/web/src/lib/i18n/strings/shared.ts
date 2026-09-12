import type { Widen } from "../widen.js";

// Shared UI chrome copy: generic modal/button/control components used across every
// feature area (ModalShell, ConfirmModal, Button,
// SplitButton, Progress, Card, DeviceControls, StubLoadModal, ConnectGateModal,
// FolderGateModal, InstallProgressModal). Grouped by owning component; `common` holds
// strings reused verbatim by 2+ of them (Cancel/Close/Connect/etc).
export const sharedEn = {
  common: {
    cancel: "Cancel",
    // Owner ruling (DECISIONS.md #11): "Done" or "Close" -- either, as long as it is
    // consistent project-wide. `Close` wins, and stays the ONE word for this slot: every
    // modal footer/dismiss control in the app already routes here (AddSourcesModal,
    // ConfirmModal, InstallProgressModal, GameDetailsPanel's import modal + its X,
    // RomManagementTab's drawer X), and none of them "finishes" anything on click -- each
    // one dismisses a modal whose work is already committed. `done` below is the "✓ Done."
    // STATUS line those modals show above this button, not a label for it; don't merge the
    // two, and don't reintroduce a "Done" button on the Add Sources footer.
    close: "Close",
    connect: "Connect",
    connecting: "Connecting…",
    workingNotePre: "Working. ",
    workingNoteBold: "Do not unplug your device",
    workingNotePost: ".",
    done: "✓ Done.",
    changeEllipsis: "Change…",
    chooseEllipsis: "Choose…",
    or: "or",
  },
  confirmModal: {
    defaultConfirmText: "Confirm",
  },
  splitButton: {
    moreOptions: "More options",
  },
  deviceControls: {
    deviceActions: "Device actions",
    rescan: "Rescan",
    restartRecoveryMode: "Restart Recovery Mode",
    startRecoveryMode: "Start Recovery Mode",
    changeAdapter: "Change Adapter",
    disconnectDevice: "Disconnect Device",
  },
  stubLoadModal: {
    title: "Enter Recovery Mode?",
    body1Pre: "To perform this action (like reading flash, backing up, or installing firmware), the device must enter ",
    body1Bold: "Recovery Mode",
    body1Post: ". This will temporarily halt the running application.",
    body2Pre: "Hold down the device’s ",
    body2Bold: "power button",
    body2Post: " while it connects, then set the device down and don’t touch it until the operation finishes.",
    continue: "Continue",
  },
  connectGateModal: {
    title: "Device needed",
    subtitle: "Connect your device’s adapter to continue.",
    deviceConnectionTitle: "Device Connection",
    connectedFallback: "Connected",
    adapterHint: "An ST-Link v2 (or compatible) adapter",
    chooseAdapter: "Choose Adapter",
    connectionFailed: "Connection failed.",
  },
  folderGateModal: {
    // NO SUBTITLE. It was a `subtitleSingular`/`subtitlePlural` pair swapped on the ROW COUNT,
    // which is the antipattern UI_VOICE section 3 names by name ("two i18n keys differing only
    // in plurality are a smell", the same shape as the deleted `chooseFiles`). Both are gone
    // rather than merged into a third wording: the line said "Select the folders below to
    // continue", which narrates what the rows and their own `Choose…` buttons already are, and
    // `title` carries the fact on its own.
    title: "Folders needed",
    romFolderTitle: "ROM Folder",
    selectedFallback: "Selected",
    romFolderHint: "Your local collection of ROM files",
    reconnectLastFolder: "Reconnect last folder",
    scanning: "Scanning…",
    sdCardFolderTitle: "SD Card Folder",
    sdCardFolderHint: "The root of your SD card volume",
    // ModalFolderSdUnreadable.dc.html — a GENUINE pick/scan failure on the SD row (never a
    // cancel). Promises no cause: the catch holds a DOMException that may be a permissions
    // denial, a removed volume or a scan failure. Deliberately the shape of
    // `sources.filePrompt.errRead` so the two error surfaces speak in one voice.
    errRead: "That folder could not be read.",
    continue: "Continue",
  },
  // THE ACTIVITY LOG (`auditLog.svelte.ts`, RomsActivityLog.dc.html) — the one place the app
  // says what it did. Only two strings: the surface's own name, and what it says when there is
  // nothing in it. `Close` is `common.close`, and `Copy log` is reused verbatim from
  // `installProgressModal` below rather than translated a second time — it is the same action,
  // with the same English-whatever-the-locale rule.
  auditLog: {
    title: "Activity",
    empty: "Nothing to report yet.",
    // THE RELOAD BOUNDARY (ActivityPane). Entries survive a page reload, so the list can hold
    // two loads' worth of record. This names the point between them: everything above the rule
    // is from before the refresh. A name for the event, not a sentence about it.
    reloaded: "Reloaded",
    // THE SESSIONS LIST (ActivityPane). Names the list of page loads for a screen reader; the
    // rows themselves are dates and clock times, which need no translating. HIS OWN WORD -- the
    // owner asked for "a list with each of those sessions listed by date" -- so it is not a
    // heading invented for the surface. The list is drawn only when there is more than one, so
    // this never labels a list of one.
    sessions: "Sessions",
    // THE SEVERITY SEGMENT (Activity.dc.html). `all` is every level the user has asked to see,
    // which is not the same as every level recorded: `debug` has its own chip because it is a
    // capture mode rather than a peer view.
    sevAll: "All",
    sevDebug: "Debug",
    sevInfo: "Info",
    sevWarning: "Warning",
    sevError: "Error",
    // The source chips. These name parts of the app, so they match the vocabulary the rest of
    // the UI already uses for the same things.
    srcConverter: "Converter",
    srcDevice: "Device",
    srcSources: "Sources",
    filterPlaceholder: "Filter",
    // The line Copy and Save sit beside, and which states what they would act on.
    showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    // `Copy` and `Save`, not `Copy log`/`Save log`: they sit on the count line inside a pane
    // already titled Activity, so repeating the noun would be repeating the heading. Copy is
    // English whatever the display language (auditLog.copyText), so a pasted report reads the
    // same for everyone; `Save` because nothing is fetched, the bytes are already here.
    copy: "Copy",
    save: "Save",
    // The filename Save writes to. Not translated: it is an identifier a maintainer receives.
    saveFilename: "gnw-activity.txt",
    // THE BELL'S PANEL (Notifications.dc.html). Errors only, which is why its empty line differs
    // from the pane's: Activity holds the whole record and can be genuinely empty, while this
    // holds only what is unattended and is empty far more often, including when Activity is full.
    notificationsTitle: "Notifications",
    noneWaiting: "No activity yet",
    openActivity: "Open Activity",
    // Clears the BELL, never the record: both this and the per-row control set `seen`.
    clearNotifications: "Clear",
    dismissNotification: "Dismiss",
    // WHAT FAILED, WHEN IT FAILED NOWHERE ELSE. Each of these names one operation the user
    // started, and carries the thrower's own text as the reason. They exist because the app
    // had exactly ONE catch that reached this log (the converter's, `roms.convertFailed`,
    // whose shape these follow): a failed Recovery Mode boot wrote `device.error`, which no
    // component renders, so the owner saw a button that did nothing and reported a hardware
    // flake. A failure with no line here is indistinguishable from a click that never landed.
    //
    // The reason is raw thrower text, not translated: it is the same untranslated detail
    // `convertFailed` carries, and inventing a sentence for it would be guessing at a cause.
    recoveryFailed: (reason: string) => `Recovery Mode didn't start: ${reason}`,
    connectFailed: (reason: string) => `Couldn't connect: ${reason}`,
    scanFailed: (reason: string) => `Scan didn't finish: ${reason}`,
    foldersFailed: (reason: string) => `Couldn't read the folders: ${reason}`,
    cheatsFailed: (reason: string) => `Couldn't load cheats: ${reason}`,
  },
  installProgressModal: {
    logLabel: (count: number) => `Log (${count})`,
    saveLog: "Save log",
    // FlashFailure.dc.html:84 draws `Copy log` beside `Save log`. It always copies ENGLISH,
    // whatever the UI language, so a pasted bug report reads the same for everyone.
    copyLog: "Copy log",
    // FlashFailure.dc.html:85 — the failed-install dialog's block table, headline and advice.
    // The board draws three rows and the words "Three blocks … two retries"; the flasher aborts
    // at the FIRST failing chunk, so in practice this is one block. Both counts are therefore
    // interpolated, and `retries` is `FlashVerifyError.attempts - 1`.
    blocksFailed: "Blocks that failed",
    blockLabel: (n: number) => `Block ${n}`,
    verifyHeadline: (blocks: number, retries: number) =>
      `${blocks === 1 ? "One block" : `${blocks} blocks`} did not match after ` +
      `${retries === 1 ? "one retry" : `${retries} retries`}.`,
    partlyWrittenBank: (bank: number) => `Bank ${bank} is partly written and will not boot.`,
    partlyWrittenExt: "External flash is partly written.",
    wiringAdvice:
      "Repeated block failures are almost always the programmer wiring. Reseat it, then retry.",
    // THE STOP (FlashingCancel.dc.html, FlashingCancelConfirm.dc.html). The link itself reuses
    // `common.cancel`; these are the parts around it.
    //
    // `cancelCaption` is the board's own words, and it is a fact about the writer rather than
    // reassurance: the flasher checks the abort flag at the top of each 256 KiB chunk, so a stop
    // never lands mid-erase.
    cancelCaption: "Stops after the current block",
    cancelPending: "Stopping",
    cancelTitle: "Stop writing?",
    // THE BOARD'S BODY IS DELIBERATELY NOT REPRODUCED. It reads "Bank 2 is 46% written. Stopping
    // leaves it unbootable until you install again. Your stock firmware in bank 1 is not
    // touched." -- true of a Retro-Go install into bank 2, and false of an OFW patch flash,
    // which writes bank 1. No ruling exists on what a half-written bank leaves behind
    // (docs/BLOCKED-AUDIT.md Q20 says so in as many words), so this states only what is true of
    // every writer here: nothing is rolled back, and nothing resumes.
    cancelBody: "What is already written stays written. The install is incomplete until you run it again.",
    cancelKeep: "Keep writing",
    cancelStop: "Stop",
    cancelledNote: "Stopped. The install is incomplete.",
    logStopping: "Stopping at the next block boundary.",
    logStopped: "Stopped.",
  },
  // Geometry-bar segment labels (engine/classify.ts's extflashSegments/intflashSegments) —
  // shared across OverviewTab, RomSection, DumpSection, EraseSection, FileBrowserSection (all
  // render the same GeoSegment[] via ui/GeometryBar.svelte), so this lives here rather than in
  // one feature area's string file.
  geometry: {
    freeSpace: "Free Space",
    games: "Games & Homebrew",
    coresAndSaves: "Cores & Saves",
    bankLabel: (n: number) => `Bank ${n}`,
    bankUnknown: "—",
    used: "used",
    free: "free",
    bankFree: (n: number) => `Bank ${n} free`,
    empty: "empty",
    externalFlash: "external flash",
    reservedSdCache: "Reserved (SD cache)",
  },
  // Byte-size unit suffixes for util.ts's formatSize(). 1024-based values wearing the LOOSE
  // decimal-style labels on purpose (`KB`, not `KiB`) — the owner's ruling; don't "correct"
  // them to binary prefixes. `space` is what goes between the number and the unit, because
  // that is a per-language typographic choice, not a constant.
  units: {
    b: "B",
    kb: "KB",
    mb: "MB",
    gb: "GB",
    space: " ",
  },
} as const;

export type SharedStrings = Widen<typeof sharedEn>;
