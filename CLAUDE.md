# Convo AI

A hands-free conversational AI mobile app. The user taps the orb to open a voice
session, talks with the model — server VAD decides whose turn it is, and the user
can interrupt — taps again to end it, and the conversation is saved as a chat.

It is **not** push-to-talk: the microphone is open for the whole session, and
nothing is held down.

> This file was emptied by accident in commit `bccbde5` and restored in iteration
> 2, updated to match the Clean Architecture that iteration 1 actually built. If
> it disagrees with the code, the code is right — fix this file.

## The one thing to understand first

Conversation audio does **not** flow through this server.

The mobile app opens a WebRTC connection **directly** to the OpenAI Realtime API
using a short-lived credential this server mints. WebRTC is used rather than a
WebSocket because it supplies acoustic echo cancellation, Opus and jitter
buffering natively — which the app needs, since audio always plays through the
loudspeaker while the microphone is open.

That has two consequences that shape everything else:

1. **The server never sees the conversation.** The device posts each completed
   turn back to the API for storage.
2. **Model tool calls arrive on the device, not the server.** Privileged tools are
   proxied back to `POST /api/tools/:name`, which is therefore a public endpoint
   reachable by a model that a user may have prompt-injected.

## Non-negotiable rules

- **Never derive identity or ownership from tool arguments.** Always take the user
  from the authenticated session and scope every query by it. A model can be
  talked into passing any `userId`; it cannot forge a session. Concretely: no
  contract in `packages/shared` may declare a `userId` field on a request body,
  and `ToolExecutionContext.userId` is the only identity a tool handler ever sees.
- **The mobile app must never import `@convo/db` or `drizzle-orm`.** Enforced by a
  Biome rule in `biome.json`.
- **Dependencies run one way:** `mobile → ai`, `mobile → shared`, `server → ai`,
  `server → db`, `server → shared`.
- **Route files contain no business logic.** They map a URL to a middleware stack
  and a controller. Nothing else.
- **No raw SQL outside `packages/db` and the server's repositories.** Use Drizzle
  query builders; a `sql` fragment is for things the builder cannot express, such
  as the row-value comparison keyset pagination needs.
- **Never mirror-delete anything.** No `robocopy /MIR`, no `rsync --delete`, no
  equivalent, anywhere in this repo. See below — this rule was written in blood.

## Deleting files here — read before any recursive delete

On 20 Aug 2026 an assistant destroyed this project's entire source tree by running
`robocopy <empty> node_modules /MIR` to work around a Windows long-path error.
pnpm puts **workspace symlinks** in `node_modules` — `node_modules/@convo/shared`
points at `packages/shared` — and without `/XJ` robocopy followed them out of
`node_modules` and mirrored the empty directory over the real source. A finished,
tested backend was lost. There was no git repo, and OneDrive had silently stopped
syncing months earlier, so nothing was recoverable.

Rules that follow from that:

1. **Mirror-style deletes are banned.** Delete explicit paths with `Remove-Item`.
2. **Before any recursive delete, list reparse points first:**
   ```powershell
   Get-ChildItem <path> -Recurse -Force |
     Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
   ```
   If that returns anything, stop and rethink.
3. **`node_modules` in a pnpm workspace is full of links back to source.** Treat
   deleting it as a dangerous operation, not routine cleanup.
4. **A Windows long-path error means shorten the path**, never reach for a more
   forceful delete tool.
5. **Confirm a backup exists before destructive work.** A folder inside OneDrive is
   not automatically protected — verify sync is actually running.

## Layout

```
apps/mobile     Expo + Expo Router. Screens, call state machine, WebRTC audio.
apps/server     TanStack Start. Token minting, tools, persistence. Not the audio path.
packages/ai     Tool definitions, prompts, model ids. Declares behavior, never performs it.
packages/db     Drizzle schema, migrations, client. Imported only by the server.
packages/shared Zod contracts shared by the server and the app.
```

## Server architecture — Clean Architecture, four layers

Dependencies point **inwards**. `core` knows nothing about HTTP, Drizzle or
TanStack; delete the web framework and the use cases still compile.

```
src/
├─ core/
│  ├─ domain/entities/          Conversation, Turn. Immutable; a change returns a new instance.
│  └─ application/
│     ├─ ports/                 Interfaces the core NEEDS: repositories, authenticator,
│     │                         limiter, credential minter, tool handlers.
│     ├─ use-cases/             One class, one verb, one `execute`.
│     ├─ errors/                ApplicationError — failures with no notion of a status code.
│     └─ pagination/            Keyset cursor codec.
├─ infrastructure/              The implementations: Drizzle, Better Auth, in-memory
│  │                            limiter, the OpenAI credential minter.
│  └─ di/container.ts           The composition root. The ONLY place `new Drizzle…` appears,
│                               and where tool name → handler is bound.
├─ presentation/
│  ├─ controllers/              defineHandler specs: parse, delegate, map, choose a status.
│  ├─ middleware/               Guards, composed into named stacks in stacks.ts.
│  ├─ mappers/                  Entity → wire shape (and Date → ISO string).
│  ├─ http/                     defineHandler, ApiError, currentUser.
│  └─ openapi/                  The generated document.
├─ routes/api/                  URL map only. Middleware stack + controller per method.
└─ config/env.ts                Validated at boot. Fails loudly, not at 3am.
```

**Where does X go?** A decision about *what should happen* → use case. A decision
about *what a request means* or *what status to return* → controller or
`defineHandler`. Talking to something outside the process → infrastructure, behind
a port.

### For a NestJS reader

| NestJS | Here |
|---|---|
| `@Controller` class | `presentation/controllers/*.controller.ts` |
| `@Injectable()` service | `core/application/use-cases/*.use-case.ts` |
| `@Module` + providers | `infrastructure/di/container.ts` |
| `Test.createTestingModule().overrideProvider()` | `createContainer({ … })` overrides |
| Repository pattern | a port in `core/application/ports`, implemented in `infrastructure` |
| DTO + `@ApiProperty` | one Zod schema in `packages/shared/src/contracts/` |
| `@ApiOperation` | the `defineHandler` spec, next to the handler |
| Guards | `presentation/middleware/*.middleware.ts`, composed in `stacks.ts` |
| Exception filter | `defineHandler` in `presentation/http/define-handler.ts` |
| `SwaggerModule.setup()` | `GET /api/openapi` + `GET /api/docs` |

## API documentation

The OpenAPI 3.1 document is **generated from the same Zod schemas the handlers
validate with**, so it cannot drift from the implementation. There is no registry
to update: `document.ts` uses `import.meta.glob` to import every
`*.controller.ts` and turns each export carrying a `.spec` into an operation.

To add an endpoint:

1. Define request/response schemas in `packages/shared/src/contracts/`.
2. Write a `defineHandler({ … })` export in a `*.controller.ts`, using those
   schemas as `body` / `query` / `params` / `responses`.
3. Point a route file at it with the right middleware stack.

`document.test.ts` walks `src/routes/api` on disk and fails if a route is not
documented or a document entry has no route, so step 3 cannot be forgotten.

**The exception:** `/api/auth/*` is Better Auth's own router behind a bare splat.
Its four operations are hand-written in `presentation/openapi/auth-operations.ts`
because there is no spec to discover — and it returns Better Auth's flat
`{ code, message }` errors, **not** this API's envelope.

`GET /api/openapi` serves the document; `GET /api/docs` renders it (dev only by
default — set `DOCS_ENABLED=true` to expose it elsewhere).

**The manual test loop:** sign up → sign in → copy the token from the
`set-auth-token` **response header** → Authorize → every protected endpoint is
clickable.

## Auth

Better Auth with email + password, `minPasswordLength: 12`, and the **bearer**
plugin. Config in `infrastructure/auth/auth.ts`; the token arrives in the
`set-auth-token` response header (the body's `token` differs but also
authenticates — the header is the signed form, and the plugin signs a bare token
itself before verifying, which is why both work).

It is a **session token, not a JWT**: two dot-separated parts, `<token>.<HMAC>`,
where the first half is a row in the `session` table. So it is revocable by
deleting that row, and every authenticated request costs one lookup.

**The app DOES have a cookie jar, and that cost a session to learn.** The
comment in `auth.ts` said it did not. On Android, React Native's fetch runs on
OkHttp, which keeps a native jar and replays the `better-auth.session_token`
cookie Better Auth set at sign-in — while React Native sends no `Origin`. Better
Auth runs its CSRF origin check only when a cookie is present, so that pairing
is a 403 on **every auth POST**: sign-in, sign-up and sign-out alike. GETs
return before the check, so `get-session` keeps working and the app looks half
alive. curl reproduces neither header, which is why every server-side probe
passed and it only ever appeared on a phone.

`infrastructure/auth/native-cookie.ts` drops that cookie before Better Auth sees
it — but only when nothing announces a browser (`Origin`, `Referer`,
`Sec-Fetch-Site`). Removing the credential removes the CSRF surface; a browser
keeps its cookie and keeps the protection. **Do not "fix" this with
`advanced.disableCSRFCheck`** — Better Auth's own docs call it a security risk,
and it would switch the check off for browsers too.

Guards live in `presentation/middleware`. A route gets them by naming a stack:

```ts
server: { middleware: authenticatedStack, handlers: { POST: createConversation } }
```

`requiresAuth: true` on a handler spec both draws the Swagger padlock and enforces
the 401, so a route wired without its guard fails closed.

## Tools — the device/privileged split

Every tool is declared once in `packages/ai/src/tools/`, with one Zod schema that
generates the JSON Schema OpenAI is given, validates the arguments that come
back, and types the handler. `execution` is the security-relevant field:

- **`device`** — runs on the phone (it needs the phone's clock, timezone,
  sensors). The server **refuses to proxy one, with 403.** Running it anyway
  would "work", and that is exactly why it is forbidden: it would make the split
  a naming convention rather than a boundary.
- **`privileged`** — touches the user's data, so it runs here, as the user from
  the session. Declared in `@convo/ai`, implemented as a `ToolHandler`, bound to
  its name in `container.ts`.

`POST /api/tools/:name` fails three different ways on purpose, because they mean
different things to whoever is debugging:

| Situation | Status | Meaning |
|---|---|---|
| Name not in the registry | **404** | The model hallucinated a tool. |
| Tool is `device` | **403** | Real tool, wrong executor. |
| `privileged` with no handler | **500** | OUR bug. Not an `ApplicationError`. |

Tool handlers must be safe to **re-run**: the idempotency key deduplicates the
audit row, not the work. A mutating privileged tool would need to cache its own
result first.

## The device side of a call

Everything under `apps/mobile/src/features/call/`. The split there is the same
instinct as the server's ports, for the same reason plus one practical one.

| File | Imports React Native? | Tested |
|---|---|---|
| `call-store.ts` | no (zustand only) | ✅ the phase machine |
| `realtime-events.ts` | no | ✅ wire events → domain events |
| `transcript-assembler.ts` | no | ✅ a pure reducer |
| `realtime-session.ts` | no | ✅ the connect ORDER |
| `device-tools.ts` | no | ✅ device vs proxied routing |
| `turn-recorder.ts` | no | ✅ seq assignment + retry |
| `webrtc-adapter.ts` | **yes** — `react-native-webrtc` | — |
| `audio-route.ts` | **yes** — `react-native-incall-manager` | — |
| `use-call-session.ts` | **yes** — the React wiring | — |

**Nothing in a tested file may import `react-native`.** It drags React Native's
Flow-typed entry point in, which no test runner can parse — the same trap that
keeps `expo-constants` out of `lib/api/client.ts`. The two adapters exist so the
`Minimal*` interfaces in `realtime-session.ts` are the only shape the logic knows.

Three things about the call that are easy to get wrong:

- **The order in `open()` is load-bearing.** The credential lives ~60 seconds, so
  the permission dialog, the microphone and ICE gathering all happen BEFORE the
  mint. `realtime-session.test.ts` asserts that order literally.
- **The offer that goes on the wire is `peer.localDescription`**, read after ICE
  gathering completes (2s ceiling) — not what `createOffer` returned.
  `setLocalDescription` resolves before candidates exist, and an offer without
  them negotiates and then never carries audio.
- **`InCallManager.start` runs before `getUserMedia`.** It puts Android in
  `MODE_IN_COMMUNICATION`, and the mode the mic is OPENED in decides whether
  hardware echo cancellation is engaged. Get this backwards and the model hears
  itself through the loudspeaker and interrupts itself.
- **`setForceSpeakerphoneOn(true)` does NOT route the audio here.** With
  `auto: false` it silently does nothing, and the call comes out of the
  earpiece. `auto` does not only control the proximity sensor: it also sets
  `automatic`, and `updateAudioRoute()` returns immediately when that is false —
  which leaves `audioDevices` empty after `start()` cleared it, so
  `selectAudioDevice(SPEAKER_PHONE)` bails on its own containment check. The
  line that actually routes is **`setSpeakerphoneOn(true)`**, which calls
  `AudioManager` directly with no device-set check. Keep both, in that order.

**The device sends no `session.update`.** `buildClientSecretRequest()` binds the
instructions, tools and VAD config to the credential at mint time. Pushing them
again from the phone would make the system prompt client-rewritable, which is the
one boundary this whole design exists to hold.

## Conversation persistence and the sidebar

Added in iteration 6. Three rules here are load-bearing.

**`seq` is a POSITION, not a counter.** `features/call/turn-recorder.ts` takes it
from the line's slot index in the transcript assembler's order, 1-based. Input
transcription is asynchronous — the model's reply finishes before the user's
own words are transcribed, which is why `input_audio_buffer.committed` is handled
at all — so a counter incremented on each `*.transcript.done` would number the
REPLY 1 and the QUESTION 2, and the stored conversation would read backwards. It
is also what makes a retry safe: the same line always computes the same seq, so a
second POST collides with the unique index and is answered `replayed: true`.
Never replace it with a counter.

**`PATCH /api/conversations/{id}` takes a UNION, not optional fields.**
`{ title }` renames, `{ status: "ended" }` ends. Declared as
`z.union([renameConversationBody, endConversationBody])` so both intents appear
in the OpenAPI document and `{}` is rejected by the schema — a `.refine()`
would enforce it at runtime and vanish from the published document. The
controller branching on `"title" in body` is the one branch in that file, and it
is deciding what the request MEANS, which is presentation's job.

**Search is server-side, and it must stay that way.** `GET /api/conversations?q=`
matches a conversation's title OR the text of any turn in it, and the term joins
the same WHERE clause as the keyset cursor. Filtering a fetched page on the
device would only ever match titles — the words live in Postgres — and it
would break "load more", because a page of thirty rows may hold two matches.
`matchesQuery()` in `drizzle-conversation.repository.ts` is shared with the
`search_conversations` tool so the box a person types into and the tool the model
calls cannot drift.

`DELETE /api/conversations/{id}` is deliberately NOT idempotent: 204, then 404.
Ending is fired by the device as a call tears down and must survive a retry;
deleting is a person tapping once. Turns go by `ON DELETE CASCADE`; the
`realtime_sessions` and `tool_invocations` audit rows are `SET NULL` and survive.

On the device, `components/sidebar.tsx` is ONLY the drawer shell — the list,
search, rename and delete live in `features/conversations/conversation-list.tsx`,
which fetches its own data. That is not tidiness: the voice screen re-renders
several times a sentence, and a search term held up there would reconcile the
whole drawer panel behind the next tap.

Two React Native traps in this code, both of the "curl is not a phone" family:
`URLSearchParams` is a STUB here (`set`, `get`, `delete` throw; no `size`), so
query strings are built by hand; and a release build's JS bundle is written by
Expo in the first ~30 seconds, so **source edited after `expo run:android`
starts is silently absent from the APK** while the build still reports success.

## Health endpoints

- `GET /api/health` — liveness. Touches nothing external. Always 200 if the
  process can serve. An orchestrator uses this to decide on restarts.
- `GET /api/ready` — readiness. Checks dependencies with a timeout, returns 503
  when any is down so a load balancer drains the instance.

## Commands

```bash
pnpm install
pnpm server                      # dev server on :3000
pnpm mobile                      # Metro for the Expo app
pnpm mobile:android              # build + install the dev build on a device
pnpm verify                      # lint + typecheck + test — run before pushing
pnpm format                      # apply Biome fixes
pnpm db:generate && pnpm db:migrate
pnpm db:check                    # connectivity + table list. NEEDS DATABASE_URL exported:
                                 # the db scripts do NOT read apps/server/.env
pnpm --filter @convo/db db:baseline   # mark the journal as applied WITHOUT running it.
                                 # NOT `pnpm db:baseline` - there is no root script for it.
```

Environment lives in `apps/server/.env` (see `.env.example`). Vite loads it
relative to the app, **not** the repo root — a root `.env` is ignored.

`OPENAI_API_KEY` is server-only. The token route exchanges it at
`POST /v1/realtime/client_secrets` for an ephemeral credential that the device
uses to open its own WebRTC connection. The key itself never leaves here.

## Conventions

- Biome for lint and format. `pnpm verify` must pass before pushing.
- Errors use the envelope in `packages/shared/src/contracts/common.contract.ts`.
  Use cases throw `ApplicationError` (no status codes in the core); `defineHandler`
  maps it — `not-found`→404, `invalid-input`→400, `conflict`→409,
  `forbidden`→403, `upstream-failure`→502. Presentation code may throw `ApiError`
  directly. A failure that is **our** bug (a declared tool with no handler, say)
  must stay a plain `Error`, so it becomes a 500 with its detail withheld rather
  than blaming the caller.
- Log via `~/infrastructure/logging/logger`, never `console`. Transcripts and
  secrets are redacted by key name — do not log them under a different key to work
  around it.
- Every response carries `x-request-id`. Include it in bug reports.
- Ownership lives in the WHERE clause. A cross-user read is **404, not 403** — a
  403 would confirm the row exists.
