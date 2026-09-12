import type { Widen } from "../widen.js";

// Guided Setup / wizard copy (views/Wizard.svelte): the 3-step linear flow (Backup & Patch
// official firmware → Install Retro-Go → Install ROMs). Runtime/device-derived substrings
// (model names, version tags, byte/MiB counts, filenames, error messages caught from a thrown
// Error) stay as function args or are left inline in the .svelte file — only literal
// surrounding copy lives here. Generic button labels already covered by shared.common (Cancel,
// Connect, etc.) are reused from there, not duplicated here.
export const wizardEn = {
  step1: {
    titlePatch: "Patch Device",
    titleBackupAndPatch: "Backup & Patch",
    bodyBroken: "This will select your backup folder and patch your device with its missing stock assets. Ensure your device has enough battery and do not unplug it!",
    bodyNormal: "You will be prompted to select a folder on your computer. This is an important folder where your device's original firmware backup will be safely stored. Do not lose these files! Once selected, the backup and patching will happen automatically.",
    confirmPatch: "Patch",
    confirmSelectFolderAndStart: "Select Folder & Start",
    phaseLocateBackup: "Locate existing backup",
    phaseReadDevice: "Read device (dump)",
    phasePatch: "Patch firmware",
    phaseFlashInternal: "Flash internal (bank 1)",
    phaseFlashExternal: "Flash external",
    phaseRescan: "Rescan device",
    logReusingBackup: (model: string, intBytes: number, extBytes: number) => `backup: reusing on-disk backup for ${model}, internal ${intBytes} B, external ${extBytes} B, no device read`,
    logNoBackupBroken: `backup: no usable backup on disk and device assets are missing, cannot repair`,
    errMustSelectBackup: "Device assets are missing. You MUST select the folder containing your previous valid backup to repair it.",
    logNoBackupReadingDevice: (model: string, extBytes: number) => `backup: no usable backup on disk, dumping stock firmware from device (model ${model}, external ${extBytes} B)`,
    errDumpedFirmwareMismatch: "Dumped firmware doesn't match a known stock ROM.",
    logDetectedModel: (model: string, intBytes: number, extBytes: number) => `backup: dump matches stock ${model} (internal ${intBytes} B, external ${extBytes} B)`,
    logSavingBackup: `backup: writing internal and external backup files to the selected folder`,
    buttonAction: (isBroken: boolean) => (isBroken ? "Patch" : "Backup & Patch"),
    skip: "Skip",
    // Retro-Go-only path: the same step, minus the patch (see Wizard.svelte's openBackupOnly).
    titleBackupOnly: "Back Up Original Firmware",
    bodyBackupOnly:
      "You will be prompted to select a folder on your computer, where a copy of your device's original firmware will be saved. Keep these files safe, because you cannot download them again. Nothing is written to the device: Retro-Go replaces the original firmware in the next step.",
    buttonBackupOnly: "Back Up",
  },
  step2: {
    title: "Install Retro-Go",
    bodyReinstall: "Reinstalling will overwrite Retro-Go on your device.",
    bodyUpgrade: (tag: string) => `Upgrading to ${tag} will overwrite Retro-Go on your device.`,
    bodyEraseWarning: "Warning: this erases existing games and data.",
    confirmInstall: "Install",
    confirmUpgrade: "Upgrade",
    confirmDowngrade: "Downgrade",
    checkboxMigrateGames: "Migrate Games",
    checkboxMigrateSaves: "Migrate Saves",
    confirmGateSelectSdCard: "Select SD Card",
    phaseReadExistingState: "Read existing state",
    subReadPreviousGameState: "Read previous game state",
    subExtractCoresSaves: "Extract cores, saves",
    subMigrateInstalledGames: "Migrate installed games",
    phaseDownloadFirmware: "Download firmware",
    phasePrepareInstallImage: "Prepare install image",
    subSetSdCacheBoundary: "Set SD cache reserved-offset boundary",
    phaseBuildInstallImage: "Build install image",
    subBuildGamesBiosLanguages: "Games, BIOS, languages",
    subBuildCoresSaves: "Cores, saves",
    subPatchSuperblock: "Patch superblock",
    phaseFlashingRetroGo: "Flashing Retro-Go",
    phaseRescan: "Rescan device",
    phaseSyncSdCores: "Sync SD cores",
    regionInternalFirmware: "Internal firmware",
    regionGamesBiosLanguages: "Games, BIOS, languages",
    regionCoresSaves: "Cores, saves",
    logMigrateSummary: (kind: string, migrateGames: boolean, migrateSaves: boolean) => `migrate: ${kind}, games=${migrateGames}, saves=${migrateSaves}`,
    logMigrateKindReinstall: `reinstall of the installed version`,
    logMigrateKindUpgrade: `upgrade`,
    logReadPreviousGameState: (hexOffset: string, length: number) => `gamestate: read frogfs state at ${hexOffset}, window ${length} B`,
    logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) => `gamestate: read failed at ${hexOffset}, window ${length} B, continuing without previous state: ${message}`,
    logExtractedSavesSettings: (count: number, bytes: number) => `saves: extracted ${count} littlefs entries, ${bytes} B`,
    logCouldNotExtractSavesSettings: (message: string) => `saves: littlefs extraction failed, continuing without saves/settings: ${message}`,
    logMigratedGames: (count: number, bytes: number) => `games: read ${count} installed games from frogfs, ${bytes} B`,
    logSkippingGameMigration: (requested: boolean, installed: number) => `games: migration skipped, requested=${requested}, installed=${installed}`,
    logTargetVersion: (tag: string) => `bundle: target version ${tag}`,
    logNoVersion: `(none)`,
    logBundleDownloaded: (tag: string, bytes: number, ms: number) => `bundle: ${tag} downloaded, ${bytes} B in ${ms} ms`,
    logGamesBiosLanguagesBuilt: `frogfs: games, BIOS and languages image built`,
    logCoresSavesBuilt: `littlefs: cores and saves image built`,
    logSuperblockPatched: `superblock: patched into the intflash blob`,
    logSdCacheBoundarySet: (offset: number) => `sdcache: reserved offset set to ${offset} B, keeps the round-robin ROM cache clear of reserved/OFW data`,
    logConfirmingLinkResponsive: (alive: boolean, ms: number) => `device: stub mailbox alive=${alive}, ${ms} ms`,
    logSdSyncStarting: `sd: syncing core files to the card`,
    logSdSyncFoundItems: (count: number, bytes: number) => `sd: ${count} files in the bundle's SD content, ${bytes} B`,
    logSdSyncCopyingFile: (path: string, bytes: number) => `sd: writing ${path}, ${bytes} B`,
    logSdSyncGeneratingZip: (count: number) => `sd: no directory handle, building a zip of ${count} files`,
    sdSyncZipFilename: "retro-go-sd-cores.zip",
    upgradeButtonLabel: (tag: string) => `Upgrade to ${tag}`,
    reinstallButtonLabel: "Reinstall",
    installButtonLabel: "Install",
    versionLatest: "(latest)",
  },
  step3: {
    continueButtonLabel: "Continue to Library →",
  },
  // Step 1 of the two-step Guided Setup: the intent chooser ("what should this device
  // run?"), its three cards, and the small grey escape hatch beneath them.
  chooser: {
    title: "What should this device run?",
    whatIsRetroGo: "Retro-Go is custom firmware that plays games from other consoles on this device.",
    dualBoot: "Dual Boot",
    onlyRetroGo: "Only Retro-Go",
    returnToStock: "Return to Stock",
    escapePrompt: "Something else?",
    escapeAction: "Use the Advanced tab",
    // Hard hardware floors, not preferences: Retro-Go needs 8 MB of external flash and
    // dual boot needs 16 MB. Below those, Guided Setup offers returning to stock only.
    tooSmallForRetroGo: (mb: number) => `Retro-Go needs 8 MB. This device has ${mb} MB.`,
    tooSmallForDualBoot: (mb: number) => `Dual boot needs 16 MB. This device has ${mb} MB.`,
  },
  // Step 2: the spine, whose step titles are specialised per chosen path. Titles and
  // controls only - the steps deliberately carry no descriptive subtitle.
  spine: {
    backupAndPatchOriginal: "Backup & Patch Original Firmware",
    backUpOriginal: "Back Up the Original Firmware",
    installRetroGo: "Install Retro-Go",
    addSources: "Add Software Sources",
    addRoms: "Add to Library",
    selectBackup: "Select Backup of Original Firmware",
    restoreOriginal: "Restore Original Firmware",
    restoreButtonLabel: "Restore",
    removeRetroGo: "Remove Retro-Go",
    skipCaution: "This cannot be undone, and downloading the original firmware is probably illegal in your jurisdiction.",
    skipAnyway: "Skip anyway",
    chipOptional: "Optional",
    runAgain: "Run again",
    sourcesButtonLabel: "Add Sources",
    selectFolderButtonLabel: "Select Folder",
    backupFound: (model: string) => `Backup found: ${model}`,
  },
  // The "Return to Stock" path's restore step. Destructive and irreversible, so the copy
  // says so plainly — and there is deliberately no affordance anywhere here to obtain a
  // backup the user does not already have.
  restore: {
    modalBody: "Your device's original firmware will be written back exactly as it was backed up. This erases Retro-Go and everything installed with it. Games, saves and settings are not migrated and cannot be recovered afterwards. Keep the device plugged in until it finishes.",
    confirm: "Restore",
    needBackup: "Select a valid backup of this device's original firmware first.",
    noneFound: "No usable backup of the original firmware was found in that folder. It must contain the pair of backup files written when the device was unlocked.",
    wrongHardware: (backup: string, hardware: string) =>
      `That backup is ${backup} firmware, but this is ${hardware} hardware. Writing it would leave the device unusable, so it cannot be restored here.`,
    tooBig: (mb: string, capMb: string) =>
      `That backup needs ${mb} MB of external flash but this device only has ${capMb} MB.`,
    logRestoring: (model: string, intBytes: number, extBytes: number) => `flash: restoring stock ${model} verbatim, internal ${intBytes} B → bank 1, external ${extBytes} B → bank 0`,
  },
  common: {
    errOperationTimedOut: "Operation timed out (device may have hung). Restart the device and try again.",
    rescanningDeviceGeometry: `device: rescanning geometry`,
  },
} as const;

export type WizardStrings = Widen<typeof wizardEn>;
