import type { SharedStrings } from "./shared.js";

export const sharedPt: SharedStrings = {
  common: {
    cancel: "Cancelar",
    close: "Fechar",
    connect: "Conectar",
    connecting: "A conectar…",
    // Composed by the template as {Pre}<strong>{Bold}</strong>{Post} with NO literal
    // whitespace, so each locale owns the spacing and punctuation at the boundaries.
    workingNotePre: "Em curso. ",
    workingNoteBold: "Não desligue o dispositivo",
    workingNotePost: ".",
    done: "✓ Concluído.",
    changeEllipsis: "Mudar…",
    chooseEllipsis: "Escolher…",
    or: "ou",
  },
  confirmModal: {
    defaultConfirmText: "Confirmar",
  },
  splitButton: {
    moreOptions: "Mais opções",
  },
  deviceControls: {
    deviceActions: "Ações do dispositivo",
    rescan: "Analisar de novo",
    restartRecoveryMode: "Reiniciar o modo de recuperação",
    startRecoveryMode: "Iniciar o modo de recuperação",
    changeAdapter: "Mudar de adaptador",
    disconnectDevice: "Desconectar o dispositivo",
  },
  stubLoadModal: {
    title: "Entrar em modo de recuperação?",
    body1Pre: "Para executar esta ação (como ler a flash, fazer um backup ou instalar firmware), o dispositivo tem de entrar em ",
    body1Bold: "modo de recuperação",
    body1Post: ". Isto interrompe temporariamente o que está em execução.",
    // RE-SPLIT against the English: "the device's power button" becomes "o botao de ligar DO
    // DISPOSITIVO", so the possessive moves from before the bold fragment to after it. German
    // solved the same split the same way ("die Ein/Aus-Taste des Geraets").
    body2Pre: "Mantenha pressionado o ",
    body2Bold: "botão de ligar",
    body2Post: " do dispositivo enquanto este se conecta, depois pouse o dispositivo e não toque nele até a operação terminar.",
    continue: "Continuar",
  },
  connectGateModal: {
    title: "Dispositivo necessário",
    subtitle: "Conecte o adaptador do seu dispositivo para continuar.",
    deviceConnectionTitle: "Conexão do dispositivo",
    connectedFallback: "Conectado",
    adapterHint: "Um adaptador ST-Link v2 (ou compatível)",
    chooseAdapter: "Escolher adaptador",
    connectionFailed: "A conexão falhou.",
  },
  folderGateModal: {
    title: "Pastas necessárias",
    romFolderTitle: "Pasta de ROMs",
    selectedFallback: "Selecionada",
    romFolderHint: "A sua coleção local de ficheiros ROM",
    reconnectLastFolder: "Reconectar a última pasta",
    scanning: "A analisar…",
    sdCardFolderTitle: "Pasta do cartão SD",
    sdCardFolderHint: "A raiz do volume do seu cartão SD",
    errRead: "Não foi possível ler essa pasta.",
    continue: "Continuar",
  },
  auditLog: {
    title: "Atividade",
    empty: "Nada a comunicar ainda.",
    reloaded: "Recarregado",
    sessions: "Sessões",
    sevAll: "Tudo",
    sevDebug: "Depuração",
    sevInfo: "Informação",
    sevWarning: "Aviso",
    sevError: "Erro",
    srcConverter: "Conversor",
    srcDevice: "Dispositivo",
    srcSources: "Fontes",
    filterPlaceholder: "Filtrar",
    showing: (shown: number, total: number) => `A mostrar ${shown} de ${total}`,
    copy: "Copiar",
    save: "Guardar",
    saveFilename: "gnw-activity.txt",
    notificationsTitle: "Notificações",
    noneWaiting: "Ainda sem atividade",
    openActivity: "Abrir Atividade",
    clearNotifications: "Limpar",
    dismissNotification: "Dispensar",
    recoveryFailed: (reason: string) => `O modo de recuperação não iniciou: ${reason}`,
    connectFailed: (reason: string) => `Não foi possível conectar: ${reason}`,
    scanFailed: (reason: string) => `A análise não terminou: ${reason}`,
    foldersFailed: (reason: string) => `Não foi possível ler as pastas: ${reason}`,
    cheatsFailed: (reason: string) => `Não foi possível carregar os cheats: ${reason}`,
  },
  installProgressModal: {
    logLabel: (count: number) => `Registo (${count})`,
    saveLog: "Guardar registo",
    copyLog: "Copiar registo",
    blocksFailed: "Blocos que falharam",
    blockLabel: (n: number) => `Bloco ${n}`,
    // The verb lives INSIDE each branch so it agrees with the number: one block "nao
    // correspondeu", several "nao corresponderam". A single shared verb would always be wrong
    // for one of the two cases, and visibly so.
    verifyHeadline: (blocks: number, retries: number) =>
      `${blocks === 1 ? "Um bloco não correspondeu" : `${blocks} blocos não corresponderam`} após ` +
      `${retries === 1 ? "uma nova tentativa" : `${retries} novas tentativas`}.`,
    partlyWrittenBank: (bank: number) => `O banco ${bank} está parcialmente escrito e não arranca.`,
    partlyWrittenExt: "A flash externa está parcialmente escrita.",
    wiringAdvice:
      "Falhas repetidas de blocos são quase sempre da cablagem do programador. Volte a encaixá-la e tente de novo.",
    // THE STOP. The link itself reuses `common.cancel` ("Cancelar"); these are the parts around
    // it, and the confirm dialog's action is "Parar" so the two stay distinguishable.
    //
    // `cancelCaption` states a fact about the writer, in the third person: the abort flag is
    // checked at the top of each 256 KiB chunk, so a stop never lands mid-erase.
    cancelCaption: "Para depois do bloco atual",
    // Replaces the caption once a stop has been asked for, so it is a STATUS, not a button.
    cancelPending: "A parar",
    cancelTitle: "Parar a escrita?",
    // Names no bank, exactly as the English does not: the board's bank-2 wording is false for an
    // OFW patch flash, which writes bank 1. This says only what holds for every writer here.
    cancelBody: "O que já foi escrito continua escrito. A instalação fica incompleta até a executar de novo.",
    cancelKeep: "Continuar a escrever",
    cancelStop: "Parar",
    cancelledNote: "Parado. A instalação está incompleta.",
    logStopping: "Para no próximo limite de bloco.",
    logStopped: "Parado.",
  },
  geometry: {
    freeSpace: "Espaço livre",
    games: "Jogos e homebrew",
    coresAndSaves: "Cores e saves",
    bankLabel: (n: number) => `Banco ${n}`,
    bankUnknown: "—",
    used: "usado",
    free: "livre",
    bankFree: (n: number) => `Banco ${n} livre`,
    empty: "vazio",
    externalFlash: "flash externa",
    reservedSdCache: "Reservado (cache SD)",
  },
  units: {
    b: "B",
    kb: "KB",
    mb: "MB",
    gb: "GB",
    space: " ",
  },
};
