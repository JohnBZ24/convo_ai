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

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  token?: string | null;
  /** Better Auth answers with the bearer token in a RESPONSE header, not the body. */
  onAuthToken?: (token: string) => void;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, token, onAuthToken } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const headerToken = response.headers.get("set-auth-token");
  if (headerToken && onAuthToken) onAuthToken(headerToken);

  if (!response.ok) throw await toError(response);

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
