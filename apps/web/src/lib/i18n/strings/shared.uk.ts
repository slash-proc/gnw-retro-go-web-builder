import type { SharedStrings } from "./shared.js";

export const sharedUk: SharedStrings = {
  common: {
    cancel: "Скасувати",
    close: "Закрити",
    connect: "Підключити",
    connecting: "Підключення…",
    // ConfirmModal/InstallProgressModal join these three with no separator of their own, so
    // the spacing lives here: `Виконується. ` + `Не від’єднуйте пристрій` + `.`
    workingNotePre: "Виконується. ",
    workingNoteBold: "Не від’єднуйте пристрій",
    workingNotePost: ".",
    done: "✓ Готово.",
    changeEllipsis: "Змінити…",
    chooseEllipsis: "Вибрати…",
    or: "або",
  },
  confirmModal: {
    defaultConfirmText: "Підтвердити",
  },
  splitButton: {
    moreOptions: "Інші дії",
  },
  deviceControls: {
    deviceActions: "Дії з пристроєм",
    rescan: "Пересканувати",
    restartRecoveryMode: "Перезапустити режим відновлення",
    startRecoveryMode: "Увімкнути режим відновлення",
    changeAdapter: "Змінити адаптер",
    disconnectDevice: "Від’єднати пристрій",
  },
  stubLoadModal: {
    title: "Увійти в режим відновлення?",
    // `режим відновлення` is accusative after `перейти в` and identical to the nominative, so
    // the bold fragment needs no inflection to fit the sentence around it.
    body1Pre:
      "Для цієї дії (читання флеш-пам’яті, резервна копія, встановлення прошивки) пристрій має перейти в ",
    body1Bold: "режим відновлення",
    body1Post: ". Запущену програму буде тимчасово зупинено.",
    // `кнопку живлення` is accusative after the imperative; the genitive `пристрою` that
    // English carries before the bold moves AFTER it, so the bold stays a bare noun phrase.
    body2Pre: "Утримуйте ",
    body2Bold: "кнопку живлення",
    body2Post:
      " пристрою, доки він підключається, потім покладіть пристрій і не торкайтеся його, доки операція не завершиться.",
    continue: "Продовжити",
  },
  connectGateModal: {
    title: "Потрібен пристрій",
    subtitle: "Підключіть адаптер пристрою, щоб продовжити.",
    deviceConnectionTitle: "Підключення пристрою",
    connectedFallback: "Підключено",
    adapterHint: "Адаптер ST-Link v2 (або сумісний)",
    chooseAdapter: "Вибрати адаптер",
    connectionFailed: "Не вдалося підключитися.",
  },
  folderGateModal: {
    title: "Потрібні теки",
    romFolderTitle: "Тека з ROM",
    selectedFallback: "Вибрано",
    romFolderHint: "Ваша локальна колекція файлів ROM",
    reconnectLastFolder: "Підключити останню теку",
    scanning: "Сканування…",
    sdCardFolderTitle: "Тека SD-картки",
    sdCardFolderHint: "Корінь тому SD-картки",
    errRead: "Не вдалося прочитати цю теку.",
    continue: "Продовжити",
  },
  auditLog: {
    title: "Активність",
    empty: "Поки що нічого.",
    reloaded: "Перезавантажено",
    sessions: "Сеанси",
    sevAll: "Усе",
    sevDebug: "Налагодження",
    sevInfo: "Інфо",
    sevWarning: "Попередження",
    sevError: "Помилка",
    srcConverter: "Конвертер",
    srcDevice: "Пристрій",
    srcSources: "Джерела",
    filterPlaceholder: "Фільтр",
    showing: (shown: number, total: number) => `Показано ${shown} з ${total}`,
    copy: "Копіювати",
    save: "Зберегти",
    saveFilename: "gnw-activity.txt",
    notificationsTitle: "Сповіщення",
    noneWaiting: "Поки що немає активності",
    openActivity: "Відкрити активність",
    clearNotifications: "Очистити",
    dismissNotification: "Сховати",
    recoveryFailed: (reason: string) => `Режим відновлення не запустився: ${reason}`,
    connectFailed: (reason: string) => `Не вдалося підключитися: ${reason}`,
    scanFailed: (reason: string) => `Сканування не завершено: ${reason}`,
    foldersFailed: (reason: string) => `Не вдалося прочитати теки: ${reason}`,
    cheatsFailed: (reason: string) => `Не вдалося завантажити чити: ${reason}`,
  },
  installProgressModal: {
    logLabel: (count: number) => `Журнал (${count})`,
    saveLog: "Зберегти журнал",
    copyLog: "Копіювати журнал",
    blocksFailed: "Блоки, що не пройшли",
    blockLabel: (n: number) => `Блок ${n}`,
    // Two independent counts, each with its own Ukrainian numeral form: the noun after a
    // count takes nominative plural for 2-4 and genitive plural from 5 up, and the verb goes
    // singular only for 1. `після` then puts the retry count in the genitive.
    verifyHeadline: (blocks: number, retries: number) => {
      const one = blocks % 10 === 1 && blocks % 100 !== 11;
      const few =
        blocks % 10 >= 2 && blocks % 10 <= 4 && !(blocks % 100 >= 12 && blocks % 100 <= 14);
      const noun = one ? "блок" : few ? "блоки" : "блоків";
      const verb = one ? "не збігся" : "не збіглися";
      const retryOne = retries % 10 === 1 && retries % 100 !== 11;
      const retryNoun = retryOne ? "повторної спроби" : "повторних спроб";
      return `${blocks} ${noun} ${verb} після ${retries} ${retryNoun}.`;
    },
    partlyWrittenBank: (bank: number) => `Банк ${bank} записано частково, він не завантажиться.`,
    partlyWrittenExt: "Зовнішню флеш-пам’ять записано частково.",
    wiringAdvice:
      "Повторювані збої блоків майже завжди означають проблему з підключенням програматора. Перепідключіть його і спробуйте ще раз.",
    // A fact about the writer, not reassurance: the abort flag is checked at the top of each
    // 256 KiB chunk, so a stop never lands mid-erase.
    cancelCaption: "Зупиниться після поточного блока",
    cancelPending: "Зупинка",
    cancelTitle: "Зупинити запис?",
    // Names no bank on purpose, like the English: true of a Retro-Go install into bank 2 and
    // false of an OFW patch flash, which writes bank 1. Only what holds for every writer here.
    cancelBody:
      "Записане лишається записаним. Встановлення буде неповним, доки ви не запустите його знову.",
    cancelKeep: "Продовжити запис",
    cancelStop: "Зупинити",
    cancelledNote: "Зупинено. Встановлення неповне.",
    logStopping: "Зупинка на межі наступного блока.",
    logStopped: "Зупинено.",
  },
  geometry: {
    freeSpace: "Вільне місце",
    games: "Ігри та homebrew",
    coresAndSaves: "Ядра та збереження",
    bankLabel: (n: number) => `Банк ${n}`,
    bankUnknown: "—",
    used: "використано",
    free: "вільно",
    bankFree: (n: number) => `Вільно в банку ${n}`,
    empty: "порожньо",
    externalFlash: "зовнішня флеш-пам’ять",
    reservedSdCache: "Зарезервовано (кеш SD)",
  },
  units: {
    b: "Б",
    kb: "КБ",
    mb: "МБ",
    gb: "ГБ",
    space: " ",
  },
} as const;
