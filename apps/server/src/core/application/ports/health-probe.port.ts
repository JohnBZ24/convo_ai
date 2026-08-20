/**
 * A dependency that readiness can interrogate.
 *
 * This is a PORT: the application layer declares what it needs, and the
 * infrastructure layer supplies an implementation. It is why
 * `CheckReadinessUseCase` can be tested with a fake that reports "down"
 * without a database anywhere near the test, and why swapping Drizzle for
 * something else would not touch the use case.
 *
 * NestJS note: this is the interface you would put in a custom provider token
 * and inject. Here the DI container passes it to the constructor directly.
 */
export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

export interface HealthProbe {
  /** Stable identifier reported to the caller, e.g. "database". */
  readonly name: string;
  check(timeoutMs: number): Promise<ProbeResult>;
}
