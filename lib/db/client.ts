import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

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

interface RequestPoolScope {
  pools: Map<string, Pool>;
  closePromise?: Promise<void>;
}

interface RequestPoolLifecycle {
  storage: AsyncLocalStorage<RequestPoolScope>;
}

const requestPoolLifecycleKey = Symbol.for(
  "index-analyzer.request-database-pools",
);
const globalSymbols = globalThis as unknown as Record<PropertyKey, unknown>;
const existingLifecycle = globalSymbols[requestPoolLifecycleKey];
const requestPoolLifecycle: RequestPoolLifecycle =
  existingLifecycle &&
  typeof existingLifecycle === "object" &&
  "storage" in existingLifecycle
    ? (existingLifecycle as RequestPoolLifecycle)
    : { storage: new AsyncLocalStorage<RequestPoolScope>() };
globalSymbols[requestPoolLifecycleKey] = requestPoolLifecycle;

async function closeRequestScope(scope: RequestPoolScope): Promise<void> {
  if (!scope.closePromise) {
    const scopedPools = [...scope.pools.values()];
    scope.pools.clear();
    scope.closePromise = Promise.allSettled(
      scopedPools.map((pool) => pool.end()),
    ).then(() => undefined);
  }
  await scope.closePromise;
}

export interface ScopedDatabasePools<T> {
  value: T;
  close(): Promise<void>;
}

/**
 * Runs one request with an isolated pool registry.
 *
 * Workerd does not allow a socket created by one request context to be reused
 * from another. Node servers that do not opt into this scope retain the global
 * pool cache, while the Workers adapter closes scoped pools after response
 * streaming completes.
 */
export async function runWithRequestDatabasePools<T>(
  operation: () => T | Promise<T>,
): Promise<ScopedDatabasePools<T>> {
  const parent = requestPoolLifecycle.storage.getStore();
  if (parent) {
    return {
      value: await operation(),
      close: async () => undefined,
    };
  }
  const scope: RequestPoolScope = { pools: new Map() };
  try {
    const value = await requestPoolLifecycle.storage.run(scope, operation);
    return { value, close: () => closeRequestScope(scope) };
  } catch (error) {
    await closeRequestScope(scope);
    throw error;
  }
}

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
    options:
      "-c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=31000",
    ...options,
  });
}

export function getDatabasePool(connectionString: string): Pool {
  const registry = requestPoolLifecycle.storage.getStore()?.pools ?? pools;
  const existing = registry.get(connectionString);
  if (existing) return existing;
  const pool = createDatabasePool(connectionString);
  registry.set(connectionString, pool);
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
