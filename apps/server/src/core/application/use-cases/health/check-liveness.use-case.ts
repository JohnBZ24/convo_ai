export interface LivenessResult {
  version: string;
  uptimeSeconds: number;
}

/**
 * "Can this process serve at all?"
 *
 * Touches nothing external on purpose. An orchestrator uses liveness to decide
 * whether to RESTART the process, so it must not fail because a dependency is
 * down - restarting the app does not fix a database outage. That distinction
 * is what separates this from readiness.
 */
export class CheckLivenessUseCase {
  constructor(
    private readonly version: string,
    private readonly startedAt: Date = new Date(),
  ) {}

  execute(): LivenessResult {
    return {
      version: this.version,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
    };
  }
}
