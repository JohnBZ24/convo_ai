import { ApplicationError } from "~/core/application/errors/application-error";

/**
 * The position of one row in the `(started_at DESC, id DESC)` ordering.
 *
 * Both halves are needed. `started_at` alone is not unique - two conversations
 * started in the same millisecond would make a page boundary ambiguous, and the
 * row on the seam would be shown twice or not at all. The id breaks the tie,
 * and `(user_id, started_at DESC, id DESC)` is indexed to match exactly.
 */
export interface KeysetPosition {
  startedAt: Date;
  id: string;
}

const SEPARATOR = "|";

/**
 * Cursors are OPAQUE to the client: base64url, no padding, no meaning promised.
 * Encoding it as readable JSON would invite the mobile app to parse and
 * construct cursors, and the encoding could then never change.
 */
export function encodeCursor(position: KeysetPosition): string {
  const raw = `${position.startedAt.toISOString()}${SEPARATOR}${position.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Decode a cursor supplied by a client.
 *
 * Everything here is untrusted input, so every failure mode - bad base64, wrong
 * shape, unparseable date - lands on the same 400 rather than reaching SQL.
 */
export function decodeCursor(cursor: string): KeysetPosition {
  const invalid = () =>
    ApplicationError.invalidInput(
      "cursor is not valid; omit it to start from the newest conversation",
    );

  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw invalid();
  }

  const separatorAt = raw.indexOf(SEPARATOR);
  if (separatorAt < 1) throw invalid();

  const startedAt = new Date(raw.slice(0, separatorAt));
  const id = raw.slice(separatorAt + 1);

  if (Number.isNaN(startedAt.getTime()) || id.length === 0) throw invalid();

  return { startedAt, id };
}
