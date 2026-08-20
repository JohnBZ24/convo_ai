import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "~/presentation/openapi/document";

/**
 * The most valuable test in the suite: it walks `src/routes/api` ON DISK and
 * fails if a route is not in the published document, or the document describes
 * a route that does not exist.
 *
 * Documentation drift is usually invisible - nothing breaks, the docs are just
 * quietly wrong, and by the time anyone notices they are not trusted any more.
 * Discovering the routes from the filesystem rather than from a list means
 * adding an endpoint and forgetting to document it BREAKS THE BUILD.
 *
 * `new URL(...).pathname` yields "/C:/..." on Windows; fileURLToPath does not.
 */
const routesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "routes",
  "api",
);

/**
 * Routes that describe the API rather than being part of it, plus the auth
 * splat.
 *
 * `auth/$` is Better Auth's own router behind a bare splat - there is no spec
 * to discover, so its four operations are written by hand in
 * auth-operations.ts. It is excluded HERE, by name, so that exclusion is a
 * visible decision rather than a silent gap.
 */
const NOT_SELF_DESCRIBING = new Set(["/api/openapi", "/api/docs", "/api/auth/$"]);

interface DiscoveredRoute {
  /** The OpenAPI path, e.g. "/api/conversations/{id}/turns". */
  path: string;
  /** Lowercased HTTP methods the route file wires up. */
  methods: string[];
  file: string;
}

function walk(dir: string, prefix = "/api"): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...walk(full, `${prefix}/${entry.name}`));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;

    const base = entry.name.replace(/\.ts$/, "");
    // "index" is the directory itself; "$id" is a path parameter.
    const segment = base === "index" ? "" : `/${base}`;
    const routePath = `${prefix}${segment}`.replace(/\$([a-zA-Z0-9_]+)/g, "{$1}");

    const source = readFileSync(full, "utf8");
    const handlersBlock = source.match(/handlers:\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const methods = [
      ...handlersBlock.matchAll(/\b(GET|POST|PATCH|PUT|DELETE)\s*:/g),
    ].map((match) => (match[1] as string).toLowerCase());

    found.push({ path: routePath, methods, file: path.relative(routesDir, full) });
  }

  return found;
}

const routes = walk(routesDir).filter(
  (route) => !NOT_SELF_DESCRIBING.has(route.path.replace(/\{(\w+)\}/g, "$$$1")),
);
const document = buildOpenApiDocument();

describe("the OpenAPI document describes exactly the API that exists", () => {
  it("finds the route files at all (a broken walk would pass everything)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const route of routes) {
      expect(
        route.methods.length,
        `${route.file} declares no handlers`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(routes)("documents every method of $file", (route) => {
    const item = document.paths[route.path];

    expect(item, `${route.path} is served but not documented`).toBeDefined();
    for (const method of route.methods) {
      expect(
        item?.[method],
        `${method.toUpperCase()} ${route.path} is served but not documented`,
      ).toBeDefined();
    }
  });

  it("documents nothing that is not served", () => {
    const served = new Set(routes.map((route) => route.path));

    for (const documented of Object.keys(document.paths)) {
      // The auth operations are hand-written for a splat route; see above.
      if (documented.startsWith("/api/auth/")) continue;

      expect(served.has(documented), `${documented} is documented but not served`).toBe(
        true,
      );
    }
  });
});

describe("the document is usable as a test surface", () => {
  it("declares bearerAuth, which is what makes Swagger's Authorize button work", () => {
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("puts the padlock on exactly the protected operations", () => {
    const secured: string[] = [];
    const open: string[] = [];

    for (const [route, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const target = (operation as { security?: unknown }).security ? secured : open;
        target.push(`${method.toUpperCase()} ${route}`);
      }
    }

    // Health and readiness must stay reachable by an orchestrator with no
    // credentials; sign-up and sign-in obviously cannot require a session.
    expect(open.sort()).toEqual([
      "GET /api/health",
      "GET /api/ready",
      "POST /api/auth/sign-in/email",
      "POST /api/auth/sign-up/email",
    ]);
    expect(secured).toContain("POST /api/conversations");
    expect(secured).toContain("POST /api/conversations/{id}/turns");
  });

  it("gives every operation an operationId, a summary and a tag", () => {
    for (const [route, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const op = operation as {
          operationId?: string;
          summary?: string;
          tags?: string[];
        };
        const where = `${method.toUpperCase()} ${route}`;

        expect(op.operationId, `${where} has no operationId`).toBeTruthy();
        expect(op.summary, `${where} has no summary`).toBeTruthy();
        expect(op.tags?.length, `${where} has no tag`).toBeGreaterThan(0);
      }
    }
  });

  it("declares a path parameter for every {placeholder} it advertises", () => {
    for (const [route, item] of Object.entries(document.paths)) {
      const placeholders = [...route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (placeholders.length === 0) continue;

      for (const [method, operation] of Object.entries(item)) {
        const parameters =
          (operation as { parameters?: { name: string; in: string }[] }).parameters ??
          [];

        for (const placeholder of placeholders) {
          expect(
            parameters.some((p) => p.in === "path" && p.name === placeholder),
            `${method.toUpperCase()} ${route} does not declare {${placeholder}}`,
          ).toBe(true);
        }
      }
    }
  });
});
