import type { WizardStrings } from "./wizard.js";

export const wizardPl: WizardStrings = {
  step1: {
    titlePatch: "Patchuj urządzenie",
    titleBackupAndPatch: "Kopia zapasowa i patch",
    bodyBroken:
      "Spowoduje to wybranie folderu kopii zapasowej i spatchowanie urządzenia brakującymi zasobami fabrycznymi. Upewnij się, że urządzenie ma wystarczająco naładowaną baterię, i nie odłączaj go!",
    bodyNormal:
      "Zostaniesz poproszony o wybranie folderu na komputerze. To ważny folder, w którym zostanie bezpiecznie zapisana kopia zapasowa oryginalnego firmware'u urządzenia. Nie zgub tych plików! Po wybraniu folderu kopia zapasowa i patch wykonają się automatycznie.",
    confirmPatch: "Patchuj",
    confirmSelectFolderAndStart: "Wybierz folder i zacznij",
    phaseLocateBackup: "Odszukaj istniejącą kopię zapasową",
    phaseReadDevice: "Odczytaj urządzenie (zrzut)",
    phasePatch: "Patchuj firmware",
    phaseFlashInternal: "Flashuj pamięć wewnętrzną (bank 1)",
    phaseFlashExternal: "Flashuj pamięć zewnętrzną",
    phaseRescan: "Skanuj urządzenie ponownie",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logReusingBackup: (model: string) => `Valid backup found for model "${model}" — reusing it (no device read needed).`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoBackupBroken: "No usable backup on disk and the device's assets are missing — cannot repair without one.",
    errMustSelectBackup:
      "Brakuje zasobów urządzenia. MUSISZ wybrać folder zawierający poprzednią prawidłową kopię zapasową, aby je naprawić.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoBackupReadingDevice: (model: string) => `No usable backup on disk — reading stock firmware directly from the device (model: ${model}).`,
    logBackingUp: (done: string, total: string) => `Tworzenie kopii zapasowej: ${done} / ${total} MB`,
    errDumpedFirmwareMismatch: "Odczytany firmware nie odpowiada żadnemu znanemu fabrycznemu ROM-owi.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logDetectedModel: (model: string) => `Detected model: ${model}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logSavingBackup: "Saving backup…",
    heading: (isBroken: boolean) => (isBroken ? "Patchuj" : "Kopia zapasowa i patch"),
    body: (isBroken: boolean) =>
      isBroken
        ? "Urządzenie jest spatchowane, ale brakuje na nim zasobów fabrycznych. Wybierz folder kopii zapasowej, aby spatchować urządzenie i przywrócić jego zasoby."
        : "Bezpiecznie wykonaj kopię zapasową fabrycznego firmware'u i odblokuj urządzenie na potrzeby własnego firmware'u.",
    buttonAction: (isBroken: boolean) => (isBroken ? "Patchuj" : "Kopia zapasowa i patch"),
    skipped: "Pominięto",
    patched: "✓ Spatchowano",
    skipEllipsis: "Pomiń…",
  },
  step2: {
    title: "Zainstaluj Retro-Go",
    body: "Zainstaluj system dual-boot Retro-Go.",
    bodyReinstall: "Ponowna instalacja nadpisze Retro-Go na urządzeniu.",
    bodyUpgrade: (tag: string) => `Aktualizacja do ${tag} nadpisze Retro-Go na urządzeniu.`,
    bodyEraseWarning: "Uwaga: spowoduje to usunięcie istniejących gier i danych.",
    confirmInstall: "Zainstaluj",
    checkboxMigrateGames: "Przenieś gry",
    checkboxMigrateSaves: "Przenieś zapisy",
    confirmGateSelectSdCard: "Wybierz kartę SD",
    phaseReadExistingState: "Odczytaj obecny stan urządzenia",
    subReadPreviousGameState: "Odczytaj poprzedni stan gier",
    subExtractEmulatorsSaves: "Wyodrębnij dane emulatorów/zapisów",
    subMigrateInstalledGames: "Przenieś zainstalowane gry",
    phaseDownloadFirmware: "Pobierz firmware",
    phasePrepareInstallImage: "Przygotuj obraz instalacyjny",
    subSetSdCacheBoundary: "Ustaw granicę zarezerwowanego offsetu pamięci podręcznej SD",
    phaseBuildInstallImage: "Zbuduj obraz instalacyjny",
    subBuildGamesBiosLanguages: "Zbuduj obraz gier, BIOS-u i języków",
    subBuildEmulatorsSaves: "Zbuduj obraz emulatorów/zapisów",
    subPatchSuperblock: "Patchuj superblok",
    phaseFlashingRetroGo: "Flashowanie Retro-Go",
    phaseRescan: "Skanuj urządzenie ponownie",
    phaseSyncSdCores: "Synchronizuj emulatory na karcie SD",
    regionInternalFirmware: "Firmware wewnętrzny",
    regionGamesBiosLanguages: "Gry, BIOS, języki",
    regionEmulatorsSaves: "Emulatory, zapisy",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logMigrateSummary: (kind: string, migrateGames: boolean, migrateSaves: boolean) =>
      `${kind} — migrate games: ${migrateGames}, migrate saves/settings: ${migrateSaves}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logMigrateKindReinstall: "Reinstall of the currently-installed version",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logMigrateKindUpgrade: "Upgrade",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logReadPreviousGameState: "Read previous game state.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCouldNotReadPreviousGameState: "Could not read previous game state (continuing).",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logExtractedSavesSettings: (count: number) => `Extracted saves/settings (${count} entries).`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCouldNotExtractSavesSettings: "Could not extract saves/settings (continuing).",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logMigratedGames: (count: number) => `Migrated ${count} installed game(s).`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logSkippingGameMigration: "Skipping game migration (not requested or none installed).",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logTargetVersion: (tag: string) => `Target version: ${tag}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoVersion: "(none)",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logBundleDownloaded: (mib: string) => `Bundle downloaded (${mib} MiB).`,
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
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logSdSyncStarting: "Starting SD Card sync for cores…",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logSdSyncFoundItems: (count: number) => `Found ${count} items in sdContent bundle.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
    progressFilesLabel: (done: number, total: number) => {
      const form =
        total === 1
          ? "plik"
          : total % 10 >= 2 && total % 10 <= 4 && !(total % 100 >= 12 && total % 100 <= 14)
            ? "pliki"
            : "plików";
      return `${done} / ${total} ${form}`;
    },
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logSdSyncGeneratingZip: "Generating ZIP fallback…",
    sdSyncZipFilename: "retro-go-sd-cores.zip",
    upgradeButtonLabel: (tag: string) => `Zaktualizuj do ${tag}`,
    installedLabel: "✓ Zainstalowano",
    reinstallButtonLabel: "Zainstaluj ponownie",
    installButtonLabel: "Zainstaluj Retro-Go",
  },
  step3: {
    title: "Zarządzaj ROM-ami",
    body: "Przejdź do zakładki ROM-y, aby zainstalować swoje gry.",
    continueButtonLabel: "Przejdź do zarządzania ROM-ami →",
  },
  common: {
    errOperationTimedOut: "Przekroczono czas operacji (urządzenie mogło się zawiesić). Uruchom urządzenie ponownie i spróbuj jeszcze raz.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    rescanningDeviceGeometry: "Rescanning device geometry…",
  },
};
