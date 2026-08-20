import { healthResponse, readinessResponse } from "@convo/shared";
import { container } from "~/infrastructure/di/container";
import { defineHandler } from "~/presentation/http/define-handler";

/**
 * Controllers are the HTTP adapter: they translate a request into a use-case
 * call and a use-case result into a response. No business logic lives here -
 * the decision about what "ready" means belongs to CheckReadinessUseCase.
 *
 * Health deliberately has no repository and no entity. Forcing the full
 * controller/use-case/repository triple onto a feature this thin would add
 * files without adding clarity.
 */

export const getHealth = defineHandler({
  operationId: "getHealth",
  method: "get",
  path: "/api/health",
  summary: "Liveness probe",
  description:
    "Reports whether the process can serve. Touches no external dependency, so it stays 200 even when the database is down - restarting the app would not fix that. Orchestrators use this to decide on restarts.",
  tags: ["health"],
  responses: { 200: healthResponse },
  handler: () => {
    const { version, uptimeSeconds } = container.checkLiveness.execute();
    return { status: 200, body: { status: "ok" as const, version, uptimeSeconds } };
  },
});

export const getReadiness = defineHandler({
  operationId: "getReadiness",
  method: "get",
  path: "/api/ready",
  summary: "Readiness probe",
  description:
    "Reports whether traffic should be routed here. Checks every dependency under a timeout and answers 503 when any is down, so a load balancer drains this instance rather than restarting it.",
  tags: ["health"],
  responses: { 200: readinessResponse, 503: readinessResponse },
  handler: async () => {
    const { ready, dependencies } = await container.checkReadiness.execute();

    return {
      status: ready ? 200 : 503,
      body: {
        status: ready ? ("ready" as const) : ("degraded" as const),
        dependencies,
      },
    };
  },
});
