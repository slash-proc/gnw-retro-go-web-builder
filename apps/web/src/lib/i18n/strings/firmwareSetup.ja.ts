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

export const advancedJa: AdvancedStrings = {
  tabbarLabel: "詳細ツール",
  tabOverview: "概要",
  tabFirmwareSetup: "ファームウェア設定",
  tabRoms: "ROM",
  waitingForDevice: "デバイスの接続を待っています…",
  modeGuidedSetup: "かんたん設定",
  modeAdvanced: "詳細設定",
  expertHeading: "エキスパート",
  backToAdvanced: "← 詳細設定に戻る",
};

export const officialFirmwareJa: OfficialFirmwareStrings = {
  step1Title: "ファームウェアのバックアップ",
  chromiumRequired: "フォルダの選択にはChromium系ブラウザが必要です（WebUSBと同様）。",
  pickFolderIntro: "純正バックアップが入ったフォルダ、またはバックアップを保存する空のフォルダを選択してください。",
  pickFolderLookForPre: "次のファイル：",
  pickFolderBodyPost: "を探して検証します。",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "別のフォルダを選択",
  chooseBackupFolder: "バックアップフォルダを選択",
  reconnectLastFolder: "前回のフォルダに再接続",
  backupsFoundLegend: (plural: boolean) => `このフォルダに見つかった純正バックアップ`,
  validChip: "✓ 有効",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ 無効（内蔵 ${internalOk ? "✓" : "✗"}・外部 ${externalOk ? "✓" : "✗"}）`,
  validBackupSelected: (model: string) =>
    `✓ 有効な${model}の純正バックアップを選択しました。`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `${model}のバックアップの検証に失敗しました（内蔵 ${internalOk ? "✓" : "✗"}・外部 ${externalOk ? "✓" : "✗"}）。以下から新しくバックアップを取ってください。`,
  noBackupYet: "このフォルダにはまだ純正バックアップがありません — 接続中のデバイスから以下でバックアップを取ってください。",
  alreadyPatchedNoticePre: "このデバイスはすでに",
  alreadyPatchedNoticeBold: "パッチ済みのRetro-Go",
  alreadyPatchedNoticePost:
    "ファームウェアで動作しているため、バックアップすべき純正ファームウェアがありません。",
  alreadyPatchedNoticeDifferentBold: "別の",
  alreadyPatchedNoticeEnd:
    "純正ファームウェア（例：マリオ⇔ゼルダ）をインストールするには、上でマリオまたはゼルダの純正バックアップが入ったフォルダを選択し、以下でパッチしてください。",
  unlockDeviceLabel: "デバイスのロックを解除",
  unlockDeviceHint: "（RDP読み出し保護を解除します — ロックされたデバイスを読み出すために必要です）",
  backingUp: "バックアップ中…",
  backUpNow: "今すぐバックアップ",
  connectToBackUp: "バックアップを取るにはデバイスを接続してください。",
  optInToUnlock: "ロックされたデバイスをバックアップするには、ロック解除を有効にしてください。",
  step2Title: "ファームウェアをパッチ",
  step2Body: (model: string) =>
    `${model}の純正ファームウェアをパッチし、Retro-Goとのデュアルブートに対応させます。`,
  installBootloaderLabel: "ブートローダーをインストール",
  installBootloaderHint: "（推奨）",
  crossModelDangerBold: "⚠ 機種の不一致：",
  crossModelDangerBody:
    "これはゼルダ用ファームウェアですが、接続されているハードウェアはマリオと判定されました。マリオのハードウェアにはゼルダに必要なボタンが2つ不足しているため、一部が使用できなくなる可能性があります。",
  crossModelAck: "リスクを理解した上で、それでもマリオのハードウェアにゼルダ用ファームウェアを書き込みます",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `注：バックアップは${deviceModel}のハードウェア上の${backupModel}ファームウェアです — これは許可されています。`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ この${model}バックアップの外部フラッシュイメージ（${backupMb} MB）は、このデバイスの外部フラッシュ容量（${deviceMb} MB）を超えているため、物理的に収まらず書き込めません。`,
  enteringRecoveryMode: "リカバリーモードに入っています…",
  enterRecoveryMode: "リカバリーモードを開始",
  patchFirmwareButton: "ファームウェアをパッチ",
  connectToPatchAndFlash: "パッチと書き込みを行うにはデバイスを接続してください。",
  patchedAndFlashed: "✓ パッチと書き込みが完了しました。",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `${model}の純正ファームウェアをパッチし${withBootloader ? "（SDカードブートローダー付き）" : ""}、書き込みます：内蔵 → バンク1、外部 → バンク0。書き込み中はデバイスを動かしたり取り外したりしないでください — 失敗する恐れがあります。`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ ゼルダ用ファームウェアをマリオのハードウェアに書き込もうとしています。マリオにはゼルダに必要なボタンが2つ不足しています。${base}`,
  modalTitle: "純正ファームウェアをパッチして書き込みますか？",
  modalConfirmText: "パッチして書き込む",
  phasePatch: "ファームウェアをパッチ",
  phaseFlashInternal: "内蔵フラッシュに書き込み（バンク1）",
  phaseFlashExternal: "外部フラッシュに書き込み",
  phaseRescan: "デバイスを再スキャン",
  errDeviceLocked: "デバイスがロックされています（RDP読み出し保護）。バックアップの前に「デバイスのロックを解除」にチェックを入れて解除してください。",
  errFirmwareMismatch: "読み出したファームウェアが既知のマリオ／ゼルダの純正ROMと一致しません — バックアップは保存されませんでした。",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logPatchingModel: (model: string) => `Patching firmware for model: ${model}.`,
};

// romSection: static chrome only (this component is heavily data-driven — banks, versions,
// byte counts, hex offsets never move into the string table, they're passed as args or left
// inline as before).
export const romSectionJa: RomSectionStrings = {
  regionIntflash: "内蔵ファームウェア",
  regionFrogfs: "ゲーム、BIOS、言語",
  regionLittlefs: "エミュレータ、セーブデータ",
  phasePrepare: "デバイスを準備",
  phaseDownload: "ファームウェアをダウンロード",
  phaseMigrateScan: "既存のデバイスの状態を読み出す",
  subFrogfsState: "以前のゲームの状態を読み出す",
  subLfsExtract: "エミュレータ／セーブデータを抽出する",
  subGamesMigrate: "インストール済みのゲームを引き継ぐ",
  phasePrepareInstallImage: "インストールイメージを準備",
  subSdCache: "SDキャッシュ予約オフセット境界を設定",
  phaseBuildInstallImage: "インストールイメージを作成",
  subBuildFrogfs: "ゲーム・BIOS・言語イメージを作成",
  subBuildLittlefs: "エミュレータ／セーブイメージを作成",
  subPatchSuperblock: "スーパーブロックをパッチ",
  phaseFlashingToDevice: "デバイスに書き込み中",
  phaseRescan: "デバイスを再スキャン",
  phaseSyncSdCores: "SDカードにコアを同期",
  chooseSdCard: "SDカードを選択",
  flashRetroGo: "Retro-Goを書き込む",
  flashInternalFirmware: "内蔵ファームウェアを書き込む",
  flashGamesBiosLanguages: "ゲーム・BIOS・言語を書き込む",
  flashEmulatorsSaves: "エミュレータ・セーブデータを書き込む",
  flashThisInstall: "このインストール内容を書き込みますか？",
  flashRegions: (joined: string) => `${joined}を書き込みますか？`,
  regionInternalFirmware: "内蔵ファームウェア",
  regionGamesBiosLanguages: "ゲーム、BIOS、言語",
  regionEmulatorsSaves: "エミュレータ、セーブデータ",
  flashBody: (writes: string) => `書き込み内容：${writes}。処理が終わるまでデバイスを取り外さないでください。`,
  nameInternalFirmware: (bank: number) => `内蔵ファームウェア → バンク${bank}`,
  nameGamesBiosLanguages: (addr: string) => `ゲーム、BIOS、言語 → 外部 ${addr}`,
  nameEmulatorsSaves: (addr: string) => `エミュレータ、セーブデータ → 外部 ${addr}`,
  flashConfirmText: "書き込み",
  selectSdCard: "SDカードを選択",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "まだ公開されているファームウェアバージョンがありません。",
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
    `外部フラッシュへの書き込み内容（${payloadMb} MB）がこのデバイスの外部フラッシュ容量（${deviceMb} MB）を超えているため書き込めません。`,
  logRescanning: "Rescanning device geometry and installed games…",
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "インストールするバージョン",
  migrateGamesLabel: "ゲームを引き継ぐ",
  migrateSavesLabel: "セーブデータと設定を引き継ぐ",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `インストール先：バンク${bank} ${dualBoot ? "（デュアルブート、純正を維持）" : "（純正を上書き）"}`,
  retroGoOnlyNotice:
    "バンク1に純正ファームウェアが検出されなかったため、推定されるインストール先はバンク1です — これはデュアルブートなしのRetro-Go専用インストールになります。",
  bank1StockOfwNotice:
    "バンク1には未パッチの純正ファームウェアがあります — パッチするまでRetro-Goには到達できません（上の「バックアップ＆パッチ」を参照）。",
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `デバイスは${deviceBuild}ビルドのようです。現在表示しているのは${viewingMode}モードです。`,
  layoutAdvancedToggle: "レイアウト（詳細）",
  sdCacheOffsetLabel: "SDキャッシュオフセット",
  frogfsOffsetLabel: "FrogFSオフセット",
  offsetHint: "（0x90000000からのバイト数。下側を予約します）",
  autoPlaceholder: (hex: string) => `自動（${hex}）`,
  littlefsSizeLabel: "LittleFSサイズ",
  littlefsSizeHint: "（8 MiB以上）",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `既定値：FrogFSオフセットはデバイスのレイアウトに応じて下側を自動的に予約します。両方とも${blockSize} Bの消去ブロック単位に切り上げられます。`,
  scanningProgress: (pct: number) => `スキャン中… ${pct}%`,
  scanFailed: (err: string) => `スキャンに失敗しました：${err}`,
  scanToSeeLayout: "デバイスをスキャンすると現在のフラッシュレイアウトが表示されます。",
  connectToSizeAndFlash: "サイズの計算と書き込みを行うにはデバイスを接続してください。",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range}・${mib} MiB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range}・${mib} MiB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `デバイス末尾 ${devEnd}・ブロック ${blockSize} B・空き ${freeMib} MiB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `確認：チップ末尾で終了 ${endsAtChip ? "✓" : "✗"}・重複なし ${noOverlap ? "✓" : "✗"}・整列 ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `システム：${systems || "（なし）"}`,
  startBankLabel: (bank: number) => `バンク${bank}を起動`,
  readBackSuperblockDebug: "スーパーブロックを読み戻す（デバッグ）",
  chipTextFlashing: "書き込み中",
  chipTextInstalled: "✓ インストール済み",
  chipTextFileCount: (count: number) => `${count}ファイル`,
  chipTextIdle: "待機中",
  startedBankResult: (bank: number) =>
    `バンク${bank}を起動しました。デバイスは現在そのファームウェアで動作しており、スタブはもう有効ではありません — アプリを再度使用するには再接続するか、デバイスの電源を入れ直してください。`,
};

// dumpSection: DumpSection.svelte — "Dump Flash" (read any region of any bank to a file).
export const dumpSectionJa: DumpSectionStrings = {
  title: "フラッシュをダンプ",
  scanningDevice: "デバイスをスキャン中…",
  intro: "任意のバンクの任意の領域をダウンロードファイルとして読み出します。読み出し中にキャンセルできます。",
  internalFlashTitle: "内蔵フラッシュ",
  externalFlashTitle: "外部フラッシュ",
  bankLabel: "バンク",
  offsetLabel: "オフセット",
  offsetPlaceholder: "0x0",
  lengthLabel: "長さ",
  lengthPlaceholder: "領域全体",
  quickFillWholeRegion: "領域全体",
  quickFill128Kib: "128 KiB",
  quickFill1Mib: "1 MiB",
  quickFillStockOfw: "純正OFW内蔵ファームウェア（0–0x20000）",
  lockedNotice:
    "🔒 デバイスがロックされている間は内蔵フラッシュを読み出せません — 簡単セットアップのバックアップ手順で自動的にロックが解除されます。（バンク0／外部は読み出し可能なままです。）",
  lengthBlankHint: "長さを空欄にすると、オフセットから領域全体を対象にします。",
  planLine: (from: string, to: string) => `内容：${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes}バイト → ${filename}`,
  overrunWarning: (clamped: string) => `長さが領域を超えるため、${clamped}バイトに制限されます。`,
  enterRecoveryMode: "リカバリーモードを開始",
  dumpToFile: "ファイルにダンプ",
  invalidHint: "有効なオフセットと長さを入力してください。",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "キャンセル",
  cancelHint: "読み出しは非破壊的です — 「キャンセル」を押すと、途中までのダンプは破棄されます（ファイルは作成されません）。",
  readingPct: (pct: number) => `読み出し中 ${pct}%`,
  lockedChip: "ロック中",
  canceledChip: "キャンセル済み",
  errorChip: "エラー",
  resultSummary: (mib: string, secs: number) => `${mib} MiBを${secs}秒で読み出しました`,
};

// flashSection: FlashSection.svelte — "Write Flash" (write an arbitrary image to any bank/offset).
export const flashSectionJa: FlashSectionStrings = {
  title: "フラッシュに書き込み",
  scanningDevice: "デバイスをスキャン中…",
  enterRecoveryMode: "リカバリーモードを開始",
  intro: "任意のイメージを任意のバンク／オフセットに書き込みます。書き込み前に確認が求められます。",
  imageFileLabel: "イメージファイル",
  chooseImage: "イメージを選択",
  bankLabel: "バンク",
  offsetLabel: "オフセット",
  offsetPlaceholder: "0x0",
  transferOptions: "転送オプション",
  compressLabel: "LZMA圧縮",
  compressHint: "（転送が速くなります。デバイス側で展開されます。効果がない場合は自動的にスキップされます）",
  verifyLabel: "書き込みを検証",
  verifyHint: "（各バッファを読み戻して転送エラーを検出します。速度は低下します）",
  lockedNotice:
    "🔒 内蔵フラッシュがロックされています — ロックされたデバイスは書き込みを拒否します。簡単セットアップのバックアップ手順で自動的にロックが解除されます。（バンク0／外部は書き込み可能なままです。）",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `内容：バンク${bank}（${base}）+ ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} B → パディング後 ${padded} B（${paddedHex}）`,
  alignWarning: (align: number, kind: string) => `オフセットは${align}の倍数である必要があります（${kind}フラッシュの整列制約）。`,
  overrunWarning: (region: string) => `イメージが${region} Bの領域を超えています。`,
  ackLabel: "これによりファームウェアバンクが上書きされることを理解しており、バックアップを取ってあります。",
  flashImageButton: "イメージを書き込む…",
  modalTitle: "このイメージを書き込みますか？",
  modalConfirmText: "書き込み",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `内容：バンク${bank}（${base}）+ ${offset} ← ${filename}（${size} B、パディング後 → ${padded}）。` +
    `処理が終わるまでデバイスを取り外さないでください。`,
  phaseFlashingImage: "イメージを書き込み中",
  writingChip: "書き込み中",
  lockedChip: "ロック中",
  extIntWordExt: "外部",
  extIntWordInt: "内蔵",
};

// eraseSection: EraseSection.svelte — "Erase Flash" (select partitions to erase).
export const eraseSectionJa: EraseSectionStrings = {
  title: "フラッシュを消去",
  scanningDevice: "デバイスをスキャン中…",
  enterRecoveryMode: "リカバリーモードを開始",
  intro: "下のパーティションをクリックすると消去対象として選択されます。Ctrl／Cmdキーを押しながらクリックすると複数選択できます。",
  internalFlashTitle: "内蔵フラッシュ",
  externalFlashTitle: "外部フラッシュ",
  lockedNotice:
    "🔒 内蔵フラッシュがロックされています — ロックされたデバイスは書き込みを拒否します。簡単セットアップのバックアップ手順で自動的にロックが解除されます。（外部フラッシュは消去可能なままです。）",
  selectedTitle: "選択中：",
  bankWipeWarning: "警告：内蔵バンクを消去すると、OS（純正またはRetro-Go）が起動できなくなる可能性があります！",
  eraseButton: (plural: boolean) => `パーティションを消去…`,
  modalTitle: (count: number, plural: boolean) => `${count}件のパーティションを消去しますか？`,
  modalBody: (plural: boolean) =>
    `選択したパーティションを0xFFで埋めて完全に消去します。その上のデータやファームウェアはすべて失われます。`,
  modalConfirmText: "消去",
  phaseErase: "消去",
  phaseRescan: "デバイスを再スキャン",
  partitionAtFallback: (addr: string) => `${addr}のパーティション`,
  erasingLog: (label: string, size: string, addr: string) => `${label}を消去中（${addr}、${size} B）…`,
  partitionFallback: "パーティション",
  rescanningLog: "デバイスのジオメトリを再スキャン中…",
  erasingChip: "消去中",
  lockedChip: "ロック中",
  selectedSizeAt: (size: string, addr: string) => `（${addr}に${size}バイト）`,
};

// fileBrowserSection: FileBrowserSection.svelte — read-only LittleFS/FrogFS file browser.
export const fileBrowserSectionJa: FileBrowserSectionStrings = {
  intro: "下のバーからファイルシステムパーティションを選択すると、そのファイルを表示できます。",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "FrogFSにファイルが見つかりません。",
  noLittlefsFiles: "LittleFSにファイルが見つかりません。",
  readingLittlefs: (pct: number) => `SWD経由でLittleFSパーティションを読み出し中（${pct}%）...`,
  browserNotAvailable: (kind: string) => `${kind}にはファイルブラウザが利用できません。`,
};

// retroGoTab: RetroGoTab.svelte — the Firmware Setup tab shell (group headings + section titles).
export const retroGoTabJa: RetroGoTabStrings = {
  officialFirmwareHeading: "純正ファームウェア",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "フラッシュ管理",
  backupAndPatchTitle: "バックアップ＆パッチ",
  installRetroGoTitle: "Retro-Goをインストール",
  reinstallRetroGoTitle: "Retro-Goを再インストール",
  fileBrowserTitle: "ファイルブラウザ",
  scanningDevice: "デバイスをスキャン中…",
  enterRecoveryMode: "リカバリーモードを開始",
};

// expertCorner: ExpertCorner.svelte — the deliberately-hidden #expert surface (deferred panels).
export const expertCornerJa: ExpertCornerStrings = {
  warnBanner:
    "エキスパート向けの領域です — ほとんどの方はここにある機能を必要としません。これらの操作の多くはほとんどのユーザーにとって危険、または無意味ですが、" +
    "機能自体を失わないためだけに残してあります。",
  manualRelockTitle: "手動での再ロック",
  manualRelockChip: "現時点では利用できません",
  manualRelockWill: "デバイスの読み出し保護（RDP）を再度有効にします。唯一のロック操作であるため、意図的な操作として扱われます。",
  manualRelockNeeds: "電源の入れ直しによるハンドシェイクが必要です。GnwFlasher.lock()は未実装です。型付きの同意操作とブロッキング確認の後ろで提供予定です。",
  relockButton: "デバイスを再ロック…",
  rawPatchTitle: "生のファームウェアパッチオプション",
  rawPatchChip: "エキスパート／非対応",
  rawPatchWill: "内部のパッチャーが持つオプションスキーマをそのまま公開します。検証は行われません — 明示的に非対応の機能です。",
  rawPatchNeedsBold: "おそらくこれは不要です。",
  rawPatchNeedsMid: "設定不要の",
  rawPatchNeedsBody: "を使う「簡単セットアップ」こそ、誰もが使うべき方法です。このパネルは、この機能を失わないためだけに存在しています。",
  patchWithOptionsButton: "オプション付きでパッチ…",
};

// deferredSection: DeferredSection.svelte — the generic honest-deferred-panel component's own
// literal chrome (the `will`/`needs`/`control` copy is caller-supplied, not here).
export const deferredSectionJa: DeferredSectionStrings = {
  defaultChipText: "現時点では利用できません",
  comingSoon: "近日提供予定",
  needsLabel: "必要な要素：",
};
