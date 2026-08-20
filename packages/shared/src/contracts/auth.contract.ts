import { z } from "zod";

/**
 * Contracts for the Better Auth endpoints.
 *
 * These are the ONE set of schemas in this package that the server does not
 * validate with. `/api/auth/*` is handled by Better Auth's own router, which
 * owns its request and response shapes end to end - wrapping it would rewrite
 * headers it needs, including `set-auth-token`.
 *
 * They exist anyway because two other things must agree with those shapes: the
 * OpenAPI document (so the Swagger "sign up -> sign in -> Authorize" loop
 * works, which is the manual test surface for the whole API) and the mobile
 * client. Both read them from here.
 */

/**
 * Mirrored in `emailAndPassword.minPasswordLength` on the server AND in the
 * mobile sign-up form. Defined once here so those cannot drift - a client that
 * validates at 8 sends a password the server rejects at 12, and the user sees
 * an error the form said would not happen.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const signUpBody = z
  .object({
    name: z.string().min(1).max(120),
    email: z.email(),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .meta({
    id: "SignUpRequest",
    description: "Create an account with email and password",
  });

export const signInBody = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .meta({ id: "SignInRequest", description: "Exchange credentials for a session" });

export const authUser = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
    image: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "AuthUser", description: "The signed-in user" });

/**
 * The bearer token appears TWICE and the two values differ: `token` in this
 * body is the raw session token, while the `set-auth-token` RESPONSE HEADER
 * carries the same token with an HMAC signature appended. Both authenticate,
 * because the bearer plugin signs an unsigned token itself. Read the header and
 * fall back to the body.
 */
export const signInResponse = z
  .object({
    token: z.string(),
    user: authUser,
    redirect: z.boolean().optional(),
    url: z.string().nullable().optional(),
  })
  .meta({ id: "SignInResponse", description: "Session token plus the user" });

export const sessionResponse = z
  .object({
    session: z.object({
      id: z.string(),
      token: z.string(),
      userId: z.string(),
      expiresAt: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      ipAddress: z.string().nullable().optional(),
      userAgent: z.string().nullable().optional(),
    }),
    user: authUser,
  })
  .meta({
    id: "SessionResponse",
    description: "The session behind the presented token",
  })
  .nullable();

/**
 * Better Auth does NOT use this API's error envelope. It returns a FLAT
 * `{ code, message }` with SCREAMING_SNAKE codes. Parsing an auth failure with
 * `errorEnvelope` yields "an unexpected error occurred" on every wrong
 * password, which is exactly the bug this schema exists to prevent.
 *
 * Codes verified against the running server:
 *   INVALID_EMAIL_OR_PASSWORD              401
 *   USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL  422
 *   PASSWORD_TOO_SHORT                     400
 */
export const authErrorResponse = z
  .object({
    code: z.string().optional(),
    message: z.string(),
  })
  .meta({
    id: "AuthErrorResponse",
    description: "Better Auth's own flat error shape - NOT the API error envelope",
  });

export type AuthErrorResponse = z.infer<typeof authErrorResponse>;
export type AuthUser = z.infer<typeof authUser>;
export type SignUpBody = z.infer<typeof signUpBody>;
export type SignInBody = z.infer<typeof signInBody>;
