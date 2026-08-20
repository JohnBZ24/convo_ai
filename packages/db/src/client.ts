import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseOptions {
  /** Max pooled connections. Small by default; this is a single dev instance. */
  maxConnections?: number;
  /** Seconds an idle connection is kept before being closed. */
  idleTimeoutSeconds?: number;
}

/**
 * Build a database handle.
 *
 * Deliberately a FACTORY that takes a connection string, rather than a module
 * that reads `process.env` itself. Configuration is the application's job, not
 * this package's - which is also what lets a test point it at a throwaway
 * database without touching the environment.
 *
 * NestJS note: this is the equivalent of `TypeOrmModule.forRoot()`. What
 * supplies the singleton here is the ES module system - `container.ts` calls
 * this once and every importer of the container gets that same instance,
 * because Node caches modules.
 */
export function createDatabase(
  connectionString: string,
  options: DatabaseOptions = {},
) {
  const client = postgres(connectionString, {
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    onnotice: () => {},
  });

  return {
    db: drizzle(client, { schema }),
    /** Close the pool. Used by tests and graceful shutdown. */
    close: () => client.end({ timeout: 5 }),
  };
}

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

/**
 * `SELECT 1` under a hard timeout.
 *
 * The timeout is the point: a database that accepts connections but never
 * answers would otherwise hang the readiness probe, and a probe that hangs is
 * worse than one that fails, because the orchestrator learns nothing.
 */
export async function pingDatabase(
  db: Database,
  timeoutMs = 2000,
): Promise<PingResult> {
  const startedAt = Date.now();

  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);

    return { ok: true, latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
