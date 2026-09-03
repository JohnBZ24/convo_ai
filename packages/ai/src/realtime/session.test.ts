import { describe, expect, it } from "vitest";
import { CONVO_SYSTEM_PROMPT } from "../prompts/system-prompt";
import {
  buildClientSecretRequest,
  CLIENT_SECRET_TTL_MAX_SECONDS,
  CLIENT_SECRET_TTL_MIN_SECONDS,
  CLIENT_SECRET_TTL_SECONDS,
  MAX_OUTPUT_TOKENS,
} from "./session";
import { REALTIME_VOICES } from "./voices";

/**
 * These assertions describe a body that was verified against the LIVE OpenAI
 * API on 25 Aug 2026 - status 200, a real `ek_...`, a 60 second TTL and both
 * tools echoed back. That is why the shape is pinned so precisely here: this
 * test is the record of a working request, so a refactor that quietly renames a
 * field fails in CI rather than sixty seconds into a demo.
 */

const request = () =>
  buildClientSecretRequest({ model: "gpt-realtime-2", voice: "marin" });

describe("the client secret request", () => {
  it("asks for the model and voice it was given, not a built-in default", () => {
    const body = buildClientSecretRequest({
      model: "gpt-realtime-2.1",
      voice: "cedar",
    });

    expect(body.session.model).toBe("gpt-realtime-2.1");
    expect(body.session.audio.output.voice).toBe("cedar");
  });

  it("anchors expiry at creation with the declared TTL", () => {
    expect(request().expires_after).toEqual({
      anchor: "created_at",
      seconds: CLIENT_SECRET_TTL_SECONDS,
    });
  });

  /** The provider rejects anything outside this range, so the default must sit in it. */
  it("keeps the default TTL inside the range the API accepts", () => {
    expect(CLIENT_SECRET_TTL_SECONDS).toBeGreaterThanOrEqual(
      CLIENT_SECRET_TTL_MIN_SECONDS,
    );
    expect(CLIENT_SECRET_TTL_SECONDS).toBeLessThanOrEqual(
      CLIENT_SECRET_TTL_MAX_SECONDS,
    );
  });

  it("caps one reply, which is the only thing standing between a loop and the bill", () => {
    expect(request().session.max_output_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  /**
   * Asking for text as well would bill for tokens the app never renders - the
   * transcript under the orb comes from the audio transcription events.
   */
  it("requests audio only", () => {
    expect(request().session.output_modalities).toEqual(["audio"]);
  });

  it("binds the system prompt to the credential, so the device cannot rewrite it", () => {
    expect(request().session.instructions).toBe(CONVO_SYSTEM_PROMPT);
  });

  it("declares every tool in the registry", () => {
    expect(request().session.tools.map((tool) => tool.name)).toEqual([
      "get_current_time",
      "search_conversations",
      "web_search",
      "show_card",
    ]);
  });

  /**
   * server_vad with interruption is what makes the app hands-free between the
   * two taps of the orb AND lets the user talk over the model. Losing either
   * flag would not fail anything - it would just make the app feel wrong.
   */
  it("uses server-side VAD with barge-in enabled", () => {
    expect(request().session.audio.input.turn_detection).toMatchObject({
      type: "server_vad",
      create_response: true,
      interrupt_response: true,
    });
  });

  it("asks for input transcription, without which only half a conversation is storable", () => {
    expect(request().session.audio.input.transcription).toEqual({
      model: "gpt-4o-mini-transcribe",
    });
  });

  it("lets every default be overridden, including turning transcription off", () => {
    const body = buildClientSecretRequest({
      model: "m",
      voice: "alloy",
      ttlSeconds: 30,
      instructions: "be terse",
      tools: [],
      maxOutputTokens: 64,
      transcriptionModel: null,
      noiseReduction: null,
      turnDetection: null,
      speed: 1.2,
    });

    expect(body.expires_after.seconds).toBe(30);
    expect(body.session.instructions).toBe("be terse");
    expect(body.session.tools).toEqual([]);
    expect(body.session.max_output_tokens).toBe(64);
    expect(body.session.audio.input.transcription).toBeNull();
    expect(body.session.audio.input.noise_reduction).toBeNull();
    expect(body.session.audio.input.turn_detection).toBeNull();
    expect(body.session.audio.output.speed).toBe(1.2);
  });

  it("is a pure function - two calls produce equal bodies", () => {
    expect(request()).toEqual(request());
  });
});

describe("voices", () => {
  it("lists marin, the default this app ships with", () => {
    expect(REALTIME_VOICES).toContain("marin");
  });

  it("has no duplicates and no blanks", () => {
    expect(new Set(REALTIME_VOICES).size).toBe(REALTIME_VOICES.length);
    for (const voice of REALTIME_VOICES) expect(voice.length).toBeGreaterThan(0);
  });
});
