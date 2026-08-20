/**
 * Mark every migration in the journal as already applied, without running it.
 *
 *   pnpm --filter @convo/db db:baseline
 *
 * This exists because the `convo` database OUTLIVED the source tree it was
 * built from (see docs/HANDOFF.md). Its tables are correct, but drizzle's
 * ledger still refers to migration files that no longer exist - and drizzle
 * applies every migration whose journal timestamp is newer than the newest
 * ledger row, so `db:migrate` would try to CREATE TABLE over tables that are
 * already there and abort.
 *
 * Baselining says "the schema already matches this journal entry". It is only
 * ever correct when that is TRUE - on a fresh database run `db:migrate`
 * instead, which is why this is a separate command and not part of migrate.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase } from "../client";

interface JournalEntry {
  tag: string;
  when: number;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("✗ DATABASE_URL is not set (it lives in apps/server/.env)");
  process.exit(1);
}

// `new URL(...).pathname` yields "/C:/..." on Windows; fileURLToPath does not.
const packageRoot = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);
const migrationsDir = path.join(packageRoot, "drizzle");

const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

const { db, close } = createDatabase(connectionString, { maxConnections: 1 });

try {
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);

  for (const entry of journal.entries) {
    // The hash drizzle records is a sha256 of the migration file's contents,
    // computed exactly this way - see drizzle-orm/migrator.js.
    const contents = fs.readFileSync(
      path.join(migrationsDir, `${entry.tag}.sql`),
      "utf8",
    );
    const hash = crypto.createHash("sha256").update(contents).digest("hex");

    const existing = await db.execute<{ id: number }>(sql`
      select id from drizzle.__drizzle_migrations where hash = ${hash}
    `);

    if ([...existing].length > 0) {
      console.log(`· ${entry.tag} already recorded`);
      continue;
    }

    await db.execute(sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${entry.when})
    `);
    console.log(`✓ ${entry.tag} marked as applied`);
  }

  console.log("\nDone. `db:migrate` will now only run migrations added after this.");
} finally {
  await close();
}
