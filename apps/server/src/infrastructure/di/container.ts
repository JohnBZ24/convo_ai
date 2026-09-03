import type { Database } from "@convo/db";
import { env } from "~/config/env";
import type { ConversationRepository } from "~/core/application/ports/conversation-repository.port";
import type { HealthProbe } from "~/core/application/ports/health-probe.port";
import type { RateLimiter } from "~/core/application/ports/rate-limiter.port";
import type { RealtimeCredentialMinter } from "~/core/application/ports/realtime-credential-minter.port";
import type { RealtimeSessionRepository } from "~/core/application/ports/realtime-session-repository.port";
import type { SessionAuthenticator } from "~/core/application/ports/session-authenticator.port";
import type { ToolHandlerRegistry } from "~/core/application/ports/tool-handler.port";
import type { ToolInvocationRepository } from "~/core/application/ports/tool-invocation-repository.port";
import { AppendTurnUseCase } from "~/core/application/use-cases/conversations/append-turn.use-case";
import { DeleteConversationUseCase } from "~/core/application/use-cases/conversations/delete-conversation.use-case";
import { EndConversationUseCase } from "~/core/application/use-cases/conversations/end-conversation.use-case";
import { GetConversationUseCase } from "~/core/application/use-cases/conversations/get-conversation.use-case";
import { ListConversationsUseCase } from "~/core/application/use-cases/conversations/list-conversations.use-case";
import { RenameConversationUseCase } from "~/core/application/use-cases/conversations/rename-conversation.use-case";
import { StartConversationUseCase } from "~/core/application/use-cases/conversations/start-conversation.use-case";
import { CheckLivenessUseCase } from "~/core/application/use-cases/health/check-liveness.use-case";
import { CheckReadinessUseCase } from "~/core/application/use-cases/health/check-readiness.use-case";
import { MintRealtimeCredentialUseCase } from "~/core/application/use-cases/realtime/mint-realtime-credential.use-case";
import { ExecuteToolUseCase } from "~/core/application/use-cases/tools/execute-tool.use-case";
import {
  SEARCH_CONVERSATIONS_TOOL_NAME,
  SearchConversationsUseCase,
} from "~/core/application/use-cases/tools/search-conversations.use-case";
import { BetterAuthSessionAuthenticator } from "~/infrastructure/auth/better-auth-session.authenticator";
import { db } from "~/infrastructure/database/database";
import { DrizzleConversationRepository } from "~/infrastructure/database/drizzle-conversation.repository";
import { DrizzleHealthProbe } from "~/infrastructure/database/drizzle-health.probe";
import { DrizzleRealtimeSessionRepository } from "~/infrastructure/database/drizzle-realtime-session.repository";
import { DrizzleToolInvocationRepository } from "~/infrastructure/database/drizzle-tool-invocation.repository";
import { InMemoryRateLimiter } from "~/infrastructure/rate-limiting/in-memory-rate-limiter";
import { OpenAiRealtimeMinter } from "~/infrastructure/realtime/openai-realtime.minter";

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
  realtimeSessionRepository: RealtimeSessionRepository;
  toolInvocationRepository: ToolInvocationRepository;
  sessionAuthenticator: SessionAuthenticator;
  rateLimiter: RateLimiter;
  realtimeCredentialMinter: RealtimeCredentialMinter;
  /**
   * Tool name -> implementation. A tool declared privileged in `@convo/ai` with
   * no entry here is a 500 by design, and a test asserts it - so adding a
   * declaration without an implementation cannot ship quietly.
   */
  toolHandlers: ToolHandlerRegistry;

  checkLiveness: CheckLivenessUseCase;
  checkReadiness: CheckReadinessUseCase;
  startConversation: StartConversationUseCase;
  listConversations: ListConversationsUseCase;
  getConversation: GetConversationUseCase;
  endConversation: EndConversationUseCase;
  renameConversation: RenameConversationUseCase;
  deleteConversation: DeleteConversationUseCase;
  appendTurn: AppendTurnUseCase;
  mintRealtimeCredential: MintRealtimeCredentialUseCase;
  executeTool: ExecuteToolUseCase;
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
  const realtimeSessionRepository =
    overrides.realtimeSessionRepository ??
    new DrizzleRealtimeSessionRepository(database);
  const toolInvocationRepository =
    overrides.toolInvocationRepository ?? new DrizzleToolInvocationRepository(database);

  /**
   * Every knob comes from validated configuration, so switching model, voice or
   * even the API host is an environment change and a restart - not a release.
   */
  const realtimeCredentialMinter =
    overrides.realtimeCredentialMinter ??
    new OpenAiRealtimeMinter({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      ttlSeconds: env.REALTIME_CLIENT_SECRET_TTL_SECONDS,
      requestTimeoutMs: env.OPENAI_REQUEST_TIMEOUT_MS,
    });

  const toolHandlers =
    overrides.toolHandlers ??
    ({
      [SEARCH_CONVERSATIONS_TOOL_NAME]: new SearchConversationsUseCase(
        conversationRepository,
      ),
    } satisfies ToolHandlerRegistry);

  return {
    database,
    healthProbes,
    conversationRepository,
    realtimeSessionRepository,
    toolInvocationRepository,
    sessionAuthenticator:
      overrides.sessionAuthenticator ?? new BetterAuthSessionAuthenticator(),
    rateLimiter: overrides.rateLimiter ?? new InMemoryRateLimiter(),
    realtimeCredentialMinter,
    toolHandlers,

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
    renameConversation:
      overrides.renameConversation ??
      new RenameConversationUseCase(conversationRepository),
    deleteConversation:
      overrides.deleteConversation ??
      new DeleteConversationUseCase(conversationRepository),
    appendTurn: overrides.appendTurn ?? new AppendTurnUseCase(conversationRepository),
    mintRealtimeCredential:
      overrides.mintRealtimeCredential ??
      new MintRealtimeCredentialUseCase(
        realtimeCredentialMinter,
        realtimeSessionRepository,
        conversationRepository,
        { model: env.REALTIME_MODEL, voice: env.REALTIME_VOICE },
      ),
    executeTool:
      overrides.executeTool ??
      new ExecuteToolUseCase(toolHandlers, toolInvocationRepository),
  };
}

/** The application's graph. Built once; Node's module cache makes it a singleton. */
export const container = createContainer();
