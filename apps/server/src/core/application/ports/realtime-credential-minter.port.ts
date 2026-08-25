/**
 * Trades this server's permanent API key for something safe to hand a phone.
 *
 * A port because the exchange is an outbound HTTP call to a third party - the
 * one thing a use case must never do directly. Behind this interface the
 * implementation talks to OpenAI; in a test it returns a canned credential, so
 * "does minting record an audit row?" and "is a credential refused for someone
 * else's conversation?" are answerable with no network and no spend.
 */

export interface MintCredentialCommand {
  /** From configuration. The use case does not choose a model. */
  model: string;
  voice: string;
}

export interface MintedCredential {
  /** The `ek_...` value. NEVER persisted and never logged - see the logger. */
  value: string;
  expiresAt: Date;
  /** OpenAI's `sess_...`, echoed back so a device bug can be traced to a row. */
  sessionId: string;
  /** What the upstream actually applied, which may differ from what was asked. */
  model: string;
  voice: string;
}

export interface RealtimeCredentialMinter {
  /** Throws `ApplicationError.upstreamFailure` when the provider will not mint. */
  mint(command: MintCredentialCommand): Promise<MintedCredential>;

  /** Where the device POSTs its SDP offer. Configuration, not a constant. */
  readonly callsUrl: string;
}
