import { buildClientSecretRequest, type RealtimeVoice } from "@convo/ai";
import { ApplicationError } from "~/core/application/errors/application-error";
import type {
  MintCredentialCommand,
  MintedCredential,
  RealtimeCredentialMinter,
} from "~/core/application/ports/realtime-credential-minter.port";
import { logger } from "~/infrastructure/logging/logger";

export interface OpenAiRealtimeMinterOptions {
  apiKey: string;
  /** e.g. https://api.openai.com/v1 - configuration, never a literal here. */
  baseUrl: string;
  ttlSeconds: number;
  requestTimeoutMs: number;
}

/**
 * What the endpoint returns. Only the fields this server actually reads are
 * modelled; OpenAI sends a great deal more and may send more still tomorrow.
 */
interface ClientSecretResponse {
  value?: unknown;
  expires_at?: unknown;
  session?: {
    id?: unknown;
    model?: unknown;
    audio?: { output?: { voice?: unknown } };
  };
}

/**
 * The one place this server's `OPENAI_API_KEY` is used.
 *
 * The key is exchanged for a ~60 second `ek_...` credential which is the ONLY
 * thing that reaches the device. That is the whole security argument for the
 * architecture: audio flows phone-to-OpenAI without touching this process, and
 * a compromised phone still never holds a durable credential.
 *
 * The request body is built by `@convo/ai`, not here. This class owns
 * TRANSPORT - the URL, the timeout, the failure translation - and nothing about
 * what a session should be.
 */
export class OpenAiRealtimeMinter implements RealtimeCredentialMinter {
  constructor(private readonly options: OpenAiRealtimeMinterOptions) {}

  /**
   * Where the device POSTs its SDP offer, derived from the SAME base URL the
   * mint uses. Pointing this server at a proxy or a mock therefore moves both
   * halves at once, instead of leaving the device talking to the real API.
   */
  get callsUrl(): string {
    return `${this.options.baseUrl.replace(/\/+$/, "")}/realtime/calls`;
  }

  async mint(command: MintCredentialCommand): Promise<MintedCredential> {
    const body = buildClientSecretRequest({
      model: command.model,
      // Validated at boot by config/env.ts, which is what makes this cast safe.
      voice: command.voice as RealtimeVoice,
      ttlSeconds: this.options.ttlSeconds,
    });

    const response = await this.post(body);
    const payload = (await this.readJson(response)) as ClientSecretResponse;

    if (!response.ok) {
      /**
       * Logged with the upstream's own message, which may name the model or the
       * account - useful here, and never sent onward. The caller gets a 502 and
       * the request id, and nothing about our OpenAI account.
       */
      logger.error("realtime credential mint rejected by upstream", {
        status: response.status,
        upstream: payload,
      });

      throw ApplicationError.upstreamFailure(
        "The voice provider refused to issue a session credential",
        { upstreamStatus: response.status },
      );
    }

    return this.toCredential(payload, command);
  }

  private async post(body: unknown): Promise<Response> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/realtime/client_secrets`;

    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        /**
         * A hung request here is worse than a failed one: the user is holding a
         * phone with a spinning orb and no way to know it will never connect.
         * Fail fast and let the app offer a retry.
         */
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      });
    } catch (error) {
      logger.error("realtime credential mint could not reach upstream", {
        error: error instanceof Error ? error.message : String(error),
      });

      throw ApplicationError.upstreamFailure("The voice provider could not be reached");
    }
  }

  /** A non-JSON body from an upstream is a failure, not a crash. */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private toCredential(
    payload: ClientSecretResponse,
    command: MintCredentialCommand,
  ): MintedCredential {
    const value = payload.value;
    const expiresAtSeconds = payload.expires_at;

    /**
     * Validated rather than trusted. A 200 with a missing `value` would
     * otherwise reach the device as `clientSecret: undefined` and fail there,
     * on a phone, as an unexplained WebRTC error.
     */
    if (typeof value !== "string" || value.length === 0) {
      throw ApplicationError.upstreamFailure(
        "The voice provider returned no session credential",
      );
    }
    if (typeof expiresAtSeconds !== "number" || !Number.isFinite(expiresAtSeconds)) {
      throw ApplicationError.upstreamFailure(
        "The voice provider returned no credential expiry",
      );
    }

    const session = payload.session ?? {};

    return {
      value,
      // The API reports epoch SECONDS; everything in this codebase is a Date.
      expiresAt: new Date(expiresAtSeconds * 1000),
      sessionId: typeof session.id === "string" ? session.id : "",
      // Fall back to what was asked for, so the audit row is never blank.
      model: typeof session.model === "string" ? session.model : command.model,
      voice:
        typeof session.audio?.output?.voice === "string"
          ? session.audio.output.voice
          : command.voice,
    };
  }
}
