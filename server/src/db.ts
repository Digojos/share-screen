import mysql from 'mysql2/promise';

/**
 * O banco e OPCIONAL. Sem configuracao o servidor roda inteiramente em memoria
 * (comportamento original): salas morrem com o host e o chat e efemero. Com o
 * banco configurado, o codigo da sala e o historico sobrevivem.
 *
 * Ha duas formas de configurar, e a ordem importa:
 *
 * 1. Variaveis separadas (`MYSQL_HOST`, `MYSQL_USER`, ...) — preferida. Senha
 *    passa como valor, sem virar parte de uma URL.
 * 2. `DATABASE_URL` — aceita por compatibilidade, mas exige que a senha esteja
 *    percent-encoded. Uma senha com `/`, `@` ou `#` (comuns em geradores como
 *    `openssl rand -base64`) quebra a URL em silencio e o servidor so reporta
 *    "Access denied", o que aponta para o lugar errado.
 */
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

/**
 * Monta a configuracao do pool. `null` significa "sem banco": o servidor segue
 * em memoria.
 */
function buildPoolOptions(): mysql.PoolOptions | null {
  const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, DATABASE_URL } = process.env;

  const comum = { connectionLimit: 10, waitForConnections: true, charset: 'utf8mb4' } as const;

  if (MYSQL_HOST && MYSQL_USER && MYSQL_DATABASE) {
    return {
      ...comum,
      host: MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: MYSQL_USER,
      password: MYSQL_PASSWORD ?? '',
      database: MYSQL_DATABASE,
    };
  }

  if (DATABASE_URL) return { ...comum, uri: DATABASE_URL };

  return null;
}

export function isDatabaseEnabled(): boolean {
  return pool !== null;
}

export function getPool(): mysql.Pool | null {
  return pool;
}

/**
 * Erros do mysql2 costumam ter `message` vazia e trazer a causa em `code`
 * (ECONNREFUSED, ER_ACCESS_DENIED_ERROR). Sem isso o log sai como
 * "tentativa 1/10 falhou:" e nao ajuda ninguem.
 */
function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as Error & { code?: string }).code;
  const partes = [code, error.message].filter(Boolean);
  return partes.length > 0 ? partes.join(' - ') : error.name;
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
  const opcoes = buildPoolOptions();
  if (!opcoes) {
    console.log('[db] sem configuracao de banco — rodando em memoria, sem historico.');
    return;
  }

  // O container do MySQL costuma demorar alguns segundos a mais que o Node.
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt += 1) {
    try {
      const candidate = mysql.createPool(opcoes);
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
      console.warn(`[db] tentativa ${attempt}/${CONNECT_RETRIES} falhou: ${describeDbError(error)}`);
      if (attempt === CONNECT_RETRIES) {
        console.error('[db] nao foi possivel conectar. Suba o MySQL, ou remova a');
        console.error('[db] configuracao de banco para rodar em memoria.');
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
