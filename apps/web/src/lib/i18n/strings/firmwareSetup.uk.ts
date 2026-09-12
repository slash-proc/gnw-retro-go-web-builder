import type {
  AdvancedStrings,
  DumpSectionStrings,
  EraseSectionStrings,
  FileBrowserSectionStrings,
  FlashSectionStrings,
  OfficialFirmwareStrings,
  RetroGoTabStrings,
  RomSectionStrings,
} from "./firmwareSetup.js";

/**
 * Ukrainian numeral agreement: nominative singular after 1 (but not 11), nominative plural
 * after 2-4 (but not 12-14), genitive plural otherwise. The `plural` booleans the English
 * signatures carry only distinguish one from many, which is not enough here, so the count
 * itself decides and the boolean is left unused.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

export const advancedUk: AdvancedStrings = {
  tabbarLabel: "Інструменти для досвідчених",
  tabOverview: "Огляд",
  tabFirmwareSetup: "Прошивка",
  tabRoms: "Бібліотека",
  waitingForDevice: "Очікування підключення пристрою…",
  modeGuidedSetup: "Покроково",
  modeAdvanced: "Для досвідчених",
  // A unit of measure (B / KB / MB) on a RangeField's selector, not the console.
  unitLabel: "Одиниця виміру",
} as const;

export const officialFirmwareUk: OfficialFirmwareStrings = {
  pageSubtitle:
    "Збережіть оригінальну прошивку, а потім пропатчте її, щоб могла завантажуватися нестандартна.",
  step1Title: "Резервна копія прошивки",
  chromiumRequired: "Для вибору теки потрібен браузер на Chromium (як і для WebUSB).",
  pickFolderIntro:
    "Виберіть теку з вашими оригінальними копіями або порожню теку, щоб зберегти копію.",
  // Template order: this fragment, then the two filenames, then the tail. Both land on their
  // own template lines, so the single collapsed space between them is the markup's, not ours.
  pickFolderLookForPre: "Шукаємо",
  pickFolderBodyPost: "і перевіряємо їх.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseBackupFolder: "Вибрати теку для копій",
  reconnectLastFolder: "Підключити останню теку",
  backupsFoundLegend: (plural: boolean) =>
    plural ? "Оригінальні копії в цій теці" : "Оригінальна копія в цій теці",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ недійсна (внутр. ${internalOk ? "✓" : "✗"}, зовн. ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) => `✓ Вибрано дійсну оригінальну копію ${model}.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `Копія ${model} не пройшла перевірку (внутрішня ${internalOk ? "✓" : "✗"}, зовнішня ${externalOk ? "✓" : "✗"}). Створіть нову копію нижче.`,
  noBackupYet:
    "У цій теці ще немає оригінальної копії; створіть її з підключеного пристрою.",
  foundChip: "Знайдено",
  changeFolder: "Змінити теку",
  backUpAgain: "Створити копію цього пристрою знову",
  rowValid: "Дійсна",
  step2BodyThis: (model: string) => `Патчить вашу копію ${model} і записує її назад на пристрій.`,
  step2BodySelected: "Патчить вибрану копію і записує її назад на пристрій.",
  // Five fragments joined with no separator of their own. `іншу` is feminine accusative to
  // agree with `прошивку`, which appears in the tail AFTER it, exactly as the German sibling
  // puts `andere` in front of `Firmware`.
  alreadyPatchedNoticePre: "На пристрої вже встановлено ",
  alreadyPatchedNoticeBold: "пропатчену Retro-Go",
  alreadyPatchedNoticePost:
    ", тож оригінальної прошивки, яку можна було б скопіювати, на ньому немає. Щоб установити ",
  alreadyPatchedNoticeDifferentBold: "іншу",
  alreadyPatchedNoticeEnd:
    " офіційну прошивку (наприклад, Mario ↔ Zelda), виберіть вище теку з оригінальною копією Mario або Zelda, а потім пропатчте її нижче.",
  backingUp: "Створення копії…",
  backUpNow: "Створити копію",
  connectToBackUp: "Підключіть пристрій, щоб створити копію.",
  lockedCannotBackUp:
    "Цей пристрій заблоковано, тому його внутрішню флеш-пам’ять не можна прочитати і копіювати тут нічого.",
  step2Title: "Патч прошивки",
  installBootloaderLabel: "Встановити завантажувач",
  installBootloaderHint: "(рекомендовано)",
  // The danger case is a CONFLICT, the allowed case a plain SWITCH. The English says
  // `Cross-model:` for both; the German sibling separates them, and so does this.
  crossModelDangerBold: "⚠ Конфлікт моделей:",
  crossModelDangerBody:
    "це прошивка Zelda, але підключене залізо визначено як Mario. На Mario бракує двох кнопок, потрібних Zelda, тож частина результату може виявитися непридатною.",
  crossModelAck: "Я розумію і все одно хочу записати прошивку Zelda на залізо Mario",
  crossModelAllowedBold: "Зміна моделі:",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `це прошивка ${backupModel} на залізі ${deviceModel}. Так працює, бо ${deviceModel} має всі кнопки, які використовує ${backupModel}, але пристрій поводитиметься як ${backupModel}.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ Зовнішній образ цієї копії ${model} (${backupMb} МБ) більший за зовнішню флеш-пам’ять пристрою (${deviceMb} МБ); він фізично не вміститься і не може бути записаний тут.`,
  // German reads `Überschreibt installierte Daten`: the point is that the data is overwritten,
  // not merely that the ranges overlap.
  overlapWarnBold: "Перезапише встановлені дані:",
  overlapWarnBody: (mb: string) =>
    `патч записує ${mb} МБ на початок зовнішньої флеш-пам’яті. Усе, що встановлено там (ігри та homebrew, ядра та збереження), доведеться встановити заново.`,
  enteringRecoveryMode: "Вхід у режим відновлення…",
  enterRecoveryMode: "Увійти в режим відновлення",
  patchFirmwareButton: "Пропатчити прошивку",
  patchAnywayButton: "Усе одно пропатчити",
  footerSummary: "Ваша оригінальна копія залишається на диску. Це лише перезаписує пристрій.",
  footerSummaryCross: "Перш ніж продовжити, прочитайте попередження вище.",
  connectToPatchAndFlash: "Підключіть пристрій, щоб пропатчити і записати.",
  patchedAndFlashed: "✓ Пропатчено і записано.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Патчить оригінальну прошивку ${model}${withBootloader ? " (із завантажувачем для SD-картки)" : ""} і записує її: внутрішню → банк 1, зовнішню → банк 0. Не рухайте і не від’єднуйте пристрій під час запису, інакше він може не вдатися.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ Ви записуєте прошивку ZELDA на залізо MARIO, якому бракує двох кнопок, потрібних Zelda. ${base}`,
  modalTitle: "Пропатчити і записати офіційну прошивку?",
  modalConfirmText: "Пропатчити і записати",
  phasePatch: "Патч прошивки",
  phaseFlashInternal: "Запис внутрішньої (банк 1)",
  phaseFlashExternal: "Запис зовнішньої",
  phaseRescan: "Пересканування пристрою",
  errDeviceLocked:
    "Цей пристрій заблоковано (захист від читання RDP). Внутрішню флеш-пам’ять заблокованого пристрою не можна прочитати, тому створити копію його прошивки неможливо. Запис на пристрій розблоковує його, а розблокування стирає оригінал.",
  unlockModalTitle: "Розблокувати цей пристрій?",
  unlockModalBody:
    "Для запису на цей пристрій його потрібно розблокувати, а розблокування стирає обидві флеш-пам’яті. Внутрішню флеш-пам’ять заблокованого пристрою не можна прочитати, тому зберегти оригінальну прошивку заздалегідь не вийде: її буде втрачено назавжди.",
  unlockModalConfirm: "Розблокувати і стерти",
  unlockErasing: "unlock: зняття захисту від читання, це стирає обидві флеш-пам’яті",
  unlockDone: "unlock: захист від читання знято",
  unlockDeclined: "unlock: відхилено, пристрій лишається заблокованим, нічого не записано",
  errFirmwareMismatch: "Зчитана прошивка не збігається з жодним відомим оригінальним ROM Mario чи Zelda; копію не збережено.",
  logPatchingModel: (model: string, intBytes: number, extBytes: number) =>
    `patch: патч оригінальної ${model}, внутрішня ${intBytes} B, зовнішня ${extBytes} B`,
} as const;

export const romSectionUk: RomSectionStrings = {
  regionIntflash: "Внутрішня прошивка",
  regionFrogfs: "Ігри, BIOS, мови",
  regionLittlefs: "Ядра, збереження",
  phasePrepare: "Підготовка пристрою",
  phaseDownload: "Завантаження прошивки",
  phaseMigrateScan: "Читання поточного стану",
  subFrogfsState: "Читання попереднього стану ігор",
  subLfsExtract: "Витягування ядер і збережень",
  subGamesMigrate: "Перенесення встановлених ігор",
  phasePrepareInstallImage: "Підготовка образу",
  subSdCache: "Встановлення межі зарезервованого зміщення кешу SD",
  phaseBuildInstallImage: "Збирання образу",
  subBuildFrogfs: "Ігри, BIOS, мови",
  subBuildLittlefs: "Ядра, збереження",
  subPatchSuperblock: "Патч суперблока",
  phaseFlashingToDevice: "Запис на пристрій",
  phaseRescan: "Пересканування пристрою",
  phaseSyncSdCores: "Синхронізація ядер на SD-картку",
  chooseSdCard: "Вибрати SD-картку",
  flashRetroGo: "Записати Retro-Go",
  flashThisInstall: "Записати це встановлення?",
  flashRegions: (joined: string) => `Записати ${joined}?`,
  regionInternalFirmware: "внутрішню прошивку",
  regionGamesBiosLanguages: "ігри, BIOS, мови",
  regionCoresSaves: "ядра, збереження",
  flashBody: (writes: string) =>
    `Записує: ${writes}. Не від’єднуйте пристрій до завершення.`,
  nameInternalFirmware: (bank: number) => `внутрішня прошивка → банк ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `ігри, BIOS, мови → зовн. ${addr}`,
  nameCoresSaves: (addr: string) => `ядра, збереження → зовн. ${addr}`,
  flashConfirmText: "Записати",
  selectSdCard: "Вибрати SD-картку",
  logConnectingFlashUtil: `device: підключення, завантаження флеш-утиліти`,
  logFlashUtilReady: (extBytes: number, blockSize: number) =>
    `device: флеш-утиліта готова, зовнішня флеш-пам’ять ${extBytes} B, блок стирання ${blockSize} B`,
  errNoVersionsPublished: "Версій прошивки ще не опубліковано.",
  logDownloadingBundle: (tag: string) => `bundle: завантаження ${tag}`,
  logBundleDownloaded: (tag: string, bytes: number, ms: number) =>
    `bundle: ${tag} завантажено, ${bytes} B за ${ms} мс`,
  logSameVersionRepair: (tag: string) =>
    `migrate: відновлення тієї самої версії ${tag}, перенесення ігор увімкнено примусово`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) =>
    `migrate: ціль ${tag}, games=${migrateGames}, saves=${migrateLfs}`,
  logReadPreviousGameState: (hexOffset: string, length: number) =>
    `gamestate: зчитано стан frogfs за ${hexOffset}, вікно ${length} B`,
  logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) =>
    `gamestate: читання за ${hexOffset} не вдалося, вікно ${length} B, продовження без попереднього стану: ${message}`,
  logExtractedSavesData: (count: number, bytes: number) =>
    `saves: витягнуто записів littlefs: ${count}, ${bytes} B`,
  logCouldNotExtractSavesData: (message: string) =>
    `saves: витягнути littlefs не вдалося, продовження без збережень і налаштувань: ${message}`,
  logMigratedGames: (count: number) =>
    `games: зчитано встановлених ігор з frogfs: ${count}`,
  logSkippedGameMigration: (requested: boolean, installed: number) =>
    `games: перенесення пропущено, requested=${requested}, installed=${installed}`,
  logGamesBiosLanguagesBuilt: `frogfs: образ ігор, BIOS і мов зібрано`,
  logCoresSavesBuilt: `littlefs: образ ядер і збережень зібрано`,
  logSuperblockPatched: `superblock: вставлено у блоб внутрішньої флеш-пам’яті`,
  logSdCacheBoundarySet: (offset: number) => `sdcache: зарезервоване зміщення ${offset} B, тримає кільцевий кеш ROM подалі від зарезервованих даних і OFW`,
  logConfirmingLinkResponsive: (alive: boolean, ms: number) =>
    `device: stub mailbox alive=${alive}, ${ms} мс`,
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `Зовнішні дані (${payloadMb} МБ) перевищують зовнішню флеш-пам’ять пристрою (${deviceMb} МБ); запис неможливий.`,
  logRescanning: `device: пересканування геометрії та встановлених ігор`,
  logSdSyncFoundItems: (count: number, bytes: number) =>
    `sd: файлів у SD-вмісті бандла: ${count}, ${bytes} B`,
  logSdSyncCopyingFile: (path: string, bytes: number) => `sd: запис ${path}, ${bytes} B`,
  logSdSyncNoHandleZipFallback: (count: number) =>
    `sd: немає доступу до теки, збирається zip з файлів: ${count}`,
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Версія",
  refreshVersions: "Перевірити наявність нових версій",
  migrateGamesLabel: "Зберегти встановлені ігри",
  migrateSavesLabel: "Зберегти збереження та налаштування",
  bankTargetLabel: "Ціль",
  bankReplacesStock: "Замінює оригінальну",
  bankDualBoot: "Подвійне завантаження",
  retroGoOnlyNotice:
    "У банку 1 не виявлено оригінальної прошивки, тому визначена ціль це банк 1; встановлення буде лише з Retro-Go (без подвійного завантаження).",
  bank1StockOfwNotice:
    "У банку 1 оригінальна непропатчена прошивка; ви не зможете дістатися до Retro-Go, доки її не пропатчено (див. «Копія та патч» вище).",
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `Пристрій схожий на збірку ${deviceBuild}. Ви переглядаєте режим ${viewingMode}.`,
  layoutAdvancedToggle: "Розмітка для досвідчених",
  footerSummary: (size: string, bank: number, dualBoot: boolean) =>
    `Записує ${size} у банк ${bank}${dualBoot ? ", оригінальна прошивка зберігається" : ""}`,
  sdCacheOffsetLabel: "Зміщення кешу SD",
  frogfsOffsetLabel: "Зміщення FrogFS",
  offsetHint: "(байтів від 0x90000000; резервує нижню частину)",
  autoPlaceholder: (hex: string) => `авто (${hex})`,
  littlefsSizeLabel: "Розмір LittleFS",
  littlefsSizeHint: "(≥8 МБ)",
  littlefsSizePlaceholder: "8",
  mbUnit: "МБ",
  layoutDefaultsNote: (blockSize: number) =>
    `За замовчуванням зміщення FrogFS автоматично резервує нижню частину за розміткою пристрою. Обидва округлюються вгору до блока стирання ${blockSize} B.`,
  scanningProgress: (pct: number) => `Сканування… ${pct}%`,
  scanFailed: (err: string) => `сканування не вдалося: ${err}`,
  scanToSeeLayout: "Проскануйте пристрій, щоб побачити поточну розмітку флеш-пам’яті.",
  connectToSizeAndFlash: "Підключіть пристрій, щоб розрахувати розмір і записати.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range}, ${mib} МБ`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range}, ${mib} МБ`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `кінець пристрою ${devEnd}, блок ${blockSize} B, вільно ${freeMib} МБ`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `перевірки: кінець-на-чипі ${endsAtChip ? "✓" : "✗"}, без-перекриття ${noOverlap ? "✓" : "✗"}, вирівняно ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `системи: ${systems || "(немає)"}`,
  startBankLabel: (bank: number) => `Запустити банк ${bank}`,
  readBackSuperblockDebug: "Зчитати суперблок назад (налагодження)",
  startedBankResult: (bank: number) =>
    `Банк ${bank} запущено. Пристрій виконує цю прошивку; стаб більше не активний; перепідключіть або перезапустіть живлення, щоб знову користуватися застосунком.`,
} as const;

export const dumpSectionUk: DumpSectionStrings = {
  scanningDevice: "Сканування пристрою…",
  intro: "Зчитайте ділянку флеш-пам’яті у файл на комп’ютері.",
  internalFlashTitle: "Внутрішня флеш-пам’ять",
  externalFlashTitle: "Зовнішня флеш-пам’ять",
  barHint: "Натисніть розділ, щоб заповнити діапазон, або введіть його вручну.",
  offsetLabel: "Початок",
  offsetPlaceholder: "0x90000000",
  lengthLabel: "Розмір",
  lengthPlaceholder: "уся ділянка",
  lockedNotice:
    "🔒 Внутрішню флеш-пам’ять неможливо прочитати, доки пристрій заблоковано, а розблокування стирає вміст, тож зчитувати тут нічого. (Банк 0 і зовнішня лишаються доступними для читання.)",
  overrunWarning: (clamped: string) =>
    `Довжина перевищує ділянку; буде обмежено до ${clamped} байтів.`,
  planCaption: "План",
  readsRow: "Читає",
  matchesPartition: (name: string) => `збігається з ${name}`,
  toFileRow: "У файл",
  bytesValue: (bytes: string) => `${bytes} байтів`,
  enterRecoveryMode: "Увійти в режим відновлення",
  dumpToFile: "Зчитати у файл",
  footerSummary: "Читає через SWD. Пристрій лишається недоторканим.",
  invalidHint: "Введіть дійсні зміщення і довжину.",
  progressLabel: (done: string, total: string) => `${done} / ${total} КБ`,
  cancel: "Скасувати",
  cancelHint:
    "Читання нічого не змінює; скасування відкидає частковий дамп (файла не буде).",
  resultSummary: (mib: string, secs: number) => `${mib} МБ зчитано за ${secs} с`,
} as const;

export const flashSectionUk: FlashSectionStrings = {
  scanningDevice: "Сканування пристрою…",
  enterRecoveryMode: "Увійти в режим відновлення",
  intro: "Запишіть сирий .bin у банк за зміщенням.",
  imageFileLabel: "Файл образу",
  chooseImage: "Вибрати образ",
  internalFlashTitle: "Внутрішня флеш-пам’ять",
  externalFlashTitle: "Зовнішня флеш-пам’ять",
  barHint: "Натисніть розділ, щоб заповнити призначення, або введіть його вручну.",
  offsetLabel: "Початок",
  offsetPlaceholder: "0x08100000",
  compressLabel: "Стискати передачу",
  verifyLabel: "Перевірити після запису",
  lockedNotice:
    "🔒 Внутрішню флеш-пам’ять заблоковано, тому запис спершу розблокує пристрій, а це стирає обидві флеш-пам’яті. (Банк 0 і зовнішня лишаються доступними для запису.)",
  alignWarning: (align: number, kind: string) =>
    `Зміщення має бути кратним ${align} (вирівнювання ${kind}флеш-пам’яті).`,
  overrunWarning: (region: string) => `Образ виходить за межі ділянки ${region} B.`,
  ackLabel: "Я розумію, що це перезапише все, що там зараз є.",
  planCaption: "План",
  writesRow: "Записує",
  destinationRow: "Призначення",
  overwritesRow: "Перезаписує",
  bytesValue: (bytes: string) => `${bytes} байтів`,
  padCaption: (size: string, paddedHex: string, padded: string) =>
    `${size} → доповнюється до ${paddedHex}, ${padded} з вирівнюванням по блоку стирання`,
  flashImageButton: "Записати образ",
  footerSummary: "Записує сирий образ. Без патчів, без змін розмітки.",
  modalTitle: "Записати цей образ?",
  modalConfirmText: "Записати",
  planBody: (
    bank: number,
    base: string,
    offset: string,
    filename: string,
    size: string,
    padded: string,
  ) =>
    `План: банк${bank} (${base}) + ${offset} ← ${filename} (${size} B, доповнено → ${padded}). ` +
    `Не від’єднуйте пристрій до завершення.`,
  phaseFlashingImage: "Запис образу",
  extIntWordExt: "зовн. ",
  extIntWordInt: "внутр. ",
} as const;

export const eraseSectionUk: EraseSectionStrings = {
  scanningDevice: "Сканування пристрою…",
  enterRecoveryMode: "Увійти в режим відновлення",
  intro: "Виберіть розділи для стирання. Це незворотно.",
  internalFlashTitle: "Внутрішня флеш-пам’ять",
  externalFlashTitle: "Зовнішня флеш-пам’ять",
  barHint: "Натискайте розділи, щоб вибрати. Ctrl / Cmd для кількох.",
  customRange: "Власний діапазон…",
  lockedNotice:
    "🔒 Внутрішню флеш-пам’ять заблоковано, тому стирання спершу розблокує пристрій, а це так само стирає обидві флеш-пам’яті. (Зовнішню можна стирати.)",
  selectedTitle: "Вибрано",
  bankWipeWarning:
    "Стирання внутрішнього банку знищує систему на ньому, оригінальну прошивку або Retro-Go.",
  // The boolean only tells one from many, which Ukrainian needs three forms for, so the count
  // decides and `plural` goes unused here and in `modalTitle`.
  eraseButton: (count: number) =>
    `Стерти ${count} ${plural(count, "розділ", "розділи", "розділів")}…`,
  footerSummary: (size: string) => `Буде стерто ${size}. Це незворотно.`,
  modalTitle: (count: number) =>
    `Стерти ${count} ${plural(count, "розділ", "розділи", "розділів")}?`,
  modalBody: (plural: boolean) =>
    plural
      ? "Вибрані розділи буде остаточно стерто заповненням 0xFF. Усі дані чи прошивка на них будуть втрачені."
      : "Вибраний розділ буде остаточно стерто заповненням 0xFF. Усі дані чи прошивка на ньому будуть втрачені.",
  modalConfirmText: "Стерти",
  phaseErase: "Стирання",
  phaseRescan: "Пересканування пристрою",
  partitionAtFallback: (addr: string) => `розділ за ${addr}`,
  erasingLog: (label: string, size: string, addr: string) =>
    `flash: стирання ${label}, ${size} B за ${addr}`,
  partitionFallback: "розділ",
  rescanningLog: `device: пересканування геометрії`,
  selectedSizeAt: (size: string, addr: string) => `${size} байтів за ${addr}`,
} as const;

export const fileBrowserSectionUk: FileBrowserSectionStrings = {
  intro: "Виберіть розділ вище, щоб прочитати його вміст.",
  frogfsTitle: "Ігри, homebrew (FrogFS)",
  internalFlashTitle: "Внутрішня флеш-пам’ять",
  externalFlashTitle: "Зовнішня флеш-пам’ять",
  littlefsTitle: "Ядра, збереження (LittleFS)",
  noFrogfsFiles: "У FrogFS файлів не знайдено.",
  noLittlefsFiles: "У LittleFS файлів не знайдено.",
  readingLittlefs: (pct: number) => `читання ${pct}%`,
  browserNotAvailable: (kind: string) => `Файловий браузер недоступний для ${kind}.`,
  downloadTitle: (path: string) => `Завантажити ${path} з пристрою`,
  downloadNeedsRecovery: "Увійдіть у режим відновлення, щоб завантажувати файли.",
  downloadFailed: (err: string) => `Не вдалося завантажити: ${err}`,
  footerSummary: "Натисніть файл, щоб завантажити його з пристрою.",
  footerSummaryFrogfs: "Прочитано з пристрою. Завантаження доступне лише для LittleFS.",
} as const;

export const retroGoTabUk: RetroGoTabStrings = {
  firmwareManagementHeading: "Керування прошивкою",
  flashManagementHeading: "Керування флеш-пам’яттю",
  railWriteImage: "Записати образ",
  railDump: "Зчитування",
  railErase: "Стирання",
  backupAndPatchTitle: "Копія та патч",
  installRetroGoTitle: "Встановити Retro-Go",
  reinstallRetroGoTitle: "Перевстановити Retro-Go",
  upgradeRetroGoTitle: "Оновити Retro-Go",
  fileBrowserTitle: "Файловий браузер",
  currentlyOnBank: (bank: string, version: string) =>
    `Зараз у банку ${bank}, ${version}.`,
  scanningDevice: "Сканування пристрою…",
  enterRecoveryMode: "Увійти в режим відновлення",
} as const;
