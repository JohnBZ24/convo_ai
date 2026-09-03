import { describe, expect, it } from "vitest";
import { stripPhantomCookie } from "~/infrastructure/auth/native-cookie";

const URL = "http://127.0.0.1:3000/api/auth/sign-in/email";

function post(headers: Record<string, string>): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "a@b.co", password: "irrelevant" }),
  });
}

describe("stripPhantomCookie", () => {
  /**
   * The device's exact shape. OkHttp replays Better Auth's session cookie and
   * React Native sends no `Origin`, which is the one pairing Better Auth
   * answers with 403 MISSING_OR_NULL_ORIGIN - on sign-in, sign-up AND sign-out.
   */
  it("drops the cookie when nothing announces a browser", async () => {
    const result = await stripPhantomCookie(
      post({ cookie: "better-auth.session_token=stale" }),
    );

    expect(result.headers.has("cookie")).toBe(false);
  });

  it("keeps the body intact after rebuilding the request", async () => {
    const result = await stripPhantomCookie(
      post({ cookie: "better-auth.session_token=stale" }),
    );

    await expect(result.json()).resolves.toEqual({
      email: "a@b.co",
      password: "irrelevant",
    });
    expect(result.method).toBe("POST");
    expect(result.headers.get("content-type")).toBe("application/json");
  });

  /**
   * The other half, and the reason this is not a blanket strip: a browser keeps
   * its cookie and therefore keeps Better Auth's CSRF protection. Any one of
   * the three headers is enough to count as announcing itself.
   */
  it.each(["origin", "referer", "sec-fetch-site"])(
    "leaves the cookie alone when %s is present",
    async (header) => {
      const result = await stripPhantomCookie(
        post({
          cookie: "better-auth.session_token=stale",
          [header]: "https://example.com",
        }),
      );

      expect(result.headers.get("cookie")).toBe("better-auth.session_token=stale");
    },
  );

  it("passes a request through untouched when it has no cookie", async () => {
    const request = post({});
    await expect(stripPhantomCookie(request)).resolves.toBe(request);
  });

  /** `get-session` is a GET and has no body to buffer. */
  it("handles a GET, which has no body", async () => {
    const result = await stripPhantomCookie(
      new Request(URL, { headers: { cookie: "better-auth.session_token=stale" } }),
    );

    expect(result.headers.has("cookie")).toBe(false);
    expect(result.method).toBe("GET");
  });
});
