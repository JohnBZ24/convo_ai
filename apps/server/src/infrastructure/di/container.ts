import type { Database } from "@convo/db";
import { env } from "~/config/env";
import type { HealthProbe } from "~/core/application/ports/health-probe.port";
import { CheckLivenessUseCase } from "~/core/application/use-cases/health/check-liveness.use-case";
import { CheckReadinessUseCase } from "~/core/application/use-cases/health/check-readiness.use-case";
import { db } from "~/infrastructure/database/database";
import { DrizzleHealthProbe } from "~/infrastructure/database/drizzle-health.probe";

/**
 * Everything the presentation layer is allowed to reach for.
 *
 * This is the composition root: the ONLY place where interfaces get bound to
 * implementations. Nothing else in the codebase says `new DrizzleHealthProbe`,
 * which is what keeps the dependency arrows pointing inwards.
 */
export interface Dependencies {
  database: Database;
  healthProbes: readonly HealthProbe[];
  checkLiveness: CheckLivenessUseCase;
  checkReadiness: CheckReadinessUseCase;
}

/**
 * Build a dependency graph, optionally with pieces replaced.
 *
 * A FACTORY rather than a bare singleton, because that `overrides` parameter is
 * the test seam. A readiness test can pass a probe that reports "down" and
 * assert on the 503 without a database anywhere near it:
 *
 *   const container = createContainer({
 *     healthProbes: [{ name: "database", check: async () => ({ ok: false, ... }) }],
 *   });
 *
 * NestJS note: this replaces `Test.createTestingModule().overrideProvider()`.
 * Same capability, no decorators and no reflection.
 */
export function createContainer(overrides: Partial<Dependencies> = {}): Dependencies {
  const database = overrides.database ?? db;
  const healthProbes = overrides.healthProbes ?? [new DrizzleHealthProbe(database)];

  return {
    database,
    healthProbes,
    checkLiveness: overrides.checkLiveness ?? new CheckLivenessUseCase(env.APP_VERSION),
    checkReadiness: overrides.checkReadiness ?? new CheckReadinessUseCase(healthProbes),
  };
}

/** The application's graph. Built once; Node's module cache makes it a singleton. */
export const container = createContainer();
