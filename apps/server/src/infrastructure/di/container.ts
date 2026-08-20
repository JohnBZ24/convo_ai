import type { Database } from "@convo/db";
import { env } from "~/config/env";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { HealthProbe } from "~/core/application/ports/health-probe.port";
import type { RateLimiter } from "~/core/application/ports/rate-limiter.port";
import type { SessionAuthenticator } from "~/core/application/ports/session-authenticator.port";
import { AppendTurnUseCase } from "~/core/application/use-cases/conversations/append-turn.use-case";
import { EndConversationUseCase } from "~/core/application/use-cases/conversations/end-conversation.use-case";
import { GetConversationUseCase } from "~/core/application/use-cases/conversations/get-conversation.use-case";
import { ListConversationsUseCase } from "~/core/application/use-cases/conversations/list-conversations.use-case";
import { StartConversationUseCase } from "~/core/application/use-cases/conversations/start-conversation.use-case";
import { CheckLivenessUseCase } from "~/core/application/use-cases/health/check-liveness.use-case";
import { CheckReadinessUseCase } from "~/core/application/use-cases/health/check-readiness.use-case";
import { BetterAuthSessionAuthenticator } from "~/infrastructure/auth/better-auth-session.authenticator";
import { db } from "~/infrastructure/database/database";
import { DrizzleConversationRepository } from "~/infrastructure/database/drizzle-conversation.repository";
import { DrizzleHealthProbe } from "~/infrastructure/database/drizzle-health.probe";
import { InMemoryRateLimiter } from "~/infrastructure/rate-limiting/in-memory-rate-limiter";

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
  conversationRepository: ConversationRepository;
  sessionAuthenticator: SessionAuthenticator;
  rateLimiter: RateLimiter;

  checkLiveness: CheckLivenessUseCase;
  checkReadiness: CheckReadinessUseCase;
  startConversation: StartConversationUseCase;
  listConversations: ListConversationsUseCase;
  getConversation: GetConversationUseCase;
  endConversation: EndConversationUseCase;
  appendTurn: AppendTurnUseCase;
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
  const conversationRepository =
    overrides.conversationRepository ?? new DrizzleConversationRepository(database);

  return {
    database,
    healthProbes,
    conversationRepository,
    sessionAuthenticator:
      overrides.sessionAuthenticator ?? new BetterAuthSessionAuthenticator(),
    rateLimiter: overrides.rateLimiter ?? new InMemoryRateLimiter(),

    checkLiveness: overrides.checkLiveness ?? new CheckLivenessUseCase(env.APP_VERSION),
    checkReadiness: overrides.checkReadiness ?? new CheckReadinessUseCase(healthProbes),
    startConversation:
      overrides.startConversation ??
      new StartConversationUseCase(conversationRepository),
    listConversations:
      overrides.listConversations ??
      new ListConversationsUseCase(conversationRepository),
    getConversation:
      overrides.getConversation ?? new GetConversationUseCase(conversationRepository),
    endConversation:
      overrides.endConversation ?? new EndConversationUseCase(conversationRepository),
    appendTurn: overrides.appendTurn ?? new AppendTurnUseCase(conversationRepository),
  };
}

/** The application's graph. Built once; Node's module cache makes it a singleton. */
export const container = createContainer();
