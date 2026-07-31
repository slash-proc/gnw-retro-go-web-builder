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

export const advancedFr: AdvancedStrings = {
  tabbarLabel: "Outils avancés",
  tabOverview: "Aperçu",
  tabFirmwareSetup: "Configuration du firmware",
  tabRoms: "ROMs",
  waitingForDevice: "En attente d'une connexion à l'appareil…",
  modeGuidedSetup: "Configuration simplifiée",
  modeAdvanced: "Avancé",
  expertHeading: "Expert",
  backToAdvanced: "← Retour à Avancé",
} as const;

export const officialFirmwareFr: OfficialFirmwareStrings = {
  step1Title: "Sauvegarde du firmware",
  chromiumRequired: "La sélection de dossier nécessite un navigateur Chromium (comme pour WebUSB).",
  pickFolderIntro: "Choisissez un dossier contenant vos sauvegardes stock, ou un dossier vide pour en enregistrer une.",
  pickFolderLookForPre: "Nous recherchons",
  pickFolderBodyPost: "et les validons.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseDifferentFolder: "Choisir un autre dossier",
  chooseBackupFolder: "Choisir le dossier de sauvegarde",
  reconnectLastFolder: "Reconnecter le dernier dossier",
  backupsFoundLegend: (plural: boolean) => `Sauvegarde${plural ? "s" : ""} stock trouvée${plural ? "s" : ""} dans ce dossier`,
  validChip: "✓ valide",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ invalide (int ${internalOk ? "✓" : "✗"} · ext ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) =>
    `✓ Sauvegarde stock ${model} valide sélectionnée.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `La sauvegarde ${model} a échoué à la validation (interne ${internalOk ? "✓" : "✗"} · externe ${externalOk ? "✓" : "✗"}). Effectuez une nouvelle sauvegarde ci-dessous.`,
  noBackupYet: "Pas encore de sauvegarde stock dans ce dossier — sauvegardez-en une depuis l'appareil connecté.",
  alreadyPatchedNoticePre: "Cet appareil exécute déjà un firmware",
  alreadyPatchedNoticeBold: "Retro-Go patché",
  alreadyPatchedNoticePost:
    ", il n'y a donc pas de firmware stock à sauvegarder dessus. Pour installer un",
  alreadyPatchedNoticeDifferentBold: "autre",
  alreadyPatchedNoticeEnd:
    "firmware officiel (par ex. Mario ↔ Zelda), choisissez ci-dessus un dossier contenant une sauvegarde stock Mario ou Zelda, puis patchez-la ci-dessous.",
  unlockDeviceLabel: "Déverrouiller l'appareil",
  unlockDeviceHint: "(supprime la protection en lecture RDP — nécessaire pour lire un appareil verrouillé)",
  backingUp: "Sauvegarde en cours…",
  backUpNow: "Sauvegarder maintenant",
  connectToBackUp: "Connectez un appareil pour effectuer une sauvegarde.",
  optInToUnlock: "Activez le déverrouillage pour sauvegarder un appareil verrouillé.",
  step2Title: "Patcher le firmware",
  step2Body: (model: string) =>
    `Patche le firmware stock ${model} pour prendre en charge le double démarrage avec Retro-Go.`,
  installBootloaderLabel: "Installer le bootloader",
  installBootloaderHint: "(recommandé)",
  crossModelDangerBold: "⚠ Modèles différents :",
  crossModelDangerBody:
    "il s'agit du firmware Zelda, mais le matériel connecté a été identifié comme Mario. Le matériel Mario ne possède pas deux des boutons nécessaires à Zelda — le résultat pourrait être partiellement inutilisable.",
  crossModelAck: "Je comprends et je souhaite quand même flasher le firmware Zelda sur du matériel Mario",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `Remarque : la sauvegarde est un firmware ${backupModel} sur du matériel ${deviceModel} — c'est autorisé.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ L'image externe de cette sauvegarde ${model} (${backupMb} Mo) est plus grande que le flash externe de cet appareil (${deviceMb} Mo) — elle ne tiendra physiquement pas et ne peut pas être flashée ici.`,
  enteringRecoveryMode: "Passage en mode de récupération…",
  enterRecoveryMode: "Passer en mode de récupération",
  patchFirmwareButton: "Patcher le firmware",
  connectToPatchAndFlash: "Connectez un appareil pour patcher et flasher.",
  patchedAndFlashed: "✓ Patché et flashé.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `Patche le firmware stock ${model}${withBootloader ? " (avec le bootloader carte SD)" : ""} et le flashe : interne → banque 1, externe → banque 0. Ne déplacez ni ne débranchez l'appareil pendant l'écriture — cela pourrait faire échouer le flashage.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ Vous êtes sur le point de flasher le firmware ZELDA sur du matériel MARIO, auquel il manque deux des boutons nécessaires à Zelda. ${base}`,
  modalTitle: "Patcher et flasher le firmware officiel ?",
  modalConfirmText: "Patcher et flasher",
  phasePatch: "Patcher le firmware",
  phaseFlashInternal: "Flasher l'interne (banque 1)",
  phaseFlashExternal: "Flasher l'externe",
  phaseRescan: "Analyser l'appareil à nouveau",
  errDeviceLocked: "L'appareil est verrouillé (protection en lecture RDP). Cochez « Déverrouiller l'appareil » pour la supprimer avant de sauvegarder.",
  errFirmwareMismatch: "Le firmware lu ne correspond à aucune ROM stock Mario/Zelda connue — sauvegarde non enregistrée.",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logPatchingModel: (model: string) => `Patching firmware for model: ${model}.`,
} as const;

// romSection: static chrome only (this component is heavily data-driven — banks, versions,
// byte counts, hex offsets never move into the string table, they're passed as args or left
// inline as before).
export const romSectionFr: RomSectionStrings = {
  regionIntflash: "Firmware interne",
  regionFrogfs: "Jeux, BIOS, langues",
  regionLittlefs: "Émulateurs, sauvegardes",
  phasePrepare: "Préparer l'appareil",
  phaseDownload: "Télécharger le firmware",
  phaseMigrateScan: "Lire l'état actuel de l'appareil",
  subFrogfsState: "Lire l'état de jeu précédent",
  subLfsExtract: "Extraire les données des émulateurs/sauvegardes",
  subGamesMigrate: "Reprendre les jeux installés",
  phasePrepareInstallImage: "Préparer l'image d'installation",
  subSdCache: "Définir la limite réservée du cache SD",
  phaseBuildInstallImage: "Créer l'image d'installation",
  subBuildFrogfs: "Créer l'image jeux, BIOS, langues",
  subBuildLittlefs: "Créer l'image émulateurs/sauvegardes",
  subPatchSuperblock: "Patcher le superblock",
  phaseFlashingToDevice: "Flashage vers l'appareil",
  phaseRescan: "Analyser l'appareil à nouveau",
  phaseSyncSdCores: "Synchroniser les émulateurs sur la carte SD",
  chooseSdCard: "Choisir la carte SD",
  flashRetroGo: "Flasher Retro-Go",
  flashInternalFirmware: "Flasher le firmware interne",
  flashGamesBiosLanguages: "Flasher jeux, BIOS, langues",
  flashEmulatorsSaves: "Flasher émulateurs, sauvegardes",
  flashThisInstall: "Flasher cette installation ?",
  flashRegions: (joined: string) => `Flasher ${joined} ?`,
  regionInternalFirmware: "firmware interne",
  regionGamesBiosLanguages: "jeux, BIOS, langues",
  regionEmulatorsSaves: "émulateurs, sauvegardes",
  flashBody: (writes: string) => `Écritures : ${writes}. Ne débranchez pas l'appareil avant la fin de l'opération.`,
  nameInternalFirmware: (bank: number) => `firmware interne → banque ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `jeux, BIOS, langues → ext ${addr}`,
  nameEmulatorsSaves: (addr: string) => `émulateurs, sauvegardes → ext ${addr}`,
  flashConfirmText: "Flasher",
  selectSdCard: "Sélectionner la carte SD",
  // report.log() audit-trail text — deliberately English-only in every locale, see owner feedback
  logConnectingFlashUtil: "Connecting to device and starting the flash utility…",
  logFlashUtilReady: (extMib: string, blockSize: number) =>
    `Flash utility ready — external flash ${extMib} MiB, erase block ${blockSize} B.`,
  errNoVersionsPublished: "Aucune version de firmware n'est encore publiée.",
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
    `La charge externe (${payloadMb} Mo) dépasse le flash externe de cet appareil (${deviceMb} Mo) — flashage impossible.`,
  logRescanning: "Rescanning device geometry and installed games…",
  logSdSyncFoundItems: (count: number) => `Found ${count} item(s) in the bundle's SD content.`,
  logSdSyncCopyingFile: (path: string) => `Copying core file: ${path}`,
  logSdSyncNoHandleZipFallback: "No SD card handle (Firefox) — generating ZIP fallback…",
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "Version à installer",
  migrateGamesLabel: "Reprendre les jeux",
  migrateSavesLabel: "Reprendre les sauvegardes et paramètres",
  bankTargetCaption: (bank: number, dualBoot: boolean) =>
    `Cible d'installation : banque ${bank} ${dualBoot ? "(double démarrage, stock conservé)" : "(écrase le stock)"}`,
  retroGoOnlyNotice:
    "Aucun firmware stock détecté sur la banque 1, la cible déduite est donc la banque 1 — il s'agira d'une installation Retro-Go seul (sans double démarrage).",
  bank1StockOfwNotice:
    "La banque 1 contient un firmware stock non patché — vous ne pourrez pas accéder à Retro-Go tant qu'il n'aura pas été patché (voir « Sauvegarde et patch » ci-dessus).",
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `L'appareil semble être une build ${deviceBuild}. Vous consultez le mode ${viewingMode}.`,
  layoutAdvancedToggle: "Agencement (avancé)",
  sdCacheOffsetLabel: "Décalage du cache SD",
  frogfsOffsetLabel: "Décalage FrogFS",
  offsetHint: "(octets depuis 0x90000000 ; réserve le bas)",
  autoPlaceholder: (hex: string) => `auto (${hex})`,
  littlefsSizeLabel: "Taille LittleFS",
  littlefsSizeHint: "(≥8 Mio)",
  littlefsSizePlaceholder: "8",
  mbUnit: "Mo",
  layoutDefaultsNote: (blockSize: number) =>
    `Par défaut : le décalage FrogFS réserve automatiquement le bas selon l'agencement de l'appareil. Les deux sont arrondis au bloc d'effacement de ${blockSize} o.`,
  scanningProgress: (pct: number) => `Analyse en cours… ${pct} %`,
  scanFailed: (err: string) => `échec de l'analyse : ${err}`,
  scanToSeeLayout: "Analysez l'appareil pour voir son agencement flash actuel.",
  connectToSizeAndFlash: "Connectez un appareil pour dimensionner et flasher l'installation.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range} · ${mib} Mio`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range} · ${mib} Mio`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `fin de l'appareil ${devEnd} · bloc ${blockSize} o · libre ${freeMib} Mio`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `vérifications : se termine à la puce ${endsAtChip ? "✓" : "✗"} · pas de chevauchement ${noOverlap ? "✓" : "✗"} · aligné ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `systèmes : ${systems || "(aucun)"}`,
  startBankLabel: (bank: number) => `Démarrer la banque ${bank}`,
  readBackSuperblockDebug: "Relire le superblock (debug)",
  chipTextFlashing: "flashage",
  chipTextInstalled: "✓ installé",
  chipTextFileCount: (count: number) => `${count} fichier${count > 1 ? "s" : ""}`,
  chipTextIdle: "inactif",
  startedBankResult: (bank: number) =>
    `Banque ${bank} démarrée. L'appareil exécute maintenant ce firmware — le stub n'est plus actif ; reconnectez-vous ou redémarrez l'appareil pour réutiliser l'application.`,
} as const;

// dumpSection: DumpSection.svelte — "Dump Flash" (read any region of any bank to a file).
export const dumpSectionFr: DumpSectionStrings = {
  title: "Extraire le flash",
  scanningDevice: "Analyse de l'appareil…",
  intro: "Lisez n'importe quelle zone de n'importe quelle banque vers un fichier téléchargé. Vous pouvez annuler en cours de lecture.",
  internalFlashTitle: "Flash interne",
  externalFlashTitle: "Flash externe",
  bankLabel: "Banque",
  offsetLabel: "Décalage",
  offsetPlaceholder: "0x0",
  lengthLabel: "Longueur",
  lengthPlaceholder: "zone entière",
  quickFillWholeRegion: "Zone entière",
  quickFill128Kib: "128 Kio",
  quickFill1Mib: "1 Mio",
  quickFillStockOfw: "Intflash OFW stock (0–0x20000)",
  lockedNotice:
    "🔒 Le flash interne ne peut pas être lu tant que l'appareil est verrouillé — le déverrouillage se fait automatiquement " +
    "pendant l'étape de sauvegarde de la configuration simplifiée. (La banque 0 / externe reste lisible.)",
  lengthBlankHint: "Longueur vide = zone entière à partir du décalage.",
  planLine: (from: string, to: string) => `Plan : ${from} → ${to}`,
  planBytesLine: (bytes: string, filename: string) => `${bytes} octets → ${filename}`,
  overrunWarning: (clamped: string) => `La longueur dépasse la zone ; sera limitée à ${clamped} octets.`,
  enterRecoveryMode: "Passer en mode de récupération",
  dumpToFile: "Extraire vers un fichier",
  invalidHint: "Saisissez un décalage et une longueur valides.",
  progressLabel: (done: string, total: string) => `${done} / ${total} Ko`,
  cancel: "Annuler",
  cancelHint: "Une lecture est non destructive — « Annuler » ne fait que rejeter l'extraction partielle (aucun fichier).",
  readingPct: (pct: number) => `lecture ${pct} %`,
  lockedChip: "verrouillé",
  canceledChip: "annulé",
  errorChip: "erreur",
  resultSummary: (mib: string, secs: number) => `${mib} Mio lus en ${secs} s`,
} as const;

// flashSection: FlashSection.svelte — "Write Flash" (write an arbitrary image to any bank/offset).
export const flashSectionFr: FlashSectionStrings = {
  title: "Écrire dans le flash",
  scanningDevice: "Analyse de l'appareil…",
  enterRecoveryMode: "Passer en mode de récupération",
  intro: "Écrivez une image quelconque à n'importe quelle banque/décalage. Une confirmation vous sera demandée avant l'écriture.",
  imageFileLabel: "Fichier image",
  chooseImage: "Choisir une image",
  bankLabel: "Banque",
  offsetLabel: "Décalage",
  offsetPlaceholder: "0x0",
  transferOptions: "Options de transfert",
  compressLabel: "Compression LZMA",
  compressHint: "(transfert plus rapide ; l'appareil décompresse ; ignoré automatiquement si ça n'aide pas)",
  verifyLabel: "Vérifier les écritures",
  verifyHint: "(relit chaque tampon pour détecter une corruption de la sonde ; plus lent)",
  lockedNotice:
    "🔒 Le flash interne est verrouillé — un appareil verrouillé refuse les écritures. Le déverrouillage se fait automatiquement " +
    "pendant l'étape de sauvegarde de la configuration simplifiée. (La banque 0 / externe reste accessible en écriture.)",
  planLine: (bank: number, base: string, offset: string, filename: string) =>
    `Plan : banque ${bank} (${base}) + ${offset} ← ${filename}`,
  planSizeLine: (size: string, padded: string, paddedHex: string) => `${size} o → complété à ${padded} o (${paddedHex})`,
  alignWarning: (align: number, kind: string) => `Le décalage doit être un multiple de ${align} (alignement ${kind}flash).`,
  overrunWarning: (region: string) => `L'image dépasse la zone de ${region} o.`,
  ackLabel: "Je comprends que cela écrase la banque de firmware ; j'ai une sauvegarde.",
  flashImageButton: "Flasher l'image…",
  modalTitle: "Flasher cette image ?",
  modalConfirmText: "Flasher",
  planBody: (bank: number, base: string, offset: string, filename: string, size: string, padded: string) =>
    `Plan : banque ${bank} (${base}) + ${offset} ← ${filename} (${size} o, complété → ${padded}). ` +
    `Ne débranchez pas l'appareil avant la fin de l'opération.`,
  phaseFlashingImage: "Flashage de l'image",
  writingChip: "écriture",
  lockedChip: "verrouillé",
  extIntWordExt: "ext",
  extIntWordInt: "int",
} as const;

// eraseSection: EraseSection.svelte — "Erase Flash" (select partitions to erase).
export const eraseSectionFr: EraseSectionStrings = {
  title: "Effacer le flash",
  scanningDevice: "Analyse de l'appareil…",
  enterRecoveryMode: "Passer en mode de récupération",
  intro: "Cliquez sur une partition ci-dessous pour la sélectionner en vue de l'effacement. Maintenez Ctrl/Cmd pour sélectionner plusieurs partitions.",
  internalFlashTitle: "Flash interne",
  externalFlashTitle: "Flash externe",
  lockedNotice:
    "🔒 Le flash interne est verrouillé — un appareil verrouillé refuse les écritures. Le déverrouillage se fait automatiquement " +
    "pendant l'étape de sauvegarde de la configuration simplifiée. (Le flash externe reste effaçable.)",
  selectedTitle: "Sélectionné :",
  bankWipeWarning: "Attention : effacer une banque interne peut détruire le système d'exploitation (stock ou Retro-Go) !",
  eraseButton: (plural: boolean) => `Effacer ${plural ? "les" : "la"} partition${plural ? "s" : ""}…`,
  modalTitle: (count: number, plural: boolean) => `Effacer ${count} partition${plural ? "s" : ""} ?`,
  modalBody: (plural: boolean) =>
    `Ceci effacera définitivement ${plural ? "les" : "la"} partition${plural ? "s" : ""} sélectionnée${plural ? "s" : ""} en les remplissant de 0xFF. Toutes les données ou le firmware qui s'y trouvent seront perdus.`,
  modalConfirmText: "Effacer",
  phaseErase: "Effacement",
  phaseRescan: "Analyser l'appareil à nouveau",
  partitionAtFallback: (addr: string) => `partition à ${addr}`,
  erasingLog: (label: string, size: string, addr: string) => `Effacement de ${label} (${size} o à ${addr})…`,
  partitionFallback: "partition",
  rescanningLog: "Analyse de la géométrie de l'appareil en cours…",
  erasingChip: "effacement",
  lockedChip: "verrouillé",
  selectedSizeAt: (size: string, addr: string) => `(${size} octets à ${addr})`,
} as const;

// fileBrowserSection: FileBrowserSection.svelte — read-only LittleFS/FrogFS file browser.
export const fileBrowserSectionFr: FileBrowserSectionStrings = {
  intro: "Sélectionnez une partition de système de fichiers dans la barre ci-dessous pour afficher ses fichiers.",
  frogfsTitle: "FrogFS",
  littlefsTitle: "LittleFS",
  noFrogfsFiles: "Aucun fichier trouvé dans FrogFS.",
  noLittlefsFiles: "Aucun fichier trouvé dans LittleFS.",
  readingLittlefs: (pct: number) => `Lecture de la partition LittleFS via SWD (${pct} %)…`,
  browserNotAvailable: (kind: string) => `Navigateur de fichiers indisponible pour ${kind}.`,
  downloadTitle: (path: string) => `Télécharger ${path} depuis l'appareil`,
  downloadNeedsRecovery: "Passez en mode de récupération pour télécharger des fichiers.",
  downloadFailed: (err: string) => `Échec du téléchargement : ${err}`,
} as const;

// retroGoTab: RetroGoTab.svelte — the Firmware Setup tab shell (group headings + section titles).
export const retroGoTabFr: RetroGoTabStrings = {
  officialFirmwareHeading: "Firmware officiel",
  retroGoHeading: "Retro-Go",
  flashManagementHeading: "Gestion du flash",
  backupAndPatchTitle: "Sauvegarde et patch",
  installRetroGoTitle: "Installer Retro-Go",
  reinstallRetroGoTitle: "Réinstaller Retro-Go",
  fileBrowserTitle: "Navigateur de fichiers",
  scanningDevice: "Analyse de l'appareil…",
  enterRecoveryMode: "Passer en mode de récupération",
} as const;

// expertCorner: ExpertCorner.svelte — the deliberately-hidden #expert surface (deferred panels).
export const expertCornerFr: ExpertCornerStrings = {
  warnBanner:
    "Zone experte — presque personne n'a besoin de quoi que ce soit ici. Ces réglages sont dangereux ou " +
    "inutiles pour la plupart des utilisateurs et ne sont conservés que pour ne pas perdre la fonctionnalité.",
  manualRelockTitle: "Reverrouillage manuel",
  manualRelockChip: "pas encore disponible",
  manualRelockWill: "Réactive la protection en lecture (RDP) sur l'appareil. Ce point de verrouillage unique est une décision délibérée.",
  manualRelockNeeds: "la poignée de main du cycle d'alimentation ; GnwFlasher.lock() n'est pas implémenté. Sera livré derrière une confirmation typée + un dialogue bloquant.",
  relockButton: "Reverrouiller l'appareil…",
  rawPatchTitle: "Options brutes de patch du firmware",
  rawPatchChip: "expert / non pris en charge",
  rawPatchWill: "Expose directement le schéma d'options complet du patcher sous-jacent, transmis tel quel sans validation — explicitement non pris en charge.",
  rawPatchNeedsBold: "Vous n'en avez probablement pas besoin.",
  rawPatchNeedsMid: "Le",
  rawPatchNeedsBody: "sans réglages, utilisé par la configuration simplifiée, est ce que tout le monde devrait utiliser. Ce panneau n'existe que pour ne pas perdre cette fonctionnalité.",
  patchWithOptionsButton: "Patcher avec des options…",
} as const;

// deferredSection: DeferredSection.svelte — the generic honest-deferred-panel component's own
// literal chrome (the `will`/`needs`/`control` copy is caller-supplied, not here).
export const deferredSectionFr: DeferredSectionStrings = {
  defaultChipText: "pas encore disponible",
  comingSoon: "Bientôt disponible",
  needsLabel: "Nécessite :",
} as const;
