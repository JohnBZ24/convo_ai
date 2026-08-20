import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/infrastructure/auth/auth";

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
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
