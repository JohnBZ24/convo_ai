/**
 * Standalone connectivity check.
 *
 * Exists because drizzle-kit swallows connection errors and prints nothing at
 * all - a wrong DATABASE_URL looks identical to a hung terminal. This says
 * plainly what happened and exits non-zero so CI can use it.
 *
 *   pnpm --filter @convo/db db:check
 */
import { sql } from "drizzle-orm";
import { createDatabase, pingDatabase } from "../client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("✗ DATABASE_URL is not set (it lives in apps/server/.env)");
  process.exit(1);
}

const { db, close } = createDatabase(connectionString, { maxConnections: 1 });

try {
  const ping = await pingDatabase(db, 5000);

  if (!ping.ok) {
    console.error(`✗ cannot reach the database: ${ping.error}`);
    process.exit(1);
  }

  console.log(`✓ connected in ${ping.latencyMs}ms`);

  const rows = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `);

  const names = [...rows].map((row) => row.table_name);
  console.log(`✓ ${names.length} tables: ${names.join(", ")}`);
} finally {
  await close();
}
