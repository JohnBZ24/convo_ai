import { describe, expect, it } from "vitest";
import { CheckLivenessUseCase } from "~/core/application/use-cases/health/check-liveness.use-case";

describe("CheckLivenessUseCase", () => {
  it("reports the configured version", () => {
    expect(new CheckLivenessUseCase("1.2.3").execute().version).toBe("1.2.3");
  });

  it("reports uptime in whole seconds since start", () => {
    const startedAt = new Date(Date.now() - 90_000);
    expect(new CheckLivenessUseCase("1.0.0", startedAt).execute().uptimeSeconds).toBe(
      90,
    );
  });

  it("never throws, because liveness must not depend on anything external", () => {
    expect(() => new CheckLivenessUseCase("1.0.0").execute()).not.toThrow();
  });
});
