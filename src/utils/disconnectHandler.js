/**
 * Tipos de desconexão do WhatsApp
 * Baseado nos DisconnectReason do Baileys
 */

export const DisconnectReasons = {
  // Erros que exigem nova autenticação
  LOGGED_OUT: 401, // Usuário foi deslogado
  BAD_SESSION: 500, // Sessão corrompida
  
  // Erros temporários (reconectar)
  CONNECTION_CLOSED: 428, // Conexão fechada
  CONNECTION_LOST: 408, // Conexão perdida
  CONNECTION_REPLACED: 440, // Conexão substituída
  TIMED_OUT: 408, // Timeout
  RESTART_REQUIRED: 515, // Reinício requerido
  
  // Conflitos
  MULTIDEVICE_MISMATCH: 411, // Conflito multidevice
  
  // Outros
  UNAVAILABLE: 503, // Serviço indisponível
};

export const ErrorMessages = {
  CONNECTION_FAILURE: "Connection Failure",
  CONFLICT: "conflict",
  BAD_MAC: "INVALID_MAC",
  STREAM_CLOSED: "Stream Closed",
};

/**
 * Determina se deve reconectar baseado no erro
 */
export function shouldReconnect(statusCode, errorMessage) {
  const noReconnectCodes = [
    DisconnectReasons.LOGGED_OUT,
    DisconnectReasons.BAD_SESSION,
  ];
  
  return !noReconnectCodes.includes(statusCode);
}

/**
 * Obtém mensagem amigável para o erro
 */
export function getErrorDescription(statusCode, errorMessage) {
  switch (statusCode) {
    case DisconnectReasons.LOGGED_OUT:
      return "Você foi deslogado do WhatsApp";
    case DisconnectReasons.BAD_SESSION:
      return "Sessão corrompida ou inválida";
    case DisconnectReasons.CONNECTION_CLOSED:
      return "Conexão fechada pelo servidor";
    case DisconnectReasons.CONNECTION_LOST:
      return "Conexão perdida";
    case DisconnectReasons.TIMED_OUT:
      return "Tempo de conexão esgotado";
    case DisconnectReasons.RESTART_REQUIRED:
      return "Reinício requerido pelo WhatsApp";
    case DisconnectReasons.MULTIDEVICE_MISMATCH:
      return "Conflito de múltiplos dispositivos";
    default:
      return errorMessage || "Erro desconhecido";
  }
}

export default {
  DisconnectReasons,
  ErrorMessages,
  shouldReconnect,
  getErrorDescription,
};
