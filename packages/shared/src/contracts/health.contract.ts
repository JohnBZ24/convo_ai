import { z } from "zod";

/**
 * Liveness: "is this process able to serve at all?"
 *
 * Touches nothing external, so it always answers 200 unless the process is
 * genuinely broken. An orchestrator uses this to decide whether to RESTART.
 */
export const healthResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
  })
  .meta({ id: "HealthResponse", description: "Liveness probe result" });

export type HealthResponse = z.infer<typeof healthResponse>;

/**
 * Readiness: "should traffic be routed here right now?"
 *
 * Checks dependencies. Returns 503 when any is down so a load balancer drains
 * this instance instead of restarting it - a database outage is not fixed by
 * restarting the app.
 */
export const dependencyStatus = z.object({
  name: z.string(),
  status: z.enum(["up", "down"]),
  latencyMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});

export const readinessResponse = z
  .object({
    status: z.enum(["ready", "degraded"]),
    dependencies: z.array(dependencyStatus),
  })
  .meta({ id: "ReadinessResponse", description: "Readiness probe result" });

export type ReadinessResponse = z.infer<typeof readinessResponse>;
export type DependencyStatus = z.infer<typeof dependencyStatus>;
