import type { OverviewStrings } from "./overview.js";

// Russian copy for the Overview tab. Status rows are labels and bare values: a value reads on
// its own without its label ("Защита от чтения: Включена"), and no value restates its label as
// a verb.
export const overviewRu: OverviewStrings = {
  waitingForConnection: "Ожидание подключения устройства…",
  noDevice: {
    title: "Устройство не подключено",
    body: "Для резервных копий, патчей и прошивки нужен адаптер ST-Link v2 (или совместимый), подключённый к устройству.",
    browserTitle: "Этот браузер не может обратиться к устройству",
    browserBody:
      "Для доступа к устройству нужен WebUSB. Он есть в Chrome, Edge и Opera; библиотека и источники работают в любом браузере.",
  },
  info: {
    readProtection: "Защита от чтения",
    unknownValue: "—",
    lockLocked: "Заблокировано",
    lockUnlocked: "Разблокировано",
  },
  status: {
    title: "Состояние",
    layoutLabel: "Разметка",
    layoutDual: "Двойная загрузка",
    layoutRetroGo: "Только Retro-Go",
    layoutStock: "Только заводская прошивка",
    layoutOther: "Не распознана",
    bank: (n: number) => `Банк ${n}`,
    // Russian agreement: 1, 21, 31 take "требует"; everything else takes "требуют".
    needAttention: (n: number) =>
      `${n} ${n % 10 === 1 && n % 100 !== 11 ? "требует" : "требуют"} внимания`,
    debugProbe: "Отладочный адаптер",
    firmwareBackup: "Резервная копия прошивки",
    backupNone: "Нет",
    backUpNow: "Создать копию",
    backupNotConnected: "Папка не подключена",
    backupNotThisDevice: "Нет копии для подключённой консоли",
    connectFolder: "Подключить папку",
    storage: "Хранилище",
    storageSdCard: "SD-карта",
    storageInternal: "Встроенная флеш-память",
    storageNoCard: "Карта не выбрана",
    installedFirmware: "Установленная прошивка",
    firmwareNone: "Нет",
    latestLabel: "Последняя",
    upgradeAction: "Обновить Retro-Go",
    rescan: "Пересканировать",
  },
  controls: {
    captureScreenshot: "Снимок экрана",
    capturingPercent: (pct: number) => `Снимок (${pct}%)`,
  },
  screenshot: {
    sectionLabel: "Экран",
    alt: "Снимок экрана",
    clickToDownload: "Нажмите, чтобы скачать снимок",
    noScreenshotCaptured: "Снимков пока нет",
    modalTitle: "Сделать снимок экрана",
    modalBody: "Устройство будет ненадолго остановлено для чтения буфера экрана.",
    modalConfirm: "Снять",
    rememberCheckbox: "Больше не спрашивать",
    phaseCapturing: "Съёмка экрана",
  },
  banks: {
    heading: "Встроенная флеш-память",
  },
  bankEmpty: {
    guidedSetup: "Начать пошаговую настройку",
    installStock: "Установить заводскую прошивку",
    patchStock: "Запатчить заводскую прошивку",
    installRetroGo: "Установить Retro-Go",
  },
  extFlash: {
    title: "Внешняя флеш-память",
    scanningPleaseWait: "Сканирование… Подождите",
    scan: "Сканировать",
    enterRecoveryToScan: "Войти в режим восстановления",
    freeOfTotal: (total: string) => `свободно из ${total}`,
  },
  bootModal: {
    title: "Загрузка образа",
    body: (name: string, addr: string) =>
      `Устройство будет перезапущено для загрузки ${name} с адреса ${addr}.`,
    confirm: "Загрузить",
    bankFallbackLabel: (n: number) => `Банк ${n}`,
  },
  bankButton: {
    startFirmware: (model: string) => `Запустить прошивку ${model}`,
    startRetroGo: "Запустить Retro-Go",
    startType: (type: string) => `Запустить ${type}`,
  },
  log: {
    heading: "Журнал устройства",
    readLog: "Прочитать журнал устройства",
    reading: "Чтение…",
    download: "Скачать",
  },
};
