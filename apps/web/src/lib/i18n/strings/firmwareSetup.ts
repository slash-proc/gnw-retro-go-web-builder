import type { Widen } from "../widen.js";

// Firmware Setup area: the tab shell (views/Advanced.svelte) + its two sub-flows,
// OfficialFirmwareSection.svelte (stock Backup & Patch) and RomSection.svelte (Install/
// Reinstall Retro-Go, DATA-HEAVY — only static chrome is here, not live version/bank/size
// values). Batch 4b (a separate pass) adds sibling top-level keys to this same file for
// DumpSection/FlashSection/EraseSection/FileBrowserSection/RetroGoTab/
// DeferredSection — don't assume this file belongs to one feature area forever.
//
// Runtime/device-derived substrings (model labels, version tags, byte/MiB counts, bank
// numbers, hex addresses, filenames, caught-error messages) stay as function args or inline
// in the .svelte files — only literal surrounding copy lives here.
export const advancedEn = {
  tabbarLabel: "Advanced tools",
  tabOverview: "Overview",
  tabFirmwareSetup: "Firmware",
  tabRoms: "Library",
  waitingForDevice: "Waiting for a device connection…",
  modeGuidedSetup: "Guided",
  modeAdvanced: "Advanced",
  unitLabel: "Unit",
} as const;

export type AdvancedStrings = Widen<typeof advancedEn>;

export const officialFirmwareEn = {
  // The rail pane page subtitle (BackupPatch.dc.html).
  pageSubtitle: "Save your stock firmware, then patch it so custom firmware can boot.",
  step1Title: "Firmware backup",
  chromiumRequired: "Folder selection needs a Chromium browser (same as WebUSB).",
  pickFolderIntro: "Pick a folder holding your stock backups, or an empty folder to save a backup.",
  pickFolderLookForPre: "We look for",
  pickFolderBodyPost: "and validate them.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseBackupFolder: "Choose backup folder",
  reconnectLastFolder: "Reconnect last folder",
  backupsFoundLegend: (plural: boolean) => `Stock backup${plural ? "s" : ""} found in this folder`,
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ invalid (int ${internalOk ? "✓" : "✗"}, ext ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Valid ${model} stock backup selected.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `The ${model} backup failed validation (internal ${internalOk ? "✓" : "✗"}, external ${externalOk ? "✓" : "✗"}). Take a fresh backup below.`,
  noBackupYet: "No stock backup in this folder yet; back one up from the connected device.",
  foundChip: "Found",
  changeFolder: "Change folder",
  backUpAgain: "Back up this device again",
  rowValid: "Valid",
  step2BodyThis: (model: string) =>
    `Patches your ${model} backup and writes it back to the device.`,
  step2BodySelected: "Patches the selected backup and writes it back to the device.",
  alreadyPatchedNoticePre: "This device is already running ",
  alreadyPatchedNoticeBold: "patched Retro-Go",
  alreadyPatchedNoticePost: " firmware, so there's no stock firmware on it to back up. To install a ",
  alreadyPatchedNoticeDifferentBold: "different",
  alreadyPatchedNoticeEnd: " official firmware (e.g. Mario ↔ Zelda), choose a folder above that holds a Mario or Zelda stock backup, then patch it below.",
  backingUp: "Backing up…",
  backUpNow: "Back up now",
  connectToBackUp: "Connect a device to back up.",
  lockedCannotBackUp: "This device is locked, so its internal flash cannot be read and there is nothing here to back up.",
  step2Title: "Patch firmware",
  installBootloaderLabel: "Install bootloader",
  installBootloaderHint: "(recommended)",
  crossModelDangerBold: "⚠ Cross-model:",
  crossModelDangerBody:
    "this is Zelda firmware, but the connected hardware scanned as Mario. Mario hardware lacks two of the buttons Zelda needs, so the result may be partly unusable.",
  crossModelAck: "I understand and want to flash Zelda firmware onto Mario hardware anyway",
  crossModelAllowedBold: "Cross-model:",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `this is ${backupModel} firmware on ${deviceModel} hardware. That works, because ${deviceModel} has every button ${backupModel} uses, but the device will behave as a ${backupModel} unit.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ This ${model} backup's external image (${backupMb} MB) is larger than this device's external flash (${deviceMb} MB); it physically won't fit and can't be flashed here.`,
  overlapWarnBold: "Overlaps installed data:",
  overlapWarnBody: (mb: string) =>
    `patching writes ${mb} MB at the start of external flash. Anything installed there (Games & Homebrew, Cores & Saves) will need reinstalling.`,
  enteringRecoveryMode: "Entering Recovery Mode…",
  enterRecoveryMode: "Enter Recovery Mode",
  patchFirmwareButton: "Patch firmware",
  // Footer bar (BackupPatch.dc.html / BackupPatchCross.dc.html) — the cross-model state
  // swaps both the summary and the button, which turns destructive-outline there.
  patchAnywayButton: "Patch anyway",
  footerSummary: "Your stock backup stays on disk. This only rewrites the device.",
  footerSummaryCross: "Read the warning above before continuing.",
  connectToPatchAndFlash: "Connect a device to patch + flash.",
  patchedAndFlashed: "✓ Patched + flashed.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Patches the ${model} stock firmware${withBootloader ? " (with the SD-card bootloader)" : ""} and flashes it: internal → bank 1, external → bank 0. Do not move or unplug the device during the write; it can fail the flash.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ You are flashing ZELDA firmware onto MARIO hardware, which lacks two of the buttons Zelda needs. ${base}`,
  modalTitle: "Patch + flash official firmware?",
  modalConfirmText: "Patch & flash",
  phasePatch: "Patch firmware",
  phaseFlashInternal: "Flash internal (bank 1)",
  phaseFlashExternal: "Flash external",
  phaseRescan: "Rescan device",
  errDeviceLocked: "This device is locked (RDP read-protection). A locked device's internal flash cannot be read, so its firmware cannot be backed up. Writing to the device unlocks it, and unlocking erases the original.",
  // The one prompt that survives automatic unlocking, and the audit-log lines around it.
  unlockModalTitle: "Unlock this device?",
  unlockModalBody: "Writing to this device requires unlocking it, and unlocking erases both flashes. A locked device's internal flash cannot be read, so its original firmware cannot be saved first: it will be gone for good.",
  unlockModalConfirm: "Unlock and erase",
  unlockErasing: "unlock: clearing read protection, which erases both flashes",
  unlockDone: "unlock: read protection cleared",
  unlockDeclined: "unlock: declined, so the device is still locked and nothing was written",
  errFirmwareMismatch: "The dumped firmware doesn't match a known stock Mario/Zelda ROM; backup not saved.",
  logPatchingModel: (model: string, intBytes: number, extBytes: number) => `patch: patching stock ${model}, internal ${intBytes} B, external ${extBytes} B`,
} as const;

export type OfficialFirmwareStrings = Widen<typeof officialFirmwareEn>;

// romSection: static chrome only (this component is heavily data-driven — banks, versions,
// byte counts, hex offsets never move into the string table, they're passed as args or left
// inline as before).
export const romSectionEn = {
  regionIntflash: "Internal firmware",
  regionFrogfs: "Games, BIOS, languages",
  regionLittlefs: "Cores, saves",
  phasePrepare: "Prepare device",
  phaseDownload: "Download firmware",
  phaseMigrateScan: "Read existing state",
  subFrogfsState: "Read previous game state",
  subLfsExtract: "Extract cores, saves",
  subGamesMigrate: "Migrate installed games",
  phasePrepareInstallImage: "Prepare install image",
  subSdCache: "Set SD cache reserved-offset boundary",
  phaseBuildInstallImage: "Build install image",
  subBuildFrogfs: "Games, BIOS, languages",
  subBuildLittlefs: "Cores, saves",
  subPatchSuperblock: "Patch superblock",
  phaseFlashingToDevice: "Flashing to device",
  phaseRescan: "Rescan device",
  phaseSyncSdCores: "Sync cores to SD card",
  chooseSdCard: "Choose SD Card",
  flashRetroGo: "Flash Retro-Go",
  flashThisInstall: "Flash this install?",
  flashRegions: (joined: string) => `Flash ${joined}?`,
  regionInternalFirmware: "internal firmware",
  regionGamesBiosLanguages: "games, BIOS, languages",
  regionCoresSaves: "cores, saves",
  flashBody: (writes: string) => `Writes: ${writes}. Don't unplug your device until it finishes.`,
  nameInternalFirmware: (bank: number) => `internal firmware → bank ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `games, BIOS, languages → ext ${addr}`,
  nameCoresSaves: (addr: string) => `cores, saves → ext ${addr}`,
  flashConfirmText: "Flash",
  selectSdCard: "Select SD Card",
  logConnectingFlashUtil: `device: connecting, loading the flash utility`,
  logFlashUtilReady: (extBytes: number, blockSize: number) => `device: flash utility ready, external flash ${extBytes} B, erase block ${blockSize} B`,
  errNoVersionsPublished: "No firmware versions are published yet.",
  logDownloadingBundle: (tag: string) => `bundle: downloading ${tag}`,
  logBundleDownloaded: (tag: string, bytes: number, ms: number) => `bundle: ${tag} downloaded, ${bytes} B in ${ms} ms`,
  logSameVersionRepair: (tag: string) => `migrate: same-version repair of ${tag}, forcing games migration on`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) => `migrate: target ${tag}, games=${migrateGames}, saves=${migrateLfs}`,
  logReadPreviousGameState: (hexOffset: string, length: number) => `gamestate: read frogfs state at ${hexOffset}, window ${length} B`,
  logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) => `gamestate: read failed at ${hexOffset}, window ${length} B, continuing without previous state: ${message}`,
  logExtractedSavesData: (count: number, bytes: number) => `saves: extracted ${count} littlefs entries, ${bytes} B`,
  logCouldNotExtractSavesData: (message: string) => `saves: littlefs extraction failed, continuing without saves/settings: ${message}`,
  logMigratedGames: (count: number) => `games: read ${count} installed games from frogfs`,
  logSkippedGameMigration: (requested: boolean, installed: number) => `games: migration skipped, requested=${requested}, installed=${installed}`,
  logGamesBiosLanguagesBuilt: `frogfs: games, BIOS and languages image built`,
  logCoresSavesBuilt: `littlefs: cores and saves image built`,
  logSuperblockPatched: `superblock: patched into the intflash blob`,
  logSdCacheBoundarySet: (offset: number) => `sdcache: reserved offset set to ${offset} B, keeps the round-robin ROM cache clear of reserved/OFW data`,
  logConfirmingLinkResponsive: (alive: boolean, ms: number) => `device: stub mailbox alive=${alive}, ${ms} ms`,
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `External payload (${payloadMb} MB) exceeds this device's external flash (${deviceMb} MB); can't flash.`,
  logRescanning: `device: rescanning geometry and installed games`,
  logSdSyncFoundItems: (count: number, bytes: number) => `sd: ${count} files in the bundle's SD content, ${bytes} B`,
  logSdSyncCopyingFile: (path: string, bytes: number) => `sd: writing ${path}, ${bytes} B`,
  logSdSyncNoHandleZipFallback: (count: number) => `sd: no directory handle, building a zip of ${count} files`,
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Version",
  refreshVersions: "Check for new versions",
  migrateGamesLabel: "Keep installed games",
  migrateSavesLabel: "Keep saves and settings",
  bankTargetLabel: "Target",
  bankReplacesStock: "Replaces stock",
  bankDualBoot: "Dual boot",
  retroGoOnlyNotice:
    "Bank 1 has no stock firmware detected, so the inferred target is bank 1; this will be a Retro-Go-only install (no dual-boot).",
  bank1StockOfwNotice:
    'Bank 1 has stock, unpatched firmware; you won\'t be able to reach Retro-Go until it\'s patched (see "Backup & Patch" above).',
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `Device looks like a ${deviceBuild} build. You're viewing ${viewingMode} mode.`,
  layoutAdvancedToggle: "Advanced layout",
  // Footer bar (Firmware.dc.html:149) — size and bank are device-derived, so they stay
  // arguments; the "stock firmware kept" tail only applies to a dual-boot (bank 2) install.
  footerSummary: (size: string, bank: number, dualBoot: boolean) =>
    `Writes ${size} to bank ${bank}${dualBoot ? ", stock firmware kept" : ""}`,
  sdCacheOffsetLabel: "SD Cache offset",
  frogfsOffsetLabel: "FrogFS offset",
  offsetHint: "(bytes from 0x90000000; reserves the bottom)",
  autoPlaceholder: (hex: string) => `auto (${hex})`,
  littlefsSizeLabel: "LittleFS size",
  littlefsSizeHint: "(≥8 MB)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `Default: FrogFS offset automatically reserves the bottom based on device layout. Both round up to the ${blockSize} B erase block.`,
  scanningProgress: (pct: number) => `Scanning… ${pct}%`,
  scanFailed: (err: string) => `scan failed: ${err}`,
  scanToSeeLayout: "Scan the device to see its current flash layout.",
  connectToSizeAndFlash: "Connect a device to size and flash the install.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range}, ${mib} MB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range}, ${mib} MB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `device end ${devEnd}, block ${blockSize} B, free ${freeMib} MB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `checks: ends-at-chip ${endsAtChip ? "✓" : "✗"}, no-overlap ${noOverlap ? "✓" : "✗"}, aligned ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `systems: ${systems || "(none)"}`,
  startBankLabel: (bank: number) => `Start bank ${bank}`,
  readBackSuperblockDebug: "Read back superblock (debug)",
  startedBankResult: (bank: number) =>
    `Started bank ${bank}. The device is now running that firmware; the stub is no longer active; reconnect or power-cycle to use the app again.`,
} as const;

export type RomSectionStrings = Widen<typeof romSectionEn>;

// dumpSection: DumpSection.svelte — "Dump Flash" (read any region of any bank to a file).
export const dumpSectionEn = {
  scanningDevice: "Scanning device…",
  intro: "Read a region of flash to a file on your computer.",
  internalFlashTitle: "Internal flash",
  externalFlashTitle: "External flash",
  barHint: "Click a partition to fill the range, or type one in.",
  offsetLabel: "Start",
  offsetPlaceholder: "0x90000000",
  lengthLabel: "Size",
  lengthPlaceholder: "whole region",
  lockedNotice: "🔒 Internal flash is unreadable while the device is locked, and unlocking it erases the contents, so there is nothing here to dump. (Bank 0 / external stays readable.)",
  overrunWarning: (clamped: string) => `Length exceeds region; will clamp to ${clamped} bytes.`,
  planCaption: "Plan",
  readsRow: "Reads",
  matchesPartition: (name: string) => `matches ${name}`,
  toFileRow: "To file",
  bytesValue: (bytes: string) => `${bytes} bytes`,
  enterRecoveryMode: "Enter Recovery Mode",
  dumpToFile: "Dump to file",
  // Footer bar (Dump.dc.html).
  footerSummary: "Reads over SWD. The device stays untouched.",
  invalidHint: "Enter a valid offset and length.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "Cancel",
  cancelHint: "A read is non-destructive; cancel discards the partial dump (no file).",
  resultSummary: (mib: string, secs: number) => `${mib} MB read in ${secs} s`,
} as const;

export type DumpSectionStrings = Widen<typeof dumpSectionEn>;

// flashSection: FlashSection.svelte — "Write Flash" (write an arbitrary image to any bank/offset).
export const flashSectionEn = {
  scanningDevice: "Scanning device…",
  enterRecoveryMode: "Enter Recovery Mode",
  intro: "Write a raw .bin to a bank at an offset.",
  imageFileLabel: "Image file",
  chooseImage: "Choose image",
  internalFlashTitle: "Internal flash",
  externalFlashTitle: "External flash",
  barHint: "Click a partition to fill the destination, or type one in.",
  offsetLabel: "Start",
  offsetPlaceholder: "0x08100000",
  compressLabel: "Compress transfer",
  verifyLabel: "Verify after write",
  lockedNotice: "🔒 Internal flash is locked, so flashing unlocks the device first, which erases both flashes. (Bank 0 / external stays writable.)",
  alignWarning: (align: number, kind: string) => `Offset must be a multiple of ${align} (${kind}flash alignment).`,
  overrunWarning: (region: string) => `Image overruns the ${region} B region.`,
  ackLabel: "I understand this overwrites whatever is there now.",
  planCaption: "Plan",
  writesRow: "Writes",
  destinationRow: "Destination",
  overwritesRow: "Overwrites",
  bytesValue: (bytes: string) => `${bytes} bytes`,
  padCaption: (size: string, paddedHex: string, padded: string) =>
    `${size} → pads to ${paddedHex}, ${padded} erase-aligned`,
  flashImageButton: "Write image",
  // Footer bar (Write.dc.html).
  footerSummary: "Writes a raw image. No patching, no layout changes.",
  modalTitle: "Flash this image?",
  modalConfirmText: "Flash",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `Plan: bank${bank} (${base}) + ${offset} ← ${filename} (${size} B, padded → ${padded}). ` +
    `Don't unplug your device until it finishes.`,
  phaseFlashingImage: "Flashing image",
  extIntWordExt: "ext",
  extIntWordInt: "int",
} as const;

export type FlashSectionStrings = Widen<typeof flashSectionEn>;

// eraseSection: EraseSection.svelte — "Erase Flash" (select partitions to erase).
export const eraseSectionEn = {
  scanningDevice: "Scanning device…",
  enterRecoveryMode: "Enter Recovery Mode",
  intro: "Select partitions to wipe. This cannot be undone.",
  internalFlashTitle: "Internal flash",
  externalFlashTitle: "External flash",
  barHint: "Click partitions to select. Ctrl / Cmd for more than one.",
  customRange: "Custom range…",
  lockedNotice: "🔒 Internal flash is locked, so erasing it unlocks the device first, which erases both flashes anyway. (External flash stays erasable.)",
  selectedTitle: "Selected",
  bankWipeWarning: "Erasing an internal bank wipes the OS on it, stock firmware or Retro-Go.",
  eraseButton: (count: number, plural: boolean) => `Erase ${count} partition${plural ? "s" : ""}…`,
  // Footer bar (Erase.dc.html) — the size is device-derived, so it stays an argument.
  footerSummary: (size: string) => `${size} will be erased. This cannot be undone.`,
  modalTitle: (count: number, plural: boolean) => `Erase ${count} partition${plural ? "s" : ""}?`,
  modalBody: (plural: boolean) =>
    `This will permanently erase the selected partition${plural ? "s" : ""} by filling them with 0xFF. Any data or firmware on them will be lost.`,
  modalConfirmText: "Erase",
  phaseErase: "Erase",
  phaseRescan: "Rescan device",
  partitionAtFallback: (addr: string) => `partition at ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `flash: erasing ${label}, ${size} B at ${addr}`,
  partitionFallback: "partition",
  rescanningLog: `device: rescanning geometry`,
  selectedSizeAt: (size: string, addr: string) => `${size} bytes at ${addr}`,
} as const;

export type EraseSectionStrings = Widen<typeof eraseSectionEn>;

// fileBrowserSection: FileBrowserSection.svelte — read-only LittleFS/FrogFS file browser.
export const fileBrowserSectionEn = {
  intro: "Pick a partition above to read its contents.",
  frogfsTitle: "Games, homebrew (FrogFS)",
  internalFlashTitle: "Internal flash",
  externalFlashTitle: "External flash",
  littlefsTitle: "Cores, saves (LittleFS)",
  noFrogfsFiles: "No files found in FrogFS.",
  noLittlefsFiles: "No files found in LittleFS.",
  readingLittlefs: (pct: number) => `reading ${pct}%`,
  browserNotAvailable: (kind: string) => `File browser not available for ${kind}.`,
  downloadTitle: (path: string) => `Download ${path} from the device`,
  downloadNeedsRecovery: "Enter Recovery Mode to download files.",
  downloadFailed: (err: string) => `Download failed: ${err}`,
  // Footer bar (FileBrowser.dc.html).
  footerSummary: "Click a file to download it from the device.",
  footerSummaryFrogfs: "Read from the device. Download is available on LittleFS only.",
} as const;

export type FileBrowserSectionStrings = Widen<typeof fileBrowserSectionEn>;

// retroGoTab: RetroGoTab.svelte — the Firmware Setup tab shell (group headings + section titles).
export const retroGoTabEn = {
  firmwareManagementHeading: "Firmware management",
  flashManagementHeading: "Flash management",
  railWriteImage: "Write image",
  railDump: "Dump",
  railErase: "Erase",
  backupAndPatchTitle: "Backup & patch",
  installRetroGoTitle: "Install Retro-Go",
  reinstallRetroGoTitle: "Reinstall Retro-Go",
  upgradeRetroGoTitle: "Upgrade Retro-Go",
  fileBrowserTitle: "File browser",
  // The rail pane page subtitle (Firmware.dc.html:82) — bank number and version are
  // device-derived, so they stay arguments.
  currentlyOnBank: (bank: string, version: string) => `Currently on bank ${bank}, ${version}.`,
  scanningDevice: "Scanning device…",
  enterRecoveryMode: "Enter Recovery Mode",
} as const;

export type RetroGoTabStrings = Widen<typeof retroGoTabEn>;



