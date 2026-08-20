import { env, isProduction } from "~/config/env";

/**
 * Origins allowed to call this API from a browser.
 *
 * The native app is not subject to CORS, but the web build, the docs
 * page, and local tooling are. Configured rather than wildcarded so
 * credentials can be sent.
 */
const allowedOrigins = new Set(
  [env.BETTER_AUTH_URL, "http://localhost:3000", "http://localhost:8081"].filter(
    (o): o is string => Boolean(o),
  ),
);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return {};

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,cookie,x-request-id",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/**
 * Baseline response headers.
 *
 * This server returns JSON to a native client and one HTML docs page, so
 * the CSP can be strict: no scripts by default, and the docs route opts
 * itself in explicitly.
 */
export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  };

  if (isProduction) {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }

  return headers;
}
