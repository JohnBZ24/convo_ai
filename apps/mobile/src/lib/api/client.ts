import { errorEnvelope } from "@convo/shared";

/**
 * Where the server is.
 *
 * `adb reverse tcp:3000 tcp:3000` makes the phone's own loopback the dev
 * machine's, which is why this is 127.0.0.1 and not a LAN address. If sign-in
 * fails with "Network request failed", the reverse is missing - it does not
 * survive a replug or an `adb kill-server`. That looks exactly like an auth bug
 * and is not one.
 *
 * `EXPO_PUBLIC_` rather than `expo-constants`: Metro inlines these at build
 * time, so this module imports nothing from React Native and stays testable in
 * plain Node. Importing `expo-constants` here would drag in `react-native`'s
 * Flow-typed entry point, which no test runner can parse.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000";

/** A failure with something worth showing the user. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Better Auth does NOT use this API's error envelope.
 *
 * It returns a flat `{ code, message }` with SCREAMING_SNAKE codes, while every
 * other route returns `{ error: { code, message, requestId } }`. Parsing an auth
 * failure with the envelope schema yields "an unexpected error occurred" on
 * every wrong password, which is why both shapes are handled here rather than
 * at each call site.
 */
async function toError(response: Response): Promise<ApiRequestError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiRequestError(
      "The server sent an unreadable response",
      response.status,
      "UNREADABLE",
    );
  }

  const envelope = errorEnvelope.safeParse(body);
  if (envelope.success) {
    const { code, message, requestId } = envelope.data.error;
    return new ApiRequestError(message, response.status, code, requestId);
  }

  const flat = body as { code?: unknown; message?: unknown };
  return new ApiRequestError(
    typeof flat.message === "string" ? flat.message : "Something went wrong",
    response.status,
    typeof flat.code === "string" ? flat.code : "UNKNOWN",
  );
}

/**
 * Long enough for a cold server route to compile, short enough that a laptop
 * that is asleep, off the network or on a changed IP fails VISIBLY instead of
 * leaving the app on its splash screen forever.
 *
 * React Native's fetch has no timeout of its own, and the launch path awaits
 * `GET /api/auth/get-session` before it can decide which screen to show - so
 * without this, "the server is unreachable" and "the app is broken" look
 * identical to the user.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** Better Auth answers with the bearer token in a RESPONSE header, not the body. */
  onAuthToken?: (token: string) => void;
  /** Override the default. A realtime mint is the one call worth waiting on. */
  timeoutMs?: number;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    onAuthToken,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;

  /**
   * `AbortController` rather than `AbortSignal.timeout`: the static is not on
   * every Hermes build this app has to run on, and a missing static would throw
   * inside the request path rather than failing a feature check.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // An abort and a dead network arrive here the same way; say which it was.
    if (controller.signal.aborted) {
      throw new ApiRequestError(
        `The server did not answer within ${Math.round(timeoutMs / 1000)}s`,
        0,
        "TIMEOUT",
      );
    }
    throw new ApiRequestError("Could not reach the server", 0, "NETWORK");
  } finally {
    clearTimeout(timer);
  }

  const headerToken = response.headers.get("set-auth-token");
  if (headerToken && onAuthToken) onAuthToken(headerToken);

  if (!response.ok) throw await toError(response);

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
