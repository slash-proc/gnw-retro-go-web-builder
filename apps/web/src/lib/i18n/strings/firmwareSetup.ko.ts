import type { AdvancedStrings } from "./firmwareSetup.js";
import type { OfficialFirmwareStrings } from "./firmwareSetup.js";
import type { RomSectionStrings } from "./firmwareSetup.js";
import type { DumpSectionStrings } from "./firmwareSetup.js";
import type { FlashSectionStrings } from "./firmwareSetup.js";
import type { EraseSectionStrings } from "./firmwareSetup.js";
import type { FileBrowserSectionStrings } from "./firmwareSetup.js";
import type { RetroGoTabStrings } from "./firmwareSetup.js";
import type { ExpertCornerStrings } from "./firmwareSetup.js";
import type { DeferredSectionStrings } from "./firmwareSetup.js";

export const advancedKo: AdvancedStrings = {
  tabbarLabel: "고급 도구",
  tabOverview: "개요",
  tabFirmwareSetup: "펌웨어 설정",
  tabRoms: "ROM",
  waitingForDevice: "기기 연결을 기다리는 중…",
  modeGuidedSetup: "간편 설정",
  modeAdvanced: "고급",
  expertHeading: "전문가",
  backToAdvanced: "← 고급으로 돌아가기",
} as const;

export const officialFirmwareKo: OfficialFirmwareStrings = {
  step1Title: "펌웨어 백업",
  chromiumRequired: "폴더 선택에는 Chromium 계열 브라우저가 필요해요 (WebUSB와 동일).",
  pickFolderIntro: "순정 백업이 들어 있는 폴더를 선택하거나, 백업을 저장할 빈 폴더를 선택하세요.",
  pickFolderLookForPre: "다음 파일을 찾아서",
  pickFolderBodyPost: "확인해요.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "다른 폴더 선택",
  chooseBackupFolder: "백업 폴더 선택",
  reconnectLastFolder: "마지막 폴더 다시 연결",
  backupsFoundLegend: (plural: boolean) => `이 폴더에서 찾은 순정 백업`,
  validChip: "✓ 유효함",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ 유효하지 않음 (내장 ${internalOk ? "✓" : "✗"} · 외장 ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ 유효한 ${model} 순정 백업을 선택했어요.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `${model} 백업 검증에 실패했어요 (내장 ${internalOk ? "✓" : "✗"} · 외장 ${externalOk ? "✓" : "✗"}). 아래에서 새로 백업하세요.`,
  noBackupYet: "이 폴더에는 아직 순정 백업이 없어요 — 아래에서 연결된 기기의 백업을 만드세요.",
  alreadyPatchedNoticePre: "이 기기는 이미",
  alreadyPatchedNoticeBold: "패치된 Retro-Go",
  alreadyPatchedNoticePost:
    "펌웨어로 동작하고 있어서 백업할 순정 펌웨어가 없어요.",
  alreadyPatchedNoticeDifferentBold: "다른",
  alreadyPatchedNoticeEnd:
    "공식 펌웨어(예: 마리오 ↔ 젤다)를 설치하려면 위에서 마리오 또는 젤다 순정 백업이 들어 있는 폴더를 선택한 뒤 아래에서 패치하세요.",
  unlockDeviceLabel: "기기 잠금 해제",
  unlockDeviceHint: "(RDP 읽기 보호를 해제해요 — 잠긴 기기를 읽으려면 필요해요)",
  backingUp: "백업 중…",
  backUpNow: "지금 백업",
  connectToBackUp: "백업하려면 기기를 연결하세요.",
  optInToUnlock: "잠긴 기기를 백업하려면 잠금 해제에 동의하세요.",
  step2Title: "펌웨어 패치",
  step2Body: (model: string) =>
    `${model} 순정 펌웨어를 패치해서 Retro-Go와의 듀얼 부팅을 지원하게 해요.`,
  installBootloaderLabel: "부트로더 설치",
  installBootloaderHint: "(권장)",
  crossModelDangerBold: "⚠ 기종 불일치:",
  crossModelDangerBody:
    "이 펌웨어는 젤다용이지만, 연결된 하드웨어는 마리오로 인식됐어요. 마리오 하드웨어에는 젤다에 필요한 버튼 두 개가 없어서, 결과물 일부가 작동하지 않을 수 있어요.",
  crossModelAck: "이해했으며, 그래도 마리오 하드웨어에 젤다 펌웨어를 플래시하겠습니다",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `참고: 백업은 ${deviceModel} 하드웨어용 ${backupModel} 펌웨어예요 — 이 조합은 허용돼요.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ 이 ${model} 백업의 외장 이미지(${backupMb} MB)가 이 기기의 외장 플래시(${deviceMb} MB)보다 커요 — 물리적으로 맞지 않아 여기서는 플래시할 수 없어요.`,
  enteringRecoveryMode: "복구 모드로 진입 중…",
  enterRecoveryMode: "복구 모드 진입",
  patchFirmwareButton: "펌웨어 패치",
  connectToPatchAndFlash: "패치하고 플래시하려면 기기를 연결하세요.",
  patchedAndFlashed: "✓ 패치 및 플래시 완료.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `${model} 순정 펌웨어를 패치${withBootloader ? " (SD 카드 부트로더 포함)" : ""}하고 플래시해요: 내장 → 뱅크 1, 외장 → 뱅크 0. 쓰는 동안 기기를 옮기거나 뽑지 마세요 — 플래시가 실패할 수 있어요.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ 젤다에 필요한 버튼 두 개가 없는 마리오 하드웨어에 젤다 펌웨어를 플래시하려고 해요. ${base}`,
  modalTitle: "공식 펌웨어를 패치하고 플래시할까요?",
  modalConfirmText: "패치 & 플래시",
  phasePatch: "펌웨어 패치",
  phaseFlashInternal: "내장 플래시 (뱅크 1)",
  phaseFlashExternal: "외장 플래시",
  phaseRescan: "기기 다시 스캔",
  errDeviceLocked: '기기가 잠겨 있어요 (RDP 읽기 보호). 백업 전에 "기기 잠금 해제"를 선택해서 보호를 해제하세요.',
  errFirmwareMismatch: "읽어 온 펌웨어가 알려진 마리오/젤다 순정 ROM과 일치하지 않아요 — 백업이 저장되지 않았어요.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logPatchingModel: (model: string) => `Patching firmware for model: ${model}.`,
} as const;

export const romSectionKo: RomSectionStrings = {
  regionIntflash: "내장 펌웨어",
  regionFrogfs: "게임, BIOS, 언어",
  regionLittlefs: "코어, 세이브",
  phasePrepare: "기기 준비",
  phaseDownload: "펌웨어 다운로드",
  phaseMigrateScan: "기존 기기 상태 읽기",
  subFrogfsState: "이전 게임 상태 읽기",
  subLfsExtract: "코어/세이브 데이터 추출",
  subGamesMigrate: "설치된 게임 이전",
  phasePrepareInstallImage: "설치 이미지 준비",
  subSdCache: "SD 캐시 예약 오프셋 경계 설정",
  phaseBuildInstallImage: "설치 이미지 생성",
  subBuildFrogfs: "게임, BIOS, 언어 이미지 생성",
  subBuildLittlefs: "코어/세이브 이미지 생성",
  subPatchSuperblock: "슈퍼블록 패치",
  phaseFlashingToDevice: "기기에 플래시 중",
  phaseRescan: "기기 다시 스캔",
  phaseSyncSdCores: "SD 카드에 코어 동기화",
  chooseSdCard: "SD 카드 선택",
  flashRetroGo: "Retro-Go 플래시",
  flashInternalFirmware: "내장 펌웨어 플래시",
  flashGamesBiosLanguages: "게임, BIOS, 언어 플래시",
  flashEmulatorsSaves: "코어, 세이브 플래시",
  flashThisInstall: "이 설치를 플래시할까요?",
  flashRegions: (joined: string) => `${joined}을(를) 플래시할까요?`,
  regionInternalFirmware: "내장 펌웨어",
  regionGamesBiosLanguages: "게임, BIOS, 언어",
  regionEmulatorsSaves: "코어, 세이브",
  flashBody: (writes: string) => `기록 대상: ${writes}. 작업이 끝날 때까지 기기를 뽑지 마세요.`,
  nameInternalFirmware: (bank: number) => `내장 펌웨어 → 뱅크 ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `게임, BIOS, 언어 → 외장 ${addr}`,
  nameEmulatorsSaves: (addr: string) => `코어, 세이브 → 외장 ${addr}`,
  flashConfirmText: "플래시",
  selectSdCard: "SD 카드 선택",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "아직 게시된 펌웨어 버전이 없어요.",
  logDownloadingBundle: (tag: string) => `Downloading firmware bundle ${tag}…`,
  logBundleDownloaded: (tag: string, mib: string) => `Bundle ${tag} downloaded (${mib} MiB).`,
  logSameVersionRepair: (tag: string) => `Same-version repair (${tag}) — forcing games migration on.`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) =>
    `Target version: ${tag}. Migrate games: ${migrateGames}, migrate saves/settings: ${migrateLfs}.`,
  logReadPreviousGameState: "Read previous game state.",
  logCouldNotReadPreviousGameState: "Could not read previous game state (continuing).",
  logExtractedSavesData: (count: number) => `Extracted emulators/saves data for migration (${count} entries).`,
  logCouldNotExtractSavesData: "Could not extract emulators/saves data for migration (continuing).",
  logMigratedGames: (count: number) => `Migrated ${count} installed game(s).`,
  logSkippedGameMigration: "Skipping game migration (not requested or none installed).",
  logGamesBiosLanguagesBuilt: "Games, BIOS, languages image built.",
  logEmulatorsSavesBuilt: "Emulators/saves image built.",
  logSuperblockPatched: "Superblock patched into intflash blob.",
  logSdCacheBoundarySet: (offset: number) =>
    `SD cache reserved-offset set to ${offset} bytes (keeps the round-robin ROM cache clear of existing reserved/OFW data).`,
  logConfirmingLinkResponsive: "Confirming link is responsive…",
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `외장 데이터(${payloadMb} MB)가 이 기기의 외장 플래시(${deviceMb} MB)를 초과해요 — 플래시할 수 없어요.`,
  logRescanning: "Rescanning device geometry and installed games…",
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "설치할 버전",
  migrateGamesLabel: "게임 이전",
  migrateSavesLabel: "세이브와 설정 이전",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `설치 대상: 뱅크 ${bank} ${dualBoot ? "(듀얼 부팅, 순정 유지)" : "(순정 덮어씀)"}`,
  retroGoOnlyNotice:
    "뱅크 1에서 순정 펌웨어가 감지되지 않아서 추정 대상이 뱅크 1이 됐어요 — 이번 설치는 듀얼 부팅 없이 Retro-Go만 설치돼요.",
  bank1StockOfwNotice:
    '뱅크 1에 패치되지 않은 순정 펌웨어가 있어요 — 패치하기 전까지는 Retro-Go에 접근할 수 없어요 (위의 "백업 & 패치" 참고).',
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `기기가 ${deviceBuild} 빌드로 보여요. 현재 보고 있는 화면은 ${viewingMode} 모드예요.`,
  layoutAdvancedToggle: "레이아웃 (고급)",
  sdCacheOffsetLabel: "SD 캐시 오프셋",
  frogfsOffsetLabel: "FrogFS 오프셋",
  offsetHint: "(0x90000000부터의 바이트 수; 하단을 예약해요)",
  autoPlaceholder: (hex: string) => `자동 (${hex})`,
  littlefsSizeLabel: "LittleFS 크기",
  littlefsSizeHint: "(8 MiB 이상)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `기본값: FrogFS 오프셋은 기기 레이아웃에 따라 하단을 자동으로 예약해요. 둘 다 ${blockSize} B 소거 블록 단위로 올림돼요.`,
  scanningProgress: (pct: number) => `스캔 중… ${pct}%`,
  scanFailed: (err: string) => `스캔 실패: ${err}`,
  scanToSeeLayout: "기기를 스캔하면 현재 플래시 레이아웃을 볼 수 있어요.",
  connectToSizeAndFlash: "설치 크기를 계산하고 플래시하려면 기기를 연결하세요.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range} · ${mib} MiB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range} · ${mib} MiB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `기기 끝 ${devEnd} · 블록 ${blockSize} B · 여유 ${freeMib} MiB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `검사: 칩끝-일치 ${endsAtChip ? "✓" : "✗"} · 겹침없음 ${noOverlap ? "✓" : "✗"} · 정렬됨 ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `시스템: ${systems || "(없음)"}`,
  startBankLabel: (bank: number) => `뱅크 ${bank} 시작`,
  readBackSuperblockDebug: "슈퍼블록 다시 읽기 (디버그)",
  chipTextFlashing: "플래시 중",
  chipTextInstalled: "✓ 설치됨",
  chipTextFileCount: (count: number) => `파일 ${count}개`,
  chipTextIdle: "대기 중",
  startedBankResult: (bank: number) =>
    `뱅크 ${bank}을(를) 시작했어요. 이제 기기가 해당 펌웨어로 실행 중이며 스텁은 더 이상 활성 상태가 아니에요 — 앱을 다시 사용하려면 다시 연결하거나 기기 전원을 껐다 켜세요.`,
} as const;

export const dumpSectionKo: DumpSectionStrings = {
  title: "플래시 덤프",
  scanningDevice: "기기 스캔 중…",
  intro: "임의 뱅크의 임의 영역을 파일로 다운로드해요. 읽는 도중 취소할 수 있어요.",
  internalFlashTitle: "내장 플래시",
  externalFlashTitle: "외장 플래시",
  bankLabel: "뱅크",
  offsetLabel: "오프셋",
  offsetPlaceholder: "0x0",
  lengthLabel: "길이",
  lengthPlaceholder: "전체 영역",
  quickFillWholeRegion: "전체 영역",
  quickFill128Kib: "128 KiB",
  quickFill1Mib: "1 MiB",
  quickFillStockOfw: "순정 OFW 내장 플래시 (0–0x20000)",
  lockedNotice:
    "🔒 기기가 잠긴 동안에는 내장 플래시를 읽을 수 없어요 — 간편 설정의 백업 단계에서 자동으로 잠금이 해제돼요. " +
    "(뱅크 0 / 외장은 계속 읽을 수 있어요.)",
  lengthBlankHint: "길이를 비워 두면 오프셋부터 전체 영역을 읽어요.",
  planLine: (from: string, to: string) => `계획: ${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes}바이트 → ${filename}`,
  overrunWarning: (clamped: string) => `길이가 영역을 초과해서 ${clamped}바이트로 제한돼요.`,
  enterRecoveryMode: "복구 모드 진입",
  dumpToFile: "파일로 덤프",
  invalidHint: "유효한 오프셋과 길이를 입력하세요.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "취소",
  cancelHint: "읽기는 데이터를 손상시키지 않아요 — 취소하면 부분 덤프만 버려져요 (파일이 생성되지 않아요).",
  readingPct: (pct: number) => `읽는 중 ${pct}%`,
  lockedChip: "잠김",
  canceledChip: "취소됨",
  errorChip: "오류",
  resultSummary: (mib: string, secs: number) => `${mib} MiB를 ${secs}초 만에 읽었어요`,
} as const;

export const flashSectionKo: FlashSectionStrings = {
  title: "플래시 쓰기",
  scanningDevice: "기기 스캔 중…",
  enterRecoveryMode: "복구 모드 진입",
  intro: "임의 뱅크/오프셋에 임의 이미지를 기록해요. 기록 전에 확인을 거쳐요.",
  imageFileLabel: "이미지 파일",
  chooseImage: "이미지 선택",
  bankLabel: "뱅크",
  offsetLabel: "오프셋",
  offsetPlaceholder: "0x0",
  transferOptions: "전송 옵션",
  compressLabel: "LZMA 압축",
  compressHint: "(전송이 더 빠르며, 기기가 압축을 해제해요; 도움이 안 되면 자동으로 건너뛰어요)",
  verifyLabel: "쓰기 검증",
  verifyHint: "(전송 오류를 확인하기 위해 각 버퍼를 다시 읽어요; 더 느려요)",
  lockedNotice:
    "🔒 내장 플래시가 잠겨 있어요 — 잠긴 기기는 쓰기를 거부해요. 간편 설정의 백업 단계에서 자동으로 잠금이 해제돼요. " +
    "(뱅크 0 / 외장은 계속 쓸 수 있어요.)",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `계획: 뱅크${bank} (${base}) + ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} B → 패딩 후 ${padded} B (${paddedHex})`,
  alignWarning: (align: number, kind: string) => `오프셋은 ${align}의 배수여야 해요 (${kind}플래시 정렬).`,
  overrunWarning: (region: string) => `이미지가 ${region} B 영역을 초과해요.`,
  ackLabel: "이 작업이 펌웨어 뱅크를 덮어쓴다는 것을 이해했으며, 백업이 있어요.",
  flashImageButton: "이미지 플래시…",
  modalTitle: "이 이미지를 플래시할까요?",
  modalConfirmText: "플래시",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `계획: 뱅크${bank} (${base}) + ${offset} ← ${filename} (${size} B, 패딩 후 → ${padded}). ` +
    `작업이 끝날 때까지 기기를 뽑지 마세요.`,
  phaseFlashingImage: "이미지 플래시 중",
  writingChip: "쓰는 중",
  lockedChip: "잠김",
  extIntWordExt: "외장",
  extIntWordInt: "내장",
} as const;

export const eraseSectionKo: EraseSectionStrings = {
  title: "플래시 지우기",
  scanningDevice: "기기 스캔 중…",
  enterRecoveryMode: "복구 모드 진입",
  intro: "아래에서 파티션을 클릭해 지울 대상을 선택하세요. Ctrl/Cmd를 누른 채로 클릭하면 여러 파티션을 선택할 수 있어요.",
  internalFlashTitle: "내장 플래시",
  externalFlashTitle: "외장 플래시",
  lockedNotice:
    "🔒 내장 플래시가 잠겨 있어요 — 잠긴 기기는 쓰기를 거부해요. 간편 설정의 백업 단계에서 자동으로 잠금이 해제돼요. " +
    "(외장 플래시는 계속 지울 수 있어요.)",
  selectedTitle: "선택됨:",
  bankWipeWarning: "주의: 내장 뱅크를 지우면 운영체제(순정 또는 Retro-Go)가 손상될 수 있어요!",
  eraseButton: (plural: boolean) => `파티션 지우기…`,
  modalTitle: (count: number, plural: boolean) => `파티션 ${count}개를 지울까요?`,
  modalBody: (plural: boolean) =>
    `선택한 파티션을 0xFF로 채워서 영구적으로 지워요. 그 안의 모든 데이터나 펌웨어는 사라져요.`,
  modalConfirmText: "지우기",
  phaseErase: "지우기",
  phaseRescan: "기기 다시 스캔",
  partitionAtFallback: (addr: string) => `${addr}의 파티션`,
  erasingLog: (label: string, size: string, addr: string) => `${label}을(를) 지우는 중 (${addr}에서 ${size} B)…`,
  partitionFallback: "파티션",
  rescanningLog: "기기 지오메트리를 다시 스캔하는 중…",
  erasingChip: "지우는 중",
  lockedChip: "잠김",
  selectedSizeAt: (size: string, addr: string) => `(${addr}에서 ${size}바이트)`,
} as const;

export const fileBrowserSectionKo: FileBrowserSectionStrings = {
  intro: "아래 막대에서 파일 시스템 파티션을 선택하면 파일을 볼 수 있어요.",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "FrogFS에서 파일을 찾을 수 없어요.",
  noLittlefsFiles: "LittleFS에서 파일을 찾을 수 없어요.",
  readingLittlefs: (pct: number) => `SWD로 LittleFS 파티션을 읽는 중 (${pct}%)...`,
  browserNotAvailable: (kind: string) => `${kind}용 파일 브라우저를 사용할 수 없어요.`,
  downloadTitle: (path: string) => `기기에서 ${path} 내려받기`,
  downloadNeedsRecovery: "파일을 내려받으려면 복구 모드로 진입하세요.",
  downloadFailed: (err: string) => `내려받기에 실패했어요: ${err}`,
} as const;

export const retroGoTabKo: RetroGoTabStrings = {
  officialFirmwareHeading: "공식 펌웨어",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "플래시 관리",
  backupAndPatchTitle: "백업 & 패치",
  installRetroGoTitle: "Retro-Go 설치",
  reinstallRetroGoTitle: "Retro-Go 다시 설치",
  fileBrowserTitle: "파일 브라우저",
  scanningDevice: "기기 스캔 중…",
  enterRecoveryMode: "복구 모드 진입",
} as const;

export const expertCornerKo: ExpertCornerStrings = {
  warnBanner:
    "전문가 영역 — 여기 있는 기능은 거의 아무도 필요하지 않아요. 대부분의 사용자에게 " +
    "위험하거나 쓸모없는 컨트롤이며, 그 기능 자체를 잃지 않기 위해서만 남겨 두었어요.",
  manualRelockTitle: "수동 재잠금",
  manualRelockChip: "아직 사용 불가",
  manualRelockWill: "기기의 읽기 보호(RDP)를 다시 활성화해요. 이 유일한 잠금 지점은 의도적인 조치예요.",
  manualRelockNeeds: "전원 껐다 켜기 핸드셰이크가 필요해요; GnwFlasher.lock()은 아직 구현되지 않았어요. 별도의 명시적 동의 + 차단형 확인 절차 뒤에 제공될 예정이에요.",
  relockButton: "기기 재잠금…",
  rawPatchTitle: "원시 펌웨어 패치 옵션",
  rawPatchChip: "전문가 / 지원되지 않음",
  rawPatchWill: "내부 패처의 전체 옵션 스키마를 검증 없이 그대로 노출해요 — 명시적으로 지원되지 않아요.",
  rawPatchNeedsBold: "이 기능은 대부분 필요하지 않을 거예요.",
  rawPatchNeedsMid: "옵션 없이",
  rawPatchNeedsBody: "를 그대로 사용하는 간편 설정이야말로 누구나 써야 하는 방식이에요. 이 패널은 그 기능을 잃지 않기 위해서만 남겨 두었어요.",
  patchWithOptionsButton: "옵션과 함께 패치…",
} as const;

export const deferredSectionKo: DeferredSectionStrings = {
  defaultChipText: "아직 사용 불가",
  comingSoon: "곧 제공 예정",
  needsLabel: "필요 사항:",
} as const;
