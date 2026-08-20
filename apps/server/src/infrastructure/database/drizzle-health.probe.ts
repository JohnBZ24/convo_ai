import { type Database, pingDatabase } from "@convo/db";
import type {
  HealthProbe,
  ProbeResult,
} from "~/core/application/ports/health-probe.port";

/**
 * Adapter: satisfies the application's HealthProbe port using Drizzle.
 *
 * The use case that consumes this has no idea Postgres exists - which is the
 * entire point of the port. Swapping the database would replace this file and
 * nothing else.
 */
export class DrizzleHealthProbe implements HealthProbe {
  readonly name = "database";

  constructor(private readonly database: Database) {}

  check(timeoutMs: number): Promise<ProbeResult> {
    return pingDatabase(this.database, timeoutMs);
  }
}
