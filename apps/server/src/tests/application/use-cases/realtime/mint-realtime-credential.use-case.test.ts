import { beforeEach, describe, expect, it } from "vitest";
import { ApplicationError } from "~/core/application/errors/application-error";
import { MintRealtimeCredentialUseCase } from "~/core/application/use-cases/realtime/mint-realtime-credential.use-case";
import { InMemoryConversationRepository } from "~/tests/support/in-memory-conversation.repository";
import {
  FakeRealtimeCredentialMinter,
  RecordingRealtimeSessionRepository,
} from "~/tests/support/realtime-and-tool-doubles";

const OWNER = "user-owner";
const STRANGER = "user-stranger";
const SETTINGS = { model: "gpt-realtime-2", voice: "marin" };

let conversations: InMemoryConversationRepository;
let minter: FakeRealtimeCredentialMinter;
let sessions: RecordingRealtimeSessionRepository;
let mint: MintRealtimeCredentialUseCase;

beforeEach(() => {
  conversations = new InMemoryConversationRepository();
  minter = new FakeRealtimeCredentialMinter();
  sessions = new RecordingRealtimeSessionRepository();
  mint = new MintRealtimeCredentialUseCase(minter, sessions, conversations, SETTINGS);
});

describe("minting a credential", () => {
  it("works without a conversation - the device may mint before it opens one", async () => {
    const credential = await mint.execute(OWNER);

    expect(credential.value).toBe("ek_test_credential");
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.conversationId).toBeNull();
  });

  /**
   * The model is CONFIGURATION. A use case that picked one would put a
   * deployment decision in the core, and switching to the cheaper model would
   * stop being a one-line .env change.
   */
  it("mints with the configured model and voice, not a hardcoded pair", async () => {
    await mint.execute(OWNER);

    expect(minter.commands).toEqual([{ model: "gpt-realtime-2", voice: "marin" }]);
  });

  it("links the audit row to the conversation when one is given", async () => {
    const conversation = await conversations.create(OWNER);

    await mint.execute(OWNER, { conversationId: conversation.id });

    expect(sessions.rows[0]).toMatchObject({
      userId: OWNER,
      conversationId: conversation.id,
      model: "gpt-realtime-2",
      voice: "marin",
    });
  });

  /**
   * If the provider substitutes a model, the audit trail must say what actually
   * happened rather than what was requested - otherwise the one record of a
   * surprise bill describes a session that never existed.
   */
  it("records what the upstream applied, not what was asked for", async () => {
    minter = new FakeRealtimeCredentialMinter({
      value: "ek_x",
      expiresAt: new Date("2026-08-25T12:01:00.000Z"),
      sessionId: "sess_x",
      model: "gpt-realtime-2.1-mini",
      voice: "cedar",
    });
    mint = new MintRealtimeCredentialUseCase(minter, sessions, conversations, SETTINGS);

    await mint.execute(OWNER);

    expect(sessions.rows[0]).toMatchObject({
      model: "gpt-realtime-2.1-mini",
      voice: "cedar",
    });
  });

  it("never stores the credential itself", async () => {
    await mint.execute(OWNER);

    // The port has no field for it, so this asserts the shape as much as the
    // behaviour: a credential in a database outlives its 60 second life.
    expect(JSON.stringify(sessions.rows)).not.toContain("ek_test_credential");
  });
});

describe("ownership", () => {
  /**
   * The important half of this test is the SECOND assertion. Minting is
   * billable, so an unauthorised request has to be refused BEFORE it spends
   * anything - checking afterwards would still have cost money.
   */
  it("refuses another user's conversation without minting anything", async () => {
    const conversation = await conversations.create(OWNER);

    await expect(
      mint.execute(STRANGER, { conversationId: conversation.id }),
    ).rejects.toMatchObject({ kind: "not-found" });

    expect(minter.commands).toHaveLength(0);
    expect(sessions.rows).toHaveLength(0);
  });

  it("reports a conversation that never existed the same way", async () => {
    await expect(
      mint.execute(OWNER, {
        conversationId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("when the provider fails", () => {
  it("propagates the upstream failure and writes no audit row", async () => {
    minter.failWith = ApplicationError.upstreamFailure("provider is down");

    await expect(mint.execute(OWNER)).rejects.toMatchObject({
      kind: "upstream-failure",
    });

    // Nothing was issued, so nothing is recorded as issued.
    expect(sessions.rows).toHaveLength(0);
  });
});
