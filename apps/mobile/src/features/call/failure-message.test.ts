import { describe, expect, it } from "vitest";
import { ApiRequestError } from "~/lib/api/client";
import {
  describeFailure,
  GENERIC_CALL_FAILURE,
  isWorthRetrying,
} from "./failure-message";

describe("what the orb tells the user", () => {
  /**
   * The whole point of this module. Before it, an unreachable laptop, a
   * sleeping server and an expired session all read as one vague sentence, and
   * none of them told the user which thing to go and fix.
   */
  it.each([
    ["NETWORK", 0, "No connection. Check Wi-Fi and try again"],
    ["TIMEOUT", 0, "The server is not responding"],
    ["UNAUTHORIZED", 401, "Your session expired. Sign in again"],
    ["RATE_LIMITED", 429, "Too many calls just now. Wait a minute"],
    ["UPSTREAM_ERROR", 502, "The voice service is unavailable"],
  ])("turns %s into something actionable", (code, status, expected) => {
    expect(describeFailure(new ApiRequestError("raw", status, code))).toBe(expected);
  });

  it("apologises for a 5xx it has no copy for, rather than blaming the caller", () => {
    const error = new ApiRequestError("boom", 503, "SOMETHING_NEW");

    expect(describeFailure(error)).toBe("Something went wrong on our side");
  });

  it("keeps a short message we wrote ourselves", () => {
    expect(describeFailure(new Error("Not signed in"))).toBe("Not signed in");
  });

  /**
   * A library error is written for a developer and often carries a path, a URL
   * or a stack frame. Showing one under the orb is worse than saying nothing
   * useful, because it looks like the app broke rather than the network.
   */
  it.each([
    "Failed to construct 'RTCPeerConnection': {iceServers}",
    "Request to https://api.openai.com/v1/realtime failed",
    "TypeError: undefined is not an object\n    at Object.foo",
    "at RTCPeerConnection.setRemoteDescription",
    "Cannot find module C:\\convo_ai\\apps\\mobile\\index.js",
  ])("refuses to show %j", (message) => {
    expect(describeFailure(new Error(message))).toBe(GENERIC_CALL_FAILURE);
  });

  it("refuses an essay, however readable", () => {
    expect(describeFailure(new Error("x".repeat(200)))).toBe(GENERIC_CALL_FAILURE);
  });

  it("has something to say about a thrown string", () => {
    expect(describeFailure("nope")).toBe(GENERIC_CALL_FAILURE);
  });
});

describe("deciding whether to try again", () => {
  /**
   * The distinction that keeps a reconnect loop honest: a network blip will
   * clear, a refused credential will not. Retrying the second just spends the
   * user's patience before showing them the same message.
   */
  it.each([
    ["NETWORK", 0],
    ["TIMEOUT", 0],
    ["UPSTREAM_ERROR", 502],
    ["SERVICE_UNAVAILABLE", 503],
  ])("retries %s", (code, status) => {
    expect(isWorthRetrying(new ApiRequestError("x", status, code))).toBe(true);
  });

  it.each([
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["RATE_LIMITED", 429],
    ["BAD_REQUEST", 400],
  ])("does not retry %s", (code, status) => {
    expect(isWorthRetrying(new ApiRequestError("x", status, code))).toBe(false);
  });

  it("does not retry something it cannot classify", () => {
    expect(isWorthRetrying(new Error("who knows"))).toBe(false);
  });
});
