import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailKo: OverviewRailStrings = {
  groupConsole: "본체",
  groupLogs: "로그",
  details: "세부 정보",

  externalFlash: "외장 플래시",
  adapter: "어댑터",
  thisApp: "이 앱",

  capacity: "용량",

  probe: "프로브",
  deviceUid: "기기 UID",

  sources: "소스",
  sourcesCount: (listed: number, active: number) => `${listed}개 중 ${active}개 활성`,
  browserCache: "브라우저 캐시",
  appVersion: "앱 버전",

  copyDetails: "세부 정보 복사",

  output: "출력",
  copy: "복사",
  save: "저장",
};
