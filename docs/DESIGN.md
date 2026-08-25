# Convo AI — Design & Build Plan

**Status:** design agreed 20 Aug 2026. **Iterations 0–3 are built** (backend
complete); iteration 4 — the Expo app and the first dev build on the Note 8 — is next.
**Read order:** `CLAUDE.md` (rules) → this file (design) → `HANDOFF.md` (verified facts, gotchas).

> Two parts of this file describe a design that iteration 1 deliberately
> replaced, and are kept only because the *reasoning* still holds. Where they
> disagree with the code, the code wins:
> - §3 and §6 describe a **`RouteDoc` registry** and a four-step "register it in
>   `lib/openapi.ts`" flow. There is no registry: `document.ts` discovers every
>   `*.controller.ts` with `import.meta.glob`, so there is no registration step
>   to forget. The *test* described in §6 does still exist and still walks the
>   route directory on disk.
> - §3's NestJS table maps `@Controller` to the route file and services to
>   `services/*.ts`. The real layout is Clean Architecture — see `CLAUDE.md`.

This document is the design the build follows. `HANDOFF.md` stays what it is — a
record of things already proven against real OpenAI, real Postgres and the real
device. Where the two touch, `HANDOFF.md` wins on facts, this file wins on plan.

---

## 1. Decisions locked for this build

| Decision | Choice | Consequence |
|---|---|---|
| Project root | `C:\convo_ai` (11 chars) | NDK object paths land ~189/250. Build unblocked. |
| Mic model | Tap to open, tap to hang up | OpenAI `server_vad`. Hands-free, barge-in works. |
| Backup | git init + private GitHub remote | Commit every iteration, push every iteration. |
| Model in dev | mini variant, full model for the demo | One `.env` line. Protects the ~$10 budget. |

---

## 2. What the system is

Three processes plus one cloud API.

```
   ┌────────────────────┐        WebRTC audio (Opus, AEC, jitter buffer)
   │  Expo app          │◄══════════════════════════════════════════╗
   │  Note 8, API 28    │                                           ║
   │  411 × 846 dp      │                                           ▼
   └─────────┬──────────┘                                  ┌──────────────────┐
             │  HTTP  (auth, conversations,                │ OpenAI Realtime  │
             │         turns, token, tools)                │ gpt-realtime-*   │
             ▼                                             └──────────────────┘
   ┌────────────────────┐                                           ▲
   │  TanStack Start    │  POST /v1/realtime/client_secrets         ║
   │  :3000             │═══════════════════════════════════════════╝
   └─────────┬──────────┘        (mints ephemeral credential only)
             │ Drizzle
             ▼
   ┌────────────────────┐
   │  Postgres 18 :5432 │  database `convo`
   └────────────────────┘
```

**The load-bearing fact:** conversation audio never touches the server. The server
mints a ~60-second credential; the device opens its own WebRTC connection to
OpenAI. The `OPENAI_API_KEY` never leaves the server.

Two consequences drive the security design:

1. The server never sees the conversation — the **device posts each completed turn back**.
2. Model tool calls arrive **on the device**. Privileged ones proxy to
   `POST /api/tools/:name`, which is therefore reachable by a model a user may have
   prompt-injected. It defends itself: identity comes from the session, never from
   tool arguments.

### One conversation, end to end

```
 1. app   →  POST /api/auth/sign-in/email        → bearer token
 2. user  →  taps orb
 3. app   →  POST /api/conversations             → { id }
 4. app   →  POST /api/realtime/token            → { clientSecret, expiresAt, model, voice }
 5. app   →  getUserMedia → RTCPeerConnection → createOffer
 6. app   →  POST OpenAI /v1/realtime/calls (SDP + Bearer clientSecret) → answer SDP
 7.          data channel `oai-events` opens → session.update (instructions, tools, VAD)
 8.          ══ audio flows device ↔ OpenAI, transcript deltas on the data channel ══
 9. app   →  POST /api/conversations/:id/turns   (per completed turn, seq monotonic)
10. model →  tool call → runs on device, or proxies to POST /api/tools/:name
11. user  →  taps orb → close peer connection
12. app   →  PATCH /api/conversations/:id { status: "ended" }
```

Steps 4 and 6 are the only places the credential is used, and it is dead 60
seconds after minting.

---

## 3. Repository layout

Dependencies run **one way**. A Biome rule enforces that mobile cannot import the
database.

```
convo_ai/
├─ apps/
│  ├─ mobile/          Expo + Expo Router. Screens, call machine, audio pipeline.
│  └─ server/          TanStack Start. Tokens, tools, persistence. Not the audio path.
├─ packages/
│  ├─ ai/              Tool definitions, prompts, model ids. Declares; never performs.
│  ├─ db/              Drizzle schema, migrations, repositories. Server-only.
│  └─ shared/          Zod contracts + the OpenAPI RouteDoc registry.
└─ docs/
```

```
mobile → ai       mobile → shared
server → ai       server → shared      server → db
```

`mobile ↛ db` is the rule that matters. It is enforced, not documented.

### For a NestJS reader

You will look for decorators and a Swagger module and not find them. The mapping:

| NestJS | Here | Why |
|---|---|---|
| `@Controller` class | the route **file** — `routes/api/conversations.ts` | The framework binds URL → file path. A `controllers/` folder would be a pass-through layer. |
| `@Injectable()` service | `services/conversations.ts`, plain exported functions | No DI container, so no decorator to register with. |
| `TypeOrmModule.forRoot()` | `export const db` in `packages/db/src/client.ts` | ES modules give you the singleton. Node caches the module; every importer gets the same instance. |
| Repository pattern | `packages/db/src/repositories/*.ts` | Same idea, plain functions. |
| DTO + `@ApiProperty` | one Zod schema in `packages/shared/src/contracts/` | The schema both validates and generates the docs, so they cannot disagree. |
| `@ApiTags` / `@ApiOperation` | a `RouteDoc` object exported next to the schema | Same metadata, declared as data instead of as a decorator. |
| `main.ts` → `SwaggerModule.setup()` | `GET /api/openapi` + `GET /api/docs` | Document built by walking the RouteDoc registry. |
| Guards | `guards/require-user.ts`, `guards/rate-limit.ts` | Called at the top of a handler instead of injected. |
| Exception filter | the `handler()` wrapper in `lib/http.ts` | Catches `ApiError`, formats the envelope, stamps `x-request-id`. |

---

## 4. Data model

Postgres 18, database `convo`, Drizzle ORM. **No raw SQL outside `packages/db`.**

```
conversations
  id              uuid        pk
  user_id         text        not null            → better-auth user.id
  title           text        null                derived from the first user turn
  status          text        not null 'active'   'active' | 'ended'
  turn_count      integer     not null 0          denormalised
  last_turn_at    timestamptz null                denormalised
  started_at      timestamptz not null now()
  ended_at        timestamptz null
  INDEX (user_id, started_at DESC, id DESC)       ← keyset pagination

turns
  id              uuid        pk
  conversation_id uuid        not null  → conversations.id  ON DELETE CASCADE
  seq             integer     not null            device-assigned, monotonic
  role            text        not null            'user' | 'assistant'
  text            text        not null
  started_at      timestamptz null
  ended_at        timestamptz null
  created_at      timestamptz not null now()
  UNIQUE (conversation_id, seq)                   ← this is what makes replay safe

realtime_sessions
  id, user_id, conversation_id, model, voice, expires_at, created_at
  INDEX (user_id, created_at DESC)                ← rate-limit window + audit

tool_invocations
  id, user_id, conversation_id, tool_name, status, duration_ms, created_at
  idempotency_key text UNIQUE                     ← a retried tool call runs once
```

Plus Better Auth's own tables: `user`, `session`, `account`, `verification`.

### Three invariants worth stating plainly

**Ownership lives in the WHERE clause.** Every repository function takes `userId`
and filters on it. A cross-user read therefore returns **404, not 403** — the row
simply is not in the result set. This is not politeness; a 403 would confirm the
conversation exists.

**Turn append is idempotent.** The device posts `seq`. `appendTurn` runs
`INSERT … ON CONFLICT (conversation_id, seq) DO NOTHING` inside a transaction, then
bumps `turn_count` / `last_turn_at` **only if the insert actually happened**. A
flaky mobile network retrying the same turn produces `200 replayed`, not a
duplicate row. This is the entire reason the unique index exists.

**Pagination is keyset, not offset.** Cursor is `(started_at, id)`;
`WHERE (started_at, id) < (cursor)` matches the index exactly. A conversation
created mid-scroll cannot shift the page under you.

---

## 5. API surface

Routes parse, delegate, format. No business logic. Every response carries
`x-request-id`. Errors use the envelope in `contracts/common.ts` — **except
`/api/auth/*`, which returns Better Auth's own flat `{ code, message }`** and must
be parsed with a different schema (see §9).

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/api/health` | — | Liveness. Touches nothing external. Always 200 if the process can serve. |
| GET | `/api/ready` | — | Readiness. `checkConnection` on a 2s timeout. 503 + `degraded` when the DB is down. |
| GET | `/api/openapi` | — | OpenAPI 3.1 document. Gated on `DOCS_ENABLED`, else 404. |
| GET | `/api/docs` | — | Swagger UI. Same gate. |
| POST | `/api/auth/$` | — | Bare splat → Better Auth's handler. **Deliberately not wrapped in `handler()`.** |
| POST | `/api/conversations` | bearer | Create → 201. |
| GET | `/api/conversations` | bearer | List, keyset paginated. |
| GET | `/api/conversations/:id` | bearer | Detail + turns. 404 if not yours. |
| PATCH | `/api/conversations/:id` | bearer | End the conversation. |
| POST | `/api/conversations/:id/turns` | bearer | Record a turn. **201 new / 200 replayed.** |
| POST | `/api/realtime/token` | bearer | Mint credential. Rate limited **20/hour/user**. |
| POST | `/api/tools/:name` | bearer | Execute a privileged tool. Rate limited **120/min/user**. |

`/api/auth/$` is not wrapped because Better Auth owns that response shape end to
end — wrapping it would rewrite headers it needs, including `set-auth-token`.

### `POST /api/tools/:name` — three distinct refusals

This endpoint is reachable by a possibly-prompt-injected model, so it fails loudly
and *differently* depending on why:

| Situation | Status | Reasoning |
|---|---|---|
| Tool name not in the registry | **404** | The model hallucinated a tool. |
| Tool is declared `device` execution | **403** | Real tool, wrong caller. Never proxy a device tool. |
| Tool is `privileged` but has no handler | **500** | Our bug, not the caller's. A test asserts this so it cannot rot silently. |

---

## 6. Swagger as the test surface

The OpenAPI document is generated by walking the `RouteDoc` registry, and the
RouteDocs sit beside the Zod schemas the handlers actually validate with. Docs
cannot drift from behaviour.

A test — `openapi.registry.test.ts`, the most valuable one in the old suite —
walks `src/routes/api` **on disk** and fails if a route file has no RouteDoc, or a
RouteDoc has no route file. Adding an endpoint without documenting it breaks the
build.

**To make Swagger UI genuinely usable for testing**, the document declares:

```
components.securitySchemes.bearerAuth = { type: "http", scheme: "bearer" }
```

so the **Authorize** button works. The loop is: sign up → sign in → copy the token
from the `set-auth-token` response header → Authorize → every protected endpoint
becomes clickable. That is the manual test surface for iterations 1–3, and it stays
useful afterwards for reproducing device bugs without the device.

Adding an endpoint (four steps, from `CLAUDE.md`):

1. Schemas in `packages/shared/src/contracts/`
2. Export a `RouteDoc[]` from the same file
3. Register it in `apps/server/src/lib/openapi.ts`
4. Handler uses those schemas via `parseBody` / `parseQuery`

---

## 7. Mobile architecture

### Layout — settled, not up for relitigation

ChatGPT **voice mode**, not chat. The orb is above; spoken text appears **below**
it and reveals word by word, older lines scrolling up and fading.

```
        ┌──────────────────────┐  ← safe-area top
        │  ☰                   │     left-edge swipe opens sidebar
        │                      │
        │                      │
        │         ◯            │  ← orb centre at 38% of usable height,
        │        ORB           │     derived from insets, never a pixel constant
        │                      │     scales with mic amplitude
        │                      │
        │  ─────────────────   │
        │  transcript, newest  │  ← react-native-streamdown, per-word fade
        │  at the bottom,      │     older lines scroll up and fade
        │  older fading up     │
        │                      │
        └──────────────────────┘  ← safe-area bottom (3-button nav, no gesture bar)
```

- **Voice only.** No text input, no keyboard, no send button. (The markdown library
  stays in place because typed chat may come later.)
- **The orb IS the button.** There is no separate mic control.
- **Dark theme only:** `#202123` bg · `#19C37D` accent · `#8E8EA0` muted · `#ECECF1` text.
- Sidebar slides **over** the content on a left-edge swipe, ChatGPT-mobile style,
  with a "New chat" button. Every row identical — no main-chat/side-chat distinction.
- Auto-scroll pauses on manual scroll-up, resumes at the bottom. FlashList v2's
  `autoscrollToBottomThreshold` **already is** this behaviour — do not write an
  `onScroll` handler for it.

### Library choices — all driven by "must never feel laggy"

| Need | Choice | Why |
|---|---|---|
| Streaming text | `react-native-streamdown` | Parses markdown on a **worklet thread**, so a busy JS thread cannot stutter it. Needs Bundle Mode. |
| Per-word fade | `streamingAnimation` (`react-native-enriched-markdown`) | **Native** — animates only the newly appended tail. |
| Lists | FlashList v2 | `maintainVisibleContentPosition` is built for chat feeds. No native code. |
| Sidebar | ReanimatedDrawerLayout | Runs on the **UI thread**; cannot stutter when JS is busy. |
| Server state | TanStack Query | `focusManager`/`onlineManager` wired to AppState + expo-network. |
| Client state | Zustand | Holds the call state machine. |
| Token storage | expo-secure-store | Keystore-backed. Not AsyncStorage. |

### Call state machine (Zustand)

```
    idle ──tap──► connecting ──ready──► live ──tap──► ending ──► idle
                      │                  │              │
                      └──── error ◄──────┴──────────────┘
                              │
                        (retry / dismiss)

    while live, a sub-state drives the orb's visual:
        listening   → orb scales with mic amplitude
        thinking    → slow idle pulse
        speaking    → orb scales with output amplitude
```

**The amplitude contract:** mock input (iteration 4) and real mic input
(iteration 5) write **the same Reanimated shared value**. That makes iteration 5 a
swap rather than a rewrite — and it means the orb animation is proven on-device
before any audio code exists.

---

## 8. Build plan — eight iterations

Each ends with a green `pnpm verify`, a **stated exit test actually run**, and a
commit + push. I stop at each boundary for you to look.

Iterations 1–3 rebuild what was proven working before the loss. Their design is not
speculative; only the code is gone.

---

### Iteration 0 — Repo safety and workspace skeleton

The handoff's first lesson, so it goes first.

- `git init`, `.gitignore` (`node_modules`, `.env`, `.expo`, `android/`, `ios/`,
  `dist`, `.turbo`, `.worklets`); commit `.env.example` and **never** `.env`
- `pnpm-workspace.yaml`, root `package.json`, `turbo.json`, `biome.json`,
  `tsconfig.base.json`
- **Turbo concurrency capped** in the root scripts — four packages' tests in
  parallel exhaust memory on this machine and report the OOM as an unrelated
  package failing. Do not remove those flags.
- Biome: exclude generated output explicitly (`vcs.useIgnoreFile` does nothing
  until `.git` exists — and now it will)
- `ANDROID_HOME` + platform-tools onto PATH
- Wire the private GitHub remote, push

**Exit test:** `git log` shows the commit · remote push succeeds · `pnpm install` clean.

---

### Iteration 1 — Backend foundation and Swagger

`packages/shared` — error envelope, `ApiError`, `RouteDoc` type, registry.

`packages/db` — schema, migrations, client, `checkConnection`, plus a `db:check`
script (drizzle-kit swallows connection errors and prints nothing).

`apps/server` — `env.ts` (with the `optional()` helper: blank env values are empty
strings, not `undefined`), `logger.ts` (redacts transcripts and secrets by key
name), `http.ts` (the `handler()` wrapper), `security.ts` (**recovered — copy from
`C:\Users\JBZLB\convo_ai_keep\security.ts`, do not rewrite**), health, ready,
openapi, docs.

Two traps recorded from last time: `resolve.alias` must be explicit — TanStack's
documented `tsconfigPaths: true` does **not** resolve `~` for server handlers; and
Vite loads `.env` from `apps/server/`, not the repo root.

**Exit test:** `pnpm verify` green · `curl /api/health` → 200 · `curl /api/ready`
→ 200, then **stop Postgres** → 503 `degraded` · Swagger UI renders at `/api/docs`
and "Try it out" works on both.

---

### Iteration 2 — Auth and conversations CRUD

Better Auth: email + password, **`minPasswordLength: 12`** (mirrored client-side),
bearer plugin, `trustedOrigins` including **`convoai://`** exactly. Guards
`require-user` and `rate-limit`. Repositories and services for conversations and
turns. All six conversation/turn routes. `bearerAuth` added to the OpenAPI document
so Swagger's Authorize button works.

**Exit test — entirely through Swagger UI:**
- sign up → sign in → copy token from `set-auth-token` → Authorize
- create → 201 · list → keyset paginated
- append `seq=1` → **201**; post it again → **200 replayed**, `turn_count` still 1
- second account reads the first account's conversation → **404**, not 403
- `PATCH` → `status: "ended"`

---

### Iteration 3 — packages/ai, realtime token, tools

`packages/ai` declares and never executes: model ids,
`CLIENT_SECRET_TTL_SECONDS = 60`, `max_output_tokens: 1200`, `server_vad`, default
voice `marin`, and two tools — `get_current_time` (device) and
`search_conversations` (privileged). `REALTIME_MODEL` / `REALTIME_VOICE` /
`DOCS_ENABLED` get added to `.env` and `.env.example`.

**⚠ Verify before coding — DONE 25 Aug 2026.** `GET /v1/models` confirms
`gpt-realtime-2`, `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` all exist; the
`/v1/realtime/client_secrets` request and response shapes were confirmed by
POSTing the generated body for real. Full findings in `HANDOFF.md`.

**Exit test — through Swagger, against real OpenAI: PASSED 25 Aug 2026.**
Automated in `scripts/exit-test.sh`, which now covers iterations 2 and 3.
- mint a credential → real `ek_…`, `expiresInSeconds: 59` ✓
- `search_conversations` → returns **only your own** conversations ✓
- `get_current_time` → **403** (device tool) · unknown name → **404** ✓
- 20th token inside an hour → **429** with `retry-after: 3586` ✓
  (20th, not 21st: a *failed* mint still spends budget, because the limiter is
  middleware and runs before the handler rejects the request. Deliberate —
  probing has to cost the prober.)
- Added beyond the stated test, because the endpoint deserves it: a caller
  passing another user's `userId` in the tool arguments gets **zero matches**,
  and a `query` of `"%"` matches nothing rather than dumping the history.

---

### Iteration 4 — Expo scaffold, UI shell, and the first dev build on the Note 8

**The riskiest iteration, so it comes before any audio work.** The Windows path
problem and Bundle Mode both bite here; hitting them now means audio work later is
not blocked behind a build fight.

App identity: name `Convo AI`, slug `convo-ai`, scheme `convoai`, `android.package`
`com.abiroot.convoai`. **Omit `newArchEnabled` and `android.edgeToEdgeEnabled`** —
removed from the SDK 57 schema, both now unconditional, and leaving them in fails
`expo-doctor`.

**Worklets Bundle Mode needs all six things. The last four fail *silently*:**

1. `babel-preset-expo` with **both** `worklets: false` **and** `reanimated: false`
   — `worklets: false` alone falls through to the deprecated Reanimated 3 plugin,
   which throws under Reanimated 4
2. Add the plugin manually: `bundleMode: true`,
   `importForwarding: { moduleNames: ['remend'] }`
3. `package.json` → `worklets.staticFeatureFlags.BUNDLE_MODE_ENABLED: true`
4. `expo.autolinking.android.buildFromSource: ["react-native-worklets"]` — Expo
   precompiles Android modules since SDK 53 and bakes feature flags into the
   binary, so the static flag is ignored without this
5. **Two `pnpm patch` patches** — `metro` and `metro-runtime`, both `0.84.4`.
   Generate with `pnpm patch`, *not* by copying the published files (those are
   patch-package format with `a/node_modules/…` paths that pnpm rejects)
6. Create the `.worklets` watch folder and resolve it via **`require.resolve`** —
   under pnpm, `path.resolve(__dirname, 'node_modules/…')` is the *symlink* while
   Babel writes to the realpath in the virtual store. `fs.mkdirSync` it too;
   Metro's Node watcher throws on a missing watch root and there is no Watchman here.

**Do NOT add `watchFolders` for the monorepo.** Expo has configured Metro for pnpm
workspaces automatically since SDK 52. `metro.config.js` exists *only* for Bundle Mode.

Then: theme tokens, Expo Router, auth screens, TanStack Query wiring, the Zustand
call machine, the orb at 38% of usable height driven by a **mock** amplitude source,
streaming transcript below it, ReanimatedDrawerLayout sidebar, FlashList v2.

`npx expo run:android --device`, then **`adb reverse tcp:3000 tcp:3000`** — re-run
after every replug and every `adb kill-server`. A missing reverse shows up as
"Network request failed" on sign-in, which looks exactly like an auth bug.

**Exit test:** app installs and launches on the Note 8 · sign in works against the
real server · mock amplitude visibly pulses the orb · sidebar swipe is smooth.

---

### Iteration 5 — WebRTC audio on the device

`react-native-webrtc` via config plugin, `RECORD_AUDIO` permission, audio focus and
speaker routing. Mint → `getUserMedia` → peer connection → offer → OpenAI → answer
→ data channel → `session.update`. Real mic amplitude replaces the mock **by
writing the same shared value**.

**Exit test:** tap the orb, say "hello", hear the reply through the loudspeaker, and
confirm the model does **not** interrupt itself — that is WebRTC's echo cancellation
doing the job it was chosen for.

---

### Iteration 6 — Transcripts, persistence, history

Data-channel events → the transcript under the orb, per-word fade via the native
`streamingAnimation`. Completed turns → `POST /turns` with monotonic `seq` and
retry-on-same-seq. Sidebar lists real conversations from `GET /api/conversations`;
tapping one opens its transcript.

**Exit test:** hold a real multi-turn conversation, hang up, reopen it from the
sidebar, and confirm the stored transcript matches what was said.

---

### Iteration 7 — Hardening and measured latency over USB

Barge-in, credential expiry mid-call (session handoff), reconnect after network
loss, offline state, real error surfaces.

Then **measure, and report numbers rather than claims**:

| Metric | Method | Target |
|---|---|---|
| UI thread FPS | Reanimated `PerformanceMonitor` | ≥ 58 |
| JS thread FPS | same, side by side | ≥ 45 |
| Frame times | `adb shell dumpsys gfxinfo com.abiroot.convoai framestats` | cross-check |
| Jank, visual | Developer options → Profile HWUI rendering | cross-check |
| Tap → first audio out | instrumented log timestamps | record |
| End of speech → model audio | instrumented log timestamps | record |

**Exit test:** the table above, filled in with real measurements from the Note 8.

---

## 9. Facts already verified — do not rediscover these

Condensed from `HANDOFF.md`; that file has the full detail and the reasoning.

**Auth, probed against the running server**

- The bearer token arrives in the **`set-auth-token` response header**. The body
  also carries a `token` and **the two differ** (the header has a signature suffix)
  — but **both authenticate**. Read the header, fall back to the body.
- **`/api/auth/*` does not use the shared error envelope.** It returns
  `{ code, message }` with SCREAMING_SNAKE codes. Parsing it with the envelope
  schema shows "an unexpected error occurred" on every wrong password. Verified:
  `INVALID_EMAIL_OR_PASSWORD` (401), `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (422),
  `PASSWORD_TOO_SHORT` (400).
- A probe account `claude-probe@example.com` may already exist in the dev database.

**Device — Samsung Galaxy Note 8** (re-confirmed over adb today)

- `SM-N950F`, Android 9, API 28. `minSdk` is 24, so it is supported.
- Physical 1440×2960 but **override 1080×2220 @ density 420 → 411 × 846 dp**.
- **No wireless debugging** (Android 11+ only). USB only. **Expo Go cannot run this
  at all** — Bundle Mode and WebRTC both require a dev build.
- 3-button nav, no gesture bar. Drive bottom spacing from safe-area insets.
- `unauthorized` with no prompt → **reboot the phone**. On Android 9 `adbd` wedges
  into accepting the connection but never prompting, and toggling USB debugging does
  not clear it. Also set *Default USB configuration → File transfer*, since Samsung
  suppresses the prompt in charge-only mode.
- Cleartext HTTP is blocked from API 28, but Expo's **debug** manifest sets
  `usesCleartextTraffic="true"`. Never build release against a plain-HTTP server.

**Toolchain, confirmed present today**

- Node 24.13.0 · pnpm 11.22.0 · git 2.45.1 · **JDK 17** (Adoptium, at `JAVA_HOME` —
  AGP 8.12 does not support JDK 25) · Android platform 36, build-tools 36.1.0,
  **NDK 27.1.12297006**, cmake 3.22.1 · Postgres 18 on 5432 · Docker 28.3.2.
- `ANDROID_HOME` is unset and `adb` is not on PATH — fixed in iteration 0.
- `gh` is **not installed** — needed for the GitHub remote.

**Version pins**

- `@tanstack/react-start` maxes at **1.168.46**, not 1.170.x like `react-router`.
- Chain: `expo@57.0.14` → `@expo/metro-config@57.0.8` → `@expo/metro@56.0.0` →
  `metro@0.84.4`. `@expo/metro` is a one-line shim over real `metro`, so patching
  `metro` works.
- FlashList v2 has no native code, so its version may differ from Expo's
  recommendation — silence the warning with `expo.install.exclude`.
- `new URL(...).pathname` yields `/C:/...` on Windows. Use `fileURLToPath`.

---

## 10. Known gaps, carried deliberately

- **Rate limiting is in-process memory.** With more than one server instance the
  effective limit becomes `limit × instances`. Move to Redis before scaling out.
  Fine for a single dev instance and a demo.
- **No handler for privileged tools beyond `search_conversations`.** A tool declared
  privileged with no handler fails a test, so this cannot rot silently.
- **`services/tools/handlers.ts` should split** into one file per tool once there
  are more than about three.
- **The OpenAI dashboard usage limit still needs setting.** The app-side limits
  (60s TTL, `max_output_tokens: 1200`, 20 sessions/hour/user) do not cap a mistake
  in a loop. ~$10 of budget; the full model runs $0.05–0.15/min.

---

## 11. Open items

1. ~~**Private GitHub repo**~~ — DONE. `origin` is
   `https://github.com/JohnBZ24/convo_ai.git`. Push at every iteration boundary.
2. ~~**Confirm the mini model's exact id**~~ — DONE 25 Aug 2026 against
   `GET /v1/models`: it is **`gpt-realtime-2.1-mini`**. Switching is one `.env`
   line, no redeploy.
3. **Set the OpenAI dashboard usage limit** — this one is yours to click, and it
   is now the ONLY protection the app cannot provide itself. The app-side limits
   (60s TTL, `max_output_tokens: 1200`, 20 mints/hour/user) do not cap a mistake
   in a loop.
