import type { LandingStrings } from "./landing.js";

export const landingKo: LandingStrings = {
  title1: "Game & Watch 웹 빌더",
  mediaPrompt: "기기가 어떻게 개조되어 있나요?",
  flashMemory: "플래시 메모리",
  flashMemoryDesc: "게임이 내장 플래시 칩에 저장됩니다.",
  sdCard: "SD 카드",
  sdCardDesc: "게임이 SD 카드 모드에 저장됩니다.",
  title2: "무엇을 하시겠어요?",
  actionPrompt: "들어간 뒤에는 언제든지 전환할 수 있습니다.",
  manageDevice: "기기 관리",
  manageDeviceDesc: "백업, 패치, 펌웨어 설치. 어댑터가 필요합니다.",
  unsupportedBrowser: "Chromium, Chrome 또는 Edge가 필요합니다.",
  manageDeviceAdvanced: "기기 관리 (고급) →",
  manageLibrary: "라이브러리 관리",
  manageLibraryDesc: "라이브러리를 구성하고 설치합니다.",
  back: "← 뒤로",
} as const;
