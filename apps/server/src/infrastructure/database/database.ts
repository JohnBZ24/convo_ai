import { createDatabase } from "@convo/db";
import { env } from "~/config/env";

/**
 * The one database handle for this process.
 *
 * NestJS note: this is `TypeOrmModule.forRoot()`. The singleton comes from the
 * ES module system rather than a DI container - Node caches modules, so every
 * importer receives this same instance.
 */
export const { db, close: closeDatabase } = createDatabase(env.DATABASE_URL);
