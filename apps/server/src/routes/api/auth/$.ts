import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/infrastructure/auth/auth";
import { stripPhantomCookie } from "~/infrastructure/auth/native-cookie";

/**
 * Every Better Auth endpoint, handed straight to Better Auth.
 *
 * A bare splat with NO middleware and NO `defineHandler`, deliberately. Better
 * Auth owns these responses end to end - including `set-auth-token`, the header
 * the mobile app reads its bearer token from, and the `set-cookie` headers the
 * browser flow needs. Wrapping this would rewrite them, and forcing its flat
 * `{ code, message }` errors into this API's envelope would break the client
 * parsing it expects.
 *
 * That asymmetry is documented rather than hidden: see `auth.contract.ts` in
 * @convo/shared, and the operations added by hand to the OpenAPI document.
 *
 * GET as well as POST: sign-in and sign-up are POSTs, but `get-session` is a
 * GET, and it is what the app calls on launch to decide whether to show the
 * sign-in screen.
 *
 * The one thing done TO the request is `stripPhantomCookie` - see that file.
 * Android replays a cookie the app never asked for, and Better Auth answers a
 * cookie without an `Origin` with a 403 on every auth POST.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => auth.handler(await stripPhantomCookie(request)),
      POST: async ({ request }) => auth.handler(await stripPhantomCookie(request)),
    },
  },
});
