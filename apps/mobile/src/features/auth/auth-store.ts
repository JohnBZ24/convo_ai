import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { apiRequest } from "~/lib/api/client";

/**
 * Mirrors Better Auth's `minPasswordLength: 12` on the server. Checked here so
 * a too-short password is rejected before a round trip, not so the server can
 * stop checking - it still does.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Keystore-backed, not AsyncStorage: this is a credential. */
const TOKEN_KEY = "convo.auth.token";

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface SignInResponse {
  token?: string;
  user: AuthUser;
}

interface SessionResponse {
  user: AuthUser;
}

export interface AuthState {
  /** null until `restore` has run; the app shows a splash rather than guessing. */
  status: "unknown" | "signed-out" | "signed-in";
  token: string | null;
  user: AuthUser | null;
  busy: boolean;
  error: string | null;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "unknown",
  token: null,
  user: null,
  busy: false,
  error: null,

  /**
   * On launch: read the stored token and ask the server whether it is still
   * good. A token that has expired must land the user on the sign-in screen,
   * not on a voice screen whose every request 401s.
   */
  restore: async () => {
    /**
     * Guarded, because a throw here used to leave `status` on "unknown"
     * FOREVER - and "unknown" is the one value the redirect ignores, so the app
     * silently stayed on the voice screen instead of going to sign-in. A
     * keystore that will not open is a signed-out user, not a hung app.
     */
    let stored: string | null = null;
    try {
      stored = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      set({ status: "signed-out", token: null, user: null });
      return;
    }

    if (!stored) {
      set({ status: "signed-out" });
      return;
    }

    try {
      const session = await apiRequest<SessionResponse | null>(
        "/api/auth/get-session",
        {
          token: stored,
        },
      );

      if (!session?.user) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        set({ status: "signed-out", token: null, user: null });
        return;
      }

      set({ status: "signed-in", token: stored, user: session.user });
    } catch {
      // Offline at launch is not a reason to throw away a good token: keep it
      // and let the first real request decide.
      set({ status: "signed-in", token: stored });
    }
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    await authenticate(set, "/api/auth/sign-in/email", { email, password });
  },

  signUp: async (name, email, password) => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      set({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    set({ busy: true, error: null });
    await authenticate(set, "/api/auth/sign-up/email", { name, email, password });
  },

  signOut: async () => {
    const { token } = get();
    try {
      if (token) await apiRequest("/api/auth/sign-out", { method: "POST", token });
    } catch {
      // A failed sign-out must still sign the user out locally.
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ status: "signed-out", token: null, user: null, error: null });
  },

  clearError: () => set({ error: null }),
}));

type SetState = (partial: Partial<AuthState>) => void;

/**
 * Sign-in and sign-up differ only in URL and payload, and both have the same
 * token-reading quirk, so they share this.
 *
 * The token arrives in the `set-auth-token` RESPONSE HEADER. The body carries a
 * `token` too and the two DIFFER - the header's has a signature suffix - but
 * both authenticate. Read the header, fall back to the body.
 */
async function authenticate(
  set: SetState,
  path: string,
  payload: Record<string, string>,
): Promise<void> {
  let headerToken: string | null = null;

  try {
    const result = await apiRequest<SignInResponse>(path, {
      method: "POST",
      body: payload,
      onAuthToken: (token) => {
        headerToken = token;
      },
    });

    const token = headerToken ?? result.token ?? null;
    if (!token) {
      set({ busy: false, error: "The server did not return a session token" });
      return;
    }

    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ status: "signed-in", token, user: result.user, busy: false, error: null });
  } catch (error) {
    set({
      busy: false,
      error: error instanceof Error ? error.message : "Could not reach the server",
    });
  }
}
