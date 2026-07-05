import type { LandingStrings } from "./landing.js";

export const landingKo: LandingStrings = {
  title: "Game & Watch",
  mediaPrompt: "플래시 메모리 기기인가요, SD 카드 모드 기기인가요?",
  flashMemory: "플래시 메모리",
  sdCard: "SD 카드",
  actionPrompt: "무엇을 관리하시겠어요?",
  manageDevice: "기기 관리",
  unsupportedBrowser: "(지원되지 않는 브라우저)",
  requiresAdapter: "(어댑터 필요)",
  manageDeviceAdvanced: "기기 관리 (고급)",
  manageGames: "게임 관리",
  romsCollection: "(ROM 모음)",
  back: "← 뒤로",
} as const;
