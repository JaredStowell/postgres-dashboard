import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface DatabasePool extends Queryable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

const pools = new Map<string, Pool>();

export function createDatabasePool(
  connectionString: string,
  options: Partial<PoolConfig> = {},
): Pool {
  return new Pool({
    connectionString,
    max: 8,
    min: 0,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    application_name: "index-analyzer",
    ...options,
  });
}

export function getDatabasePool(connectionString: string): Pool {
  const existing = pools.get(connectionString);
  if (existing) return existing;
  const pool = createDatabasePool(connectionString);
  pools.set(connectionString, pool);
  return pool;
}

export async function closeDatabasePools(): Promise<void> {
  const closing = [...pools.values()].map((pool) => pool.end());
  pools.clear();
  await Promise.allSettled(closing);
}

export async function withReadOnlyTransaction<T>(
  pool: DatabasePool,
  operation: (client: PoolClient) => Promise<T>,
  options: { statementTimeoutMs?: number; lockTimeoutMs?: number } = {},
): Promise<T> {
  const statementTimeoutMs = Math.min(
    Math.max(options.statementTimeoutMs ?? 5_000, 100),
    30_000,
  );
  const lockTimeoutMs = Math.min(
    Math.max(options.lockTimeoutMs ?? 1_000, 50),
    5_000,
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${statementTimeoutMs}ms`,
    ]);
    await client.query("SELECT set_config('lock_timeout', $1, true)", [
      `${lockTimeoutMs}ms`,
    ]);
    await client.query(
      "SELECT set_config('idle_in_transaction_session_timeout', $1, true)",
      [`${statementTimeoutMs + 1_000}ms`],
    );
    const result = await operation(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}
