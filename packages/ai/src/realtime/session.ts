import { CONVO_SYSTEM_PROMPT } from "../prompts/system-prompt";
import { realtimeToolDeclarations } from "../tools/registry";
import type { RealtimeFunctionTool } from "../tools/tool-definition";
import type { RealtimeVoice } from "./voices";

/**
 * The shape of `POST /v1/realtime/client_secrets`, as verified against the live
 * API on 25 Aug 2026 rather than remembered.
 *
 * This module DECLARES the request. It never sends it: the server owns the API
 * key and performs the exchange, and the device only ever sees the ephemeral
 * credential that comes back. Keeping the description here rather than in the
 * server's HTTP client is what lets the mobile app import the same tool
 * declarations it will be asked to execute.
 */

/** `expires_after.seconds` accepted range. Below 10 the API rejects the mint. */
export const CLIENT_SECRET_TTL_MIN_SECONDS = 10;
export const CLIENT_SECRET_TTL_MAX_SECONDS = 7200;

/**
 * Sixty seconds, and deliberately near the floor.
 *
 * The credential is used twice - once to POST the SDP offer, once as the
 * connection is established - and both happen within a second or two of
 * minting. Everything after that is the WebRTC session, which outlives the
 * credential that opened it. A longer TTL would only widen the window in which
 * a leaked `ek_...` can be spent against this project's OpenAI budget.
 */
export const CLIENT_SECRET_TTL_SECONDS = 60;

/**
 * A ceiling on ONE reply, not on the conversation.
 *
 * ~1200 tokens is far more than anything the system prompt asks for, so a
 * normal answer never reaches it. It exists to bound a pathological response -
 * a model that starts reciting - which on an audio model is billed by the
 * second and heard by the user.
 */
export const MAX_OUTPUT_TOKENS = 1200;

/**
 * Server-side voice activity detection: OpenAI decides when the user has
 * stopped speaking.
 *
 * This is what makes the app hands-free between the two taps of the orb, and
 * `interrupt_response` is what makes barge-in work - the user talking over the
 * model cancels its reply instead of queueing behind it. The values are the
 * API's own defaults, restated explicitly so a change upstream cannot silently
 * alter how the app feels.
 */
export interface ServerVadConfig {
  type: "server_vad";
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
  create_response: boolean;
  interrupt_response: boolean;
}

export const DEFAULT_TURN_DETECTION: ServerVadConfig = {
  type: "server_vad",
  threshold: 0.5,
  /** Audio kept from BEFORE speech was detected, so no word is clipped. */
  prefix_padding_ms: 300,
  /** Silence before the turn is considered over. Lower feels rushed. */
  silence_duration_ms: 500,
  create_response: true,
  interrupt_response: true,
};

/** `near_field` suits a phone held in the hand; `far_field` a room mic. */
export type NoiseReduction = "near_field" | "far_field";

/**
 * Transcription is what the TEXT under the orb is made of.
 *
 * The audio model produces speech, not a transcript of the user; this asks for
 * the user's side to be transcribed as well, which is what the device stores
 * with `POST /turns`. Without it, only the assistant's half of a conversation
 * could ever be saved.
 */
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

/**
 * The model used when nothing overrides it. `REALTIME_MODEL` in the server's
 * environment takes precedence, and does: this deployment pins the model there
 * so it can be changed without a release.
 */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
export const DEFAULT_REALTIME_VOICE: RealtimeVoice = "marin";

export interface RealtimeSessionOptions {
  /** From configuration, never a literal at a call site. */
  model: string;
  voice: RealtimeVoice;
  ttlSeconds?: number;
  instructions?: string;
  tools?: RealtimeFunctionTool[];
  maxOutputTokens?: number;
  turnDetection?: ServerVadConfig | null;
  transcriptionModel?: string | null;
  noiseReduction?: NoiseReduction | null;
  /** 0.25-1.5. Playback rate of the synthesised voice. */
  speed?: number;
}

export interface ClientSecretRequest {
  expires_after: { anchor: "created_at"; seconds: number };
  session: {
    type: "realtime";
    model: string;
    instructions: string;
    output_modalities: ["audio"];
    max_output_tokens: number;
    tool_choice: "auto";
    tools: RealtimeFunctionTool[];
    audio: {
      input: {
        transcription: { model: string } | null;
        noise_reduction: { type: NoiseReduction } | null;
        turn_detection: ServerVadConfig | null;
      };
      output: { voice: string; speed: number };
    };
  };
}

/**
 * Build the exact JSON body the credential endpoint expects.
 *
 * A pure function of its options, which is the point: the request that goes to
 * OpenAI can be asserted on in a unit test with no network, and the server's
 * HTTP client has nothing left to decide beyond where to POST it.
 */
export function buildClientSecretRequest(
  options: RealtimeSessionOptions,
): ClientSecretRequest {
  const {
    model,
    voice,
    ttlSeconds = CLIENT_SECRET_TTL_SECONDS,
    instructions = CONVO_SYSTEM_PROMPT,
    tools = realtimeToolDeclarations(),
    maxOutputTokens = MAX_OUTPUT_TOKENS,
    turnDetection = DEFAULT_TURN_DETECTION,
    transcriptionModel = DEFAULT_TRANSCRIPTION_MODEL,
    noiseReduction = "near_field",
    speed = 1.0,
  } = options;

  return {
    expires_after: { anchor: "created_at", seconds: ttlSeconds },
    session: {
      type: "realtime",
      model,
      instructions,
      /**
       * Audio only. Asking for text as well would bill for tokens the app
       * never renders - the transcript under the orb comes from the audio
       * transcription events, not from a second text modality.
       */
      output_modalities: ["audio"],
      max_output_tokens: maxOutputTokens,
      tool_choice: "auto",
      tools,
      audio: {
        input: {
          transcription: transcriptionModel ? { model: transcriptionModel } : null,
          noise_reduction: noiseReduction ? { type: noiseReduction } : null,
          turn_detection: turnDetection,
        },
        output: { voice, speed },
      },
    },
  };
}
