import { isProduction } from "~/config/env";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

/**
 * Keys whose values are NEVER logged, matched case-insensitively at any depth.
 *
 * Conversation transcripts are the user's private speech and secrets are
 * secrets. Do not work around this by logging the same value under a different
 * key - that defeats the only mechanism protecting it.
 */
const REDACTED_KEYS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "clientsecret",
  "client_secret",
  "transcript",
  "text",
  "audio",
];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value as Fields).map(([key, item]) => {
      const normalised = key.toLowerCase().replace(/[-_]/g, "");
      const isSecret = REDACTED_KEYS.some((needle) =>
        normalised.includes(needle.replace(/[-_]/g, "")),
      );
      return [key, isSecret ? "[redacted]" : redact(item, depth + 1)];
    }),
  );
}

function emit(level: Level, message: string, fields: Fields = {}) {
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(redact(fields) as Fields),
  };

  // JSON in production so a log shipper can parse it; readable locally.
  const line = isProduction
    ? JSON.stringify(entry)
    : `${level.toUpperCase()} ${message}`;
  const detail = isProduction ? "" : JSON.stringify(redact(fields));

  if (level === "error") console.error(line, detail);
  else if (level === "warn") console.warn(line, detail);
  else console.log(line, detail);
}

export const logger = {
  debug: (message: string, fields?: Fields) => emit("debug", message, fields),
  info: (message: string, fields?: Fields) => emit("info", message, fields),
  warn: (message: string, fields?: Fields) => emit("warn", message, fields),
  error: (message: string, fields?: Fields) => emit("error", message, fields),
  /** Bind fields (e.g. requestId) to every subsequent call. */
  child: (bound: Fields) => ({
    debug: (m: string, f?: Fields) => emit("debug", m, { ...bound, ...f }),
    info: (m: string, f?: Fields) => emit("info", m, { ...bound, ...f }),
    warn: (m: string, f?: Fields) => emit("warn", m, { ...bound, ...f }),
    error: (m: string, f?: Fields) => emit("error", m, { ...bound, ...f }),
  }),
};

export type Logger = ReturnType<typeof logger.child>;
