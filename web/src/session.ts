const NAME_KEY = 'share-screen:display-name';

export function loadDisplayName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveDisplayName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim() || 'Anonimo');
  } catch {
    // localStorage bloqueado (modo privado): o nome so nao persiste.
  }
}

/**
 * Token de sessao por sala, usado para retomar o papel apos uma reconexao.
 *
 * Vive no `sessionStorage`, e nao no `localStorage`, porque a identidade e por
 * ABA: duas abas do mesmo navegador sao dois participantes distintos, e
 * compartilhar o token faria uma roubar a sessao da outra.
 */
function tokenKey(roomId: string): string {
  return `share-screen:token:${roomId}`;
}

export function loadSessionToken(roomId: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(roomId)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSessionToken(roomId: string, token: string): void {
  try {
    sessionStorage.setItem(tokenKey(roomId), token);
  } catch {
    // sessionStorage bloqueado: perde-se apenas a retomada apos reconexao.
  }
}
