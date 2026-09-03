/**
 * Drops the phantom cookie a native client never meant to send.
 *
 * THE BUG THIS EXISTS FOR. `auth.ts` says "the mobile app has no cookie jar".
 * That is false on Android: React Native's fetch goes through OkHttp, which
 * keeps a native jar and faithfully replays the `better-auth.session_token`
 * cookie Better Auth sets at sign-in. React Native does not send an `Origin`
 * header to go with it.
 *
 * Better Auth runs its CSRF origin check ONLY when a cookie is present
 * (`origin-check.mjs`: `useCookies = headers.has("cookie")`), so that exact
 * pairing - cookie, no origin - is a 403 `MISSING_OR_NULL_ORIGIN`. On the
 * device it lands on the sign-in form reading like a rejected password, and it
 * breaks sign-in, sign-up AND sign-out. GETs are unaffected: the middleware
 * returns before the check, which is why `get-session` kept working and the
 * app still looked half alive.
 *
 * curl reproduces neither header, which is why every server-side probe passed
 * and this only ever appeared on a phone.
 *
 * WHY STRIP RATHER THAN DISABLE THE CHECK. `advanced.disableCSRFCheck` is the
 * obvious lever and the wrong one - Better Auth's own docs call it a security
 * risk, and it would switch off origin validation, the Fetch Metadata checks
 * and cross-site navigation blocking for every caller, browser included.
 * Removing the cookie instead removes the ambient credential the check exists
 * to protect. No cookie, no CSRF surface, and the check correctly stops firing.
 * The app is unaffected either way: it authenticates with the bearer token from
 * the `set-auth-token` header and has never read a cookie.
 *
 * WHY THIS IS NOT A BLANKET STRIP. A real browser always announces itself on a
 * state-changing request - `Origin`, `Referer`, or `Sec-Fetch-Site`. Those
 * requests keep their cookie and stay fully protected. An attacker cannot make
 * a victim's browser send a request with NONE of the three, so the only callers
 * that lose their cookie here are non-browser clients, which have no ambient
 * jar for an attacker to ride in the first place.
 */
export async function stripPhantomCookie(request: Request): Promise<Request> {
  if (!request.headers.has("cookie")) return request;

  const announcesItself =
    request.headers.has("origin") ||
    request.headers.has("referer") ||
    request.headers.has("sec-fetch-site");

  if (announcesItself) return request;

  const headers = new Headers(request.headers);
  headers.delete("cookie");

  /**
   * Rebuilt field by field, and the body BUFFERED rather than piped.
   *
   * `new Request(request, { headers })` is the obvious spelling and throws here
   * - TanStack hands the handler its own Request-like object, not undici's, so
   * the copy constructor fails on a private field it cannot see. Passing
   * `request.body` through instead would make it a stream, which needs
   * `duplex: "half"` and is not portable either. An auth payload is an email
   * and a password, so reading it into memory costs nothing and works
   * everywhere.
   */
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  return new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });
}
