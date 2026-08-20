import type { HealthProbe } from "~/core/application/ports/health-probe.port";

export interface DependencyReport {
  name: string;
  status: "up" | "down";
  latencyMs: number | null;
  error: string | null;
}

export interface ReadinessResult {
  ready: boolean;
  dependencies: DependencyReport[];
}

/**
 * "Should traffic be routed here right now?"
 *
 * Probes run CONCURRENTLY - a serial loop would make the probe's latency the
 * sum of its dependencies, and a readiness check that is slow to answer is
 * nearly as bad as one that answers wrongly.
 *
 * Any dependency down means not ready, so the load balancer drains this
 * instance instead of restarting it.
 */
export class CheckReadinessUseCase {
  constructor(
    private readonly probes: readonly HealthProbe[],
    private readonly timeoutMs: number = 2000,
  ) {}

  async execute(): Promise<ReadinessResult> {
    const dependencies = await Promise.all(
      this.probes.map(async (probe): Promise<DependencyReport> => {
        const result = await probe.check(this.timeoutMs);

        return {
          name: probe.name,
          status: result.ok ? "up" : "down",
          latencyMs: result.ok ? result.latencyMs : null,
          error: result.error,
        };
      }),
    );

    return {
      ready: dependencies.every((dependency) => dependency.status === "up"),
      dependencies,
    };
  }
}
