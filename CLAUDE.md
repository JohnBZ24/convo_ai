# Convo AI

A push-to-talk conversational AI mobile app. The user taps a mic button to open a
voice session, talks with the model, taps again to end it, and the conversation is
saved as a chat.

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
  talked into passing any `userId`; it cannot forge a session.
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
apps/mobile     Expo + Expo Router. Screens, call state machine, audio pipeline.
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
│     ├─ ports/                 Interfaces the core NEEDS: repositories, authenticator, limiter.
│     ├─ use-cases/             One class, one verb, one `execute`.
│     ├─ errors/                ApplicationError — failures with no notion of a status code.
│     └─ pagination/            Keyset cursor codec.
├─ infrastructure/              The implementations: Drizzle, Better Auth, in-memory limiter.
│  └─ di/container.ts           The composition root. The ONLY place `new Drizzle…` appears.
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
plugin — the app has no cookie jar. Config in
`infrastructure/auth/auth.ts`; the token arrives in the `set-auth-token` response
header (the body's `token` differs but also authenticates).

Guards live in `presentation/middleware`. A route gets them by naming a stack:

```ts
server: { middleware: authenticatedStack, handlers: { POST: createConversation } }
```

`requiresAuth: true` on a handler spec both draws the Swagger padlock and enforces
the 401, so a route wired without its guard fails closed.

## Health endpoints

- `GET /api/health` — liveness. Touches nothing external. Always 200 if the
  process can serve. An orchestrator uses this to decide on restarts.
- `GET /api/ready` — readiness. Checks dependencies with a timeout, returns 503
  when any is down so a load balancer drains the instance.

## Commands

```bash
pnpm install
pnpm server                      # dev server on :3000
pnpm verify                      # lint + typecheck + test — run before pushing
pnpm format                      # apply Biome fixes
pnpm db:generate && pnpm db:migrate
pnpm db:check                    # connectivity + table list (drizzle-kit prints nothing on failure)
pnpm db:baseline                 # mark the journal as applied WITHOUT running it — see the script
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
  maps it. Presentation code may throw `ApiError` directly.
- Log via `~/infrastructure/logging/logger`, never `console`. Transcripts and
  secrets are redacted by key name — do not log them under a different key to work
  around it.
- Every response carries `x-request-id`. Include it in bug reports.
- Ownership lives in the WHERE clause. A cross-user read is **404, not 403** — a
  403 would confirm the row exists.
