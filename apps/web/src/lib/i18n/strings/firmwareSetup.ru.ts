import type { AdvancedStrings, DumpSectionStrings, EraseSectionStrings, FileBrowserSectionStrings, FlashSectionStrings, OfficialFirmwareStrings, RetroGoTabStrings, RomSectionStrings } from "./firmwareSetup.js";

// Russian copy for the Firmware area. Log lines keep their English channel prefix and
// translate only the prose after it. The ✓/✗/⚠/⛔/🔒 marks are drawn by the artboards and are
// kept verbatim.
export const advancedRu: AdvancedStrings = {
  tabbarLabel: "Расширенные инструменты",
  tabOverview: "Обзор",
  tabFirmwareSetup: "Прошивка",
  tabRoms: "Библиотека",
  waitingForDevice: "Ожидание подключения устройства…",
  modeGuidedSetup: "Простой",
  modeAdvanced: "Расширенный",
  unitLabel: "Единица",
};

export const officialFirmwareRu: OfficialFirmwareStrings = {
  pageSubtitle: "Сохраните заводскую прошивку, затем наложите на неё патч, чтобы могла загружаться альтернативная.",
  step1Title: "Резервная копия прошивки",
  chromiumRequired: "Для выбора папки нужен браузер на Chromium (как и для WebUSB).",
  pickFolderIntro: "Выберите папку с заводскими копиями или пустую папку для новой копии.",
  // "Мы ищем internal_flash_backup_*.bin + flash_backup_*.bin и проверяем их."
  pickFolderLookForPre: "Мы ищем",
  pickFolderBodyPost: "и проверяем их.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseBackupFolder: "Выбрать папку для копий",
  reconnectLastFolder: "Подключить прошлую папку",
  backupsFoundLegend: (plural: boolean) =>
    plural ? "Найденные в этой папке заводские копии" : "Найденная в этой папке заводская копия",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ недействительна (внутр. ${internalOk ? "✓" : "✗"}, внеш. ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Выбрана действительная заводская копия ${model}.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `Копия ${model} не прошла проверку (внутренняя ${internalOk ? "✓" : "✗"}, внешняя ${externalOk ? "✓" : "✗"}). Создайте новую копию ниже.`,
  noBackupYet: "Заводской копии в этой папке пока нет; создайте её с подключённого устройства.",
  foundChip: "Найдено",
  changeFolder: "Сменить папку",
  backUpAgain: "Создать копию этого устройства заново",
  rowValid: "Действительна",
  step2BodyThis: (model: string) =>
    `Накладывает патч на вашу копию ${model} и записывает её обратно на устройство.`,
  step2BodySelected: "Накладывает патч на выбранную копию и записывает её обратно на устройство.",
  // "Устройство уже работает с **пропатченной прошивкой Retro-Go**, поэтому … Чтобы установить
  // **другую** официальную прошивку …". The noun moves into the bold fragment so the
  // instrumental case after "с" is complete, and "другую" lands before its noun, where the
  // template puts it and where Russian wants it.
  alreadyPatchedNoticePre: "Устройство уже работает с ",
  alreadyPatchedNoticeBold: "пропатченной прошивкой Retro-Go",
  alreadyPatchedNoticePost: ", поэтому заводской прошивки для резервного копирования на нём нет. Чтобы установить ",
  alreadyPatchedNoticeDifferentBold: "другую",
  alreadyPatchedNoticeEnd: " официальную прошивку (например, Mario ↔ Zelda), выберите выше папку с заводской копией Mario или Zelda и наложите на неё патч ниже.",
  backingUp: "Создание копии…",
  backUpNow: "Создать копию",
  connectToBackUp: "Подключите устройство, чтобы создать копию.",
  lockedCannotBackUp: "Устройство заблокировано, его внутреннюю флеш-память нельзя прочитать, поэтому копировать здесь нечего.",
  step2Title: "Патч прошивки",
  installBootloaderLabel: "Установить загрузчик",
  installBootloaderHint: "(рекомендуется)",
  crossModelDangerBold: "⚠ Несовпадение моделей:",
  crossModelDangerBody:
    "это прошивка Zelda, а подключённое оборудование определено как Mario. У Mario нет двух кнопок, которые нужны Zelda, поэтому часть функций может оказаться недоступна.",
  crossModelAck: "Я понимаю и всё равно хочу записать прошивку Zelda на оборудование Mario",
  crossModelAllowedBold: "Смена модели:",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `это прошивка ${backupModel} на оборудовании ${deviceModel}. Так можно, потому что у ${deviceModel} есть все кнопки, которые использует ${backupModel}, но устройство будет вести себя как ${backupModel}.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ Внешний образ этой копии ${model} (${backupMb} МБ) больше внешней флеш-памяти устройства (${deviceMb} МБ); он физически не поместится и не может быть записан.`,
  overlapWarnBold: "Перезапишет установленные данные:",
  overlapWarnBody: (mb: string) =>
    `патч пишет ${mb} МБ в начало внешней флеш-памяти. Всё, что там установлено (игры и homebrew, ядра и сохранения), придётся установить заново.`,
  enteringRecoveryMode: "Переход в режим восстановления…",
  enterRecoveryMode: "Войти в режим восстановления",
  patchFirmwareButton: "Наложить патч",
  patchAnywayButton: "Всё равно наложить патч",
  footerSummary: "Заводская копия остаётся на диске. Перезаписывается только устройство.",
  footerSummaryCross: "Прежде чем продолжить, прочитайте предупреждение выше.",
  connectToPatchAndFlash: "Подключите устройство, чтобы наложить патч и записать его.",
  patchedAndFlashed: "✓ Патч наложен и записан.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Накладывает патч на заводскую прошивку ${model}${withBootloader ? " (с загрузчиком SD-карты)" : ""} и записывает её: внутреннюю → в банк 1, внешнюю → в банк 0. Не двигайте и не отключайте устройство во время записи, иначе она может сорваться.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ Вы записываете прошивку ZELDA на оборудование MARIO, у которого нет двух нужных Zelda кнопок. ${base}`,
  modalTitle: "Наложить патч и записать официальную прошивку?",
  modalConfirmText: "Патч и запись",
  phasePatch: "Патч прошивки",
  phaseFlashInternal: "Запись внутренней памяти (банк 1)",
  phaseFlashExternal: "Запись внешней памяти",
  phaseRescan: "Пересканирование устройства",
  errDeviceLocked: "Устройство заблокировано (защита от чтения RDP). У заблокированного устройства нельзя прочитать внутреннюю флеш-память, поэтому его прошивку невозможно скопировать. Запись на устройство снимает блокировку, а снятие блокировки стирает оригинал.",
  unlockModalTitle: "Разблокировать устройство?",
  unlockModalBody: "Для записи на это устройство нужно снять блокировку, а это стирает обе флеш-памяти. У заблокированного устройства нельзя прочитать внутреннюю флеш-память, поэтому сохранить оригинальную прошивку заранее не получится: она будет потеряна навсегда.",
  unlockModalConfirm: "Разблокировать и стереть",
  unlockErasing: "unlock: снятие защиты от чтения, обе флеш-памяти будут стёрты",
  unlockDone: "unlock: защита от чтения снята",
  unlockDeclined: "unlock: отказ, устройство осталось заблокированным, ничего не записано",
  errFirmwareMismatch: "Считанная прошивка не совпадает ни с одной известной заводской Mario/Zelda; копия не сохранена.",
  logPatchingModel: (model: string, intBytes: number, extBytes: number) => `patch: патч заводской ${model}, внутренняя ${intBytes} Б, внешняя ${extBytes} Б`,
};

export const romSectionRu: RomSectionStrings = {
  regionIntflash: "Внутренняя прошивка",
  regionFrogfs: "Игры, BIOS, языки",
  regionLittlefs: "Ядра, сохранения",
  phasePrepare: "Подготовка устройства",
  phaseDownload: "Загрузка прошивки",
  phaseMigrateScan: "Чтение текущего состояния",
  subFrogfsState: "Чтение прошлого состояния игр",
  subLfsExtract: "Извлечение ядер и сохранений",
  subGamesMigrate: "Перенос установленных игр",
  phasePrepareInstallImage: "Подготовка образа установки",
  subSdCache: "Установка границы резерва под кэш SD",
  phaseBuildInstallImage: "Сборка образа установки",
  subBuildFrogfs: "Игры, BIOS, языки",
  subBuildLittlefs: "Ядра, сохранения",
  subPatchSuperblock: "Патч суперблока",
  phaseFlashingToDevice: "Запись на устройство",
  phaseRescan: "Пересканирование устройства",
  phaseSyncSdCores: "Синхронизация ядер на SD-карту",
  chooseSdCard: "Выбрать SD-карту",
  flashRetroGo: "Записать Retro-Go",
  flashThisInstall: "Записать эту установку?",
  flashRegions: (joined: string) => `Записать ${joined}?`,
  regionInternalFirmware: "внутреннюю прошивку",
  regionGamesBiosLanguages: "игры, BIOS, языки",
  regionCoresSaves: "ядра, сохранения",
  flashBody: (writes: string) => `Будет записано: ${writes}. Не отключайте устройство до конца операции.`,
  nameInternalFirmware: (bank: number) => `внутренняя прошивка → банк ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `игры, BIOS, языки → внеш. ${addr}`,
  nameCoresSaves: (addr: string) => `ядра, сохранения → внеш. ${addr}`,
  flashConfirmText: "Записать",
  selectSdCard: "Выбрать SD-карту",
  logConnectingFlashUtil: `device: подключение, загрузка утилиты записи`,
  logFlashUtilReady: (extBytes: number, blockSize: number) => `device: утилита готова, внешняя флеш-память ${extBytes} Б, блок стирания ${blockSize} Б`,
  errNoVersionsPublished: "Версии прошивки ещё не опубликованы.",
  logDownloadingBundle: (tag: string) => `bundle: загрузка ${tag}`,
  logBundleDownloaded: (tag: string, bytes: number, ms: number) => `bundle: ${tag} загружен, ${bytes} Б за ${ms} мс`,
  logSameVersionRepair: (tag: string) => `migrate: восстановление той же версии ${tag}, перенос игр включён принудительно`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) => `migrate: цель ${tag}, игры=${migrateGames}, сохранения=${migrateLfs}`,
  logReadPreviousGameState: (hexOffset: string, length: number) => `gamestate: состояние frogfs прочитано по ${hexOffset}, окно ${length} Б`,
  logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) => `gamestate: чтение по ${hexOffset} не удалось, окно ${length} Б, продолжаем без прошлого состояния: ${message}`,
  logExtractedSavesData: (count: number, bytes: number) => `saves: извлечено записей littlefs: ${count}, ${bytes} Б`,
  logCouldNotExtractSavesData: (message: string) => `saves: извлечь littlefs не удалось, продолжаем без сохранений и настроек: ${message}`,
  logMigratedGames: (count: number) => `games: прочитано установленных игр из frogfs: ${count}`,
  logSkippedGameMigration: (requested: boolean, installed: number) => `games: перенос пропущен, запрошен=${requested}, установлено=${installed}`,
  logGamesBiosLanguagesBuilt: `frogfs: образ игр, BIOS и языков собран`,
  logCoresSavesBuilt: `littlefs: образ ядер и сохранений собран`,
  logSuperblockPatched: `superblock: вписан в образ внутренней памяти`,
  logSdCacheBoundarySet: (offset: number) => `sdcache: резерв установлен на ${offset} Б, кольцевой кэш ROM не заходит на зарезервированные данные и OFW`,
  logConfirmingLinkResponsive: (alive: boolean, ms: number) => `device: почтовый ящик заглушки alive=${alive}, ${ms} мс`,
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `Внешние данные (${payloadMb} МБ) не помещаются во внешнюю флеш-память устройства (${deviceMb} МБ); запись невозможна.`,
  logRescanning: `device: пересканирование разметки и установленных игр`,
  logSdSyncFoundItems: (count: number, bytes: number) => `sd: файлов в SD-содержимом пакета: ${count}, ${bytes} Б`,
  logSdSyncCopyingFile: (path: string, bytes: number) => `sd: запись ${path}, ${bytes} Б`,
  logSdSyncNoHandleZipFallback: (count: number) => `sd: нет доступа к каталогу, собирается zip из файлов: ${count}`,
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Версия",
  refreshVersions: "Проверить новые версии",
  migrateGamesLabel: "Сохранить установленные игры",
  migrateSavesLabel: "Сохранить сохранения и настройки",
  bankTargetLabel: "Цель",
  bankReplacesStock: "Заменяет заводскую",
  bankDualBoot: "Двойная загрузка",
  retroGoOnlyNotice:
    "В банке 1 заводская прошивка не обнаружена, поэтому целью выбран банк 1; это будет установка только Retro-Go, без двойной загрузки.",
  bank1StockOfwNotice:
    "В банке 1 заводская прошивка без патча; до Retro-Go не добраться, пока патч не наложен (см. «Копия и патч» выше).",
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `Устройство похоже на сборку ${deviceBuild}. Вы смотрите режим ${viewingMode}.`,
  layoutAdvancedToggle: "Расширенная разметка",
  footerSummary: (size: string, bank: number, dualBoot: boolean) =>
    `Записывает ${size} в банк ${bank}${dualBoot ? ", заводская прошивка сохраняется" : ""}`,
  sdCacheOffsetLabel: "Смещение кэша SD",
  frogfsOffsetLabel: "Смещение FrogFS",
  offsetHint: "(в байтах от 0x90000000; резервирует нижнюю часть)",
  autoPlaceholder: (hex: string) => `авто (${hex})`,
  littlefsSizeLabel: "Размер LittleFS",
  littlefsSizeHint: "(≥8 МБ)",
  littlefsSizePlaceholder: "8",
  mbUnit: "МБ",
  layoutDefaultsNote: (blockSize: number) =>
    `По умолчанию смещение FrogFS резервирует нижнюю часть автоматически, исходя из разметки устройства. Оба значения округляются вверх до блока стирания в ${blockSize} Б.`,
  scanningProgress: (pct: number) => `Сканирование… ${pct}%`,
  scanFailed: (err: string) => `сканирование не удалось: ${err}`,
  scanToSeeLayout: "Просканируйте устройство, чтобы увидеть текущую разметку флеш-памяти.",
  connectToSizeAndFlash: "Подключите устройство, чтобы рассчитать размер и записать установку.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range}, ${mib} МБ`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range}, ${mib} МБ`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `конец устройства ${devEnd}, блок ${blockSize} Б, свободно ${freeMib} МБ`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `проверки: конец на границе чипа ${endsAtChip ? "✓" : "✗"}, без пересечений ${noOverlap ? "✓" : "✗"}, выровнено ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `системы: ${systems || "(нет)"}`,
  startBankLabel: (bank: number) => `Запустить банк ${bank}`,
  readBackSuperblockDebug: "Прочитать суперблок (отладка)",
  startedBankResult: (bank: number) =>
    `Банк ${bank} запущен. Устройство теперь выполняет эту прошивку; заглушка больше не активна; переподключитесь или перезапустите питание, чтобы снова пользоваться приложением.`,
};

export const dumpSectionRu: DumpSectionStrings = {
  scanningDevice: "Сканирование устройства…",
  intro: "Считайте область флеш-памяти в файл на компьютере.",
  internalFlashTitle: "Внутренняя флеш-память",
  externalFlashTitle: "Внешняя флеш-память",
  barHint: "Нажмите на раздел, чтобы подставить диапазон, или введите его вручную.",
  offsetLabel: "Начало",
  offsetPlaceholder: "0x90000000",
  lengthLabel: "Размер",
  lengthPlaceholder: "вся область",
  lockedNotice: "🔒 Пока устройство заблокировано, внутреннюю флеш-память не прочитать, а снятие блокировки стирает её содержимое, так что считывать здесь нечего. (Банк 0 и внешняя память остаются читаемыми.)",
  overrunWarning: (clamped: string) => `Длина выходит за границы области; будет урезана до ${clamped} байт.`,
  planCaption: "План",
  readsRow: "Читает",
  matchesPartition: (name: string) => `совпадает с ${name}`,
  toFileRow: "В файл",
  bytesValue: (bytes: string) => `${bytes} байт`,
  enterRecoveryMode: "Войти в режим восстановления",
  dumpToFile: "Считать в файл",
  footerSummary: "Чтение по SWD. Устройство остаётся нетронутым.",
  invalidHint: "Введите корректные смещение и длину.",
  progressLabel: (done: string, total: string) => `${done} / ${total} КБ`,
  cancel: "Отмена",
  cancelHint: "Чтение безопасно; отмена отбрасывает частичный дамп, файл не создаётся.",
  resultSummary: (mib: string, secs: number) => `${mib} МБ прочитано за ${secs} с`,
};

export const flashSectionRu: FlashSectionStrings = {
  scanningDevice: "Сканирование устройства…",
  enterRecoveryMode: "Войти в режим восстановления",
  intro: "Запишите сырой .bin в банк по указанному смещению.",
  imageFileLabel: "Файл образа",
  chooseImage: "Выбрать образ",
  internalFlashTitle: "Внутренняя флеш-память",
  externalFlashTitle: "Внешняя флеш-память",
  barHint: "Нажмите на раздел, чтобы подставить назначение, или введите его вручную.",
  offsetLabel: "Начало",
  offsetPlaceholder: "0x08100000",
  compressLabel: "Сжимать передачу",
  verifyLabel: "Проверять после записи",
  lockedNotice: "🔒 Внутренняя флеш-память заблокирована, поэтому запись сначала снимет блокировку, а это сотрёт обе флеш-памяти. (Банк 0 и внешняя память остаются доступными для записи.)",
  alignWarning: (align: number, kind: string) => `Смещение должно быть кратно ${align} (выравнивание ${kind}. флеш-памяти).`,
  overrunWarning: (region: string) => `Образ выходит за границы области в ${region} Б.`,
  ackLabel: "Я понимаю, что это перезапишет всё, что там сейчас есть.",
  planCaption: "План",
  writesRow: "Пишет",
  destinationRow: "Назначение",
  overwritesRow: "Перезаписывает",
  bytesValue: (bytes: string) => `${bytes} байт`,
  padCaption: (size: string, paddedHex: string, padded: string) =>
    `${size} → дополняется до ${paddedHex}, ${padded} с выравниванием по блоку стирания`,
  flashImageButton: "Записать образ",
  footerSummary: "Записывает сырой образ. Без патчей и изменений разметки.",
  modalTitle: "Записать этот образ?",
  modalConfirmText: "Записать",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `План: банк${bank} (${base}) + ${offset} ← ${filename} (${size} Б, дополнено → ${padded}). ` +
    `Не отключайте устройство до конца операции.`,
  phaseFlashingImage: "Запись образа",
  extIntWordExt: "внеш",
  extIntWordInt: "внутр",
};

export const eraseSectionRu: EraseSectionStrings = {
  scanningDevice: "Сканирование устройства…",
  enterRecoveryMode: "Войти в режим восстановления",
  intro: "Выберите разделы для стирания. Отменить это нельзя.",
  internalFlashTitle: "Внутренняя флеш-память",
  externalFlashTitle: "Внешняя флеш-память",
  barHint: "Нажимайте на разделы, чтобы выбрать. Ctrl / Cmd для нескольких.",
  customRange: "Свой диапазон…",
  lockedNotice: "🔒 Внутренняя флеш-память заблокирована, поэтому стирание сначала снимет блокировку, а это в любом случае сотрёт обе флеш-памяти. (Внешняя память остаётся доступной для стирания.)",
  selectedTitle: "Выбрано",
  bankWipeWarning: "Стирание внутреннего банка уничтожает находящуюся в нём систему, заводскую прошивку или Retro-Go.",
  // The English `plural` flag cannot express the Russian three-form rule, so the form is
  // derived from `count` here and the flag is left unused.
  eraseButton: (count: number, plural: boolean) => {
    const d = count % 10, h = count % 100;
    const form =
      d === 1 && h !== 11 ? "раздел" : d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? "раздела" : "разделов";
    return `Стереть ${count} ${form}…`;
  },
  footerSummary: (size: string) => `Будет стёрто ${size}. Отменить это нельзя.`,
  modalTitle: (count: number, plural: boolean) => {
    const d = count % 10, h = count % 100;
    const form =
      d === 1 && h !== 11 ? "раздел" : d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? "раздела" : "разделов";
    return `Стереть ${count} ${form}?`;
  },
  modalBody: (plural: boolean) =>
    plural
      ? "Выбранные разделы будут безвозвратно стёрты заполнением 0xFF. Все данные и прошивки на них будут потеряны."
      : "Выбранный раздел будет безвозвратно стёрт заполнением 0xFF. Все данные и прошивки на нём будут потеряны.",
  modalConfirmText: "Стереть",
  phaseErase: "Стирание",
  phaseRescan: "Пересканирование устройства",
  partitionAtFallback: (addr: string) => `раздел по адресу ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `flash: стирание ${label}, ${size} Б по адресу ${addr}`,
  partitionFallback: "раздел",
  rescanningLog: `device: пересканирование разметки`,
  selectedSizeAt: (size: string, addr: string) => `${size} байт по адресу ${addr}`,
};

export const fileBrowserSectionRu: FileBrowserSectionStrings = {
  intro: "Выберите раздел выше, чтобы прочитать его содержимое.",
  frogfsTitle: "Игры, homebrew (FrogFS)",
  internalFlashTitle: "Внутренняя флеш-память",
  externalFlashTitle: "Внешняя флеш-память",
  littlefsTitle: "Ядра, сохранения (LittleFS)",
  noFrogfsFiles: "В FrogFS файлов не найдено.",
  noLittlefsFiles: "В LittleFS файлов не найдено.",
  readingLittlefs: (pct: number) => `чтение ${pct}%`,
  browserNotAvailable: (kind: string) => `Файловый браузер недоступен для ${kind}.`,
  downloadTitle: (path: string) => `Скачать ${path} с устройства`,
  downloadNeedsRecovery: "Войдите в режим восстановления, чтобы скачивать файлы.",
  downloadFailed: (err: string) => `Не удалось скачать: ${err}`,
  footerSummary: "Нажмите на файл, чтобы скачать его с устройства.",
  footerSummaryFrogfs: "Чтение с устройства. Скачивание доступно только для LittleFS.",
};

export const retroGoTabRu: RetroGoTabStrings = {
  firmwareManagementHeading: "Управление прошивкой",
  flashManagementHeading: "Управление флеш-памятью",
  railWriteImage: "Запись образа",
  railDump: "Дамп",
  railErase: "Стирание",
  backupAndPatchTitle: "Копия и патч",
  installRetroGoTitle: "Установка Retro-Go",
  reinstallRetroGoTitle: "Переустановка Retro-Go",
  upgradeRetroGoTitle: "Обновление Retro-Go",
  fileBrowserTitle: "Файловый браузер",
  currentlyOnBank: (bank: string, version: string) => `Сейчас на банке ${bank}, ${version}.`,
  scanningDevice: "Сканирование устройства…",
  enterRecoveryMode: "Войти в режим восстановления",
};
