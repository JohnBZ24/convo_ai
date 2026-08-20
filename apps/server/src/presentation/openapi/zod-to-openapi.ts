import { z } from "zod";

/**
 * OpenAPI 3.1 IS JSON Schema draft 2020-12, so Zod's native converter is a
 * direct fit and no zod-to-openapi dependency is needed.
 *
 * `io` is the subtle part. A schema with `.default()` or `.transform()` has a
 * DIFFERENT shape going in than coming out - `limit` is optional in a request
 * but always present in a response. Getting this wrong publishes docs that
 * quietly lie about which fields are required.
 */
export function toSchema(schema: z.ZodType, io: "input" | "output") {
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    // Dates and similar have no JSON Schema equivalent; describe them loosely
    // rather than refusing to generate the document at all.
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
