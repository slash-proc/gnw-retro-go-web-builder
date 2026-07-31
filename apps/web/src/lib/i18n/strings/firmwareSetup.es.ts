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

export const advancedEs: AdvancedStrings = {
  tabbarLabel: "Herramientas avanzadas",
  tabOverview: "Resumen",
  tabFirmwareSetup: "Configuración de firmware",
  tabRoms: "ROMs",
  waitingForDevice: "Esperando una conexión con el dispositivo…",
  modeGuidedSetup: "Configuración guiada",
  modeAdvanced: "Avanzado",
  expertHeading: "Experto",
  backToAdvanced: "← Volver a Avanzado",
};

export const officialFirmwareEs: OfficialFirmwareStrings = {
  step1Title: "Copia de seguridad del firmware",
  chromiumRequired: "Elegir una carpeta requiere un navegador Chromium (igual que WebUSB).",
  pickFolderIntro: "Elige una carpeta con tus copias de seguridad originales, o una carpeta vacía para guardar una nueva.",
  pickFolderLookForPre: "Buscamos",
  pickFolderBodyPost: "y los validamos.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "Elegir otra carpeta",
  chooseBackupFolder: "Elegir carpeta de copia de seguridad",
  reconnectLastFolder: "Reconectar la última carpeta",
  backupsFoundLegend: (plural: boolean) => `Copia${plural ? "s" : ""} de seguridad original${plural ? "es" : ""} encontrada${plural ? "s" : ""} en esta carpeta`,
  validChip: "✓ válida",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ no válida (int ${internalOk ? "✓" : "✗"} · ext ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Copia de seguridad original de ${model} válida seleccionada.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `La copia de seguridad de ${model} no superó la validación (interna ${internalOk ? "✓" : "✗"} · externa ${externalOk ? "✓" : "✗"}). Crea una nueva copia de seguridad abajo.`,
  noBackupYet: "Todavía no hay ninguna copia de seguridad original en esta carpeta — crea una desde el dispositivo conectado.",
  alreadyPatchedNoticePre: "Este dispositivo ya está ejecutando",
  alreadyPatchedNoticeBold: "Retro-Go parcheado",
  alreadyPatchedNoticePost:
    "así que no tiene firmware original que respaldar. Para instalar",
  alreadyPatchedNoticeDifferentBold: "otro",
  alreadyPatchedNoticeEnd:
    "firmware oficial (por ejemplo, Mario ↔ Zelda), elige arriba una carpeta que contenga una copia de seguridad original de Mario o Zelda y luego aplícale el parche abajo.",
  unlockDeviceLabel: "Desbloquear dispositivo",
  unlockDeviceHint: "(elimina la protección de lectura RDP — necesario para leer un dispositivo bloqueado)",
  backingUp: "Creando copia de seguridad…",
  backUpNow: "Crear copia de seguridad ahora",
  connectToBackUp: "Conecta un dispositivo para crear una copia de seguridad.",
  optInToUnlock: "Activa el desbloqueo para respaldar un dispositivo bloqueado.",
  step2Title: "Parchear firmware",
  step2Body: (model: string) =>
    `Parchea el firmware original de ${model} para admitir arranque dual con Retro-Go.`,
  installBootloaderLabel: "Instalar cargador de arranque",
  installBootloaderHint: "(recomendado)",
  crossModelDangerBold: "⚠ Modelo cruzado:",
  crossModelDangerBody:
    "esto es firmware de Zelda, pero el hardware conectado se detectó como Mario. El hardware de Mario carece de dos de los botones que necesita Zelda — el resultado puede quedar parcialmente inutilizable.",
  crossModelAck: "Entiendo el riesgo y quiero flashear firmware de Zelda en hardware de Mario de todas formas",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `Nota: la copia de seguridad es firmware de ${backupModel} en hardware de ${deviceModel} — esto está permitido.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ La imagen externa de esta copia de seguridad de ${model} (${backupMb} MB) es más grande que el flash externo de este dispositivo (${deviceMb} MB) — físicamente no cabe y no se puede flashear aquí.`,
  enteringRecoveryMode: "Entrando en Modo de recuperación…",
  enterRecoveryMode: "Entrar en Modo de recuperación",
  patchFirmwareButton: "Parchear firmware",
  connectToPatchAndFlash: "Conecta un dispositivo para parchear y flashear.",
  patchedAndFlashed: "✓ Parcheado y flasheado.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Parchea el firmware original de ${model}${withBootloader ? " (con el cargador de arranque de tarjeta SD)" : ""} y lo flashea: interno → banco 1, externo → banco 0. No muevas ni desconectes el dispositivo durante la escritura — puede hacer que el flasheo falle.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ Estás flasheando firmware de ZELDA en hardware de MARIO, al que le faltan dos de los botones que necesita Zelda. ${base}`,
  modalTitle: "¿Parchear y flashear el firmware oficial?",
  modalConfirmText: "Parchear y flashear",
  phasePatch: "Parchear firmware",
  phaseFlashInternal: "Flashear interno (banco 1)",
  phaseFlashExternal: "Flashear externo",
  phaseRescan: "Volver a escanear el dispositivo",
  errDeviceLocked: "El dispositivo está bloqueado (protección de lectura RDP). Marca «Desbloquear dispositivo» para quitarla antes de crear la copia de seguridad.",
  errFirmwareMismatch: "El firmware volcado no coincide con ninguna ROM original conocida de Mario/Zelda — no se guardó la copia de seguridad.",
  logPatchingModel: (model: string) => `Patching firmware for model: ${model}.`,
};

export const romSectionEs: RomSectionStrings = {
  regionIntflash: "Firmware interno",
  regionFrogfs: "Juegos, BIOS, idiomas",
  regionLittlefs: "Emuladores, partidas guardadas",
  phasePrepare: "Preparar dispositivo",
  phaseDownload: "Descargar firmware",
  phaseMigrateScan: "Leer el estado actual del dispositivo",
  subFrogfsState: "Leer el estado previo de los juegos",
  subLfsExtract: "Extraer datos de emuladores/partidas guardadas",
  subGamesMigrate: "Migrar juegos instalados",
  phasePrepareInstallImage: "Preparar imagen de instalación",
  subSdCache: "Establecer el límite reservado de la caché de la SD",
  phaseBuildInstallImage: "Compilar imagen de instalación",
  subBuildFrogfs: "Compilar imagen de juegos, BIOS e idiomas",
  subBuildLittlefs: "Compilar imagen de emuladores/partidas guardadas",
  subPatchSuperblock: "Parchear superbloque",
  phaseFlashingToDevice: "Flasheando el dispositivo",
  phaseRescan: "Volver a escanear el dispositivo",
  phaseSyncSdCores: "Sincronizar emuladores con la tarjeta SD",
  chooseSdCard: "Elegir tarjeta SD",
  flashRetroGo: "Flashear Retro-Go",
  flashInternalFirmware: "Flashear firmware interno",
  flashGamesBiosLanguages: "Flashear juegos, BIOS, idiomas",
  flashEmulatorsSaves: "Flashear emuladores, partidas guardadas",
  flashThisInstall: "¿Flashear esta instalación?",
  flashRegions: (joined: string) => `¿Flashear ${joined}?`,
  regionInternalFirmware: "firmware interno",
  regionGamesBiosLanguages: "juegos, BIOS, idiomas",
  regionEmulatorsSaves: "emuladores, partidas guardadas",
  flashBody: (writes: string) => `Se escribirá: ${writes}. No desconectes el dispositivo hasta que termine.`,
  nameInternalFirmware: (bank: number) => `firmware interno → banco ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `juegos, BIOS, idiomas → ext ${addr}`,
  nameEmulatorsSaves: (addr: string) => `emuladores, partidas guardadas → ext ${addr}`,
  flashConfirmText: "Flashear",
  selectSdCard: "Seleccionar tarjeta SD",
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "Aún no se ha publicado ninguna versión de firmware.",
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
    `La carga externa (${payloadMb} MB) supera el flash externo de este dispositivo (${deviceMb} MB) — no se puede flashear.`,
  logRescanning: "Rescanning device geometry and installed games…",
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Versión a instalar",
  migrateGamesLabel: "Migrar juegos",
  migrateSavesLabel: "Migrar partidas guardadas y ajustes",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `Destino de instalación: banco ${bank} ${dualBoot ? "(arranque dual, se conserva el original)" : "(sobrescribe el original)"}`,
  retroGoOnlyNotice:
    "No se detectó firmware original en el banco 1, así que el destino inferido es el banco 1 — esta será una instalación exclusiva de Retro-Go (sin arranque dual).",
  bank1StockOfwNotice:
    "El banco 1 tiene firmware original sin parchear — no podrás llegar a Retro-Go hasta que se parchee (consulta «Copia de seguridad y parche» arriba).",
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `El dispositivo parece tener una compilación ${deviceBuild}. Estás viendo el modo ${viewingMode}.`,
  layoutAdvancedToggle: "Distribución (avanzado)",
  sdCacheOffsetLabel: "Desplazamiento de la caché de la SD",
  frogfsOffsetLabel: "Desplazamiento de FrogFS",
  offsetHint: "(bytes desde 0x90000000; reserva la parte inferior)",
  autoPlaceholder: (hex: string) => `automático (${hex})`,
  littlefsSizeLabel: "Tamaño de LittleFS",
  littlefsSizeHint: "(≥8 MiB)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `Predeterminado: el desplazamiento de FrogFS reserva automáticamente la parte inferior según la distribución del dispositivo. Ambos se redondean al bloque de borrado de ${blockSize} B.`,
  scanningProgress: (pct: number) => `Escaneando… ${pct}%`,
  scanFailed: (err: string) => `error de escaneo: ${err}`,
  scanToSeeLayout: "Escanea el dispositivo para ver su distribución de flash actual.",
  connectToSizeAndFlash: "Conecta un dispositivo para calcular el tamaño y flashear la instalación.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range} · ${mib} MiB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range} · ${mib} MiB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `fin del dispositivo ${devEnd} · bloque ${blockSize} B · libre ${freeMib} MiB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `comprobaciones: termina-en-el-chip ${endsAtChip ? "✓" : "✗"} · sin-superposición ${noOverlap ? "✓" : "✗"} · alineado ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `sistemas: ${systems || "(ninguno)"}`,
  startBankLabel: (bank: number) => `Iniciar banco ${bank}`,
  readBackSuperblockDebug: "Releer superbloque (depuración)",
  chipTextFlashing: "flasheando",
  chipTextInstalled: "✓ instalado",
  chipTextFileCount: (count: number) => `${count} archivo${count === 1 ? "" : "s"}`,
  chipTextIdle: "inactivo",
  startedBankResult: (bank: number) =>
    `Banco ${bank} iniciado. El dispositivo ahora está ejecutando ese firmware — el stub ya no está activo; vuelve a conectar o reinicia el dispositivo para usar la aplicación de nuevo.`,
};

export const dumpSectionEs: DumpSectionStrings = {
  title: "Volcar flash",
  scanningDevice: "Escaneando el dispositivo…",
  intro: "Lee cualquier región de cualquier banco a un archivo descargado. Puedes cancelar la lectura en cualquier momento.",
  internalFlashTitle: "Flash interno",
  externalFlashTitle: "Flash externo",
  bankLabel: "Banco",
  offsetLabel: "Desplazamiento",
  offsetPlaceholder: "0x0",
  lengthLabel: "Longitud",
  lengthPlaceholder: "toda la región",
  quickFillWholeRegion: "Toda la región",
  quickFill128Kib: "128 KiB",
  quickFill1Mib: "1 MiB",
  quickFillStockOfw: "Intflash de OFW original (0–0x20000)",
  lockedNotice:
    "🔒 El flash interno no se puede leer mientras el dispositivo está bloqueado — el desbloqueo ocurre automáticamente " +
    "durante el paso de copia de seguridad de la configuración fácil. (El banco 0 / externo sigue siendo legible.)",
  lengthBlankHint: "Longitud en blanco = toda la región a partir del desplazamiento.",
  planLine: (from: string, to: string) => `Plan: ${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes} bytes → ${filename}`,
  overrunWarning: (clamped: string) => `La longitud excede la región; se limitará a ${clamped} bytes.`,
  enterRecoveryMode: "Entrar en Modo de recuperación",
  dumpToFile: "Volcar a archivo",
  invalidHint: "Introduce un desplazamiento y una longitud válidos.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "Cancelar",
  cancelHint: "Una lectura no es destructiva — «Cancelar» descarta el volcado parcial (no se genera archivo).",
  readingPct: (pct: number) => `leyendo ${pct}%`,
  lockedChip: "bloqueado",
  canceledChip: "cancelado",
  errorChip: "error",
  resultSummary: (mib: string, secs: number) => `${mib} MiB leídos en ${secs} s`,
};

export const flashSectionEs: FlashSectionStrings = {
  title: "Escribir flash",
  scanningDevice: "Escaneando el dispositivo…",
  enterRecoveryMode: "Entrar en Modo de recuperación",
  intro: "Escribe una imagen arbitraria en cualquier banco/desplazamiento. Se te pedirá confirmación antes de escribir.",
  imageFileLabel: "Archivo de imagen",
  chooseImage: "Elegir imagen",
  bankLabel: "Banco",
  offsetLabel: "Desplazamiento",
  offsetPlaceholder: "0x0",
  transferOptions: "Opciones de transferencia",
  compressLabel: "Comprimir con LZMA",
  compressHint: "(transferencia más rápida; el dispositivo descomprime; se omite automáticamente si no ayuda)",
  verifyLabel: "Verificar escrituras",
  verifyHint: "(relee cada búfer para detectar corrupción en la transferencia; más lento)",
  lockedNotice:
    "🔒 El flash interno está bloqueado — un dispositivo bloqueado rechaza las escrituras. El desbloqueo ocurre automáticamente " +
    "durante el paso de copia de seguridad de la configuración fácil. (El banco 0 / externo sigue siendo escribible.)",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `Plan: banco${bank} (${base}) + ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} B → rellenado a ${padded} B (${paddedHex})`,
  alignWarning: (align: number, kind: string) => `El desplazamiento debe ser múltiplo de ${align} (alineación de ${kind}flash).`,
  overrunWarning: (region: string) => `La imagen excede la región de ${region} B.`,
  ackLabel: "Entiendo que esto sobrescribe el banco de firmware; tengo una copia de seguridad.",
  flashImageButton: "Flashear imagen…",
  modalTitle: "¿Flashear esta imagen?",
  modalConfirmText: "Flashear",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `Plan: banco${bank} (${base}) + ${offset} ← ${filename} (${size} B, rellenado → ${padded}). ` +
    `No desconectes el dispositivo hasta que termine.`,
  phaseFlashingImage: "Flasheando imagen",
  writingChip: "escribiendo",
  lockedChip: "bloqueado",
  extIntWordExt: "ext",
  extIntWordInt: "int",
};

export const eraseSectionEs: EraseSectionStrings = {
  title: "Borrar flash",
  scanningDevice: "Escaneando el dispositivo…",
  enterRecoveryMode: "Entrar en Modo de recuperación",
  intro: "Haz clic en una partición de abajo para seleccionarla para borrarla. Mantén presionado Ctrl/Cmd para seleccionar varias particiones.",
  internalFlashTitle: "Flash interno",
  externalFlashTitle: "Flash externo",
  lockedNotice:
    "🔒 El flash interno está bloqueado — un dispositivo bloqueado rechaza las escrituras. El desbloqueo ocurre automáticamente " +
    "durante el paso de copia de seguridad de la configuración fácil. (El flash externo sigue siendo borrable.)",
  selectedTitle: "Seleccionado:",
  bankWipeWarning: "Advertencia: borrar un banco interno puede inutilizar el sistema operativo (original o Retro-Go).",
  eraseButton: (plural: boolean) => `Borrar partición${plural ? "es" : ""}…`,
  modalTitle: (count: number, plural: boolean) => `¿Borrar ${count} partición${plural ? "es" : ""}?`,
  modalBody: (plural: boolean) =>
    `Esto borrará permanentemente la${plural ? "s" : ""} partición${plural ? "es" : ""} seleccionada${plural ? "s" : ""} rellenándola${plural ? "s" : ""} con 0xFF. Se perderán todos los datos o el firmware que contengan.`,
  modalConfirmText: "Borrar",
  phaseErase: "Borrar",
  phaseRescan: "Volver a escanear el dispositivo",
  partitionAtFallback: (addr: string) => `partición en ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `Borrando ${label} (${size} B en ${addr})…`,
  partitionFallback: "partición",
  rescanningLog: "Volviendo a escanear la geometría del dispositivo…",
  erasingChip: "borrando",
  lockedChip: "bloqueado",
  selectedSizeAt: (size: string, addr: string) => `(${size} bytes en ${addr})`,
};

export const fileBrowserSectionEs: FileBrowserSectionStrings = {
  intro: "Selecciona una partición de sistema de archivos en la barra de abajo para ver sus archivos.",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "No se encontraron archivos en FrogFS.",
  noLittlefsFiles: "No se encontraron archivos en LittleFS.",
  readingLittlefs: (pct: number) => `Leyendo la partición LittleFS por SWD (${pct}%)...`,
  browserNotAvailable: (kind: string) => `El explorador de archivos no está disponible para ${kind}.`,
  downloadTitle: (path: string) => `Descargar ${path} del dispositivo`,
  downloadNeedsRecovery: "Entra en el modo de recuperación para descargar archivos.",
  downloadFailed: (err: string) => `Error al descargar: ${err}`,
};

export const retroGoTabEs: RetroGoTabStrings = {
  officialFirmwareHeading: "Firmware oficial",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "Gestión de flash",
  backupAndPatchTitle: "Copia de seguridad y parche",
  installRetroGoTitle: "Instalar Retro-Go",
  reinstallRetroGoTitle: "Reinstalar Retro-Go",
  fileBrowserTitle: "Explorador de archivos",
  scanningDevice: "Escaneando el dispositivo…",
  enterRecoveryMode: "Entrar en Modo de recuperación",
};

export const expertCornerEs: ExpertCornerStrings = {
  warnBanner:
    "Panel para expertos — casi nadie necesita nada de esto. Estos controles son peligrosos o " +
    "inútiles para la mayoría de los usuarios y se mantienen solo para no perder esta capacidad.",
  manualRelockTitle: "Volver a bloquear manualmente",
  manualRelockChip: "aún no disponible",
  manualRelockWill: "Vuelve a activar la protección de lectura (RDP) en el dispositivo. Este es el único punto de bloqueo, y es una decisión deliberada.",
  manualRelockNeeds: "el protocolo de encendido/apagado; GnwFlasher.lock() aún no está implementado. Se publicará detrás de una confirmación explícita y un diálogo bloqueante.",
  relockButton: "Volver a bloquear el dispositivo…",
  rawPatchTitle: "Opciones de parche de firmware sin procesar",
  rawPatchChip: "experto / no compatible",
  rawPatchWill: "Expone directamente el esquema completo de opciones del parcheador subyacente, pasado tal cual sin ninguna validación — explícitamente no compatible.",
  rawPatchNeedsBold: "Probablemente no necesites esto.",
  rawPatchNeedsMid: "La función sin opciones",
  rawPatchNeedsBody: "de la configuración fácil es la que todos deberían usar. Este panel solo existe para no perder esta capacidad.",
  patchWithOptionsButton: "Parchear con opciones…",
};

export const deferredSectionEs: DeferredSectionStrings = {
  defaultChipText: "aún no disponible",
  comingSoon: "Próximamente",
  needsLabel: "Necesita:",
};
