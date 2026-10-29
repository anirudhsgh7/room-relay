import { AsyncLocalStorage } from "node:async_hooks";
import { getDatabaseUrl } from "@/lib/config";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

// Keep the existing JSON-shaped text fields intact rather than returning
// JavaScript objects from jsonb columns. The domain layer already validates and
// parses these values itself.
import pgTypes from "pg";
pgTypes.types.setTypeParser(114, (value) => value);
pgTypes.types.setTypeParser(3802, (value) => value);
// timestamptz: return an ISO-8601 string, matching the rest of the app.
pgTypes.types.setTypeParser(1184, (value) => new Date(value).toISOString());
// count()/sum() come back as bigint/numeric strings by default.
pgTypes.types.setTypeParser(20, (value) => Number(value));
pgTypes.types.setTypeParser(1700, (value) => Number(value));

export type SqlParameters =
  | readonly unknown[]
  | Record<string, unknown>
  | string
  | number
  | boolean
  | undefined
  | null;

export interface QueryResult<T> {
  rows: T[];
  changes: number;
}

export interface PreparedStatement {
  get<T extends QueryResultRow = QueryResultRow>(
    ...parameters: unknown[]
  ): Promise<T | undefined>;
  all<T extends QueryResultRow = QueryResultRow>(
    ...parameters: unknown[]
  ): Promise<T[]>;
  run(...parameters: unknown[]): Promise<{ changes: number }>;
}

export interface RoomRelayDatabase {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(
    callback: () => Promise<T>,
  ): { immediate: () => Promise<T> };
  close(): Promise<void>;
}

function bindParameters(
  sql: string,
  parameters: SqlParameters,
): { text: string; values: unknown[] } {
  if (parameters === undefined || parameters === null) {
    return { text: sql, values: [] };
  }

  if (Array.isArray(parameters)) {
    let index = 0;
    return {
      text: sql.replace(/\?/g, () => `$${++index}`),
      values: [...parameters],
    };
  }

  if (typeof parameters !== "object") {
    let index = 0;
    return {
      text: sql.replace(/\?/g, () => `$${++index}`),
      values: [parameters],
    };
  }

  const values: unknown[] = [];
  const indexes = new Map<string, number>();
  const record = parameters as Record<string, unknown>;
  const text = sql.replace(
    /@([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, name: string) => {
      const existing = indexes.get(name);

      if (existing !== undefined) {
        return `$${existing}`;
      }

      values.push(record[name] ?? null);
      indexes.set(name, values.length);
      return `$${values.length}`;
    },
  );

  return { text, values };
}

const transactionClient = new AsyncLocalStorage<PoolClient>();

class PostgresDatabase implements RoomRelayDatabase {
  constructor(private readonly pool: Pool) {}

  prepare(sql: string): PreparedStatement {
    const execute = async (
      parameters?: SqlParameters,
    ): Promise<QueryResult<QueryResultRow>> => {
      const client = transactionClient.getStore() ?? this.pool;
      const { text, values } = bindParameters(sql, parameters);

      try {
        const result = await client.query(text, values);
        return {
          rows: result.rows as QueryResultRow[],
          changes: result.rowCount ?? 0,
        };
      } catch (error) {
        // Preserve the existing domain error mapping. pg wraps errors in an
        // Error whose message contains the trigger's RAISE text.
        throw error;
      }
    };

    const parametersFor = (args: unknown[]): SqlParameters =>
      args.length === 0
        ? undefined
        : args.length === 1
          ? (args[0] as SqlParameters)
          : args;

    return {
      async get<T extends QueryResultRow>(...parameters: unknown[]) {
        const result = await execute(parametersFor(parameters));
        return result.rows[0] as T | undefined;
      },
      async all<T extends QueryResultRow>(...parameters: unknown[]) {
        const result = await execute(parametersFor(parameters));
        return result.rows as T[];
      },
      async run(...parameters: unknown[]) {
        const result = await execute(parametersFor(parameters));
        return { changes: result.changes };
      },
    };
  }

  async exec(sql: string): Promise<void> {
    const client = transactionClient.getStore() ?? this.pool;
    await client.query(sql);
  }

  transaction<T>(callback: () => Promise<T>): { immediate: () => Promise<T> } {
    return {
      immediate: async () => {
        const client = await this.pool.connect();

        try {
          await client.query("BEGIN");
          const result = await transactionClient.run(client, callback);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the original failure.
          }
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    // A serverless instance should hold one connection; Neon's pooler does the
    // real multiplexing. Keep a larger local pool for development and tests.
    max: Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 1 : 5)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  return pool;
}

export { getDatabaseUrl };

export function openDatabase(connectionString: string): RoomRelayDatabase {
  return new PostgresDatabase(createPool(connectionString));
}

const globalForDatabase = globalThis as typeof globalThis & {
  __roomRelayDatabase?: RoomRelayDatabase;
};

export function getDatabase(): RoomRelayDatabase {
  if (globalForDatabase.__roomRelayDatabase) {
    return globalForDatabase.__roomRelayDatabase;
  }

  const database = openDatabase(getDatabaseUrl());
  globalForDatabase.__roomRelayDatabase = database;
  return database;
}

export async function closeDatabase(): Promise<void> {
  await globalForDatabase.__roomRelayDatabase?.close();
  delete globalForDatabase.__roomRelayDatabase;
}
