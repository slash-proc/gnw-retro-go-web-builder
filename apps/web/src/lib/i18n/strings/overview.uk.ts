import type { OverviewStrings } from "./overview.js";

export const overviewUk: OverviewStrings = {
  waitingForConnection: "Очікування підключення пристрою…",
  noDevice: {
    title: "Пристрій не підключено",
    body: "Для резервних копій, патчів і прошивки потрібен адаптер ST-Link v2 (або сумісний), під’єднаний до пристрою.",
    browserTitle: "Цей браузер не має доступу до пристрою",
    browserBody:
      "Доступ до пристрою потребує WebUSB. Він є в Chrome, Edge і Opera; Бібліотека та Джерела працюють у будь-якому браузері.",
  },
  info: {
    readProtection: "Захист від читання",
    unknownValue: "—",
    // The value is the DEVICE's state, not whether the protection is switched on: the German
    // sibling reads Gesperrt / Entsperrt, and the row stands alone in its column.
    lockLocked: "Заблоковано",
    lockUnlocked: "Розблоковано",
  },
  status: {
    title: "Стан",
    layoutLabel: "Розмітка",
    layoutDual: "Подвійне завантаження",
    layoutRetroGo: "Лише Retro-Go",
    layoutStock: "Лише оригінальна прошивка",
    layoutOther: "Не розпізнано",
    bank: (n: number) => `Банк ${n}`,
    // Ukrainian takes a singular verb for 1, 21, 31… and a plural one for everything else,
    // except the teens. `уваги` is genitive and never changes, so only the verb moves.
    needAttention: (n: number) =>
      n % 10 === 1 && n % 100 !== 11 ? `${n} потребує уваги` : `${n} потребують уваги`,
    debugProbe: "Адаптер налагодження",
    firmwareBackup: "Резервна копія прошивки",
    backupNone: "Немає",
    backUpNow: "Створити копію",
    backupNotConnected: "Теку не підключено",
    backupNotThisDevice: "Немає копії для підключеної консолі",
    connectFolder: "Підключити теку",
    storage: "Сховище",
    storageSdCard: "SD-картка",
    storageInternal: "Внутрішня флеш-пам’ять",
    storageNoCard: "Картку не вибрано",
    installedFirmware: "Встановлена прошивка",
    firmwareNone: "Немає",
    latestLabel: "Найновіша",
    upgradeAction: "Оновити Retro-Go",
    rescan: "Пересканувати",
  },
  controls: {
    captureScreenshot: "Зробити знімок екрана",
    capturingPercent: (pct: number) => `Знімок (${pct}%)`,
  },
  screenshot: {
    sectionLabel: "Екран",
    alt: "Знімок екрана",
    clickToDownload: "Натисніть, щоб завантажити знімок",
    noScreenshotCaptured: "Ще нічого не знято",
    modalTitle: "Зробити знімок екрана",
    modalBody: "Пристрій ненадовго зупиниться, щоб зчитати буфер дисплея.",
    modalConfirm: "Зняти",
    rememberCheckbox: "Більше не питати",
    phaseCapturing: "Знімок екрана",
  },
  banks: {
    heading: "Внутрішня флеш-пам’ять",
  },
  bankEmpty: {
    guidedSetup: "Почати покрокове налаштування",
    installStock: "Встановити оригінальну прошивку",
    patchStock: "Пропатчити оригінальну прошивку",
    installRetroGo: "Встановити Retro-Go",
  },
  extFlash: {
    title: "Зовнішня флеш-пам’ять",
    scanningPleaseWait: "Сканування… Зачекайте",
    scan: "Сканувати",
    enterRecoveryToScan: "Увійти в режим відновлення для сканування",
    freeOfTotal: (total: string) => `вільно з ${total}`,
  },
  bootModal: {
    title: "Завантажити образ",
    body: (name: string, addr: string) =>
      `Пристрій перезапуститься і завантажить ${name} з ${addr}.`,
    confirm: "Завантажити",
    bankFallbackLabel: (n: number) => `Банк ${n}`,
  },
  bankButton: {
    startFirmware: (model: string) => `Запустити прошивку ${model}`,
    startRetroGo: "Запустити Retro-Go",
    startType: (type: string) => `Запустити ${type}`,
  },
  log: {
    heading: "Журнал пристрою",
    readLog: "Зчитати журнал пристрою",
    reading: "Читання…",
    download: "Завантажити",
  },
} as const;
