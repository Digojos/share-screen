import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROOM_CODE_LENGTH } from '@shared';
import { connectSignaling, createRoom } from '../rtc/signaling';
import { loadDisplayName, saveDisplayName } from '../session';

export function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(loadDisplayName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function enterRoom(roomId: string) {
    saveDisplayName(name);
    navigate(`/room/${roomId.toUpperCase()}`);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    // Socket descartavel so para reservar o codigo: quem entrar primeiro na
    // sala (este mesmo usuario, logo em seguida) e quem vira host.
    const socket = connectSignaling();
    try {
      const { roomId } = await createRoom(socket);
      enterRoom(roomId);
    } catch {
      setError('Nao foi possivel criar a sala. O servidor esta rodando?');
    } finally {
      socket.disconnect();
      setBusy(false);
    }
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== ROOM_CODE_LENGTH) {
      setError(`O codigo tem ${ROOM_CODE_LENGTH} caracteres.`);
      return;
    }
    enterRoom(trimmed);
  }

  return (
    <main className="home">
      <h1>Share Screen</h1>
      <p className="muted">Compartilhe sua tela pelo navegador, sem instalar nada.</p>

      <label className="field">
        <span>Seu nome</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Como voce aparece para os outros"
          maxLength={40}
        />
      </label>

      <div className="home-actions">
        <button type="button" className="primary" onClick={handleCreate} disabled={busy}>
          {busy ? 'Criando...' : 'Criar sala'}
        </button>

        <form className="join-form" onSubmit={handleJoin}>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Codigo da sala"
            maxLength={ROOM_CODE_LENGTH}
            className="code-input"
          />
          <button type="submit">Entrar</button>
        </form>
      </div>

      {error && <p className="badge error">{error}</p>}
    </main>
  );
}
