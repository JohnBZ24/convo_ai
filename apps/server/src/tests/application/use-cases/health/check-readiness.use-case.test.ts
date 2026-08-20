import { describe, expect, it } from "vitest";
import type { HealthProbe } from "~/core/application/ports/health-probe.port";
import { CheckReadinessUseCase } from "~/core/application/use-cases/health/check-readiness.use-case";

/**
 * These tests touch no database, no HTTP and no framework.
 *
 * That is the payoff of the port: the use case depends on the HealthProbe
 * INTERFACE, so "what happens when the database is down" is testable by
 * handing it a probe that says so - no need to stop a real Postgres service
 * (which needs admin rights anyway).
 */
function probe(name: string, ok: boolean, error: string | null = null): HealthProbe {
  return { name, check: async () => ({ ok, latencyMs: 12, error }) };
}

describe("CheckReadinessUseCase", () => {
  it("is ready when every dependency is up", async () => {
    const result = await new CheckReadinessUseCase([probe("database", true)]).execute();

    expect(result.ready).toBe(true);
    expect(result.dependencies).toEqual([
      { name: "database", status: "up", latencyMs: 12, error: null },
    ]);
  });

  it("is NOT ready when any dependency is down", async () => {
    const result = await new CheckReadinessUseCase([
      probe("database", false, "connection refused"),
    ]).execute();

    expect(result.ready).toBe(false);
    expect(result.dependencies[0]).toMatchObject({
      name: "database",
      status: "down",
      error: "connection refused",
    });
  });

  it("reports null latency for a failed probe rather than a misleading number", async () => {
    const result = await new CheckReadinessUseCase([
      probe("database", false, "timeout"),
    ]).execute();
    expect(result.dependencies[0]?.latencyMs).toBeNull();
  });

  it("one dependency down makes the whole instance not ready", async () => {
    const result = await new CheckReadinessUseCase([
      probe("database", true),
      probe("cache", false, "down"),
    ]).execute();

    expect(result.ready).toBe(false);
    expect(result.dependencies.map((d) => d.status)).toEqual(["up", "down"]);
  });

  it("runs probes concurrently, not serially", async () => {
    const slow = (name: string): HealthProbe => ({
      name,
      check: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ok: true, latencyMs: 100, error: null };
      },
    });

    const startedAt = Date.now();
    await new CheckReadinessUseCase([slow("a"), slow("b"), slow("c")]).execute();
    const elapsed = Date.now() - startedAt;

    // serial would be ~300ms; concurrent stays near one probe's duration
    expect(elapsed).toBeLessThan(250);
  });
});
