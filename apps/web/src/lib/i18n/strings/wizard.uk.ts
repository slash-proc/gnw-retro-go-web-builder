import type { WizardStrings } from "./wizard.js";

export const wizardUk: WizardStrings = {
  step1: {
    titlePatch: "Пропатчити пристрій",
    titleBackupAndPatch: "Копія та патч",
    bodyBroken:
      "Зараз ви виберете теку з резервною копією, і пристрій буде пропатчено відсутніми оригінальними даними. Переконайтеся, що батарея заряджена, і не від’єднуйте пристрій.",
    bodyNormal:
      "Вам буде запропоновано вибрати теку на комп’ютері. У ній зберігатиметься резервна копія оригінальної прошивки пристрою. Не втрачайте ці файли. Після вибору теки копіювання і патч виконаються автоматично.",
    confirmPatch: "Пропатчити",
    confirmSelectFolderAndStart: "Вибрати теку і почати",
    phaseLocateBackup: "Пошук наявної копії",
    phaseReadDevice: "Читання пристрою (дамп)",
    phasePatch: "Патч прошивки",
    phaseFlashInternal: "Запис внутрішньої (банк 1)",
    phaseFlashExternal: "Запис зовнішньої",
    phaseRescan: "Пересканування пристрою",
    logReusingBackup: (model: string, intBytes: number, extBytes: number) =>
      `backup: використано копію з диска для ${model}, внутрішня ${intBytes} B, зовнішня ${extBytes} B, пристрій не читався`,
    logNoBackupBroken: `backup: придатної копії на диску немає, дані пристрою відсутні, відновити неможливо`,
    errMustSelectBackup:
      "Дані пристрою відсутні. Щоб їх відновити, виберіть теку з попередньою дійсною резервною копією.",
    logNoBackupReadingDevice: (model: string, extBytes: number) =>
      `backup: придатної копії на диску немає, зчитування оригінальної прошивки з пристрою (модель ${model}, зовнішня ${extBytes} B)`,
    errDumpedFirmwareMismatch: "Зчитана прошивка не збігається з жодним відомим оригінальним ROM.",
    logDetectedModel: (model: string, intBytes: number, extBytes: number) =>
      `backup: дамп відповідає оригінальній ${model} (внутрішня ${intBytes} B, зовнішня ${extBytes} B)`,
    logSavingBackup: `backup: запис файлів внутрішньої та зовнішньої копії у вибрану теку`,
    buttonAction: (isBroken: boolean) => (isBroken ? "Пропатчити" : "Копія та патч"),
    skip: "Пропустити",
    titleBackupOnly: "Резервна копія оригінальної прошивки",
    bodyBackupOnly:
      "Вам буде запропоновано вибрати теку на комп’ютері, де збережеться копія оригінальної прошивки пристрою. Зберігайте ці файли, бо завантажити їх повторно не вийде. На пристрій нічого не записується: Retro-Go замінить оригінальну прошивку на наступному кроці.",
    buttonBackupOnly: "Створити копію",
  },
  step2: {
    title: "Встановити Retro-Go",
    bodyReinstall: "Повторне встановлення перезапише Retro-Go на пристрої.",
    bodyUpgrade: (tag: string) => `Оновлення до ${tag} перезапише Retro-Go на пристрої.`,
    bodyEraseWarning: "Увага: це стирає наявні ігри та дані.",
    confirmInstall: "Встановити",
    confirmUpgrade: "Оновити",
    confirmDowngrade: "Відкотити",
    checkboxMigrateGames: "Перенести ігри",
    checkboxMigrateSaves: "Перенести збереження",
    confirmGateSelectSdCard: "Вибрати SD-картку",
    phaseReadExistingState: "Читання поточного стану",
    subReadPreviousGameState: "Читання попереднього стану ігор",
    subExtractCoresSaves: "Витягування ядер і збережень",
    subMigrateInstalledGames: "Перенесення встановлених ігор",
    phaseDownloadFirmware: "Завантаження прошивки",
    phasePrepareInstallImage: "Підготовка образу",
    subSetSdCacheBoundary: "Встановлення межі зарезервованого зміщення кешу SD",
    phaseBuildInstallImage: "Збирання образу",
    subBuildGamesBiosLanguages: "Ігри, BIOS, мови",
    subBuildCoresSaves: "Ядра, збереження",
    subPatchSuperblock: "Патч суперблока",
    phaseFlashingRetroGo: "Запис Retro-Go",
    phaseRescan: "Пересканування пристрою",
    phaseSyncSdCores: "Синхронізація ядер на SD",
    regionInternalFirmware: "Внутрішня прошивка",
    regionGamesBiosLanguages: "Ігри, BIOS, мови",
    regionCoresSaves: "Ядра, збереження",
    logMigrateSummary: (kind: string, migrateGames: boolean, migrateSaves: boolean) =>
      `migrate: ${kind}, games=${migrateGames}, saves=${migrateSaves}`,
    logMigrateKindReinstall: `повторне встановлення тієї самої версії`,
    logMigrateKindUpgrade: `оновлення`,
    logReadPreviousGameState: (hexOffset: string, length: number) =>
      `gamestate: зчитано стан frogfs за ${hexOffset}, вікно ${length} B`,
    logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) =>
      `gamestate: читання за ${hexOffset} не вдалося, вікно ${length} B, продовження без попереднього стану: ${message}`,
    logExtractedSavesSettings: (count: number, bytes: number) =>
      `saves: витягнуто записів littlefs: ${count}, ${bytes} B`,
    logCouldNotExtractSavesSettings: (message: string) =>
      `saves: витягнути littlefs не вдалося, продовження без збережень і налаштувань: ${message}`,
    logMigratedGames: (count: number, bytes: number) =>
      `games: зчитано встановлених ігор з frogfs: ${count}, ${bytes} B`,
    logSkippingGameMigration: (requested: boolean, installed: number) =>
      `games: перенесення пропущено, requested=${requested}, installed=${installed}`,
    logTargetVersion: (tag: string) => `bundle: цільова версія ${tag}`,
    logNoVersion: `(немає)`,
    logBundleDownloaded: (tag: string, bytes: number, ms: number) =>
      `bundle: ${tag} завантажено, ${bytes} B за ${ms} мс`,
    logGamesBiosLanguagesBuilt: `frogfs: образ ігор, BIOS і мов зібрано`,
    logCoresSavesBuilt: `littlefs: образ ядер і збережень зібрано`,
    logSuperblockPatched: `superblock: вставлено у блоб внутрішньої флеш-пам’яті`,
    logSdCacheBoundarySet: (offset: number) => `sdcache: зарезервоване зміщення ${offset} B, тримає кільцевий кеш ROM подалі від зарезервованих даних і OFW`,
    logConfirmingLinkResponsive: (alive: boolean, ms: number) =>
      `device: stub mailbox alive=${alive}, ${ms} мс`,
    logSdSyncStarting: `sd: синхронізація файлів ядер на картку`,
    logSdSyncFoundItems: (count: number, bytes: number) =>
      `sd: файлів у SD-вмісті бандла: ${count}, ${bytes} B`,
    logSdSyncCopyingFile: (path: string, bytes: number) => `sd: запис ${path}, ${bytes} B`,
    logSdSyncGeneratingZip: (count: number) =>
      `sd: немає доступу до теки, збирається zip з файлів: ${count}`,
    sdSyncZipFilename: "retro-go-sd-cores.zip",
    upgradeButtonLabel: (tag: string) => `Оновити до ${tag}`,
    reinstallButtonLabel: "Перевстановити",
    installButtonLabel: "Встановити",
    versionLatest: "(найновіша)",
  },
  step3: {
    continueButtonLabel: "Перейти до бібліотеки →",
  },
  chooser: {
    title: "Що має запускати цей пристрій?",
    whatIsRetroGo:
      "Retro-Go це нестандартна прошивка, яка запускає на цьому пристрої ігри з інших консолей.",
    dualBoot: "Подвійне завантаження",
    onlyRetroGo: "Лише Retro-Go",
    returnToStock: "Повернути оригінальну",
    escapePrompt: "Щось інше?",
    escapeAction: "Перейти на вкладку «Для досвідчених»",
    tooSmallForRetroGo: (mb: number) => `Retro-Go потребує 8 МБ. На цьому пристрої ${mb} МБ.`,
    tooSmallForDualBoot: (mb: number) =>
      `Подвійне завантаження потребує 16 МБ. На цьому пристрої ${mb} МБ.`,
  },
  spine: {
    backupAndPatchOriginal: "Копія та патч оригінальної прошивки",
    backUpOriginal: "Створити копію оригінальної прошивки",
    installRetroGo: "Встановити Retro-Go",
    addSources: "Додати джерела програм",
    addRoms: "Додати до бібліотеки",
    selectBackup: "Вибрати копію оригінальної прошивки",
    restoreOriginal: "Відновити оригінальну прошивку",
    restoreButtonLabel: "Відновити",
    removeRetroGo: "Видалити Retro-Go",
    skipCaution:
      "Це незворотно, а завантаження оригінальної прошивки у вашій юрисдикції, найімовірніше, незаконне.",
    skipAnyway: "Усе одно пропустити",
    chipOptional: "Необов’язково",
    runAgain: "Запустити знову",
    sourcesButtonLabel: "Додати джерела",
    selectFolderButtonLabel: "Вибрати теку",
    backupFound: (model: string) => `Знайдено копію: ${model}`,
  },
  restore: {
    modalBody:
      "Оригінальну прошивку пристрою буде записано назад точно в тому вигляді, у якому її скопійовано. Це стирає Retro-Go і все, що встановлено разом з ним. Ігри, збереження та налаштування не переносяться і не підлягають відновленню. Не від’єднуйте пристрій до завершення.",
    confirm: "Відновити",
    needBackup: "Спершу виберіть дійсну копію оригінальної прошивки цього пристрою.",
    noneFound:
      "У цій теці не знайдено придатної копії оригінальної прошивки. Вона має містити пару файлів копії, створених під час розблокування пристрою.",
    wrongHardware: (backup: string, hardware: string) =>
      `Ця копія містить прошивку ${backup}, а це залізо ${hardware}. Її запис зробив би пристрій непридатним, тому відновити її тут неможливо.`,
    tooBig: (mb: string, capMb: string) =>
      `Ця копія потребує ${mb} МБ зовнішньої флеш-пам’яті, а на пристрої лише ${capMb} МБ.`,
    logRestoring: (model: string, intBytes: number, extBytes: number) =>
      `flash: дослівне відновлення оригінальної ${model}, внутрішня ${intBytes} B → банк 1, зовнішня ${extBytes} B → банк 0`,
  },
  common: {
    errOperationTimedOut:
      "Час операції вичерпано (пристрій міг зависнути). Перезапустіть пристрій і спробуйте ще раз.",
    rescanningDeviceGeometry: `device: пересканування геометрії`,
  },
} as const;
