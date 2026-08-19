import type { RowDataPacket } from 'mysql2';
import { getPool } from './db.js';
import type { ChatMessage } from './types.js';

/** Quantas mensagens antigas um participante recebe ao entrar. */
const HISTORY_LIMIT = Number(process.env.CHAT_HISTORY_LIMIT ?? 100);

interface MessageRow extends RowDataPacket {
  id: string;
  display_name: string;
  text: string;
  created_at: Date;
}

interface CountRow extends RowDataPacket {
  total: number;
}

/**
 * Erros de escrita nao podem derrubar a sala: o chat ao vivo ja foi entregue
 * via socket, e perder uma linha de historico e menos grave que quebrar a
 * sessao de todo mundo. Por isso as falhas sao registradas, nao propagadas.
 */
function logFailure(operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db] ${operation} falhou: ${message}`);
}

export async function persistRoom(roomId: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.execute('INSERT IGNORE INTO rooms (id) VALUES (?)', [roomId]);
  } catch (error) {
    logFailure('persistRoom', error);
  }
}

/** Uma sala existe se esta no banco, mesmo sem ninguem conectado agora. */
export async function roomExists(roomId: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const [rows] = await pool.execute<CountRow[]>(
      'SELECT COUNT(*) AS total FROM rooms WHERE id = ?',
      [roomId],
    );
    return (rows[0]?.total ?? 0) > 0;
  } catch (error) {
    logFailure('roomExists', error);
    return false;
  }
}

export async function touchRoom(roomId: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.execute('UPDATE rooms SET last_active_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
      roomId,
    ]);
  } catch (error) {
    logFailure('touchRoom', error);
  }
}

export async function persistMessage(roomId: string, message: ChatMessage): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.execute(
      'INSERT INTO messages (id, room_id, display_name, text, created_at) VALUES (?, ?, ?, ?, ?)',
      [message.id, roomId, message.displayName, message.text, new Date(message.ts)],
    );
  } catch (error) {
    logFailure('persistMessage', error);
  }
}

export async function loadRecentMessages(roomId: string): Promise<ChatMessage[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    // Pega as N mais recentes e devolve em ordem cronologica para a UI.
    const [rows] = await pool.query<MessageRow[]>(
      `SELECT id, display_name, text, created_at
         FROM messages
        WHERE room_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [roomId, HISTORY_LIMIT],
    );
    return rows
      .map((row) => ({
        id: row.id,
        // `from` identifica o socket da sessao atual. Mensagens do historico
        // vem sem dono para nao serem marcadas como "suas" por engano quando
        // um socket id for reciclado.
        from: '',
        displayName: row.display_name,
        text: row.text,
        ts: row.created_at.getTime(),
      }))
      .reverse();
  } catch (error) {
    logFailure('loadRecentMessages', error);
    return [];
  }
}
