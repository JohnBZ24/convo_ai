import { describe, expect, it } from "vitest";
import { ApplicationError } from "~/core/application/errors/application-error";
import {
  decodeCursor,
  encodeCursor,
} from "~/core/application/pagination/keyset-cursor";

const position = {
  startedAt: new Date("2026-08-20T10:00:00.000Z"),
  id: "11111111-1111-4111-8111-111111111111",
};

describe("keyset cursor", () => {
  it("round-trips a position exactly", () => {
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it("is URL-safe, so it survives being put in a query string", () => {
    const cursor = encodeCursor(position);
    expect(cursor).toBe(encodeURIComponent(cursor));
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("is opaque - it does not read as the values it encodes", () => {
    expect(encodeCursor(position)).not.toContain(position.id);
  });

  it.each([
    ["empty", ""],
    ["not base64 of anything useful", "not-a-cursor"],
    ["well-formed base64 with no separator", Buffer.from("nope").toString("base64url")],
    [
      "an unparseable date",
      Buffer.from("never|11111111-1111-4111-8111-111111111111").toString("base64url"),
    ],
    [
      "a date but no id",
      Buffer.from("2026-08-20T10:00:00.000Z|").toString("base64url"),
    ],
  ])("rejects %s as invalid input, not as a server error", (_label, cursor) => {
    // Every malformed shape lands on the same 400: none of it reaches SQL.
    expect(() => decodeCursor(cursor)).toThrow(ApplicationError);
    try {
      decodeCursor(cursor);
    } catch (error) {
      expect((error as ApplicationError).kind).toBe("invalid-input");
    }
  });
});
