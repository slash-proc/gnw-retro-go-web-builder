import type { Widen } from "../widen.js";

// Overview tab copy (OverviewTab.svelte): the Info/Controls/Screenshot dashboard cards, bank
// boot buttons, external-flash geometry panel, Boot Image confirm dialog, and device log
// accordion. Runtime-derived substrings (model names passed in as args, byte/MB counts, bank
// type strings, device labels) stay as function args — only literal surrounding copy lives here.
export const overviewEn = {
  waitingForConnection: "Waiting for a device connection…",
  // The Overview is the default tab of "Manage Device", so this is the first thing many people
  // meet. Three states shared one grey wait line until now, and only one of them is a wait:
  // this browser can NEVER reach a device (no WebUSB, so no adapter and no patience helps),
  // a connection is in flight, or nothing is attached yet. The adapter requirement is
  // irreducible — the device has to be opened and wired — so the copy names that wall rather
  // than implying a cable would do. `shared.common.connect` is the action; no string here.
  noDevice: {
    title: "No device connected",
    body: "Backups, patching and firmware need an ST-Link v2 (or compatible) adapter wired to the device.",
    browserTitle: "This browser cannot reach the device",
    browserBody:
      "Device access needs WebUSB. Chrome, Edge and Opera have it; Library and Sources work in any browser.",
  },
  info: {
    readProtection: "Read protection",
    unknownValue: "—",
    lockLocked: "Locked",
    lockUnlocked: "Unlocked",
  },
  // The Overview Status pane (ui/StatusPane.svelte), whose board is
  // docs/design/proposals/overview-v2/Status.dc.html. Labels and values only: a value stands
  // alone in its column — a date, or "None" — and never restates its own label as a verb, so
  // there is no "Taken" here and never will be. The needs-attention states are the SAME rows
  // with different values, which is why they are keys in this one block and not a second one.
  status: {
    title: "Status",
    layoutLabel: "Layout",
    layoutDual: "Dual boot",
    layoutRetroGo: "Only Retro-Go",
    layoutStock: "Only stock",
    layoutOther: "Not recognised",
    bank: (n: number) => `Bank ${n}`,
    needAttention: (n: number) => (n === 1 ? "1 needs attention" : `${n} need attention`),
    debugProbe: "Debug probe",
    firmwareBackup: "Firmware backup",
    backupNone: "None",
    backUpNow: "Back up now",
    backupNotConnected: "Folder not connected",
    backupNotThisDevice: "No backup for the connected console",
    connectFolder: "Connect folder",
    storage: "Storage",
    storageSdCard: "SD card",
    storageInternal: "Internal flash",
    storageNoCard: "No card selected",
    installedFirmware: "Installed firmware",
    firmwareNone: "None",
    latestLabel: "Latest",
    upgradeAction: "Upgrade Retro-Go",
    rescan: "Rescan",
  },
  controls: {
    captureScreenshot: "Capture screenshot",
    capturingPercent: (pct: number) => `Capturing (${pct}%)`,
  },
  screenshot: {
    // Main.dc.html: the span-5 column's section label, sharing a baseline row with the
    // capture action.
    sectionLabel: "Screen",
    alt: "Screenshot",
    clickToDownload: "Click to download screenshot",
    noScreenshotCaptured: "Nothing captured yet",
    modalTitle: "Capture Screenshot",
    modalBody: "This will briefly halt the device to read the display buffer.",
    modalConfirm: "Capture",
    rememberCheckbox: "Don't ask me again",
    phaseCapturing: "Capturing screenshot",
  },
  banks: {
    heading: "Internal flash",
  },
  // Each bank offers the step that fits ITS OWN state, never a generic "Install" and never one
  // device-wide value broadcast to both (see OverviewTab.svelte's bankPrompt). When the state
  // can't be told apart, no prompt is shown at all rather than a made-up one.
  bankEmpty: {
    guidedSetup: "Start guided setup",
    installStock: "Install stock firmware",
    patchStock: "Patch stock firmware",
    installRetroGo: "Install Retro-Go",
  },
  extFlash: {
    title: "External Flash",
    scanningPleaseWait: "Scanning… Please wait",
    scan: "Scan",
    enterRecoveryToScan: "Enter Recovery Mode to Scan",
    freeOfTotal: (total: string) => `free of ${total}`,
  },
  bootModal: {
    title: "Boot Image",
    body: (name: string, addr: string) => `The device will be reset to boot ${name} from ${addr}.`,
    confirm: "Boot",
    bankFallbackLabel: (n: number) => `Bank ${n}`,
  },
  bankButton: {
    startFirmware: (model: string) => `Start ${model} firmware`,
    startRetroGo: "Start Retro-Go",
    startType: (type: string) => `Start ${type}`,
  },
  log: {
    heading: "Device log",
    readLog: "Read device log",
    reading: "Reading…",
    download: "Download",
  },
} as const;

export type OverviewStrings = Widen<typeof overviewEn>;
