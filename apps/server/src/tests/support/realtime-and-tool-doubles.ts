import type { ApplicationError } from "~/core/application/errors/application-error";
import type {
  MintCredentialCommand,
  MintedCredential,
  RealtimeCredentialMinter,
} from "~/core/application/ports/realtime-credential-minter.port";
import type {
  RealtimeSessionRepository,
  RecordRealtimeSessionInput,
} from "~/core/application/ports/realtime-session-repository.port";
import type {
  RecordToolInvocationInput,
  ToolInvocationRepository,
} from "~/core/application/ports/tool-invocation-repository.port";

/**
 * Stand-ins for the three ports iteration 3 added.
 *
 * The payoff of declaring those ports in the core: minting, auditing and
 * idempotency are all testable with no OpenAI account, no network and no spend.
 * Each double records what it was asked to do, because the assertions that
 * matter here are about ORDER and CONTENT - "was the audit row written with
 * what the upstream actually applied?" - not about return values.
 */

export class FakeRealtimeCredentialMinter implements RealtimeCredentialMinter {
  readonly callsUrl = "https://api.example.test/v1/realtime/calls";
  readonly commands: MintCredentialCommand[] = [];

  /** Set to make the next mint fail the way a provider outage does. */
  failWith: ApplicationError | null = null;

  constructor(
    private readonly credential: Omit<MintedCredential, "model" | "voice"> & {
      model?: string;
      voice?: string;
    } = {
      value: "ek_test_credential",
      expiresAt: new Date("2026-08-25T12:01:00.000Z"),
      sessionId: "sess_test",
    },
  ) {}

  async mint(command: MintCredentialCommand): Promise<MintedCredential> {
    this.commands.push(command);
    if (this.failWith) throw this.failWith;

    return {
      value: this.credential.value,
      expiresAt: this.credential.expiresAt,
      sessionId: this.credential.sessionId,
      // Echoes the request unless the double was built to substitute, which is
      // how "the audit row records what the UPSTREAM applied" gets tested.
      model: this.credential.model ?? command.model,
      voice: this.credential.voice ?? command.voice,
    };
  }
}

export class RecordingRealtimeSessionRepository implements RealtimeSessionRepository {
  readonly rows: RecordRealtimeSessionInput[] = [];

  async record(input: RecordRealtimeSessionInput): Promise<void> {
    this.rows.push(input);
  }
}

/**
 * Reproduces the unique constraint on `idempotency_key`, because a double that
 * accepted every key would make the replay tests pass without testing anything.
 */
export class InMemoryToolInvocationRepository implements ToolInvocationRepository {
  readonly rows: RecordToolInvocationInput[] = [];
  private readonly keys = new Set<string>();

  async record(input: RecordToolInvocationInput): Promise<boolean> {
    this.rows.push(input);

    if (this.keys.has(input.idempotencyKey)) return false;

    this.keys.add(input.idempotencyKey);
    return true;
  }
}
