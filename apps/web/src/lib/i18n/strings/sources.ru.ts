import type { SourcesStrings } from "./sources.js";

// Russian copy for the Sources tab.
//
// Russian has three plural forms, and the table exposes a counted key rather than a form set,
// so each counted string derives its own form inline (the same shape the Polish siblings use).
// Where a count would force an awkward agreement, the string is phrased so the number does not
// govern a noun at all.
export const sourcesRu: SourcesStrings = {
  tab: "Источники",
  heading: "Источники",
  colCores: "Ядра",
  colHomebrew: "Homebrew",
  railLocal: "Локальные источники",
  railRemote: "Удалённые источники",
  railDirectories: "Каталоги",
  coresSubtitle: "Эмуляторы и игровые движки, добавляющие консоль на Game & Watch.",
  homebrewSubtitle: "Собственные игры и приложения для Game & Watch.",
  emptyColumn: "Нет источников",
  selectAllSources: "Select all",
  clearSelection: "Clear selection",
  allSources: "Все источники",

  addSource: "Добавить источник",
  addTitle: "Добавление источника",
  modeUrl: "URL",
  modeBundle: "ZIP-пакет",
  urlLabel: "URL источника",
  urlPlaceholder: "owner/repo или https://github.com/owner/repo",
  urlHint: "У проекта должна быть копия релизов на GitHub Pages.",
  bundleLabel: "Офлайн-пакет",
  importing: "Проверка пакета…",
  bundleUnverified: "Из пакета, не проверено",
  bundleReimport: "Импортируйте заново для установки",
  add: "Добавить",
  updateAll: "Обновить все",
  lookUp: "Найти",
  found: {
    caption: "Найдено",
    name: "Название",
    type: "Тип",
    // Not a count of installations: the row lists WHAT the source installs (German:
    // "Was installiert wird").
    installs: "Что устанавливается",
    abiSupported: "поддерживается",
  },
  adding: "Проверка проекта…",

  active: "Активен",
  inactive: "Неактивен",
  activate: "Активировать",
  deactivate: "Деактивировать",
  configure: "Настроить",
  remove: "Удалить",
  loading: "Загрузка…",
  retry: "Повторить",
  curatedUnreadable: (count: number) => {
    const d = count % 10, h = count % 100;
    const form =
      d === 1 && h !== 11
        ? "рекомендованный источник"
        : d >= 2 && d <= 4 && !(h >= 12 && h <= 14)
          ? "рекомендованных источника"
          : "рекомендованных источников";
    return `Не удалось прочитать ${count} ${form}`;
  },
  noSelection: "Выберите источник, чтобы настроить его.",
  backToSources: "К списку источников",
  notActiveHint: "Не активен. При активации появится на вкладке «Библиотека».",
  activeHint: "Активен. Установка со вкладки «Библиотека».",

  // "найдено" is impersonal and neuter, so it is correct after every count.
  romsMatched: (count: number) => `${count} ROM найдено`,
  oneRomMatched: "1 ROM найден",
  noRoms: "Найдено ROM: 0",
  noRomFolder: "Папка с ROM не выбрана",
  needsUserFiles: "Требуются дополнительные файлы",
  prerelease: "Предрелиз",
  needsNewerFirmware: "Нужна более новая прошивка",

  errBadUrl: "Это не ссылка на репозиторий GitHub.",
  errNoPages: "У этого репозитория нет копии на GitHub Pages, поэтому браузер не может прочитать его файлы.",
  errNoVersions: "У репозитория есть сайт на GitHub Pages, но он не публикует dist/versions.json.",
  errMalformed: "Проект опубликовал файл, который этот инструмент не смог прочитать.",
  errUnsupportedSchema: (version: string) =>
    `Проект использует формат распространения ${version}, который этот инструмент не поддерживает. Обновите инструмент.`,
  errNetwork: "Не удалось связаться с проектом. Проверьте соединение и повторите.",
  errPrepareUnreadable: "Этот источник опубликовал конвертер, который не удалось запустить.",
  errPrepareInput: "Предоставленный вами файл не принят.",
  errPrepareCollision: "Два файла различаются только регистром, поэтому карта вместит только один из них.",
  errPrepareInterrupted: "Преобразование не завершилось.",
  filePrompt: {
    title: (name: string) => `${name}: нужны дополнительные файлы`,
    subtitleBios: (name: string) => `Игры ${name} без него не запустятся.`,
    subtitleConverted: "Файлы преобразуются в браузере. Ничего не отправляется на сервер.",
    fallbackInputLabel: (id: string) => `Файл «${id}»`,
    required: "обязательный",
    optional: "необязательный",
    choose: "Выбрать",
    chooseFolder: "Выбрать папку",
    found: "Найдено",
    added: "Добавлено",
    // Label-and-value, so the number governs nothing and no form is needed.
    addedCount: (count: number) => `Добавлено: ${count}`,
    expectedSha: "Ожидаемый SHA-1",
    currentSha: "Текущий",
    optionalTail: (count: number) => {
      const d = count % 10, h = count % 100;
      const form =
        d === 1 && h !== 11
          ? "необязательный файл"
          : d >= 2 && d <= 4 && !(h >= 12 && h <= 14)
            ? "необязательных файла"
            : "необязательных файлов";
      return `${count} ${form}`;
    },
    errInvalid: (name: string) => `Файл ${name} недействителен`,
    errTooLarge: (limit: string) => `Этот файл превышает допустимый размер (${limit}).`,
    errMissing: "Выберите файл, чтобы продолжить.",
    errNotMultiple: "Это поле принимает только один файл.",
    errUnusable: "Этот файл здесь не подходит.",
    errRead: "Не удалось прочитать этот файл.",
    submitPrepare: "Подготовить",
    submitAddToLibrary: "Добавить в библиотеку",
  },
  errBundleInvalid: "Этот файл не является ZIP-пакетом, понятным этому инструменту.",
  errBundleMissingFile: "Манифест пакета называет файл, которого нет в архиве.",
  errBundleConflict: "Уже добавлен из своего репозитория.",
  bios: {
    label: "BIOS",
    needsAFile: "нужен файл",
    missingFile: "Файл отсутствует",
    missingDetail: (system: string, filename: string) => `Для ${system} нужен ${filename}.`,
  },
  detail: {
    version: "Версия",
    getOlderVersion: "Выбрать старую версию",
    compatibility: "Совместимость",
    abiLabel: "ABI прошивки",
    published: "Опубликовано",
    installs: "Что устанавливается",
    total: "Всего",
    typeBinary: "двоичный",
    typeData: "данные",
    typeBuilt: "сборка",
    notBuiltYet: "ещё не собрано",
  },
  additional: {
    heading: "Дополнительные файлы",
    hashMatches: "Хеш совпадает",
    required: "Обязательный",
    optional: "Необязательный",
    requiredFor: (extensions: string) => `Нужен для ${extensions}`,
    chooseFile: "Выбрать файл",
  },
  release: {
    heading: "Релиз",
    needsUserFiles: "Нужны файлы пользователя",
    yes: "Да",
    no: "Нет",
    requiresAbi: "Требуется ABI",
    abiOrNewer: (version: number) => `${version} или новее`,
    validTargets: "Допустимые цели",
    storageFlash: "Флеш-память",
    storageSd: "SD-карта",
    systems: "Системы",
    fileTypes: "Типы файлов",
  },
  folders: {
    heading: "Источники",
    none: "Папок пока нет.",
    // Both agree with "папка", which is what the chip labels.
    shared: "Общая",
    dedicated: "Назначенная",
    missing: "Отсутствует",
    needsPermission: "Нужно разрешение",
    usedBy: "Используется",
    biosGroup: "Системные файлы",
    biosUsedBy: "BIOS",
    ofwBackupUsedBy: 'Копия OFW',
    any: "Любые",
    count: (n: number) => {
      const d = n % 10, h = n % 100;
      if (d === 1 && h !== 11) return `${n} папка`;
      if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return `${n} папки`;
      return `${n} папок`;
    },
    addDirectoryTitle: "Добавление каталога",
    fieldFolder: "Папка",
    fieldName: "Название",
    nameOptional: "(необязательно)",
    noFolderChosen: "Папка не выбрана",
    choose: "Выбрать…",
    chooseAgain: "Разрешить доступ, выбрав папку ещё раз",
    subtitleDirectories: "Папки с вашими играми и файлами homebrew.",
    configureDirectoryTitle: "Настройка каталога",
    save: "Сохранить",
  },
  cache: {
    heading: "Кэш",
    contents: "Содержимое",
    storage: "Хранилище",
    catFirmware: "Пакеты прошивки",
    catArtifact: "Артефакты источников",
    catConverter: "Модули конвертеров",
    catConverted: "Преобразованные файлы",
    catCover: "Обложки",
    catOffline: "Офлайн-пакеты",
    catOther: "Прочее",
    clear: "Очистить",
    total: "Всего",
    files: (n: number) => {
      const d = n % 10, h = n % 100;
      if (d === 1 && h !== 11) return `${n} файл`;
      if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return `${n} файла`;
      return `${n} файлов`;
    },
    used: "Занято",
    usedOf: (used: string, quota: string) => `${used} из ${quota}`,
    protected: "Защищено",
    protectedHelp: "Браузер не удалит эти данные ради освобождения места.",
    keptYes: "Да",
    keptNo: "Нет",
    empty: "Очистить кэш",
  },
  sd: {
    heading: "SD-карта",
    card: "Карта",
    contents: "Содержимое",
    capacity: "Ёмкость",
    files: "Файлы",
    total: "Всего",
    none: "Нет",
    rescan: "Пересканировать",
    unreadable: "Не удалось прочитать эту папку.",
    freeOf: (free: string, capacity: string) => `${free} свободно из ${capacity}`,
    fileCount: (n: number) => n === 1 ? "1 файл" : `${n} файлов`,
    truncEntries: (limit: string) => `Слишком много файлов на SD-карте. Невозможно подсчитать более ${limit} файлов`,
    truncDepth: "Папки на этой карте вложены слишком глубоко, чтобы сосчитать их все.",
    truncFile: "Не удалось прочитать файл на этой карте, поэтому эти суммы являются минимальными.",
    catBios: "BIOS",
    catCovers: "Обложки",
    catFonts: "Шрифты",
    catHomebrew: "Homebrew",
    catLanguage: "Язык",
    catRoms: "ROM",
    catSaves: "Сохранения",
    catScreenshots: "Скриншоты",
    catOther: "Прочее",
  },
};
