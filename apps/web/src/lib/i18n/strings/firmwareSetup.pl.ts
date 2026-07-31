import type { AdvancedStrings } from "./firmwareSetup.js";
import type { OfficialFirmwareStrings } from "./firmwareSetup.js";
import type { RomSectionStrings } from "./firmwareSetup.js";
import type { DumpSectionStrings } from "./firmwareSetup.js";
import type { FlashSectionStrings } from "./firmwareSetup.js";
import type { EraseSectionStrings } from "./firmwareSetup.js";
import type { FileBrowserSectionStrings } from "./firmwareSetup.js";
import type { RetroGoTabStrings } from "./firmwareSetup.js";
import type { ExpertCornerStrings } from "./firmwareSetup.js";
import type { DeferredSectionStrings } from "./firmwareSetup.js";

export const advancedPl: AdvancedStrings = {
  tabbarLabel: "Narzędzia zaawansowane",
  tabOverview: "Przegląd",
  tabFirmwareSetup: "Konfiguracja firmware'u",
  tabRoms: "ROM-y",
  waitingForDevice: "Oczekiwanie na połączenie z urządzeniem…",
  modeGuidedSetup: "Prosta konfiguracja",
  modeAdvanced: "Zaawansowane",
  expertHeading: "Ekspert",
  backToAdvanced: "← Powrót do Zaawansowane",
};

export const officialFirmwarePl: OfficialFirmwareStrings = {
  step1Title: "Kopia zapasowa firmware'u",
  chromiumRequired: "Wybór folderu wymaga przeglądarki opartej na Chromium (tak jak WebUSB).",
  pickFolderIntro: "Wybierz folder z fabrycznymi kopiami zapasowymi albo pusty folder, aby zapisać nową kopię.",
  pickFolderLookForPre: "Szukamy plików",
  pickFolderBodyPost: "i je weryfikujemy.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "Wybierz inny folder",
  chooseBackupFolder: "Wybierz folder kopii zapasowej",
  reconnectLastFolder: "Połącz ponownie ostatni folder",
  backupsFoundLegend: (plural: boolean) => `Znaleziono ${plural ? "fabryczne kopie zapasowe" : "fabryczną kopię zapasową"} w tym folderze`,
  validChip: "✓ prawidłowa",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ nieprawidłowa (wewn. ${internalOk ? "✓" : "✗"} · zewn. ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Wybrano prawidłową fabryczną kopię zapasową ${model}.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `Weryfikacja kopii zapasowej ${model} nie powiodła się (wewnętrzna ${internalOk ? "✓" : "✗"} · zewnętrzna ${externalOk ? "✓" : "✗"}). Wykonaj poniżej nową kopię zapasową.`,
  noBackupYet: "W tym folderze nie ma jeszcze fabrycznej kopii zapasowej — wykonaj ją z połączonego urządzenia.",
  alreadyPatchedNoticePre: "To urządzenie działa już na",
  alreadyPatchedNoticeBold: "spatchowanym Retro-Go",
  alreadyPatchedNoticePost:
    "więc nie ma na nim fabrycznego firmware'u do zabezpieczenia kopią zapasową. Aby zainstalować",
  alreadyPatchedNoticeDifferentBold: "inny",
  alreadyPatchedNoticeEnd:
    "oficjalny firmware (np. Mario ↔ Zelda), wybierz powyżej folder zawierający fabryczną kopię zapasową Mario lub Zeldy, a następnie spatchuj ją poniżej.",
  unlockDeviceLabel: "Odblokuj urządzenie",
  unlockDeviceHint: "(usuwa ochronę odczytu RDP — wymagane do odczytu zablokowanego urządzenia)",
  backingUp: "Tworzenie kopii zapasowej…",
  backUpNow: "Wykonaj kopię zapasową",
  connectToBackUp: "Połącz urządzenie, aby wykonać kopię zapasową.",
  optInToUnlock: "Włącz odblokowanie, aby zabezpieczyć kopią zapasową zablokowane urządzenie.",
  step2Title: "Patchuj firmware",
  step2Body: (model: string) =>
    `Patchuje fabryczny firmware ${model}, aby obsługiwał dual-boot z Retro-Go.`,
  installBootloaderLabel: "Zainstaluj bootloader",
  installBootloaderHint: "(zalecane)",
  crossModelDangerBold: "⚠ Niezgodność modeli:",
  crossModelDangerBody:
    "To firmware Zeldy, ale połączony sprzęt rozpoznano jako Mario. Sprzęt Mario nie ma dwóch przycisków potrzebnych Zeldzie — wynik może być częściowo bezużyteczny.",
  crossModelAck: "Rozumiem i mimo to chcę zaflashować firmware Zeldy na sprzęcie Mario",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `Uwaga: kopia zapasowa to firmware ${backupModel} na sprzęcie ${deviceModel} — dozwolone.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ Zewnętrzny obraz tej kopii zapasowej ${model} (${backupMb} MB) jest większy niż zewnętrzna pamięć flash tego urządzenia (${deviceMb} MB) — fizycznie się nie zmieści i nie można go tu zaflashować.`,
  enteringRecoveryMode: "Wchodzenie w Tryb odzyskiwania…",
  enterRecoveryMode: "Przejdź w Tryb odzyskiwania",
  patchFirmwareButton: "Patchuj firmware",
  connectToPatchAndFlash: "Połącz urządzenie, aby patchować i flashować.",
  patchedAndFlashed: "✓ Spatchowano i zaflashowano.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Patchuje fabryczny firmware ${model}${withBootloader ? " (z bootloaderem karty SD)" : ""} i flashuje go: wewnętrzny → bank 1, zewnętrzny → bank 0. Nie przenoś ani nie odłączaj urządzenia podczas zapisu — może to spowodować niepowodzenie flashowania.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ Flashujesz firmware ZELDY na sprzęcie MARIO, któremu brakuje dwóch przycisków potrzebnych Zeldzie. ${base}`,
  modalTitle: "Spatchować i zaflashować oficjalny firmware?",
  modalConfirmText: "Patchuj i flashuj",
  phasePatch: "Patchuj firmware",
  phaseFlashInternal: "Flashuj pamięć wewnętrzną (bank 1)",
  phaseFlashExternal: "Flashuj pamięć zewnętrzną",
  phaseRescan: "Skanuj urządzenie ponownie",
  errDeviceLocked: 'Urządzenie jest zablokowane (ochrona odczytu RDP). Zaznacz „Odblokuj urządzenie”, aby usunąć ochronę przed wykonaniem kopii zapasowej.',
  errFirmwareMismatch: "Odczytany firmware nie odpowiada żadnemu znanemu fabrycznemu ROM-owi Mario/Zelda — kopia zapasowa nie została zapisana.",
  logPatchingModel: (model: string) => `Patchowanie firmware'u dla modelu: ${model}.`,
};

export const romSectionPl: RomSectionStrings = {
  regionIntflash: "Firmware wewnętrzny",
  regionFrogfs: "Gry, BIOS, języki",
  regionLittlefs: "Emulatory, zapisy",
  phasePrepare: "Przygotuj urządzenie",
  phaseDownload: "Pobierz firmware",
  phaseMigrateScan: "Odczytaj obecny stan urządzenia",
  subFrogfsState: "Odczytaj poprzedni stan gier",
  subLfsExtract: "Wyodrębnij dane emulatorów/zapisów",
  subGamesMigrate: "Przenieś zainstalowane gry",
  phasePrepareInstallImage: "Przygotuj obraz instalacyjny",
  subSdCache: "Ustaw granicę zarezerwowanego offsetu pamięci podręcznej SD",
  phaseBuildInstallImage: "Zbuduj obraz instalacyjny",
  subBuildFrogfs: "Zbuduj obraz gier, BIOS-u i języków",
  subBuildLittlefs: "Zbuduj obraz emulatorów/zapisów",
  subPatchSuperblock: "Patchuj superblok",
  phaseFlashingToDevice: "Flashowanie na urządzenie",
  phaseRescan: "Skanuj urządzenie ponownie",
  phaseSyncSdCores: "Synchronizuj rdzenie na kartę SD",
  chooseSdCard: "Wybierz kartę SD",
  flashRetroGo: "Flashuj Retro-Go",
  flashInternalFirmware: "Flashuj firmware wewnętrzny",
  flashGamesBiosLanguages: "Flashuj gry, BIOS, języki",
  flashEmulatorsSaves: "Flashuj emulatory, zapisy",
  flashThisInstall: "Zaflashować tę instalację?",
  flashRegions: (joined: string) => `Zaflashować: ${joined}?`,
  regionInternalFirmware: "firmware wewnętrzny",
  regionGamesBiosLanguages: "gry, BIOS, języki",
  regionEmulatorsSaves: "emulatory, zapisy",
  flashBody: (writes: string) => `Zapisy: ${writes}. Nie odłączaj urządzenia, dopóki operacja się nie zakończy.`,
  nameInternalFirmware: (bank: number) => `firmware wewnętrzny → bank ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `gry, BIOS, języki → zewn. ${addr}`,
  nameEmulatorsSaves: (addr: string) => `emulatory, zapisy → zewn. ${addr}`,
  flashConfirmText: "Flashuj",
  selectSdCard: "Wybierz kartę SD",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "Nie opublikowano jeszcze żadnych wersji firmware'u.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logDownloadingBundle: (tag: string) => `Downloading firmware bundle ${tag}…`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logBundleDownloaded: (tag: string, mib: string) => `Bundle ${tag} downloaded (${mib} MiB).`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSameVersionRepair: (tag: string) => `Same-version repair (${tag}) — forcing games migration on.`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) =>
    `Target version: ${tag}. Migrate games: ${migrateGames}, migrate saves/settings: ${migrateLfs}.`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logReadPreviousGameState: "Read previous game state.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logCouldNotReadPreviousGameState: "Could not read previous game state (continuing).",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logExtractedSavesData: (count: number) => `Extracted emulators/saves data for migration (${count} entries).`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logCouldNotExtractSavesData: "Could not extract emulators/saves data for migration (continuing).",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logMigratedGames: (count: number) => `Migrated ${count} installed game(s).`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSkippedGameMigration: "Skipping game migration (not requested or none installed).",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logGamesBiosLanguagesBuilt: "Games, BIOS, languages image built.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logEmulatorsSavesBuilt: "Emulators/saves image built.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSuperblockPatched: "Superblock patched into intflash blob.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSdCacheBoundarySet: (offset: number) =>
    `SD cache reserved-offset set to ${offset} bytes (keeps the round-robin ROM cache clear of existing reserved/OFW data).`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logConfirmingLinkResponsive: "Confirming link is responsive…",
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `Ładunek zewnętrzny (${payloadMb} MB) przekracza zewnętrzną pamięć flash tego urządzenia (${deviceMb} MB) — nie można zaflashować.`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logRescanning: "Rescanning device geometry and installed games…",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Wersja do instalacji",
  migrateGamesLabel: "Przenieś gry",
  migrateSavesLabel: "Przenieś zapisy i ustawienia",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `Cel instalacji: bank ${bank} ${dualBoot ? "(dual-boot, fabryczny zachowany)" : "(nadpisuje fabryczny)"}`,
  retroGoOnlyNotice:
    "Na banku 1 nie wykryto fabrycznego firmware'u, więc wywnioskowanym celem jest bank 1 — będzie to instalacja wyłącznie Retro-Go (bez dual-boot).",
  bank1StockOfwNotice:
    'Bank 1 zawiera niespatchowany fabryczny firmware — Retro-Go nie będzie dostępne, dopóki nie zostanie spatchowany (zobacz „Kopia zapasowa i patch” powyżej).',
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `Urządzenie wygląda na build ${deviceBuild}. Wyświetlasz tryb ${viewingMode}.`,
  layoutAdvancedToggle: "Układ (zaawansowane)",
  sdCacheOffsetLabel: "Offset pamięci podręcznej SD",
  frogfsOffsetLabel: "Offset FrogFS",
  offsetHint: "(bajty od 0x90000000; rezerwuje dolną część)",
  autoPlaceholder: (hex: string) => `automatycznie (${hex})`,
  littlefsSizeLabel: "Rozmiar LittleFS",
  littlefsSizeHint: "(≥8 MiB)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `Domyślnie: offset FrogFS automatycznie rezerwuje dolną część na podstawie układu urządzenia. Oba zaokrąglają się w górę do bloku kasowania ${blockSize} B.`,
  scanningProgress: (pct: number) => `Skanowanie… ${pct}%`,
  scanFailed: (err: string) => `skanowanie nie powiodło się: ${err}`,
  scanToSeeLayout: "Zeskanuj urządzenie, aby zobaczyć jego bieżący układ pamięci flash.",
  connectToSizeAndFlash: "Połącz urządzenie, aby wymierzyć i zaflashować instalację.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range} · ${mib} MiB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range} · ${mib} MiB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `koniec urządzenia ${devEnd} · blok ${blockSize} B · wolne ${freeMib} MiB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `sprawdzenia: kończy-się-na-chipie ${endsAtChip ? "✓" : "✗"} · brak-nakładania ${noOverlap ? "✓" : "✗"} · wyrównanie ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `systemy: ${systems || "(brak)"}`,
  startBankLabel: (bank: number) => `Uruchom bank ${bank}`,
  readBackSuperblockDebug: "Odczytaj zwrotnie superblok (debug)",
  chipTextFlashing: "flashowanie",
  chipTextInstalled: "✓ zainstalowano",
  chipTextFileCount: (count: number) => {
    const form =
      count === 1
        ? "plik"
        : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
          ? "pliki"
          : "plików";
    return `${count} ${form}`;
  },
  chipTextIdle: "bezczynny",
  startedBankResult: (bank: number) =>
    `Uruchomiono bank ${bank}. Urządzenie działa teraz na tym firmwarze — stub nie jest już aktywny; połącz się ponownie lub zrestartuj urządzenie, aby ponownie korzystać z aplikacji.`,
};

export const dumpSectionPl: DumpSectionStrings = {
  title: "Zrzuć pamięć flash",
  scanningDevice: "Skanowanie urządzenia…",
  intro: "Odczytaj dowolny obszar dowolnego banku do pobranego pliku. Odczyt można anulować w trakcie.",
  internalFlashTitle: "Pamięć wewnętrzna",
  externalFlashTitle: "Pamięć zewnętrzna",
  bankLabel: "Bank",
  offsetLabel: "Offset",
  offsetPlaceholder: "0x0",
  lengthLabel: "Długość",
  lengthPlaceholder: "cały obszar",
  quickFillWholeRegion: "Cały obszar",
  quickFill128Kib: "128 KiB",
  quickFill1Mib: "1 MiB",
  quickFillStockOfw: "Fabryczny OFW intflash (0–0x20000)",
  lockedNotice:
    "🔒 Pamięć wewnętrzna jest nieczytelna, gdy urządzenie jest zablokowane — odblokowanie następuje automatycznie " +
    "podczas kroku kopii zapasowej w prostej konfiguracji. (Bank 0 / zewnętrzny pozostaje czytelny.)",
  lengthBlankHint: "Puste pole długości = cały obszar od offsetu.",
  planLine: (from: string, to: string) => `Plan: ${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes} bajtów → ${filename}`,
  overrunWarning: (clamped: string) => `Długość przekracza obszar; zostanie ograniczona do ${clamped} bajtów.`,
  enterRecoveryMode: "Przejdź w Tryb odzyskiwania",
  dumpToFile: "Zrzuć do pliku",
  invalidHint: "Wprowadź prawidłowy offset i długość.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "Anuluj",
  cancelHint: "Odczyt jest nieniszczący — „Anuluj” odrzuca tylko częściowy zrzut (brak pliku).",
  readingPct: (pct: number) => `odczytywanie ${pct}%`,
  lockedChip: "zablokowane",
  canceledChip: "anulowano",
  errorChip: "błąd",
  resultSummary: (mib: string, secs: number) => `Odczytano ${mib} MiB w ${secs} s`,
};

export const flashSectionPl: FlashSectionStrings = {
  title: "Zapisz pamięć flash",
  scanningDevice: "Skanowanie urządzenia…",
  enterRecoveryMode: "Przejdź w Tryb odzyskiwania",
  intro: "Zapisz dowolny obraz do dowolnego banku/offsetu. Przed zapisem poprosimy o potwierdzenie.",
  imageFileLabel: "Plik obrazu",
  chooseImage: "Wybierz obraz",
  bankLabel: "Bank",
  offsetLabel: "Offset",
  offsetPlaceholder: "0x0",
  transferOptions: "Opcje transferu",
  compressLabel: "Kompresja LZMA",
  compressHint: "(szybszy transfer; urządzenie dekompresuje; pomijane automatycznie, jeśli nie pomaga)",
  verifyLabel: "Weryfikuj zapisy",
  verifyHint: "(odczytuje zwrotnie każdy bufor, aby wykryć uszkodzenia transmisji; wolniejsze)",
  lockedNotice:
    "🔒 Pamięć wewnętrzna jest zablokowana — zablokowane urządzenie odrzuca zapisy. Odblokowanie następuje automatycznie " +
    "podczas kroku kopii zapasowej w prostej konfiguracji. (Bank 0 / zewnętrzny pozostaje zapisywalny.)",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `Plan: bank${bank} (${base}) + ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} B → dopełniono do ${padded} B (${paddedHex})`,
  alignWarning: (align: number, kind: string) => `Offset musi być wielokrotnością ${align} (wyrównanie ${kind}flash).`,
  overrunWarning: (region: string) => `Obraz przekracza obszar ${region} B.`,
  ackLabel: "Rozumiem, że to nadpisuje bank firmware'u; mam kopię zapasową.",
  flashImageButton: "Flashuj obraz…",
  modalTitle: "Zaflashować ten obraz?",
  modalConfirmText: "Flashuj",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `Plan: bank${bank} (${base}) + ${offset} ← ${filename} (${size} B, dopełniono → ${padded}). ` +
    `Nie odłączaj urządzenia, dopóki operacja się nie zakończy.`,
  phaseFlashingImage: "Flashowanie obrazu",
  writingChip: "zapisywanie",
  lockedChip: "zablokowane",
  extIntWordExt: "zewn.",
  extIntWordInt: "wewn.",
};

export const eraseSectionPl: EraseSectionStrings = {
  title: "Wymaż pamięć flash",
  scanningDevice: "Skanowanie urządzenia…",
  enterRecoveryMode: "Przejdź w Tryb odzyskiwania",
  intro: "Kliknij partycję poniżej, aby zaznaczyć ją do wymazania. Przytrzymaj Ctrl/Cmd, aby zaznaczyć wiele partycji.",
  internalFlashTitle: "Pamięć wewnętrzna",
  externalFlashTitle: "Pamięć zewnętrzna",
  lockedNotice:
    "🔒 Pamięć wewnętrzna jest zablokowana — zablokowane urządzenie odrzuca zapisy. Odblokowanie następuje automatycznie " +
    "podczas kroku kopii zapasowej w prostej konfiguracji. (Pamięć zewnętrzna pozostaje możliwa do wymazania.)",
  selectedTitle: "Zaznaczono:",
  bankWipeWarning: "Uwaga: wymazanie banku wewnętrznego może zniszczyć system operacyjny (fabryczny lub Retro-Go)!",
  eraseButton: (plural: boolean) => `Wymaż ${plural ? "partycje" : "partycję"}…`,
  modalTitle: (count: number, plural: boolean) => `Wymazać ${count} ${plural ? "partycje" : "partycję"}?`,
  modalBody: (plural: boolean) =>
    `To trwale wymaże ${plural ? "zaznaczone partycje" : "zaznaczoną partycję"}, wypełniając je wartością 0xFF. Wszystkie dane lub firmware na nich zostaną utracone.`,
  modalConfirmText: "Wymaż",
  phaseErase: "Wymazywanie",
  phaseRescan: "Skanuj urządzenie ponownie",
  partitionAtFallback: (addr: string) => `partycja pod adresem ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `Wymazywanie ${label} (${size} B pod adresem ${addr})…`,
  partitionFallback: "partycja",
  rescanningLog: "Ponowne skanowanie geometrii urządzenia…",
  erasingChip: "wymazywanie",
  lockedChip: "zablokowane",
  selectedSizeAt: (size: string, addr: string) => `(${size} bajtów pod adresem ${addr})`,
};

export const fileBrowserSectionPl: FileBrowserSectionStrings = {
  intro: "Wybierz partycję systemu plików na pasku poniżej, aby zobaczyć jej pliki.",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "Nie znaleziono plików w FrogFS.",
  noLittlefsFiles: "Nie znaleziono plików w LittleFS.",
  readingLittlefs: (pct: number) => `Odczytywanie partycji LittleFS przez SWD (${pct}%)...`,
  browserNotAvailable: (kind: string) => `Przeglądarka plików niedostępna dla ${kind}.`,
  downloadTitle: (path: string) => `Pobierz ${path} z urządzenia`,
  downloadNeedsRecovery: "Przejdź w Tryb odzyskiwania, aby pobierać pliki.",
  downloadFailed: (err: string) => `Pobieranie nie powiodło się: ${err}`,
};

export const retroGoTabPl: RetroGoTabStrings = {
  officialFirmwareHeading: "Oficjalny firmware",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "Zarządzanie pamięcią flash",
  backupAndPatchTitle: "Kopia zapasowa i patch",
  installRetroGoTitle: "Zainstaluj Retro-Go",
  reinstallRetroGoTitle: "Zainstaluj ponownie Retro-Go",
  fileBrowserTitle: "Przeglądarka plików",
  scanningDevice: "Skanowanie urządzenia…",
  enterRecoveryMode: "Przejdź w Tryb odzyskiwania",
};

export const expertCornerPl: ExpertCornerStrings = {
  warnBanner:
    "Panel eksperta — prawie nikt nie potrzebuje tu niczego. Te opcje są niebezpieczne lub " +
    "bezużyteczne dla większości użytkowników i są zachowane wyłącznie po to, by nie utracić tej możliwości.",
  manualRelockTitle: "Ręczna ponowna blokada",
  manualRelockChip: "jeszcze niedostępne",
  manualRelockWill: "Ponownie włącza ochronę odczytu (RDP) na urządzeniu. To jedyne miejsce blokady jest celowym działaniem.",
  manualRelockNeeds: "uzgodnienia cyklu zasilania; GnwFlasher.lock() nie jest jeszcze zaimplementowane. Pojawi się po typowanym potwierdzeniu + blokującym oknie dialogowym.",
  relockButton: "Zablokuj urządzenie ponownie…",
  rawPatchTitle: "Surowe opcje patcha firmware'u",
  rawPatchChip: "ekspert / nieobsługiwane",
  rawPatchWill: "Udostępnia bezpośrednio pełny schemat opcji leżącego u podstaw patchera, przekazywany bez żadnej walidacji — jawnie nieobsługiwane.",
  rawPatchNeedsBold: "Prawdopodobnie tego nie potrzebujesz.",
  rawPatchNeedsMid: "To",
  rawPatchNeedsBody: "w prostej konfiguracji to funkcja, z której powinien korzystać każdy. Ten panel istnieje tylko po to, by nie utracić tej możliwości.",
  patchWithOptionsButton: "Patchuj z opcjami…",
};

export const deferredSectionPl: DeferredSectionStrings = {
  defaultChipText: "jeszcze niedostępne",
  comingSoon: "Wkrótce dostępne",
  needsLabel: "Wymaga:",
};
