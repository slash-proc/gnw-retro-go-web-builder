import type { RomsStrings } from "./roms.js";

export const romsPl: RomsStrings = {
  firefoxWarning: {
    dismissAriaLabel: "Odrzuć ostrzeżenie",
    boldLead: "Firefox jest obsługiwany tylko częściowo.",
    body: " Firefox nie pozwala łatwo zapisywać okładek obok plików ROM, więc jedyną opcją jest wyeksportowanie wszystkich okładek do pliku ZIP. Aby zapisywać pobrane/zaimportowane okładki bezpośrednio, użyj zamiast tego Chromium, Chrome, Edge itp.",
  },
  selectGames: {
    gateBody: "Skonfiguruj folder ROM-ów, aby zarządzać grami.",
    gateButton: "Skonfiguruj foldery…",
    allFilterLabel: (count: number) => `Wszystkie (${count})`,
    homebrewFilterLabel: (count: number) => `Homebrew (${count})`,
    gamesHeading: "Gry",
    expandListTitle: "Rozwiń listę",
    collapseListTitle: "Zwiń listę",
    changeFoldersTitle: "Zmień foldery",
    selectAll: "Zaznacz wszystkie",
    unselectAll: "Odznacz wszystkie",
    noFilterMatch: "Żadna gra nie pasuje do tego filtra.",
    removeButton: "usuń",
    errorPrefix: (message: string) => `Błąd: ${message}`,
    unknownHomebrewTag: "NIEZNANY HOMEBREW",
    homebrewTag: "HOMEBREW",
    homebrewChip: "HB",
    infoEmpty: "Wybierz grę, aby zobaczyć szczegóły",
    actionInstalled: "zainstalowano",
    actionUninstall: "odinstaluj",
    actionPrepare: "przygotuj",
    actionExtracting: "wyodrębnianie...",
    actionMissingRom: "brak pliku ROM",
    actionInstall: "zainstaluj",
    actionNotInstalled: "nie zainstalowano",
  },
  spaceAlert: {
    title: "Osiągnięto limit miejsca",
    ok: "OK",
    notEnoughSpace: (requiredMiB: string, availableMiB: string) =>
      `Za mało miejsca na urządzeniu! Wymagane: ${requiredMiB} MiB, dostępne: ${availableMiB} MiB`,
  },
  install: {
    connectPrompt: "Połącz urządzenie, aby zainstalować ROM-y.",
    scanningDevice: "Skanowanie urządzenia…",
    scanDevicePrompt: "Zeskanuj urządzenie, aby wykryć jego partycje.",
    installFirstPrompt: "Najpierw zainstaluj Retro-Go — na tym urządzeniu nie znaleziono partycji emulatorów/zapisów.",
    calculatingLayout: "Obliczanie układu…",
    lzmaCheckboxLabel: "Kompresuj ROM-y algorytmem LZMA ",
    lzmaSoon: "na razie bez kompresji",
    installButton: "Zainstaluj ROM-y",
    installTitle: "Zainstalować ROM-y?",
    installConfirm: "Zainstaluj",
    installBody: (hexOffset: string) =>
      `Przepakowuje gry, BIOS i języki pod adresem ${hexOffset} na podstawie Twojego wyboru. Emulatory i zapisy NIE zostaną naruszone. Nie odłączaj urządzenia, dopóki operacja się nie zakończy.`,
    phasePrepare: "Przygotuj urządzenie",
    phaseBudget: "Sprawdź budżet miejsca",
    phaseBuild: "Zbuduj obraz gier, BIOS-u i języków",
    subRetain: "Odczytaj ponownie zachowane gry na urządzeniu",
    subPack: "Spakuj obraz gier, BIOS-u i języków",
    phaseFlash: "Flashowanie gier, BIOS-u i języków",
    phaseRescan: "Skanuj urządzenie ponownie",
    flashProgressLabel: "Gry, BIOS, języki → zewn.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logConnecting: "Connecting to device and starting the flash utility…",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logFlashUtilReady: (hexOffset: string, eraseBlock: number) =>
      `Flash utility ready — FrogFS offset ${hexOffset}, erase block ${eraseBlock} B.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logBudgetBlocked: (sizeMiB: string) => `${sizeMiB} MiB selected exceeds the available gap — blocked.`,
    errBudgetBlocked: "Wybór nie mieści się w dostępnym miejscu na tym urządzeniu — odznacz kilka gier.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logBudgetFits: (sizeMiB: string, gapMiB: string) => `${sizeMiB} MiB selected — fits the available ${gapMiB} MiB gap.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logRetainedGames: (retainedCount: number, homebrewCount: number) =>
      `Re-read ${retainedCount} retained game(s) and ${homebrewCount} homebrew file(s) from device.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logBuildingImage: "Building games, BIOS, languages image from selection…",
    errNoFirmwareVersions: "Nie opublikowano jeszcze żadnych wersji firmware'u.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logReusingPreview: "Reusing prepared games, BIOS, languages preview (selection unchanged since last preview).",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logImageReady: (sizeMiB: string, hexOffset: string) =>
      `Games, BIOS, languages image ready: ${sizeMiB} MiB → flashing @ ${hexOffset}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logConfirmingLinkResponsive: "Confirming link is responsive…",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logRescanning: "Rescanning device geometry and installed games…",
    wontFitDetail: "Nie mieści się w dostępnym miejscu — odznacz kilka gier.",
  },
  sdSync: {
    upgradeLabelPre: "Zaktualizuj Retro-Go i emulatory do",
    updatesWhenBoots: "(zaktualizuje się przy następnym uruchomieniu G&W)",
    syncButton: "Synchronizuj kartę SD",
    downloadZipButton: "Pobierz ZIP karty SD",
    nothingToSyncTitle: "Nic do synchronizacji — żadne gry, rdzenie, okładki ani cheaty się nie zmieniły.",
    syncTitle: "Zsynchronizować kartę SD?",
    syncBody: "Zapisuje wybrane gry, okładki i cheaty (a także rdzenie/pliki systemowe, jeśli zaznaczono) na kartę SD. Zapisywane są tylko nowe lub zmienione pliki, a odznaczone gry są usuwane.",
    syncConfirm: "Synchronizuj",
    phaseScan: "Skanuj w poszukiwaniu zmian",
    subGames: "Dodane/usunięte gry",
    subCovers: "Zmienione okładki",
    subCheats: "Zmienione cheaty",
    phaseWrite: "Synchronizacja karty SD",
    writeSubGames: "Gry",
    writeSubCovers: "Okładki",
    writeSubCheats: "Kody cheatów",
    writeSubRemove: "Usuń odznaczone gry",
    writeSubCores: "Emulatory",
    writeSubFwUpdate: "Aktualizacja firmware'u w katalogu głównym SD",
    phaseRescan: "Skanuj kartę SD ponownie",
    phaseDone: "Gotowe",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logGamesScanned: (changedCount: number, removedCount: number, freshSuffix: string) =>
      `${changedCount} game/bios file(s) new or changed, ${removedCount} game(s) to remove${freshSuffix}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    freshTargetSuffix: " (fresh SD target — writing everything selected)",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCoversScanned: (count: number) => `${count} cover art file(s) new or changed.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCheatsScanned: (count: number) => `${count} cheat file(s) new or changed.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCoresWillResync: (withFwUpdate: boolean) =>
      withFwUpdate ? "Cores/system files WILL be re-synced (firmware update included)." : "Cores/system files WILL be re-synced.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCoresSkipped: "Cores/system files skipped (unchanged).",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logFetchingBundle: (tag: string) => `Fetching bundle (${tag})…`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logWritingGames: (count: number) => `Writing ${count} game/bios file(s)…`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoGameChanges: "No game/bios changes to sync.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logWritingCovers: (count: number) => `Writing ${count} cover art file(s)…`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoCoverChanges: "No cover art changes to sync.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logWritingCheats: (count: number) => `Writing ${count} cheat file(s)…`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoCheatChanges: "No cheat changes to sync.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logRemoving: (count: number) => `Removing ${count} de-selected game(s)…`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logRemoved: (path: string) => `Removed ${path}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCouldNotRemove: (path: string, message: string) => `Could not remove ${path}: ${message}`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoGamesToRemove: "No de-selected games to remove.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logRemovedClearedCheat: (path: string) => `Removed cleared cheat file ${path}.`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logWritingCores: (count: number) => `Writing ${count} core files…`,
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logCoresSkippedWrite: "Cores/system files skipped.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logWritingFwUpdate: "Writing update_bank2.bin…",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logFwUpdateSkipped: "Firmware update not requested — skipped.",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoSdHandleZip: "No SD card handle (Firefox) — building ZIP for download…",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logRescanning: "Rescanning SD card for installed games and core versions…",
    // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
    logNoSdHandleRescan: "No SD card handle (Firefox) — nothing to rescan.",
    zipDownloadName: "retro-go-sd-card.zip",
  },
  summary: {
    romsLabel: "ROM-y",
    homebrewLabel: "Homebrew",
    coverArtLabel: "Okładki",
    cheatsLabel: "Cheaty",
    coresLabel: "Emulatory / pliki systemowe",
    totalProjectedSizeLabel: "Szacowany rozmiar łączny",
    selectedCount: (count: number) => {
      const form =
        count === 1
          ? "pozycję"
          : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
            ? "pozycje"
            : "pozycji";
      return `Wybrano ${count} ${form}`;
    },
    noneSelected: "Nic nie wybrano",
    cheatsConfigured: (count: number) => {
      const form =
        count === 1
          ? "kod"
          : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
            ? "kody"
            : "kodów";
      return `Skonfigurowano ${count} ${form}`;
    },
    noneConfigured: "Nic nie skonfigurowano",
    noCoverChanges: "Brak zmian",
    calculating: "Obliczanie…",
    willBeResynced: "Zostanie ponownie zsynchronizowane",
    errorFetchingVersionInfo: "Błąd podczas pobierania informacji o wersji",
    includesFirmwareUpdate: "Zawiera aktualizację firmware'u bank2",
    emulatorsAndFiles: (emulatorCount: number, fileCount: number, tag: string) => {
      const emulatorForm =
        emulatorCount === 1
          ? "emulator"
          : emulatorCount % 10 >= 2 && emulatorCount % 10 <= 4 && !(emulatorCount % 100 >= 12 && emulatorCount % 100 <= 14)
            ? "emulatory"
            : "emulatorów";
      const fileForm =
        fileCount === 1
          ? "plik"
          : fileCount % 10 >= 2 && fileCount % 10 <= 4 && !(fileCount % 100 >= 12 && fileCount % 100 <= 14)
            ? "pliki"
            : "plików";
      return `${emulatorCount} ${emulatorForm}, ${fileCount} ${fileForm} (${tag})`;
    },
    netChange: (sign: string, amountMiB: string) => `${sign}${amountMiB} MiB zmiany netto`,
  },
  gameDetailsPanel: {
    additionalOptions: "Dodatkowe opcje",
    coverArt: {
      heading: "Okładka",
      importTitle: "Import",
      settingsTitle: "Ustawienia",
      sourceLabel: "Źródło:",
      sourceFile: "Plik",
      sourceScraper: "Scraper",
      variantLabel: "Wariant:",
      variantBoxart: "Boxart",
      variantScreenshot: "Zrzut ekranu",
      variantMulti3: "Multi-3",
      variantMulti4: "Multi-4",
      variantMulti5: "Multi-5",
      generatingPreview: "Generowanie podglądu...",
      configureToPreview: "Skonfiguruj ustawienia, aby zobaczyć podgląd",
      apply: "Zastosuj",
      dragDropOverride: "Przeciągnij i upuść lub kliknij, aby zastąpić okładkę",
      requestsPerDay: "Zapytania/dzień",
      downloadConvertedCovers: "Pobierz przekonwertowane okładki (.img)",
      downloadScrapedCovers: "Pobierz zescrapowane okładki (obrazy)",
      alertNoConvertedCovers: "Nie znaleziono przekonwertowanych okładek.",
      alertNoFullsizeCovers: "Nie znaleziono okładek w pełnym rozmiarze.",
      errRomNotFound: "Nie znaleziono pliku ROM.",
      errCoverNotFound: "Nie znaleziono okładki.",
      errPrefix: (message: string) => `Błąd: ${message}`,
      coverPreviewAlt: "Podgląd okładki",
    },
    saves: {
      heading: "Zapisy",
      runUtilPrompt: "Uruchom narzędzie flashujące RAM, aby zobaczyć zapisy.",
      loadingSaves: "Wczytywanie zapisów...",
      sram: "SRAM",
      slotLabel: (slot: string) => `Slot ${slot}`,
      noSavesFound: "Nie znaleziono zapisów",
      previousSaveAriaLabel: "Poprzedni zapis",
      nextSaveAriaLabel: "Następny zapis",
      loading: "Wczytywanie...",
      failedToRender: "Nie udało się wyrenderować",
      noPreview: "Brak podglądu",
      downloadSave: "Pobierz zapis",
      alertDownloadFailed: (message: string) => `Nie udało się pobrać: ${message}`,
      savePreviewAlt: "Podgląd zapisu",
    },
    cheats: {
      heading: "Cheaty",
      unsupportedConsole: "Nieobsługiwana konsola",
      builtInCheatFileHeading: "Wbudowany plik cheatów",
      attachedFromLibrary: (mcfName: string) => `Do tej gry dołączono plik cheatów (z wbudowanej biblioteki: ${mcfName}.mcf).`,
      attachedCustom: "Do tej gry dołączono plik cheatów (własny).",
      removeCheatFile: "Usuń plik cheatów",
      builtInFoundBody: (mcfName: string) => `Znaleziono wbudowany plik cheatów dla tej gry (${mcfName}.mcf).`,
      useBuiltInCheatFile: "Użyj wbudowanego pliku cheatów dla tej gry",
      loadingEllipsis: "Wczytywanie…",
      noBuiltInCheatFile: "Nie znaleziono wbudowanego pliku cheatów dla tej gry.",
      detectedGameHeading: "Wykryta gra",
      noMatchOption: "Brak dopasowania",
      autoDetectedSuffix: " (wykryto automatycznie)",
      noPresetMatch: "Brak dopasowania ustawienia predefiniowanego dla tytułu tej gry — wybierz jedno powyżej, jeśli znajduje się na liście.",
      presetsHeading: "Ustawienia predefiniowane",
      defaultCheatName: "Cheat",
      manualEntryHeading: "Wprowadzanie ręczne",
      codePlaceholder: "Kod",
      descriptionPlaceholder: "Opis",
      add: "Dodaj",
      configuredHeading: (count: number) => `Skonfigurowane (${count})`,
      removeTitle: "Usuń",
      noCheatsConfigured: "Nie skonfigurowano żadnych cheatów",
      downloadCheatsFiles: "Pobierz pliki cheatów Retro-Go",
      alertNoConfiguredCheats: "Nie znaleziono skonfigurowanych cheatów.",
    },
    screenScraperSettings: {
      title: "Ustawienia ScreenScraper",
      username: "Nazwa użytkownika",
      password: "Hasło",
      rememberCredentials: "Zapamiętaj dane logowania",
      rememberNote: "Zapisywane w formie zaciemnionej w lokalnej pamięci tej przeglądarki. Włączaj tylko na zaufanym urządzeniu.",
      preferLocalCovers: "Preferuj lokalne okładki",
      saveToRomsFolder: "Zapisuj pobrane okładki w folderze ROM-ów",
      saveToRomsFolderFirefoxNote: "(Nieobsługiwane w Firefoksie. Użyj zamiast tego „Pobierz wszystkie okładki”.)",
    },
    importModal: {
      title: "Importuj okładki",
      allFilterLabel: (count: number) => `Wszystkie (${count})`,
      consoleColumn: "Konsola",
      filenameColumn: (sortArrow: string) => `Nazwa pliku ${sortArrow}`,
      coverColumn: (sortArrow: string) => `Okładka ${sortArrow}`,
      noGamesFound: "Nie znaleziono gier",
      defaultVariantLabel: "Wariant domyślny:",
      stop: "Zatrzymaj",
      importSelected: (count: number) => {
        const form =
          count === 1
            ? "wybraną okładkę"
            : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
              ? "wybrane okładki"
              : "wybranych okładek";
        return `Importuj ${count} ${form}`;
      },
    },
  },
  carousel: {
    noGames: "Brak gier",
    noCover: "Brak okładki",
  },
  installGeometry: {
    gamesUnchanged: "Gry (bez zmian)",
    gamesProjected: "Gry (szacowane)",
    freeSpace: "Wolne miejsce",
    coresAndSaves: "Emulatory i zapisy",
    games: "Gry",
    capacity: "Pojemność",
    freeProjected: "Wolne (szacowane)",
    free: "Wolne",
    calculating: "Obliczanie…",
  },
  bankCard: {
    bankTitle: (bankNum: number) => `Bank ${bankNum}`,
    kbSuffix: (kb: number) => `${kb} KB`,
    bankTotalLabel: "256 KB",
  },
};
