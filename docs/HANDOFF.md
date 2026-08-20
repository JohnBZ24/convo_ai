# Handoff — 20 Aug 2026

Read `CLAUDE.md` first for the architecture rules; this file is state, not design.

## Read this first: the code is gone

On 20 Aug 2026 the entire source tree was destroyed by an assistant-run command.
`robocopy <empty> node_modules /MIR` was used to work around a Windows long-path
error while deleting `node_modules`. pnpm keeps **workspace symlinks** in
`node_modules` (`@convo/shared` → `packages/shared`, and so on); without `/XJ`,
robocopy followed them and mirrored the empty directory over the real source
directories.

Everything under `apps/` and `packages/` was lost. Recovery was not possible:

- **No git repo** at the root — there was never one to restore from.
- **OneDrive had not synced since 7 May 2026.** The project was created 18 Aug, so
  it was never uploaded. This failed silently.
- **File History** was not configured.
- VS Code local history held only 3 files, because everything else was written
  directly to disk rather than through the editor.

What survives, and is all that survives:

```
CLAUDE.md            architecture rules
docs/HANDOFF.md      this file
apps/server/.env     RECOVERED — real OPENAI_API_KEY, DATABASE_URL,
                     BETTER_AUTH_SECRET, BETTER_AUTH_URL
```

A backup copy of those, plus the recovered `apps/server/src/lib/security.ts`, is at
`C:\Users\JBZLB\convo_ai_keep\`.

### The three things that had to happen first - status

1. **`git init` and commit.** DONE 20 Aug 2026. Commit at every iteration boundary.
2. **Move off the OneDrive path.** DONE - now `C:\convo_ai` (11 chars, better than
   the `C:\dev\convo_ai` originally suggested). See *Windows path length* below.
3. **Stop relying on OneDrive sync.** Still relevant: there is STILL NO REMOTE.
   `gh` is not installed. A private GitHub repo remains the one real protection
   against losing this machine.

## Build steps

Steps 0 and 1 are rebuilt and committed. The original steps 1-3 had been verified
against real OpenAI and real Postgres before the loss, so the design is proven
even where the code had to be rewritten.

| Step | What | State |
|------|------|-------|
| 0 | Repo safety: git, pnpm workspace, Turbo, Biome, tsconfig | **DONE** `263d7ea` |
| 1 | Backend foundation: Clean Architecture, health/ready, generated Swagger | **DONE** `bccbde5` |
| 2 | Better Auth bearer tokens + conversations CRUD | Next |
| 3 | `packages/ai` + realtime token route + guarded tools endpoint | |
| 4 | Expo app scaffold + UI shell + FIRST dev build on the Note 8 | |
| 5 | WebRTC audio on a real device | |
| 6 | Transcripts, persistence, history screen | |
| 7 | Hardening + measured latency over USB | |

## State as of 20 Aug 2026 (session 2)

**Read `docs/DESIGN.md` for the design and `CLAUDE.md` for the architecture rules.**
Both are current. This section is only what a new session cannot infer from them.

Project now lives at **`C:\convo_ai`** (11 chars) - the short path is what unblocks
the NDK/ninja 250-char limit in iteration 4. Git is initialised and committed.
**No remote yet** - `gh` is not installed. A private GitHub repo is still wanted.

Architecture was adapted from the **`tanstack-start-ca`** Clean Architecture
boilerplate, kept for reference at `C:\coding	anstack-start-ca`. It uses
`createServerFn`; we deliberately use REST server routes instead. See CLAUDE.md.

### Things verified this session that save real time

- **The database survived.** Only source was destroyed. `convo` already had the
  Better Auth tables (`user`, `session`, `account`, `verification`) before
  iteration 1 ran. Iteration 2 does not need to create them.
- **`import.meta.glob` works in TanStack Start's server build.** This is what the
  OpenAPI document is built on - no registry, no drift test.
- **Zod 4 has native `z.toJSONSchema()`** covering OpenAPI 3.1. No zod-to-openapi
  dependency. Use `io:"input"` for request bodies and `io:"output"` for responses.
- **Vite binds IPv6 only by default.** `vite.config.ts` now pins
  `host: "127.0.0.1"`. Do NOT remove it: `adb reverse` forwards to the host's
  IPv4 loopback, so without this the phone gets connection-refused in iteration 4.
- **`@tanstack/react-start@1.168.x` depends on `@tanstack/react-router@1.170.31`
  directly.** The version gap is independent versioning, NOT an incompatibility.
- **`@types/react-dom` does not track `react`'s version** (react 19.2.8, its types
  19.2.4). A bad version spec makes pnpm abort mid-download and emit
  `UND_ERR_DESTROYED` plus a libuv crash - that noise is the ABORT, not a network
  fault. Check the version spec before blaming the network.
- **pnpm 11 gates postinstall scripts and very new packages.** `allowBuilds` and
  `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`; esbuild needs the former or
  Vite and Vitest do not run.

### Environment limits on this machine

- **The Postgres service cannot be stopped without elevation.** To test the
  readiness 503 path end to end, run `net stop postgresql-x64-18` from an
  elevated shell yourself. Otherwise point `DATABASE_URL` at a dead port, which
  exercises the same path.
- **Browser automation cannot reach this machine's localhost.** Chrome shows an
  error page (and sometimes an unrelated local app's 404) for `127.0.0.1:3000`
  while curl succeeds. Verify HTTP behaviour with curl, and ask the user to open
  pages themselves. Use `127.0.0.1`, not `localhost`.
- Something else of the user's occupies port 3000 intermittently (a Next.js app
  called "JuiceHedz"). Check `netstat` before assuming a server is yours.

## What steps 1–3 contained

Rebuild to this shape. It was working.

**`apps/server`** (TanStack Start) — routes are thin parse-and-delegate shells:

| Route | Behaviour |
|---|---|
| `GET /api/health` | Liveness. Touches nothing external. |
| `GET /api/ready` | Readiness. `checkConnection` on a 2s timeout, 503 + `degraded` when the DB is down. |
| `GET /api/openapi`, `GET /api/docs` | Gated on `DOCS_ENABLED`, else 404. |
| `POST /api/auth/$` | Bare splat delegating to Better Auth's own handler. **Deliberately not wrapped in `handler()`.** |
| `POST/GET /api/conversations` | Create (201) and list (keyset paginated). |
| `GET/PATCH /api/conversations/:id` | Detail and end. |
| `POST /api/conversations/:id/turns` | Record a turn. 201 new / 200 replayed. |
| `POST /api/realtime/token` | Mint credential. Rate limited 20/hour/user. |
| `POST /api/tools/:name` | Execute a privileged tool. Rate limited 120/min/user. |

Services: `conversations.ts`, `realtime.ts`, `tools/index.ts` (three distinct
refusals — unknown → 404, device-execution → 403, declared-without-handler → 500),
`tools/handlers.ts`. Lib: `auth.ts`, `env.ts` (with an `optional()` helper, because
blank env values are empty strings not `undefined`), `http.ts`, `logger.ts`,
`openai.ts`, `openapi.ts`, `security.ts` (recovered — see the backup folder).
Guards: `require-user.ts`, `rate-limit.ts`.

**`packages/db`** — four tables: `conversations` (denormalised `turnCount` /
`lastTurnAt`), `turns` (**unique index on `(conversationId, seq)`** — this is what
makes turn replay idempotent; `appendTurn` uses `onConflictDoNothing` in a
transaction then bumps counters), `realtime_sessions`, `tool_invocations`
(`idempotencyKey` unique). Plus the Better Auth tables. **Every repository function
takes `userId` and puts it in the WHERE clause** — that is what makes a cross-user
read return 404 rather than 403.

**`packages/ai`** — declaration only, never executes. `CLIENT_SECRET_TTL_SECONDS = 60`,
`max_output_tokens: 1200`, `server_vad`, default model `gpt-realtime-2.1`, default
voice `marin`. Two tools: `get_current_time` (device) and `search_conversations`
(privileged).

**`packages/shared`** — Zod contracts plus the `RouteDoc` registry. The OpenAPI
document is generated from the same schemas the handlers validate with, so it
cannot drift.

**Tests** — 74 passing: 18 server, 21 ai, 24 db, 11 shared. The most valuable was
`openapi.registry.test.ts` (15 tests): it walks `src/routes/api` on disk and fails
if any route file lacks a RouteDoc or vice versa.

## Frontend design — settled, do not relitigate

Layout is ChatGPT **voice mode**, not chat: the mic orb sits **above** and the
spoken text appears **below** it, revealing word by word, with older lines
scrolling up and fading. An earlier layout with text above the mic was wrong and
was corrected.

- **Voice only.** No text input, no keyboard, no send button.
- **The orb IS the button.** No separate mic control. Orb centre at **38% of usable
  height**, derived from insets, never a pixel constant.
- **The orb scales with mic amplitude while listening.** Mock and real input must
  write the *same* Reanimated shared value so Step 5 is a swap, not a rewrite.
- Sidebar slides **over** the content on a left-edge swipe, ChatGPT-mobile style,
  with a "New chat" button. Every row identical — no main-chat/side-chat
  distinction.
- **Dark theme only.** `#202123` background, `#19C37D` accent, `#8E8EA0` muted,
  `#ECECF1` text.
- Auto-scroll pauses when the user scrolls up by hand, resumes at the bottom.
- App identity: name `Convo AI`, slug `convo-ai`, scheme `convoai`,
  `android.package` `com.abiroot.convoai`. **`convoai://` is already in the
  backend's `trustedOrigins`** — use exactly that scheme.

Library choices, all driven by the stated "must never feel laggy" priority:

| Need | Choice | Why |
|------|--------|-----|
| Streaming text | `react-native-streamdown` | Parses on a worklet thread |
| Lists | FlashList v2 | `maintainVisibleContentPosition` is built for chat feeds |
| Sidebar | ReanimatedDrawerLayout | UI thread; cannot stutter when JS is busy |
| Server state | TanStack Query | `focusManager`/`onlineManager` wired to AppState + expo-network |
| Client state | Zustand | For the call state machine |

## Verified on 20 Aug — do not rediscover these

Everything below was checked against real docs, real package source, or the running
server. This is the most valuable part of this file.

### Windows path length — this WILL block the Android build

The NDK compiles C++ through CMake and ninja, which cannot produce an object file
whose full path exceeds **250 characters**. With the project at the OneDrive path
and pnpm's store inside the repo, `react-native-worklets`' object directory reached
**232 characters before the filename**, and the build died with:

```
ninja: error: manifest 'build.ninja' still dirty after 100 tries
```

`LongPathsEnabled` is `0` on this machine and enabling it does not reliably help,
because CMake/ninja do not use `\\?\` paths. **The fix is a short project path** —
`C:\dev\convo_ai` brings it to ~192. Setting pnpm's `virtualStoreDir` to a short
root also works but complicates the layout.

### Worklets Bundle Mode needs SIX things, not two

An older version of this file listed only two. The missing four all fail *silently*:

1. **Disable the preset's own injection.** `babel-preset-expo` already injects
   `react-native-worklets/plugin`, and its `worklets` option is a bare boolean with
   no options passthrough. Set **both** `worklets: false` *and* `reanimated: false`
   — `worklets: false` alone falls through to the deprecated Reanimated 3 plugin,
   which throws under Reanimated 4.
2. Add the plugin manually with `bundleMode: true` and
   `importForwarding: { moduleNames: ['remend'] }`.
3. **`package.json` needs `worklets.staticFeatureFlags.BUNDLE_MODE_ENABLED: true`.**
4. **`react-native-worklets` must build from source.** Expo precompiles Android
   modules by default since SDK 53 and bakes feature flags into the binary, so the
   static flag is ignored otherwise. Use
   `expo.autolinking.android.buildFromSource: ["react-native-worklets"]`.
5. **Two Metro patches** — `metro` and `metro-runtime`, both `0.84.4`, from
   `react-native-reanimated/packages/react-native-worklets/bundleMode/patches`.
   Without them: *"Failed to get the SHA-1 for …"* and *"Unable to resolve worklet
   with hash …"*. Version chain: `expo@57.0.14` → `@expo/metro-config@57.0.8` →
   `@expo/metro@56.0.0` → `metro@0.84.4`. `@expo/metro` is a one-line shim over
   real `metro`, so patching `metro` works. Generate with **`pnpm patch`**, not by
   copying the published files — those are patch-package format with
   `a/node_modules/…` paths that pnpm rejects.
6. **The `.worklets` watch folder must be created and resolved via
   `require.resolve`.** Under pnpm, `path.resolve(__dirname, 'node_modules/…')` is
   the *symlink*, while Babel writes to the realpath in the virtual store. Also
   `fs.mkdirSync` it — Metro's Node watcher throws on a missing watch root, and
   there is no Watchman on Windows.

**Do NOT add `watchFolders` for the monorepo.** Expo has configured Metro for pnpm
workspaces automatically since SDK 52; its docs say the migration fix is to *delete*
those options. `metro.config.js` should exist only for Bundle Mode.

### Expo SDK 57 specifics

- **`newArchEnabled` and `android.edgeToEdgeEnabled` were removed from the config
  schema.** Both are now unconditional. Leaving them in fails `expo-doctor`.
- **`minSdk` is 24** (confirmed from Gradle output), so the Note 8 at API 28 is
  supported. compileSdk 36, targetSdk 36, NDK 27.1.12297006, Kotlin 2.1.20,
  Gradle 9.3.1, AGP 8.12.0.
- **JDK 17 is required.** AGP 8.12 does not support JDK 25. Adoptium ships a `.zip`
  that needs no installer and no admin rights — the MSI needs UAC.
- `react-native-enriched-markdown`'s config plugin takes
  `{ enableMath, codeHighlight: { enabled, languages } }`. Its postinstall
  downloads tree-sitter grammars and KaTeX; opt out with an `enriched-markdown`
  key in the package.json of whatever directory the install runs from.
- FlashList v2 has **no native code**, so its version may differ from Expo's
  recommendation; silence the warning with `expo.install.exclude`.
- **`autoscrollToBottomThreshold` already is** the "pause on manual scroll, resume
  at the bottom" behaviour. Do not write an `onScroll` handler for it.
- The per-word fade is **native**: `react-native-enriched-markdown` exposes
  `streamingAnimation`, which animates only the newly appended tail.

### Auth — probed against the running server

- The bearer token arrives in the **`set-auth-token` response header**. The body
  also carries a `token`, and the two **differ** (the header has a signature
  suffix) — but **both authenticate**, so read the header and fall back to the body.
- **`/api/auth/*` does NOT use the shared error envelope.** It returns Better
  Auth's own flat `{ code, message }` with SCREAMING_SNAKE codes. Parsing it with
  the envelope schema shows "an unexpected error occurred" on every wrong password.
  Verified codes: `INVALID_EMAIL_OR_PASSWORD` (401),
  `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (422), `PASSWORD_TOO_SHORT` (400).
- **`minPasswordLength: 12`.** Mirror it client-side.
- Endpoints: `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`,
  `POST /api/auth/sign-out`, `GET /api/auth/get-session`.
- A probe account `claude-probe@example.com` may exist in the dev database.

### Device — Samsung Galaxy Note 8

- `SM-N950F`, Android 9 (One UI 1.0), API 28, Exynos 8895 / Snapdragon 835.
- Physical 1440×2960, but **override size 1080×2220** at density 420 — i.e.
  **411 × 846 dp**. The user runs FHD+, not WQHD+.
- **Wireless debugging does not exist** (Android 11+ only). USB only.
- **Expo Go cannot run this at all** — Bundle Mode and WebRTC both need a dev build.
- No gesture bar; 3-button nav. Drive bottom spacing from safe-area insets.
- If `adb devices` shows `unauthorized` and no prompt appears: **reboot the phone.**
  On Android 9 `adbd` wedges into accepting the connection but never prompting, and
  toggling USB debugging does not clear it. Deleting `~/.android/adbkey{,.pub}`
  forces a new fingerprint. Also set *Developer options → Default USB configuration
  → File transfer*, since Samsung suppresses the prompt in charge-only mode.
- Dev connectivity: `adb reverse tcp:3000 tcp:3000`, **re-run after every replug**
  and every `adb kill-server`. The symptom of a missing reverse is "Network request
  failed" on sign-in, which looks like an auth bug.
- Cleartext HTTP is blocked from API 28, but Expo's **debug** manifest sets
  `usesCleartextTraffic="true"`. Never build release against a plain-HTTP server.
- Measure frame rate with Reanimated's `PerformanceMonitor` (JS and UI side by
  side). Target UI ≥ 58, JS ≥ 45. Cross-check with *Developer options → Profile
  HWUI rendering* and `adb shell dumpsys gfxinfo <pkg> framestats`.

## Known gaps, deliberately

- **Rate limiting was in-process memory.** With more than one server instance the
  effective limit becomes `limit × instances`. Move to Redis before scaling out.
- **No `packages/ai` handler for tools beyond `search_conversations`.** A tool
  declared privileged with no handler failed a test, so this could not rot silently.
- **`services/tools/handlers.ts` needs splitting** into one file per tool once there
  are more than about three.

## Costs

The OpenAI key is the user's own, with roughly **$10** of budget for demo and
debugging. `gpt-realtime-2.1` runs about $0.05–0.15 per minute, so that is
65–200 minutes of conversation.

Protections that were in place: 60-second credential TTL, `max_output_tokens: 1200`,
and a per-user limit of 20 sessions/hour. **A usage limit still needs setting in the
OpenAI dashboard** — the app-side limit does not cap a mistake in a loop.

Switching to `gpt-realtime-2.1-mini` is a one-line `.env` change, no redeploy. The
user asked to stay on the full model to impress his boss.

## Other gotchas discovered the hard way

- `@tanstack/react-start` maxes at **1.168.46**, not 1.170.x like `react-router`.
- `resolve: { tsconfigPaths: true }` in the TanStack docs does **not** resolve the
  `~` alias for server handlers. An explicit `resolve.alias` is required.
- Vite loads `.env` from `apps/server/`, **not** the repo root.
- Blank env values are empty strings, not `undefined`, so `.optional()` alone is not
  enough — use an `optional()` helper in `lib/env.ts`.
- Turbo running four packages' tests in parallel exhausts memory on this machine and
  reports the OOM as an unrelated package failing. Cap concurrency in the root
  `package.json` scripts; do not remove those flags.
- `new URL(...).pathname` yields `/C:/...` on Windows. Use `fileURLToPath`.
- drizzle-kit swallows connection errors and prints nothing. A
  `pnpm --filter @convo/db db:check` script is worth recreating.
- Biome's `vcs.useIgnoreFile: true` does nothing without a `.git`, so generated
  output must be excluded explicitly until the repo is initialised.
