import type { DeviceHeaderStrings } from "./deviceHeader.js";

export const deviceHeaderUk: DeviceHeaderStrings = {
  changeInstallationMethod: "Змінити спосіб встановлення",
  connectionLost: "З’єднання втрачено",
  noConnection: "Немає з’єднання",
  connectedRecoveryMode: "Підключено (режим відновлення)",
  connectedRetroGo: "Підключено (Retro-Go)",
  connectedAs: (label: string) => `Підключено (${label})`,
  connected: "Підключено",
  scanning: "Сканування…",
  dash: "—",
  patchMissing: "Патч відсутній",
  notInstalled: "Не встановлено",
  none: "Немає",
  mario: "Mario",
  zelda: "Zelda",
  // Both wear the feminine ending: the chip reads `Mario (Оригінальна)`, and the noun it
  // agrees with is `прошивка`, which the chip itself never prints.
  patched: "Пропатчена",
  stock: "Оригінальна",
  ofwLabel: (model: string, status: string) => `${model} (${status})`,
  toggleTheme: "Світла / темна тема",
  toggleThemeAria: "Перемкнути тему",
  toggleLanguage: "Змінити мову",
  toggleLanguageAria: "Змінити мову",
  changeMethodTitle: "Змінити спосіб встановлення?",
  // The title already asks; the body states only the consequence.
  changeMethodBody:
    "Пристрій буде від’єднано, і ви повернетеся на початкову сторінку.",
  changeMethodConfirm: "Змінити спосіб",
  logoRgoAlt: "Retro-Go",
  logoOfwAlt: "Офіційна прошивка",
  unsafeWritingStatus: "Запис у флеш-пам’ять. Не від’єднуйте",
  unsafeSettlingStatus: "Завершення. Не від’єднуйте",
  retroGoOlderSuffix: "(старіша)",
  unsafeAria: "Не від’єднуйте пристрій",
} as const;
