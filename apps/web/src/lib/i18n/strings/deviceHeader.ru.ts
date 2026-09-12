import type { DeviceHeaderStrings } from "./deviceHeader.js";

// Russian copy for the device header. Address register across every ru file: formal plural
// imperative ("Выберите", "Подключите") for actions the user performs, bare nouns for status
// values. `patched`/`stock` are lowercase because they are only ever substituted into
// `ofwLabel`'s parentheses, never shown alone.
export const deviceHeaderRu: DeviceHeaderStrings = {
  changeInstallationMethod: "Сменить способ установки",
  connectionLost: "Соединение потеряно",
  noConnection: "Нет соединения",
  connectedRecoveryMode: "Подключено (режим восстановления)",
  connectedRetroGo: "Подключено (Retro-Go)",
  connectedAs: (label: string) => `Подключено (${label})`,
  connected: "Подключено",
  scanning: "Сканирование…",
  dash: "—",
  patchMissing: "Нет патча",
  notInstalled: "Не установлено",
  none: "Нет",
  mario: "Mario",
  zelda: "Zelda",
  patched: "с патчем",
  stock: "заводская",
  ofwLabel: (model: string, status: string) => `${model} (${status})`,
  toggleTheme: "Светлая / тёмная тема",
  toggleThemeAria: "Переключить тему",
  toggleLanguage: "Сменить язык",
  toggleLanguageAria: "Сменить язык",
  changeMethodTitle: "Сменить способ установки?",
  changeMethodBody:
    "Выбрать другой способ установки? Устройство будет отключено, и вы вернётесь на главную страницу.",
  changeMethodConfirm: "Сменить способ",
  logoRgoAlt: "Retro-Go",
  logoOfwAlt: "Официальная прошивка",
  unsafeWritingStatus: "Запись во флеш-память. Не отключайте",
  unsafeSettlingStatus: "Завершение. Не отключайте",
  retroGoOlderSuffix: "(устаревшая)",
  unsafeAria: "Не отключайте устройство",
};
