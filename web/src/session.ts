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
