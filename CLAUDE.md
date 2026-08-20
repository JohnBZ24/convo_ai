# Convo AI

A push-to-talk conversational AI mobile app. The user taps a mic button to open a
voice session, talks with the model, taps again to end it, and the conversation is
saved as a chat.

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
- **Route files contain no business logic.** API routes parse, delegate to a
  service, and format a response. Screens render a feature component.
- **No raw SQL outside `packages/db`.** Use Drizzle query builders.
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
packages/db     Drizzle schema, migrations, repositories. Imported only by the server.
packages/shared Zod contracts + the OpenAPI route registry.
```

## API documentation

The OpenAPI 3.1 document is **generated from the same Zod schemas the handlers
validate with**, so it cannot drift from the implementation.

To add an endpoint:

1. Define request/response schemas in `packages/shared/src/contracts/`.
2. Export a `RouteDoc[]` from the same file.
3. Add it to `routeDocs` in `apps/server/src/lib/openapi.ts`.
4. Write the handler using those schemas via `parseBody` / `parseQuery`.

`GET /api/openapi` serves the document; `GET /api/docs` renders it (dev only by
default — set `DOCS_ENABLED=true` to expose it elsewhere).

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
```

Environment lives in `apps/server/.env` (see `.env.example`). Vite loads it
relative to the app, **not** the repo root — a root `.env` is ignored.

`OPENAI_API_KEY` is server-only. The token route exchanges it at
`POST /v1/realtime/client_secrets` for an ephemeral credential (~30 min) that the
device uses to open its own WebRTC connection. The key itself never leaves here.

## Conventions

- Biome for lint and format. `pnpm verify` must pass before pushing.
- Errors use the envelope in `packages/shared/src/contracts/common.ts`. Services
  throw `ApiError`; the `handler` wrapper converts it.
- Log via `~/lib/logger`, never `console`. Transcripts and secrets are redacted
  by key name — do not log them under a different key to work around it.
- Every response carries `x-request-id`. Include it in bug reports.
