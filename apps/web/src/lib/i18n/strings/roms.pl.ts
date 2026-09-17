import type { RomsStrings } from "./roms.js";

export const romsPl: RomsStrings = {
  firefoxWarning: {
    dismissAriaLabel: "Odrzuć ostrzeżenie",
    boldLead: "Firefox jest obsługiwany tylko częściowo.",
    body: " Firefox nie może zapisywać okładek obok plików ROM, więc wyeksportuj je do pliku ZIP. Aby zapisywać bezpośrednio, użyj Chromium, Chrome lub Edge.",
  },
  selectGames: {
    gateBody: "Skonfiguruj folder ROM-ów, aby zarządzać grami.",
  noActiveSources: "Add or activate a core or homebrew source to see games in the Library.",
    gateButton: "Skonfiguruj foldery…",
    allFilterLabel: (count: number) => `Wszystkie (${count})`,
    homebrewFilterLabel: (count: number) => `Homebrew (${count})`,
    favoritesFilterLabel: (count: number) => `Ulubione (${count})`,
    searchPlaceholder: "Szukaj",
    refreshLibrary: "Odśwież bibliotekę",
    favoriteOn: "Ulubione",
    favoriteOff: "Nie w ulubionych",
    changeFoldersTitle: "Zmień foldery",
    selectedCount: (n: number) => {
      // Polish has three plural forms: 1 → "wybrana", 2-4 → "wybrane",
      // 5+ (and 12-14, and 0) → "wybranych".
      const d = n % 10, h = n % 100;
      if (n === 1) return "1 wybrana";
      if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return `${n} wybrane`;
      return `${n} wybranych`;
    },
    selectAll: "Zaznacz wszystkie",
    unselectAll: 'Odznacz wszystko',
    noFilterMatch: "Żadna gra nie pasuje do tego filtra.",
    removeButton: "usuń",
    errorPrefix: (message: string) => `Błąd: ${message}`,
    unknownHomebrewTag: "NIEZNANY HOMEBREW",
    homebrewTag: "HOMEBREW",
    homebrewChip: "HB",
    infoEmpty: "Wybierz grę, aby zobaczyć szczegóły",
    sortLabel: "Sortuj",
    sortBySystem: "System",
    sortByName: "Nazwa pliku",
    sortBySize: "Rozmiar",
    sortByAction: "Akcja",
    sortAscending: "Rosnąco",
    sortDescending: "Malejąco",
    actionInstalled: "zainstalowano",
    actionUninstall: "odinstaluj",
    actionPrepare: "przygotuj",
    actionExtracting: "wyodrębnianie...",
    actionMissingRom: "brak pliku ROM",
    actionInstall: "zainstaluj",
    actionNotInstalled: "nie zainstalowano",
    convertFailed: (reason: string) => `Nie udało się przygotować: ${reason}`,
    convertUnrecognised: (filename: string) => `Nie rozpoznano pliku ${filename}, użyto go mimo to.`,
  },
  spaceAlert: {
    title: "Osiągnięto limit miejsca",
    ok: "OK",
    notEnoughSpace: (requiredMiB: string, availableMiB: string) =>
      `Za mało miejsca na urządzeniu! Wymagane: ${requiredMiB} MB, dostępne: ${availableMiB} MB`,
  },
  install: {
    connectPrompt: "Połącz urządzenie, aby zainstalować swoją bibliotekę.",
    scanningDevice: "Skanowanie urządzenia…",
    scanDevicePrompt: "Zeskanuj urządzenie, aby wykryć jego partycje.",
    installFirstPrompt: "To urządzenie nie ma partycji rdzeni/zapisów, więc najpierw zainstaluj Retro-Go.",
    calculatingLayout: "Obliczanie układu…",
    lzmaCheckboxLabel: "Kompresuj ROM-y algorytmem LZMA ",
    lzmaSoon: "na razie bez kompresji",
    syncLibraryButton: "Synchronizuj bibliotekę",
    installTitle: "Instalacja",
    installBody: "Gry, BIOS i języki zostaną zainstalowane na urządzeniu.",
    phasePrepare: "Przygotuj urządzenie",
    phaseBudget: "Sprawdź budżet miejsca",
    phaseBuild: "Zbuduj obraz instalacyjny",
    subRetain: "Odczytaj ponownie zachowane gry na urządzeniu",
    subPack: "Spakuj obraz gier, BIOS-u i języków",
    phaseFlash: "Flashowanie gier, BIOS-u i języków",
    subFlashImage: "Gry, BIOS, języki",
    subFlashCores: "Rdzenie",
    phaseRescan: "Skanuj urządzenie ponownie",
    logConnecting: `device: łączenie, ładowanie narzędzia flashowania`,
    logFlashUtilReady: (hexOffset: string, eraseBlock: number, extBytes: number) => `device: narzędzie flashowania gotowe, frogfs @ ${hexOffset}, blok kasowania ${eraseBlock} B, zewnętrzna ${extBytes} B`,
    logBudgetBlocked: (bytes: number, gapBytes: string) => `budget: wybrane ${bytes} B przekracza lukę ${gapBytes} B, zablokowano`,
    errBudgetBlocked: "Wybór nie mieści się w dostępnym miejscu na tym urządzeniu. Odznacz kilka gier.",
    logBudgetFits: (bytes: number, gapBytes: string) => `budget: wybrane ${bytes} B mieści się w luce ${gapBytes} B`,
    logRetainedGames: (retainedCount: number, homebrewCount: number, bytes: number) => `frogfs: ponownie odczytano ${retainedCount} zachowanych gier i ${homebrewCount} plików homebrew z urządzenia, ${bytes} B`,
    logBuildingImage: (fileCount: number) => `frogfs: pakowanie ${fileCount} plików z zaznaczenia`,
    errNoFirmwareVersions: "Nie opublikowano jeszcze żadnych wersji firmware'u.",
    logReusingPreview: (bytes: number) => `frogfs: użycie zbuforowanego podglądu, ${bytes} B, zaznaczenie bez zmian`,
    logImageReady: (bytes: number, hexOffset: string) => `frogfs: obraz ${bytes} B, flashowanie pod ${hexOffset}`,
    logConfirmingLinkResponsive: (alive: boolean, ms: number) => `device: skrzynka stuba alive=${alive}, ${ms} ms`,
    logRescanning: `device: ponowne skanowanie geometrii i zainstalowanych gier`,
    wontFitDetail: "Nie mieści się w dostępnym miejscu. Odznacz kilka gier.",
  },
  sdSync: {
    upgradeLabelPre: "Zaktualizuj Retro-Go do",
    updatesWhenBoots: "(zaktualizuje się przy następnym uruchomieniu G&W)",
    downloadZipButton: "Pobierz ZIP karty SD",
    nothingToSyncTitle: "Żadne gry, rdzenie, okładki ani cheaty się nie zmieniły, więc nie ma nic do synchronizacji.",
    chooseCardPrompt: "Wybierz kartę SD, aby zainstalować",
    syncTitle: "Instalacja",
    syncBody: "Gry, BIOS i języki zostaną zainstalowane na karcie SD.",
    phaseScan: "Skanuj w poszukiwaniu zmian",
    subGames: "Dodane/usunięte gry",
    subCovers: "Zmienione okładki",
    subCheats: "Zmienione cheaty",
    phaseWrite: "Synchronizacja karty SD",
    writeSubGames: "Gry",
    writeSubCovers: "Okładki",
    writeSubCheats: "Kody cheatów",
    writeSubRemove: "Usuń odznaczone gry",
    writeSubFavorites: "Ulubione",
    writeSubCores: "Rdzenie",
    writeSubFwUpdate: "Aktualizacja firmware'u w katalogu głównym SD",
    phaseRescan: "Skanuj kartę SD ponownie",
    phaseDone: "Gotowe",
    logGamesScanned: (changedCount: number, removedCount: number, freshSuffix: string) => `sd: ${changedCount} plików gry/bios nowych lub zmienionych, ${removedCount} do usunięcia${freshSuffix}`,
    freshTargetSuffix: ` (nowa karta, zapis wszystkiego, co zaznaczone)`,
    logCoversScanned: (count: number) => `covers: ${count} plików nowych lub zmienionych`,
    logCheatsScanned: (count: number) => `cheats: ${count} plików nowych lub zmienionych`,
    logCoresWillResync: (withFwUpdate: boolean) =>
      withFwUpdate ? `cores: ponowna synchronizacja plików rdzeni i systemu, w tym update_bank2.bin` : `cores: ponowna synchronizacja plików rdzeni i systemu`,
    logCoresSkipped: `cores: pominięte, bez zmian`,
    logFetchingBundle: (tag: string) => `bundle: pobieranie ${tag}`,
    logWritingGames: (count: number) => `sd: zapis ${count} plików gry/bios`,
    logNoGameChanges: `sd: brak zmian gry/bios`,
    logWritingCovers: (count: number) => `sd: zapis ${count} plików okładek`,
    logNoCoverChanges: `sd: brak zmian okładek`,
    logWritingCheats: (count: number) => `sd: zapis ${count} plików kodów`,
    logNoCheatChanges: `sd: brak zmian kodów`,
    logWritingFavorites: `sd: zapisywanie ulubionych`,
    logRemoving: (count: number) => `sd: usuwanie ${count} odznaczonych gier`,
    logRemoved: (path: string) => `sd: usunięto ${path}`,
    logCouldNotRemove: (path: string, message: string) => `sd: nie udało się usunąć ${path}: ${message}`,
    logNoGamesToRemove: `sd: brak odznaczonych gier do usunięcia`,
    logRemovedClearedCheat: (path: string) => `cheats: usunięto opróżniony plik kodów ${path}`,
    logWritingCores: (count: number, bytes: number) => `cores: zapis ${count} plików rdzeni, ${bytes} B`,
    logCoresSkippedWrite: `cores: pominięte`,
    logWritingFwUpdate: (bytes: number) => `sd: zapis update_bank2.bin, ${bytes} B`,
    logFwUpdateSkipped: `sd: aktualizacja firmware niezażądana, pominięto`,
    logNoSdHandleZip: `sd: brak uchwytu katalogu (firefox), tworzenie zipa do pobrania`,
    logRescanning: `sd: ponowne skanowanie karty pod kątem gier i wersji rdzeni`,
    logNoSdHandleRescan: `sd: brak uchwytu katalogu (firefox), nic do przeskanowania`,
    zipDownloadName: "retro-go-sd-card.zip",
  },
  summary: {
    romsLabel: "Gry",
    homebrewLabel: "Homebrew",
    coverArtLabel: "Okładki",
    cheatsLabel: "Cheaty",
    coresLabel: "Rdzenie",
    totalProjectedSizeLabel: "Razem",
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
    coresAndFiles: (coreCount: number, fileCount: number, tag: string) => {
      const coreForm =
        coreCount === 1
          ? "rdzeń"
          : coreCount % 10 >= 2 && coreCount % 10 <= 4 && !(coreCount % 100 >= 12 && coreCount % 100 <= 14)
            ? "rdzenie"
            : "rdzeni";
      const fileForm =
        fileCount === 1
          ? "plik"
          : fileCount % 10 >= 2 && fileCount % 10 <= 4 && !(fileCount % 100 >= 12 && fileCount % 100 <= 14)
            ? "pliki"
            : "plików";
      return `${coreCount} ${coreForm}, ${fileCount} ${fileForm} (${tag})`;
    },
    netChange: (sign: string, amountMiB: string) => `${sign}${amountMiB} MB zmiany netto`,
    projected: (usedMiB: string, totalMiB: string) => `${usedMiB} MB z ${totalMiB} MB przewidywane`,
    additionalOptions: "Dodatkowe opcje",
    summaryTab: "Podsumowanie",
    summaryDrawerTitle: "Podsumowanie instalacji",
    colAfter: "Po",
    colChange: "Zmiana",
    installHeading: "Instalacja",
  },
  gameDetailsPanel: {
    additionalOptions: "Dodatkowe opcje",
    coverArt: {
      heading: "Okładka",
      importTitle: "Import",
      settingsTitle: "Ustawienia",
      sourceLabel: "Źródło",
      sourceFile: "Plik",
      sourceScraper: "Scraper",
      variantLabel: "Wariant",
      variantBoxart: "Boxart",
      variantScreenshot: "Zrzut ekranu",
      variantMulti3: "Multi-3",
      variantMulti4: "Multi-4",
      variantMulti5: "Multi-5",
      generatingPreview: "Generowanie podglądu...",
      configureToPreview: "Skonfiguruj ustawienia, aby zobaczyć podgląd",
      apply: "Zastosuj",
      dragDropOverride: "Przeciągnij i upuść lub kliknij, aby zastąpić okładkę",
      requestsToday: "Zapytania dzisiaj",
      downloadConvertedCovers: "Pobierz przekonwertowane okładki (.img)",
      downloadScrapedCovers: "Pobierz zescrapowane okładki (obrazy)",
      alertNoConvertedCovers: "Nie znaleziono przekonwertowanych okładek.",
      alertNoFullsizeCovers: "Nie znaleziono okładek w pełnym rozmiarze.",
      errRomNotFound: "Nie znaleziono pliku ROM.",
      errCoverNotFound: "Nie znaleziono okładki.",
      errNoOriginalSystem: "Nie podano systemu źródłowego.",
      guessNotice: "Dopasowano tylko po nazwie. Sprawdź, czy to właściwa gra.",
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
      noPresetMatch: "Brak ustawienia predefiniowanego pasującego do tytułu tej gry. Wybierz jedno powyżej.",
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
      progressLabel: (done: number, total: number) => `${done} of ${total} covers scraped`,
      showGeneratedCovers: "Show generated covers",
      skipExistingCovers: "Skip entries with an existing cover",
      generatedCoverPreviewAlt: "Latest generated cover",
      coverNotFound: (name: string) => `${name} could not be found`,
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
    coresAndSaves: "Rdzenie i zapisy",
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
    /** BothEmpty.dc.html: a bank holding nothing names its occupant `Empty` with an
     *  em dash where a filled card shows a size. */
    empty: "Pusty",
  },
  sdHomebrewMove: {
    title: "Migruj folder Homebrew",
    body: (count: number) => `W starym roms/homebrew jest ${count} plików Homebrew. Czy chcesz go przenieść do homebrews/ na karcie SD?`,
    confirm: "Przenieś",
    phaseMove: "Przenoszenie Homebrew",
    logMoved: (path: string) => `przeniesiono ${path}`,
    logSkipped: (path: string) => `pominięto ${path}, jest tam już inny plik`,
    logFailed: (path: string, message: string) => `niepowodzenie ${path}: ${message}`,
    logSummary: (moved: number, left: number) => `przeniesiono ${moved}, pozostawiono ${left}`,
  },

};
