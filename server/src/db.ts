import mysql from 'mysql2/promise';

/**
 * O banco e OPCIONAL. Sem `DATABASE_URL` o servidor roda inteiramente em
 * memoria (comportamento original): salas morrem com o host e o chat e efemero.
 * Com o banco configurado, o codigo da sala e o historico sobrevivem.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const CONNECT_RETRIES = Number(process.env.DB_CONNECT_RETRIES ?? 10);
const CONNECT_RETRY_DELAY_MS = 2000;

let pool: mysql.Pool | null = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rooms (
     id CHAR(6) NOT NULL PRIMARY KEY,
     created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     last_active_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS messages (
     id CHAR(36) NOT NULL PRIMARY KEY,
     room_id CHAR(6) NOT NULL,
     display_name VARCHAR(40) NOT NULL,
     text VARCHAR(1000) NOT NULL,
     created_at DATETIME(3) NOT NULL,
     INDEX idx_messages_room_created (room_id, created_at),
     CONSTRAINT fk_messages_room FOREIGN KEY (room_id)
       REFERENCES rooms (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export function isDatabaseEnabled(): boolean {
  return pool !== null;
}

export function getPool(): mysql.Pool | null {
  return pool;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Conecta e aplica o schema. Se `DATABASE_URL` esta definido mas o banco nao
 * responde, o processo encerra em vez de degradar em silencio para memoria —
 * persistencia configurada e ignorada e pior do que falhar alto.
 */
export async function initDatabase(): Promise<void> {
  if (!DATABASE_URL) {
    console.log('[db] DATABASE_URL ausente — rodando em memoria, sem historico.');
    return;
  }

  // O container do MySQL costuma demorar alguns segundos a mais que o Node.
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt += 1) {
    try {
      const candidate = mysql.createPool({
        uri: DATABASE_URL,
        connectionLimit: 10,
        waitForConnections: true,
        charset: 'utf8mb4',
      });
      const connection = await candidate.getConnection();
      try {
        for (const statement of SCHEMA) await connection.query(statement);
      } finally {
        connection.release();
      }
      pool = candidate;
      console.log('[db] conectado, schema aplicado.');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[db] tentativa ${attempt}/${CONNECT_RETRIES} falhou: ${message}`);
      if (attempt === CONNECT_RETRIES) {
        console.error('[db] nao foi possivel conectar. Suba o MySQL ou remova DATABASE_URL.');
        process.exit(1);
      }
      await sleep(CONNECT_RETRY_DELAY_MS);
    }
  }
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
}
