import type { Widen } from "../widen.js";

export const deviceHeaderEn = {
  changeInstallationMethod: "Change Installation Method",
  connectionLost: "Connection lost",
  noConnection: "No connection",
  connectedRecoveryMode: "Connected (Recovery Mode)",
  connectedRetroGo: "Connected (Retro-Go)",
  connectedAs: (label: string) => `Connected (${label})`,
  connected: "Connected",
  scanning: "Scanning…",
  dash: "—",
  patchMissing: "Patch missing",
  notInstalled: "Not installed",
  none: "None",
  mario: "Mario",
  zelda: "Zelda",
  patched: "Patched",
  stock: "Stock",
  ofwLabel: (model: string, status: string) => `${model} (${status})`,
  toggleTheme: "Toggle light / dark",
  toggleThemeAria: "Toggle theme",
  toggleLanguage: "Toggle language",
  toggleLanguageAria: "Toggle language",
  changeMethodTitle: "Change Installation Method?",
  changeMethodBody:
    "Are you sure you want to choose a different installation method? This will disconnect your device and return you to the home page.",
  changeMethodConfirm: "Change Method",
  logoRgoAlt: "Retro-Go",
  logoOfwAlt: "Official Firmware",
  unsafeWritingStatus: "Writing flash. Do not disconnect",
  unsafeSettlingStatus: "Finishing up. Do not disconnect",
  retroGoOlderSuffix: "(older)",
  unsafeAria: "Do not disconnect the device",
} as const;

export type DeviceHeaderStrings = Widen<typeof deviceHeaderEn>;
