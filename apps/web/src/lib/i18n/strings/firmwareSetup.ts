import type { Widen } from "../widen.js";

// Firmware Setup area: the tab shell (views/Advanced.svelte) + its two sub-flows,
// OfficialFirmwareSection.svelte (stock Backup & Patch) and RomSection.svelte (Install/
// Reinstall Retro-Go, DATA-HEAVY — only static chrome is here, not live version/bank/size
// values). Batch 4b (a separate pass) adds sibling top-level keys to this same file for
// DumpSection/FlashSection/EraseSection/FileBrowserSection/RetroGoTab/ExpertCorner/
// DeferredSection — don't assume this file belongs to one feature area forever.
//
// Runtime/device-derived substrings (model labels, version tags, byte/MiB counts, bank
// numbers, hex addresses, filenames, caught-error messages) stay as function args or inline
// in the .svelte files — only literal surrounding copy lives here.
export const advancedEn = {
  tabbarLabel: "Advanced tools",
  tabOverview: "Overview",
  tabFirmwareSetup: "Firmware Setup",
  tabRoms: "ROMs",
  waitingForDevice: "Waiting for a device connection…",
  modeGuidedSetup: "Guided Setup",
  modeAdvanced: "Advanced",
  expertHeading: "Expert",
  backToAdvanced: "← Back to Advanced",
} as const;

export type AdvancedStrings = Widen<typeof advancedEn>;

export const advancedDe: AdvancedStrings = {
  tabbarLabel: "Erweiterte Werkzeuge",
  tabOverview: "Übersicht",
  tabFirmwareSetup: "Firmware-Einrichtung",
  tabRoms: "ROMs",
  waitingForDevice: "Warten auf eine Geräteverbindung…",
  modeGuidedSetup: "Einfach",
  modeAdvanced: "Erweitert",
  expertHeading: "Experte",
  backToAdvanced: "← Zurück zu Erweitert",
};

export const officialFirmwareEn = {
  step1Title: "Firmware Backup",
  chromiumRequired: "Folder selection needs a Chromium browser (same as WebUSB).",
  pickFolderIntro: "Pick a folder holding your stock backups, or an empty folder to save a backup.",
  pickFolderLookForPre: "We look for",
  pickFolderBodyPost: "and validate them.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "Choose a different folder",
  chooseBackupFolder: "Choose backup folder",
  reconnectLastFolder: "Reconnect last folder",
  backupsFoundLegend: (plural: boolean) => `Stock backup${plural ? "s" : ""} found in this folder`,
  validChip: "✓ valid",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ invalid (int ${internalOk ? "✓" : "✗"} · ext ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Valid ${model} stock backup selected.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `The ${model} backup failed validation (internal ${internalOk ? "✓" : "✗"} · external ${externalOk ? "✓" : "✗"}). Take a fresh backup below.`,
  noBackupYet: "No stock backup in this folder yet — back one up from the connected device.",
  alreadyPatchedNoticePre: "This device is already running",
  alreadyPatchedNoticeBold: "patched Retro-Go",
  alreadyPatchedNoticePost:
    "firmware, so there's no stock firmware on it to back up. To install a",
  alreadyPatchedNoticeDifferentBold: "different",
  alreadyPatchedNoticeEnd:
    "official firmware (e.g. Mario ↔ Zelda), choose a folder above that holds a Mario or Zelda stock backup, then patch it below.",
  unlockDeviceLabel: "Unlock device",
  unlockDeviceHint: "(removes RDP read-protection — required to read a locked device)",
  backingUp: "Backing up…",
  backUpNow: "Back up now",
  connectToBackUp: "Connect a device to back up.",
  optInToUnlock: "Opt in to unlock to back up a locked device.",
  step2Title: "Patch firmware",
  step2Body: (model: string) =>
    `Patches the ${model} stock firmware to support dual-boot with Retro-Go.`,
  installBootloaderLabel: "Install bootloader",
  installBootloaderHint: "(recommended)",
  crossModelDangerBold: "⚠ Cross-model:",
  crossModelDangerBody:
    "this is Zelda firmware, but the connected hardware scanned as Mario. Mario hardware lacks two of the buttons Zelda needs — the result may be partly unusable.",
  crossModelAck: "I understand and want to flash Zelda firmware onto Mario hardware anyway",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `Note: backup is ${backupModel} firmware on ${deviceModel} hardware — allowed.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ This ${model} backup's external image (${backupMb} MB) is larger than this device's external flash (${deviceMb} MB) — it physically won't fit and can't be flashed here.`,
  enteringRecoveryMode: "Entering Recovery Mode…",
  enterRecoveryMode: "Enter Recovery Mode",
  patchFirmwareButton: "Patch firmware",
  connectToPatchAndFlash: "Connect a device to patch + flash.",
  patchedAndFlashed: "✓ Patched + flashed.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Patches the ${model} stock firmware${withBootloader ? " (with the SD-card bootloader)" : ""} and flashes it: internal → bank 1, external → bank 0. Do not move or unplug the device during the write — it can fail the flash.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ You are flashing ZELDA firmware onto MARIO hardware, which lacks two of the buttons Zelda needs. ${base}`,
  modalTitle: "Patch + flash official firmware?",
  modalConfirmText: "Patch & flash",
  phasePatch: "Patch firmware",
  phaseFlashInternal: "Flash internal (bank 1)",
  phaseFlashExternal: "Flash external",
  phaseRescan: "Rescan device",
  errDeviceLocked: 'Device is locked (RDP read-protection). Check "Unlock device" to remove it before backing up.',
  errFirmwareMismatch: "The dumped firmware doesn't match a known stock Mario/Zelda ROM — backup not saved.",
  logPatchingModel: (model: string) => `Patching firmware for model: ${model}.`,
} as const;

export type OfficialFirmwareStrings = Widen<typeof officialFirmwareEn>;

export const officialFirmwareDe: OfficialFirmwareStrings = {
  step1Title: "Firmware-Backup",
  chromiumRequired: "Die Ordnerauswahl benötigt einen Chromium-Browser (wie WebUSB).",
  pickFolderIntro: "Wähle einen Ordner mit deinen Original-Backups oder einen leeren Ordner für ein neues Backup.",
  pickFolderLookForPre: "Wir suchen nach",
  pickFolderBodyPost: "und prüfen sie.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "Anderen Ordner auswählen",
  chooseBackupFolder: "Backup-Ordner auswählen",
  reconnectLastFolder: "Letzten Ordner erneut verbinden",
  backupsFoundLegend: (plural: boolean) => `Original-Backup${plural ? "s" : ""} in diesem Ordner gefunden`,
  validChip: "✓ gültig",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ ungültig (int ${internalOk ? "✓" : "✗"} · ext ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Gültiges ${model}-Original-Backup ausgewählt.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `Die Prüfung des ${model}-Backups ist fehlgeschlagen (intern ${internalOk ? "✓" : "✗"} · extern ${externalOk ? "✓" : "✗"}). Erstelle unten ein neues Backup.`,
  noBackupYet: "Noch kein Original-Backup in diesem Ordner — erstelle unten eines vom verbundenen Gerät.",
  alreadyPatchedNoticePre: "Dieses Gerät läuft bereits mit",
  alreadyPatchedNoticeBold: "gepatchtem Retro-Go",
  alreadyPatchedNoticePost:
    "— es gibt also keine Original-Firmware darauf, die gesichert werden könnte. Um eine",
  alreadyPatchedNoticeDifferentBold: "andere",
  alreadyPatchedNoticeEnd:
    "offizielle Firmware zu installieren (z. B. Mario ↔ Zelda), wähle oben einen Ordner mit einem Mario- oder Zelda-Original-Backup und patche es anschließend unten.",
  unlockDeviceLabel: "Gerät entsperren",
  unlockDeviceHint: "(entfernt den RDP-Leseschutz — erforderlich, um ein gesperrtes Gerät auszulesen)",
  backingUp: "Backup wird erstellt…",
  backUpNow: "Jetzt sichern",
  connectToBackUp: "Verbinde ein Gerät, um ein Backup zu erstellen.",
  optInToUnlock: "Entsperrung aktivieren, um ein gesperrtes Gerät zu sichern.",
  step2Title: "Firmware patchen",
  step2Body: (model: string) =>
    `Patcht die ${model}-Original-Firmware, damit Dual-Boot mit Retro-Go möglich ist.`,
  installBootloaderLabel: "Bootloader installieren",
  installBootloaderHint: "(empfohlen)",
  crossModelDangerBold: "⚠ Modell-Konflikt:",
  crossModelDangerBody:
    "Dies ist Zelda-Firmware, aber die verbundene Hardware wurde als Mario erkannt. Mario-Hardware besitzt zwei der für Zelda benötigten Tasten nicht — das Ergebnis kann teilweise unbrauchbar sein.",
  crossModelAck: "Ich verstehe das Risiko und möchte Zelda-Firmware trotzdem auf Mario-Hardware flashen",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `Hinweis: Backup ist ${backupModel}-Firmware auf ${deviceModel}-Hardware — das ist zulässig.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ Das externe Image dieses ${model}-Backups (${backupMb} MB) ist größer als der externe Flash-Speicher dieses Geräts (${deviceMb} MB) — es passt schlicht nicht und kann hier nicht geflasht werden.`,
  enteringRecoveryMode: "Recovery-Modus wird gestartet…",
  enterRecoveryMode: "Recovery-Modus starten",
  patchFirmwareButton: "Firmware patchen",
  connectToPatchAndFlash: "Verbinde ein Gerät, um zu patchen und zu flashen.",
  patchedAndFlashed: "✓ Gepatcht und geflasht.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Patcht die ${model}-Original-Firmware${withBootloader ? " (mit SD-Karten-Bootloader)" : ""} und flasht sie: intern → Bank 1, extern → Bank 0. Das Gerät während des Schreibvorgangs nicht bewegen oder vom Strom trennen — sonst kann der Flash-Vorgang fehlschlagen.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ Du flashst ZELDA-Firmware auf MARIO-Hardware, der zwei der für Zelda benötigten Tasten fehlen. ${base}`,
  modalTitle: "Offizielle Firmware patchen und flashen?",
  modalConfirmText: "Patchen & flashen",
  phasePatch: "Firmware patchen",
  phaseFlashInternal: "Internen Speicher flashen (Bank 1)",
  phaseFlashExternal: "Externen Speicher flashen",
  phaseRescan: "Gerät erneut scannen",
  errDeviceLocked: 'Das Gerät ist gesperrt (RDP-Leseschutz). Aktiviere „Gerät entsperren“, um den Schutz vor dem Backup zu entfernen.',
  errFirmwareMismatch: "Die ausgelesene Firmware entspricht keiner bekannten Mario-/Zelda-Original-ROM — Backup wurde nicht gespeichert.",
  logPatchingModel: (model: string) => `Firmware wird gepatcht für Modell: ${model}.`,
};

// romSection: static chrome only (this component is heavily data-driven — banks, versions,
// byte counts, hex offsets never move into the string table, they're passed as args or left
// inline as before).
export const romSectionEn = {
  regionIntflash: "Internal firmware",
  regionFrogfs: "Games, BIOS, Languages",
  regionLittlefs: "Emulators, Saves",
  phasePrepare: "Prepare device",
  phaseDownload: "Download firmware",
  phaseMigrateScan: "Read existing device state",
  subFrogfsState: "Read previous game state",
  subLfsExtract: "Extract emulators/saves data",
  subGamesMigrate: "Migrate installed games",
  phasePrepareInstallImage: "Prepare install image",
  subSdCache: "Set SD cache reserved-offset boundary",
  phaseBuildInstallImage: "Build install image",
  subBuildFrogfs: "Build games, BIOS, languages image",
  subBuildLittlefs: "Build emulators/saves image",
  subPatchSuperblock: "Patch superblock",
  phaseFlashingToDevice: "Flashing to device",
  phaseRescan: "Rescan device",
  phaseSyncSdCores: "Sync cores to SD card",
  chooseSdCard: "Choose SD Card",
  flashRetroGo: "Flash Retro-Go",
  flashInternalFirmware: "Flash Internal Firmware",
  flashGamesBiosLanguages: "Flash Games, BIOS, Languages",
  flashEmulatorsSaves: "Flash Emulators, Saves",
  flashThisInstall: "Flash this install?",
  flashRegions: (joined: string) => `Flash ${joined}?`,
  regionInternalFirmware: "internal firmware",
  regionGamesBiosLanguages: "games, BIOS, languages",
  regionEmulatorsSaves: "emulators, saves",
  flashBody: (writes: string) => `Writes: ${writes}. Don't unplug your device until it finishes.`,
  nameInternalFirmware: (bank: number) => `internal firmware → bank ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `games, BIOS, languages → ext ${addr}`,
  nameEmulatorsSaves: (addr: string) => `emulators, saves → ext ${addr}`,
  flashConfirmText: "Flash",
  selectSdCard: "Select SD Card",
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "No firmware versions are published yet.",
  logDownloadingBundle: (tag: string) => `Downloading firmware bundle ${tag}…`,
  logBundleDownloaded: (tag: string, mib: string) => `Bundle ${tag} downloaded (${mib} MiB).`,
  logSameVersionRepair: (tag: string) => `Same-version repair (${tag}) — forcing games migration on.`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) =>
    `Target version: ${tag}. Migrate games: ${migrateGames}, migrate saves/settings: ${migrateLfs}.`,
  logReadPreviousGameState: "Read previous game state.",
  logCouldNotReadPreviousGameState: "Could not read previous game state (continuing).",
  logExtractedSavesData: (count: number) => `Extracted emulators/saves data for migration (${count} entries).`,
  logCouldNotExtractSavesData: "Could not extract emulators/saves data for migration (continuing).",
  logMigratedGames: (count: number) => `Migrated ${count} installed game(s).`,
  logSkippedGameMigration: "Skipping game migration (not requested or none installed).",
  logGamesBiosLanguagesBuilt: "Games, BIOS, languages image built.",
  logEmulatorsSavesBuilt: "Emulators/saves image built.",
  logSuperblockPatched: "Superblock patched into intflash blob.",
  logSdCacheBoundarySet: (offset: number) =>
    `SD cache reserved-offset set to ${offset} bytes (keeps the round-robin ROM cache clear of existing reserved/OFW data).`,
  logConfirmingLinkResponsive: "Confirming link is responsive…",
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `External payload (${payloadMb} MB) exceeds this device's external flash (${deviceMb} MB) — can't flash.`,
  logRescanning: "Rescanning device geometry and installed games…",
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Install version",
  migrateGamesLabel: "Migrate games",
  migrateSavesLabel: "Migrate saves and settings",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `Install target: bank ${bank} ${dualBoot ? "(dual-boot, stock kept)" : "(overwrites stock)"}`,
  retroGoOnlyNotice:
    "Bank 1 has no stock firmware detected, so the inferred target is bank 1 — this will be a Retro-Go-only install (no dual-boot).",
  bank1StockOfwNotice:
    'Bank 1 has stock, unpatched firmware — you won\'t be able to reach Retro-Go until it\'s patched (see "Backup & Patch" above).',
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `Device looks like a ${deviceBuild} build. You're viewing ${viewingMode} mode.`,
  layoutAdvancedToggle: "Layout (advanced)",
  sdCacheOffsetLabel: "SD Cache offset",
  frogfsOffsetLabel: "FrogFS offset",
  offsetHint: "(bytes from 0x90000000; reserves the bottom)",
  autoPlaceholder: (hex: string) => `auto (${hex})`,
  littlefsSizeLabel: "LittleFS size",
  littlefsSizeHint: "(≥8 MiB)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `Default: FrogFS offset automatically reserves the bottom based on device layout. Both round up to the ${blockSize} B erase block.`,
  scanningProgress: (pct: number) => `Scanning… ${pct}%`,
  scanFailed: (err: string) => `scan failed: ${err}`,
  scanToSeeLayout: "Scan the device to see its current flash layout.",
  connectToSizeAndFlash: "Connect a device to size and flash the install.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range} · ${mib} MiB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range} · ${mib} MiB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `device end ${devEnd} · block ${blockSize} B · free ${freeMib} MiB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `checks: ends-at-chip ${endsAtChip ? "✓" : "✗"} · no-overlap ${noOverlap ? "✓" : "✗"} · aligned ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `systems: ${systems || "(none)"}`,
  startBankLabel: (bank: number) => `Start bank ${bank}`,
  readBackSuperblockDebug: "Read back superblock (debug)",
  chipTextFlashing: "flashing",
  chipTextInstalled: "✓ installed",
  chipTextFileCount: (count: number) => `${count} files`,
  chipTextIdle: "idle",
  startedBankResult: (bank: number) =>
    `Started bank ${bank}. The device is now running that firmware — the stub is no longer active; reconnect or power-cycle to use the app again.`,
} as const;

export type RomSectionStrings = Widen<typeof romSectionEn>;

// dumpSection: DumpSection.svelte — "Dump Flash" (read any region of any bank to a file).
export const dumpSectionEn = {
  title: "Dump Flash",
  scanningDevice: "Scanning device…",
  intro: "Read any region of any bank to a downloaded file. You can cancel mid-read.",
  internalFlashTitle: "Internal Flash",
  externalFlashTitle: "External Flash",
  bankLabel: "Bank",
  offsetLabel: "Offset",
  offsetPlaceholder: "0x0",
  lengthLabel: "Length",
  lengthPlaceholder: "whole region",
  quickFillWholeRegion: "Whole region",
  quickFill128Kib: "128 KiB",
  quickFill1Mib: "1 MiB",
  quickFillStockOfw: "Stock OFW intflash (0–0x20000)",
  lockedNotice:
    "🔒 Internal flash is unreadable while the device is locked — unlocking happens automatically " +
    "during Easy setup’s backup step. (Bank 0 / external stays readable.)",
  lengthBlankHint: "Length blank = whole region from offset.",
  planLine: (from: string, to: string) => `Plan: ${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes} bytes → ${filename}`,
  overrunWarning: (clamped: string) => `Length exceeds region; will clamp to ${clamped} bytes.`,
  enterRecoveryMode: "Enter Recovery Mode",
  dumpToFile: "Dump to file",
  invalidHint: "Enter a valid offset and length.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "Cancel",
  cancelHint: "A read is non-destructive — cancel discards the partial dump (no file).",
  readingPct: (pct: number) => `reading ${pct}%`,
  lockedChip: "locked",
  canceledChip: "canceled",
  errorChip: "error",
  resultSummary: (mib: string, secs: number) => `${mib} MiB read in ${secs} s`,
} as const;

export type DumpSectionStrings = Widen<typeof dumpSectionEn>;

export const dumpSectionDe: DumpSectionStrings = {
  title: "Flash auslesen",
  scanningDevice: "Gerät wird gescannt…",
  intro: "Lies einen beliebigen Bereich jeder Bank in eine heruntergeladene Datei. Du kannst das Auslesen jederzeit abbrechen.",
  internalFlashTitle: "Interner Flash-Speicher",
  externalFlashTitle: "Externer Flash-Speicher",
  bankLabel: "Bank",
  offsetLabel: "Offset",
  offsetPlaceholder: "0x0",
  lengthLabel: "Länge",
  lengthPlaceholder: "gesamter Bereich",
  quickFillWholeRegion: "Gesamter Bereich",
  quickFill128Kib: "128 KiB",
  quickFill1Mib: "1 MiB",
  quickFillStockOfw: "Original-OFW-Intflash (0–0x20000)",
  lockedNotice:
    "🔒 Der interne Flash-Speicher kann bei gesperrtem Gerät nicht gelesen werden — die Entsperrung erfolgt automatisch " +
    "im Backup-Schritt der einfachen Einrichtung. (Bank 0 / extern bleibt lesbar.)",
  lengthBlankHint: "Länge leer lassen = gesamter Bereich ab dem Offset.",
  planLine: (from: string, to: string) => `Plan: ${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes} Bytes → ${filename}`,
  overrunWarning: (clamped: string) => `Länge überschreitet den Bereich; wird auf ${clamped} Bytes begrenzt.`,
  enterRecoveryMode: "Recovery-Modus starten",
  dumpToFile: "In Datei auslesen",
  invalidHint: "Gib einen gültigen Offset und eine gültige Länge ein.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "Abbrechen",
  cancelHint: "Ein Lesevorgang ist zerstörungsfrei — „Abbrechen“ verwirft nur den unvollständigen Dump (keine Datei).",
  readingPct: (pct: number) => `Lesen ${pct} %`,
  lockedChip: "gesperrt",
  canceledChip: "abgebrochen",
  errorChip: "Fehler",
  resultSummary: (mib: string, secs: number) => `${mib} MiB in ${secs} s gelesen`,
};

// flashSection: FlashSection.svelte — "Write Flash" (write an arbitrary image to any bank/offset).
export const flashSectionEn = {
  title: "Write Flash",
  scanningDevice: "Scanning device…",
  enterRecoveryMode: "Enter Recovery Mode",
  intro: "Write an arbitrary image to any bank/offset. You confirm before it writes.",
  imageFileLabel: "Image file",
  chooseImage: "Choose image",
  bankLabel: "Bank",
  offsetLabel: "Offset",
  offsetPlaceholder: "0x0",
  transferOptions: "Transfer options",
  compressLabel: "LZMA compress",
  compressHint: "(faster transfer; device decompresses; auto-skips if it doesn’t help)",
  verifyLabel: "Verify writes",
  verifyHint: "(read back each buffer to catch probe corruption; slower)",
  lockedNotice:
    "🔒 Internal flash is locked — a locked device rejects writes. Unlocking happens automatically " +
    "during Easy setup’s backup step. (Bank 0 / external stays writable.)",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `Plan: bank${bank} (${base}) + ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} B → padded ${padded} B (${paddedHex})`,
  alignWarning: (align: number, kind: string) => `Offset must be a multiple of ${align} (${kind}flash alignment).`,
  overrunWarning: (region: string) => `Image overruns the ${region} B region.`,
  ackLabel: "I understand this overwrites the firmware bank; I have a backup.",
  flashImageButton: "Flash image…",
  modalTitle: "Flash this image?",
  modalConfirmText: "Flash",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `Plan: bank${bank} (${base}) + ${offset} ← ${filename} (${size} B, padded → ${padded}). ` +
    `Don't unplug your device until it finishes.`,
  phaseFlashingImage: "Flashing image",
  writingChip: "writing",
  lockedChip: "locked",
  extIntWordExt: "ext",
  extIntWordInt: "int",
} as const;

export type FlashSectionStrings = Widen<typeof flashSectionEn>;

export const flashSectionDe: FlashSectionStrings = {
  title: "Flash beschreiben",
  scanningDevice: "Gerät wird gescannt…",
  enterRecoveryMode: "Recovery-Modus starten",
  intro: "Schreibe ein beliebiges Image an eine beliebige Bank/Offset-Position. Vor dem Schreiben wird um Bestätigung gebeten.",
  imageFileLabel: "Image-Datei",
  chooseImage: "Image auswählen",
  bankLabel: "Bank",
  offsetLabel: "Offset",
  offsetPlaceholder: "0x0",
  transferOptions: "Übertragungsoptionen",
  compressLabel: "LZMA-Kompression",
  compressHint: "(schnellere Übertragung; das Gerät dekomprimiert; wird automatisch übersprungen, wenn sie nichts bringt)",
  verifyLabel: "Schreibvorgänge prüfen",
  verifyHint: "(liest jeden Puffer zurück, um Übertragungsfehler zu erkennen; langsamer)",
  lockedNotice:
    "🔒 Der interne Flash-Speicher ist gesperrt — ein gesperrtes Gerät lehnt Schreibvorgänge ab. Die Entsperrung erfolgt automatisch " +
    "im Backup-Schritt der einfachen Einrichtung. (Bank 0 / extern bleibt beschreibbar.)",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `Plan: Bank ${bank} (${base}) + ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} B → aufgefüllt auf ${padded} B (${paddedHex})`,
  alignWarning: (align: number, kind: string) => `Offset muss ein Vielfaches von ${align} sein (${kind}flash-Ausrichtung).`,
  overrunWarning: (region: string) => `Image überschreitet den ${region}-B-Bereich.`,
  ackLabel: "Mir ist bewusst, dass dies die Firmware-Bank überschreibt; ich habe ein Backup.",
  flashImageButton: "Image flashen…",
  modalTitle: "Dieses Image flashen?",
  modalConfirmText: "Flashen",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `Plan: Bank ${bank} (${base}) + ${offset} ← ${filename} (${size} B, aufgefüllt → ${padded}). ` +
    `Trenne das Gerät nicht vom Strom, bis der Vorgang abgeschlossen ist.`,
  phaseFlashingImage: "Image wird geflasht",
  writingChip: "wird geschrieben",
  lockedChip: "gesperrt",
  extIntWordExt: "ext",
  extIntWordInt: "int",
};

// eraseSection: EraseSection.svelte — "Erase Flash" (select partitions to erase).
export const eraseSectionEn = {
  title: "Erase Flash",
  scanningDevice: "Scanning device…",
  enterRecoveryMode: "Enter Recovery Mode",
  intro: "Click a partition below to select it for erasure. Hold Ctrl/Cmd to select multiple partitions.",
  internalFlashTitle: "Internal Flash",
  externalFlashTitle: "External Flash",
  lockedNotice:
    "🔒 Internal flash is locked — a locked device rejects writes. Unlocking happens automatically " +
    "during Easy setup’s backup step. (External flash stays erasable.)",
  selectedTitle: "Selected:",
  bankWipeWarning: "Warning: Erasing an internal bank may wipe the operating system (stock or Retro-Go)!",
  eraseButton: (plural: boolean) => `Erase partition${plural ? "s" : ""}…`,
  modalTitle: (count: number, plural: boolean) => `Erase ${count} partition${plural ? "s" : ""}?`,
  modalBody: (plural: boolean) =>
    `This will permanently erase the selected partition${plural ? "s" : ""} by filling them with 0xFF. Any data or firmware on them will be lost.`,
  modalConfirmText: "Erase",
  phaseErase: "Erase",
  phaseRescan: "Rescan device",
  partitionAtFallback: (addr: string) => `partition at ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `Erasing ${label} (${size} B at ${addr})…`,
  partitionFallback: "partition",
  rescanningLog: "Rescanning device geometry…",
  erasingChip: "erasing",
  lockedChip: "locked",
  selectedSizeAt: (size: string, addr: string) => `(${size} bytes at ${addr})`,
} as const;

export type EraseSectionStrings = Widen<typeof eraseSectionEn>;

export const eraseSectionDe: EraseSectionStrings = {
  title: "Flash löschen",
  scanningDevice: "Gerät wird gescannt…",
  enterRecoveryMode: "Recovery-Modus starten",
  intro: "Klicke auf eine Partition unten, um sie zum Löschen auszuwählen. Halte Strg/Cmd gedrückt, um mehrere Partitionen auszuwählen.",
  internalFlashTitle: "Interner Flash-Speicher",
  externalFlashTitle: "Externer Flash-Speicher",
  lockedNotice:
    "🔒 Der interne Flash-Speicher ist gesperrt — ein gesperrtes Gerät lehnt Schreibvorgänge ab. Die Entsperrung erfolgt automatisch " +
    "im Backup-Schritt der einfachen Einrichtung. (Externer Flash-Speicher bleibt löschbar.)",
  selectedTitle: "Ausgewählt:",
  bankWipeWarning: "Achtung: Das Löschen einer internen Bank kann das Betriebssystem (Original oder Retro-Go) unbrauchbar machen!",
  eraseButton: (plural: boolean) => `Partition${plural ? "en" : ""} löschen…`,
  modalTitle: (count: number, plural: boolean) => `${count} Partition${plural ? "en" : ""} löschen?`,
  modalBody: (plural: boolean) =>
    `Dies löscht die ausgewählte${plural ? "n" : ""} Partition${plural ? "en" : ""} dauerhaft, indem sie mit 0xFF gefüllt werden. Alle darauf befindlichen Daten oder Firmware gehen verloren.`,
  modalConfirmText: "Löschen",
  phaseErase: "Löschen",
  phaseRescan: "Gerät erneut scannen",
  partitionAtFallback: (addr: string) => `Partition bei ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `${label} wird gelöscht (${size} B bei ${addr})…`,
  partitionFallback: "Partition",
  rescanningLog: "Gerätegeometrie wird erneut gescannt…",
  erasingChip: "wird gelöscht",
  lockedChip: "gesperrt",
  selectedSizeAt: (size: string, addr: string) => `(${size} Bytes bei ${addr})`,
};

// fileBrowserSection: FileBrowserSection.svelte — read-only LittleFS/FrogFS file browser.
export const fileBrowserSectionEn = {
  intro: "Select a filesystem partition on the bar below to view its files.",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "No files found in FrogFS.",
  noLittlefsFiles: "No files found in LittleFS.",
  readingLittlefs: (pct: number) => `Reading LittleFS partition over SWD (${pct}%)...`,
  browserNotAvailable: (kind: string) => `File browser not available for ${kind}.`,
} as const;

export type FileBrowserSectionStrings = Widen<typeof fileBrowserSectionEn>;

export const fileBrowserSectionDe: FileBrowserSectionStrings = {
  intro: "Wähle unten eine Dateisystem-Partition aus, um ihre Dateien anzuzeigen.",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "Keine Dateien in FrogFS gefunden.",
  noLittlefsFiles: "Keine Dateien in LittleFS gefunden.",
  readingLittlefs: (pct: number) => `LittleFS-Partition wird über SWD gelesen (${pct} %) …`,
  browserNotAvailable: (kind: string) => `Für ${kind} steht kein Dateibrowser zur Verfügung.`,
};

// retroGoTab: RetroGoTab.svelte — the Firmware Setup tab shell (group headings + section titles).
export const retroGoTabEn = {
  officialFirmwareHeading: "Official Firmware",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "Flash management",
  backupAndPatchTitle: "Backup & Patch",
  installRetroGoTitle: "Install Retro-Go",
  reinstallRetroGoTitle: "Reinstall Retro-Go",
  fileBrowserTitle: "File Browser",
  scanningDevice: "Scanning device…",
  enterRecoveryMode: "Enter Recovery Mode",
} as const;

export type RetroGoTabStrings = Widen<typeof retroGoTabEn>;

export const retroGoTabDe: RetroGoTabStrings = {
  officialFirmwareHeading: "Offizielle Firmware",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "Flash-Verwaltung",
  backupAndPatchTitle: "Backup & Patch",
  installRetroGoTitle: "Retro-Go installieren",
  reinstallRetroGoTitle: "Retro-Go erneut installieren",
  fileBrowserTitle: "Dateibrowser",
  scanningDevice: "Gerät wird gescannt…",
  enterRecoveryMode: "Recovery-Modus starten",
};

// expertCorner: ExpertCorner.svelte — the deliberately-hidden #expert surface (deferred panels).
export const expertCornerEn = {
  warnBanner:
    "Expert surface — almost nobody needs anything here. These controls are dangerous or " +
    "pointless for most users and are kept only so the capability isn’t lost.",
  manualRelockTitle: "Manual re-lock",
  manualRelockChip: "not yet available",
  manualRelockWill: "Re-enable read-out protection (RDP) on the device. The single place lock is a deliberate action.",
  manualRelockNeeds: "the power-cycle handshake; GnwFlasher.lock() is notImplemented. Will ship behind a typed acknowledgement + blocking confirm.",
  relockButton: "Re-lock device…",
  rawPatchTitle: "Raw firmware patch options",
  rawPatchChip: "expert / unsupported",
  rawPatchWill: "Exposes the underlying patcher's full option schema directly, passed through as-is with no validation — explicitly unsupported.",
  rawPatchNeedsBold: "You probably don’t need this.",
  rawPatchNeedsMid: "The knob-free",
  rawPatchNeedsBody: "in Easy setup is what everyone should use. This panel only exists so the capability isn’t lost.",
  patchWithOptionsButton: "Patch with options…",
} as const;

export type ExpertCornerStrings = Widen<typeof expertCornerEn>;

export const expertCornerDe: ExpertCornerStrings = {
  warnBanner:
    "Experten-Bereich — fast niemand braucht irgendetwas hiervon. Diese Optionen sind für die meisten Nutzer " +
    "gefährlich oder nutzlos und werden nur vorgehalten, damit die Funktion nicht verloren geht.",
  manualRelockTitle: "Manuelles erneutes Sperren",
  manualRelockChip: "noch nicht verfügbar",
  manualRelockWill: "Aktiviert den Leseschutz (RDP) auf dem Gerät erneut. Diese einzige Sperrstelle ist eine bewusste Entscheidung.",
  manualRelockNeeds: "das Power-Cycle-Handshake; GnwFlasher.lock() ist noch nicht implementiert. Erscheint hinter einer typisierten Bestätigung + blockierendem Dialog.",
  relockButton: "Gerät erneut sperren…",
  rawPatchTitle: "Rohe Firmware-Patch-Optionen",
  rawPatchChip: "Experte / nicht unterstützt",
  rawPatchWill: "Legt das vollständige Options-Schema des zugrunde liegenden Patchers offen, unverändert und ohne Prüfung weitergereicht — ausdrücklich nicht unterstützt.",
  rawPatchNeedsBold: "Das brauchst du vermutlich nicht.",
  rawPatchNeedsMid: "Das optionslose",
  rawPatchNeedsBody: "in der einfachen Einrichtung ist das, was jeder verwenden sollte. Dieses Panel existiert nur, damit die Funktion nicht verloren geht.",
  patchWithOptionsButton: "Mit Optionen patchen…",
};

// deferredSection: DeferredSection.svelte — the generic honest-deferred-panel component's own
// literal chrome (the `will`/`needs`/`control` copy is caller-supplied, not here).
export const deferredSectionEn = {
  defaultChipText: "not yet available",
  comingSoon: "Coming soon",
  needsLabel: "Needs:",
} as const;

export type DeferredSectionStrings = Widen<typeof deferredSectionEn>;

export const deferredSectionDe: DeferredSectionStrings = {
  defaultChipText: "noch nicht verfügbar",
  comingSoon: "Demnächst verfügbar",
  needsLabel: "Benötigt:",
};

export const romSectionDe: RomSectionStrings = {
  regionIntflash: "Interne Firmware",
  regionFrogfs: "Spiele, BIOS, Sprachen",
  regionLittlefs: "Emulatoren, Spielstände",
  phasePrepare: "Gerät vorbereiten",
  phaseDownload: "Firmware herunterladen",
  phaseMigrateScan: "Vorhandenen Gerätezustand lesen",
  subFrogfsState: "Vorherigen Spielzustand lesen",
  subLfsExtract: "Emulator-/Spielstanddaten extrahieren",
  subGamesMigrate: "Installierte Spiele übernehmen",
  phasePrepareInstallImage: "Installations-Image vorbereiten",
  subSdCache: "SD-Cache-Reservierungsgrenze festlegen",
  phaseBuildInstallImage: "Installations-Image erstellen",
  subBuildFrogfs: "Spiele-, BIOS-, Sprachen-Image erstellen",
  subBuildLittlefs: "Emulator-/Spielstand-Image erstellen",
  subPatchSuperblock: "Superblock patchen",
  phaseFlashingToDevice: "Wird auf Gerät geflasht",
  phaseRescan: "Gerät erneut scannen",
  phaseSyncSdCores: "Emulatoren mit SD-Karte synchronisieren",
  chooseSdCard: "SD-Karte auswählen",
  flashRetroGo: "Retro-Go flashen",
  flashInternalFirmware: "Interne Firmware flashen",
  flashGamesBiosLanguages: "Spiele, BIOS, Sprachen flashen",
  flashEmulatorsSaves: "Emulatoren, Spielstände flashen",
  flashThisInstall: "Diese Installation flashen?",
  flashRegions: (joined: string) => `${joined} flashen?`,
  regionInternalFirmware: "interne Firmware",
  regionGamesBiosLanguages: "Spiele, BIOS, Sprachen",
  regionEmulatorsSaves: "Emulatoren, Spielstände",
  flashBody: (writes: string) => `Schreibvorgänge: ${writes}. Trenne das Gerät nicht vom Strom, bis der Vorgang abgeschlossen ist.`,
  nameInternalFirmware: (bank: number) => `interne Firmware → Bank ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `Spiele, BIOS, Sprachen → ext ${addr}`,
  nameEmulatorsSaves: (addr: string) => `Emulatoren, Spielstände → ext ${addr}`,
  flashConfirmText: "Flashen",
  selectSdCard: "SD-Karte auswählen",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "Es sind noch keine Firmware-Versionen veröffentlicht.",
  logDownloadingBundle: (tag: string) => `Downloading firmware bundle ${tag}…`,
  logBundleDownloaded: (tag: string, mib: string) => `Bundle ${tag} downloaded (${mib} MiB).`,
  logSameVersionRepair: (tag: string) => `Same-version repair (${tag}) — forcing games migration on.`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) =>
    `Target version: ${tag}. Migrate games: ${migrateGames}, migrate saves/settings: ${migrateLfs}.`,
  logReadPreviousGameState: "Read previous game state.",
  logCouldNotReadPreviousGameState: "Could not read previous game state (continuing).",
  logExtractedSavesData: (count: number) => `Extracted emulators/saves data for migration (${count} entries).`,
  logCouldNotExtractSavesData: "Could not extract emulators/saves data for migration (continuing).",
  logMigratedGames: (count: number) => `Migrated ${count} installed game(s).`,
  logSkippedGameMigration: "Skipping game migration (not requested or none installed).",
  logGamesBiosLanguagesBuilt: "Games, BIOS, languages image built.",
  logEmulatorsSavesBuilt: "Emulators/saves image built.",
  logSuperblockPatched: "Superblock patched into intflash blob.",
  logSdCacheBoundarySet: (offset: number) =>
    `SD cache reserved-offset set to ${offset} bytes (keeps the round-robin ROM cache clear of existing reserved/OFW data).`,
  logConfirmingLinkResponsive: "Confirming link is responsive…",
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `Externe Nutzlast (${payloadMb} MB) überschreitet den externen Flash-Speicher dieses Geräts (${deviceMb} MB) — Flashen nicht möglich.`,
  logRescanning: "Rescanning device geometry and installed games…",
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Zu installierende Version",
  migrateGamesLabel: "Spiele übernehmen",
  migrateSavesLabel: "Spielstände und Einstellungen übernehmen",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `Installationsziel: Bank ${bank} ${dualBoot ? "(Dual-Boot, Original bleibt erhalten)" : "(überschreibt Original)"}`,
  retroGoOnlyNotice:
    "Auf Bank 1 wurde keine Original-Firmware erkannt, daher ist das ermittelte Ziel Bank 1 — dies wird eine reine Retro-Go-Installation ohne Dual-Boot.",
  bank1StockOfwNotice:
    'Bank 1 enthält ungepatchte Original-Firmware — Retro-Go ist erst erreichbar, nachdem sie gepatcht wurde (siehe „Backup & Patch“ oben).',
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `Das Gerät scheint ein ${deviceBuild}-Build zu sein. Du betrachtest den ${viewingMode}-Modus.`,
  layoutAdvancedToggle: "Layout (erweitert)",
  sdCacheOffsetLabel: "SD-Cache-Offset",
  frogfsOffsetLabel: "FrogFS-Offset",
  offsetHint: "(Bytes ab 0x90000000; reserviert den unteren Bereich)",
  autoPlaceholder: (hex: string) => `automatisch (${hex})`,
  littlefsSizeLabel: "LittleFS-Größe",
  littlefsSizeHint: "(≥8 MiB)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `Standard: Der FrogFS-Offset reserviert den unteren Bereich automatisch anhand des Geräte-Layouts. Beide werden auf den ${blockSize}-B-Löschblock aufgerundet.`,
  scanningProgress: (pct: number) => `Wird gescannt… ${pct} %`,
  scanFailed: (err: string) => `Scan fehlgeschlagen: ${err}`,
  scanToSeeLayout: "Scanne das Gerät, um sein aktuelles Flash-Layout zu sehen.",
  connectToSizeAndFlash: "Verbinde ein Gerät, um die Installation zu bemessen und zu flashen.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range} · ${mib} MiB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range} · ${mib} MiB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `Geräteende ${devEnd} · Block ${blockSize} B · frei ${freeMib} MiB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `Prüfungen: endet-am-Chip ${endsAtChip ? "✓" : "✗"} · keine-Überlappung ${noOverlap ? "✓" : "✗"} · ausgerichtet ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `Systeme: ${systems || "(keine)"}`,
  startBankLabel: (bank: number) => `Bank ${bank} starten`,
  readBackSuperblockDebug: "Superblock zurücklesen (Debug)",
  chipTextFlashing: "wird geflasht",
  chipTextInstalled: "✓ installiert",
  chipTextFileCount: (count: number) => `${count} Dateien`,
  chipTextIdle: "inaktiv",
  startedBankResult: (bank: number) =>
    `Bank ${bank} gestartet. Das Gerät läuft nun mit dieser Firmware — der Stub ist nicht mehr aktiv; erneut verbinden oder das Gerät neu starten, um die App wieder zu nutzen.`,
};
