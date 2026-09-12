import type { SharedStrings } from "./shared.js";

// Russian copy for the shared UI chrome.
//
// THE FRAGMENT KEYS (`*Pre`/`*Bold`/`*Post`) are interleaved around an inline <strong> by the
// component and joined with literal spaces, so the split point is a translation decision, not a
// fixed boundary. Each one below was composed as a whole sentence first and then divided where
// Russian wants the emphasis, which is not always where English put it.
export const sharedRu: SharedStrings = {
  common: {
    cancel: "Отмена",
    close: "Закрыть",
    connect: "Подключить",
    connecting: "Подключение…",
    // ConfirmModal / InstallProgressModal: "Идёт операция. **Не отключайте устройство**."
    workingNotePre: "Идёт операция. ",
    workingNoteBold: "Не отключайте устройство",
    workingNotePost: ".",
    done: "✓ Готово.",
    changeEllipsis: "Изменить…",
    chooseEllipsis: "Выбрать…",
    or: "или",
  },
  confirmModal: {
    defaultConfirmText: "Подтвердить",
  },
  splitButton: {
    moreOptions: "Другие действия",
  },
  deviceControls: {
    deviceActions: "Действия с устройством",
    rescan: "Пересканировать",
    restartRecoveryMode: "Перезапустить режим восстановления",
    startRecoveryMode: "Запустить режим восстановления",
    changeAdapter: "Сменить адаптер",
    disconnectDevice: "Отключить устройство",
  },
  stubLoadModal: {
    title: "Перейти в режим восстановления?",
    // "…устройство должно перейти в **режим восстановления**. Запущенное приложение…"
    // The bold noun lands in the accusative after "в", which is the nominative form here, so
    // the phrase works with the emphasis exactly where English puts it.
    body1Pre: "Для этого действия (чтение флеш-памяти, резервное копирование, установка прошивки) устройство должно перейти в ",
    body1Bold: "режим восстановления",
    body1Post: ". Запущенное приложение будет временно остановлено.",
    // "Удерживайте **кнопку питания** устройства во время подключения…". English leads with
    // "the device's", but Russian puts the possessive after the noun, so "устройства" moves
    // from the Pre fragment into the Post one.
    body2Pre: "Удерживайте ",
    body2Bold: "кнопку питания",
    body2Post: " устройства во время подключения, затем положите его и не трогайте до конца операции.",
    continue: "Продолжить",
  },
  connectGateModal: {
    title: "Нужно устройство",
    subtitle: "Подключите адаптер устройства, чтобы продолжить.",
    deviceConnectionTitle: "Подключение устройства",
    connectedFallback: "Подключено",
    adapterHint: "Адаптер ST-Link v2 (или совместимый)",
    chooseAdapter: "Выбрать адаптер",
    connectionFailed: "Не удалось подключиться.",
  },
  folderGateModal: {
    title: "Нужны папки",
    romFolderTitle: "Папка с ROM",
    selectedFallback: "Выбрано",
    romFolderHint: "Ваша локальная коллекция файлов ROM",
    reconnectLastFolder: "Подключить прошлую папку",
    scanning: "Сканирование…",
    sdCardFolderTitle: "Папка SD-карты",
    sdCardFolderHint: "Корень тома SD-карты",
    errRead: "Не удалось прочитать эту папку.",
    continue: "Продолжить",
  },
  auditLog: {
    title: "Активность",
    empty: "Пока сообщать не о чем.",
    reloaded: "Перезагрузка",
    sessions: "Сеансы",
    sevAll: "Все",
    sevDebug: "Отладка",
    sevInfo: "Инфо",
    sevWarning: "Предупреждения",
    sevError: "Ошибки",
    srcConverter: "Конвертер",
    srcDevice: "Устройство",
    srcSources: "Источники",
    filterPlaceholder: "Фильтр",
    showing: (shown: number, total: number) => `Показано ${shown} из ${total}`,
    copy: "Копировать",
    save: "Сохранить",
    saveFilename: "gnw-activity.txt",
    notificationsTitle: "Уведомления",
    noneWaiting: "Пока ничего нет",
    openActivity: "Открыть активность",
    clearNotifications: "Очистить",
    dismissNotification: "Скрыть",
    recoveryFailed: (reason: string) => `Режим восстановления не запустился: ${reason}`,
    connectFailed: (reason: string) => `Не удалось подключиться: ${reason}`,
    scanFailed: (reason: string) => `Сканирование не завершено: ${reason}`,
    foldersFailed: (reason: string) => `Не удалось прочитать папки: ${reason}`,
    cheatsFailed: (reason: string) => `Не удалось загрузить читы: ${reason}`,
  },
  installProgressModal: {
    logLabel: (count: number) => `Журнал (${count})`,
    saveLog: "Сохранить журнал",
    copyLog: "Копировать журнал",
    blocksFailed: "Блоки с ошибкой",
    blockLabel: (n: number) => `Блок ${n}`,
    // Both counts inflect. The block word carries its own verb because the verb agrees with
    // the count too ("1 блок не совпал" / "2 блока не совпали" / "5 блоков не совпало"), and
    // "после" governs the genitive, which is why the retry noun has only two forms here.
    verifyHeadline: (blocks: number, retries: number) => {
      const d = blocks % 10, h = blocks % 100;
      const blockPart =
        d === 1 && h !== 11
          ? "блок не совпал"
          : d >= 2 && d <= 4 && !(h >= 12 && h <= 14)
            ? "блока не совпали"
            : "блоков не совпало";
      const retryPart = retries === 1 ? "повторной попытки" : "повторных попыток";
      return `${blocks} ${blockPart} после ${retries} ${retryPart}.`;
    },
    partlyWrittenBank: (bank: number) => `Банк ${bank} записан частично и не загрузится.`,
    partlyWrittenExt: "Внешняя флеш-память записана частично.",
    wiringAdvice:
      "Повторяющиеся ошибки блоков почти всегда связаны с проводкой программатора. Переподключите её и повторите.",
    // THE STOP. The link itself is `common.cancel`; these are the parts around it.
    // `cancelCaption` states a fact about the writer, not reassurance: the abort flag is read at
    // the top of each 256 KiB chunk, so a stop never lands mid-erase.
    cancelCaption: "Остановится после текущего блока",
    cancelPending: "Остановка",
    cancelTitle: "Остановить запись?",
    // Names no bank, exactly as the English does not: the sentence has to stay true both of a
    // Retro-Go install into bank 2 and of an OFW patch flash into bank 1. "Что уже записано,
    // останется записанным" keeps the English parallelism in a construction Russian actually
    // uses, rather than repeating the participle for its own sake.
    cancelBody: "Что уже записано, останется записанным. Установка будет незавершённой, пока вы не запустите её снова.",
    cancelKeep: "Продолжить запись",
    cancelStop: "Остановить",
    cancelledNote: "Остановлено. Установка не завершена.",
    logStopping: "Остановка на границе следующего блока.",
    logStopped: "Остановлено.",
  },
  geometry: {
    freeSpace: "Свободно",
    games: "Игры и homebrew",
    coresAndSaves: "Ядра и сохранения",
    bankLabel: (n: number) => `Банк ${n}`,
    bankUnknown: "—",
    used: "занято",
    free: "свободно",
    bankFree: (n: number) => `Свободно в банке ${n}`,
    empty: "пусто",
    externalFlash: "внешняя флеш-память",
    reservedSdCache: "Зарезервировано (кэш SD)",
  },
  units: {
    b: "Б",
    kb: "КБ",
    mb: "МБ",
    gb: "ГБ",
    space: " ",
  },
};
