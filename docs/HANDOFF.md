# Handoff — 1 Sep 2026 (session 4)

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

`CLAUDE.md` was then **emptied by accident** in iteration 1's commit (`bccbde5`
deleted all 122 lines) and went unnoticed until iteration 2, because this file
tells you to read it first and it silently had nothing in it. It has been restored
from `263d7ea` and rewritten to match the Clean Architecture that iteration 1
actually built. If a session ever finds it empty again, `git show 263d7ea:CLAUDE.md`.

A backup copy of those, plus the recovered `apps/server/src/lib/security.ts`, is at
`C:\Users\JBZLB\convo_ai_keep\`.

### The three things that had to happen first - status

1. **`git init` and commit.** DONE 20 Aug 2026. Commit at every iteration boundary.
2. **Move off the OneDrive path.** DONE - now `C:\convo_ai` (11 chars, better than
   the `C:\dev\convo_ai` originally suggested). See *Windows path length* below.
3. **Stop relying on OneDrive sync.** DONE as of iteration 3 - the remote is
   `https://github.com/JohnBZ24/convo_ai.git` and `origin/main` is current.
   `gh` is still not installed; the remote was added by hand, so pushes use
   whatever credential helper git has. **Push at every iteration boundary** -
   iteration 2 sat committed-but-unpushed for a whole session, which is exactly
   the state this project was destroyed in once already.

## Build steps

Steps 0 and 1 are rebuilt and committed. The original steps 1-3 had been verified
against real OpenAI and real Postgres before the loss, so the design is proven
even where the code had to be rewritten.

| Step | What | State |
|------|------|-------|
| 0 | Repo safety: git, pnpm workspace, Turbo, Biome, tsconfig | **DONE** `263d7ea` |
| 1 | Backend foundation: Clean Architecture, health/ready, generated Swagger | **DONE** `bccbde5` |
| 2 | Better Auth bearer tokens + conversations CRUD | **DONE** |
| 3 | `packages/ai` + realtime token route + guarded tools endpoint | **DONE** |
| 4 | Expo app scaffold + UI shell + FIRST dev build on the Note 8 | **DONE** |
| 5 | WebRTC audio on a real device | Next |
| 6 | Transcripts, persistence, history screen | |
| 7 | Hardening + measured latency over USB | |

## State as of 20 Aug 2026 (sessions 2-3)

**Read `docs/DESIGN.md` for the design and `CLAUDE.md` for the architecture rules.**
Both are current. This section is only what a new session cannot infer from them.

Project now lives at **`C:\convo_ai`** (11 chars). The short path was NECESSARY for
the NDK/ninja 250-char limit but **not sufficient** - see *The Windows path problem*
under iteration 4; the actual fix was `nodeLinker: hoisted`. Git is initialised, and
the remote `https://github.com/JohnBZ24/convo_ai.git` is current. `gh` is still not
installed.

Architecture was adapted from the **`tanstack-start-ca`** Clean Architecture
boilerplate, kept for reference at `C:\coding	anstack-start-ca`. It uses
`createServerFn`; we deliberately use REST server routes instead. See CLAUDE.md.

### Things verified this session that save real time

- **The database "surviving" was a trap - now resolved. Read this before
  touching the schema.** The claim in earlier versions of this file, that the
  `convo` database was usable as-is, was only ever true of the *names* of the
  tables. In fact:
  - The Better Auth tables were built under **Better Auth 1.6** and lacked
    `account.issuer`, which 1.7 requires. Every sign-up returned 500 with
    *The field "issuer" does not exist in the "account" Drizzle schema*.
  - `conversations`, `turns`, `realtime_sessions` and `tool_invocations` were
    still the **destroyed project's** schema: `turns` had no `ended_at`, `role`
    and `status` were Postgres ENUMS rather than text, and there were telemetry
    columns (`audio_ms`, `ms_to_first_audio`, `interrupted`, `model`,
    `input_tokens`, `output_tokens`) that iteration 1 deliberately dropped.
  - Iteration 1's migration `0000` had therefore **never actually been applied**,
    and `drizzle.__drizzle_migrations` still held two rows from the dead project,
    so `db:migrate` would have tried to CREATE TABLE over live tables.

  Fixed in iteration 2: the four app tables were dumped to
  `C:\Users\JBZLB\convo_ai_keep\legacy-tables-20260820.sql` (23 rows, with the
  enum types prepended by hand so the file actually restores), dropped, and
  recreated from `0000`. The Better Auth tables were **kept** - they hold the real
  accounts - and migrated in place by `0002`. **The database and
  `packages/db/src/schema` now match exactly.** Verified column by column.
- **`pnpm db:baseline` is new** (`packages/db/src/scripts/baseline.ts`). It marks
  journal entries as applied without running them. Needed because drizzle applies
  every migration whose journal timestamp is newer than the newest ledger row -
  so a database that is already correct but has no matching ledger cannot be
  migrated at all. Only correct when the schema genuinely already matches.
- **Migration `0002` is hand-edited and must stay that way.** drizzle-kit emits
  `ADD COLUMN "issuer" text NOT NULL`, which cannot run against a populated
  table. It was rewritten as add-nullable / backfill `'local:' || provider_id` /
  SET NOT NULL. That backfill reproduces Better Auth's `createLocalAccountIssuer`
  exactly.
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

- **`pnpm db:check` / `db:migrate` / `db:generate` / `db:baseline` do NOT load
  `apps/server/.env`.** They read `DATABASE_URL` from the environment only, so from
  a bare shell `db:check` fails with *"DATABASE_URL is not set (it lives in
  apps/server/.env)"* even though the database is fine. Export it first. The comment
  in `drizzle.config.ts` claiming it is "loaded from there" is wrong.
- **The Postgres service cannot be stopped without elevation.** To test the
  readiness 503 path end to end, run `net stop postgresql-x64-18` from an
  elevated shell yourself. Otherwise point `DATABASE_URL` at a dead port, which
  exercises the same path.
- **Browser automation cannot reach this machine's localhost.** Chrome shows an
  error page (and sometimes an unrelated local app's 404) for `127.0.0.1:3000`
  while curl succeeds. Verify HTTP behaviour with curl, and ask the user to open
  pages themselves. Use `127.0.0.1`, not `localhost`.
- Something else of the user's occupies port 3000 intermittently (a Next.js app
  called "JuiceHedz"). Check `netstat` before assuming a server is yours - but
  the dev server from a PREVIOUS session may also still be on 3000. Confirm with
  `(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>').CommandLine` before
  killing anything.
- **`vite.config.ts` sets `strictPort: true`.** To run a second server whose logs
  you can actually read, use
  `pnpm --filter @convo/server exec vite dev --port 3001`. The first request
  after start takes ~40s to compile - give curl a generous `-m`.
- **pg_dump / psql live at `C:\Program Files\PostgreSQL\18\bin\`** and are not on
  PATH. `pg_dump -t <table>` does NOT follow the table's dependent enum types;
  add the `CREATE TYPE` statements by hand or the dump will not restore.

## What iteration 2 actually built

Structure follows iteration 1's Clean Architecture, not the flat `services/` +
`lib/` layout the pre-loss code used. `CLAUDE.md` has the full map; the parts
worth knowing before iteration 3:

- **Guards are TanStack middleware that can return a Response.** Returning one
  short-circuits the chain, so the handler never runs. `renderApiError` is
  exported from `define-handler.ts` so a guard's 401 is byte-identical to a
  handler's.
- **Middleware declares its own dependencies** —
  `createMiddleware().middleware([requestContextMiddleware])`. That is what TYPES
  `context.requestId` and `context.user` downstream, and TanStack's
  `flattenMiddlewares` dedupes by identity, so listing a middleware in a stack as
  well costs nothing. `rateLimitMiddleware` depends on `requireUserMiddleware`,
  which makes "keyed by the authenticated user" a compile-time fact.
- **The core throws `ApplicationError`, never `ApiError`.** `defineHandler` maps
  `not-found` → 404, `invalid-input` → 400, `conflict` → 409, and (added in
  iteration 3) `forbidden` → 403, `upstream-failure` → 502. A use case importing
  from `presentation/` would point the dependency arrow the wrong way.
- **`requiresAuth: true` does two jobs**: the Swagger padlock and the runtime 401.
  A route wired without its guard fails closed.
- **`scripts/exit-test.sh` runs the whole DESIGN exit test with curl.** Start the
  server, run it, read the statuses. It is the only thing that exercises real
  Postgres end to end - extend it in iteration 3 rather than starting over.
- **The rate limiter is built and tested.** `realtimeMintStack` and
  `toolCallStack` in `stacks.ts` were wired to their routes in iteration 3.
- **Auth operations in Swagger are HAND-WRITTEN** (`openapi/auth-operations.ts`),
  because Better Auth serves them from a bare splat and there is no spec to
  discover. They are the only hand-written part of the document, and
  `document.test.ts` excludes them by name so the exclusion stays visible.

### Traps hit while building it

- **postgres.js will not bind a `Date` inside a raw `sql` fragment.** It throws
  *The "string" argument must be of type string ... Received an instance of Date*,
  which Drizzle then wraps as "Failed query: ...". Bind
  `date.toISOString()` and keep the `::timestamptz` cast - the cast is
  load-bearing, not decoration. This broke page 2 of pagination only, so it did
  not show up until a cursor was actually used.
- **Drizzle hides the real error in `cause`.** `define-handler.ts` now logs the
  whole cause chain; without it the log says "Failed query" and nothing about why.
- Index routes match without a trailing slash: `routes/api/conversations/index.ts`
  serves `/api/conversations`. Use `$id/index.ts` + `$id/turns.ts`, NOT
  `$id.ts` + `$id.turns.ts` - the dotted form makes `$id` a parent route, whose
  middleware would then run a second time for `turns`.

## What iteration 3 actually built

`packages/ai`, `POST /api/realtime/token`, `POST /api/tools/:name`. Every claim
below was checked against the LIVE OpenAI API and the running server on
25 Aug 2026, not against my knowledge cutoff.

### The OpenAI realtime API, verified live

- **Model ids that exist right now** (`GET /v1/models`, filtered): `gpt-realtime`,
  `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-2.1`,
  `gpt-realtime-2.1-mini`, `gpt-realtime-mini`, `gpt-realtime-2025-08-28`,
  `gpt-realtime-translate`, `gpt-realtime-whisper`. **`.env` pins
  `gpt-realtime-2`.** The mini variant for cheap dev work is
  `gpt-realtime-2.1-mini` — one `.env` line, no redeploy.
- **`POST /v1/realtime/client_secrets` returns** `{ value: "ek_...", expires_at:
  <epoch SECONDS>, session: { id: "sess_...", model, audio: { output: { voice } },
  ... } }`. `expires_at` is seconds, not millis — the minter multiplies by 1000.
- **`expires_after` is `{ anchor: "created_at", seconds: N }` with N in 10..7200**,
  defaulting to 600. Those bounds are exported from `@convo/ai` and imported by
  `config/env.ts`, so the env validation cannot drift from what the API enforces.
- **The default voice is already `marin`** and the default turn detection is
  already `server_vad` with the exact values in `DEFAULT_TURN_DETECTION`. They
  are restated explicitly anyway, so an upstream default change cannot silently
  alter how the app feels.
- **`audio.input.transcription`** is what produces the USER's side of the
  transcript. Without it only the assistant's half could ever be stored — worth
  knowing before iteration 6. `gpt-4o-mini-transcribe` accepted.
- **`noise_reduction: { type: "near_field" }`** accepted; the API's own default
  is `null`.
- The whole generated body was POSTed for real: 200, a live `ek_`, TTL exactly
  60s, both tools echoed back. `packages/ai/src/realtime/session.test.ts` pins
  that shape, so it is a regression test for a request known to work.

### Design decisions worth not relitigating

- **`packages/ai` declares, the server performs.** `buildClientSecretRequest` is
  a pure function returning the request body; `OpenAiRealtimeMinter` owns only
  transport (URL, timeout, failure translation). That split is what lets the
  mobile app import the same tool declarations it will be asked to execute.
- **One Zod schema per tool does three jobs**: it generates the JSON Schema
  OpenAI is given, it validates the arguments that come back, and it types the
  handler. A tool whose declared and accepted parameters could disagree would
  fail mid-sentence on a device.
- **`z.toJSONSchema` emits `$schema`, which must be STRIPPED** for OpenAI tool
  parameters, and `additionalProperties: false` must be ADDED so the model does
  not invent fields. See `toParameterSchema`.
- **The idempotency key is `${userId}:${callId}`, not `callId`.**
  `tool_invocations.idempotency_key` is globally unique but OpenAI's `call_id`
  is only unique within one session — unscoped, two users could collide and one
  would silently be told "replayed".
- **The key deduplicates the AUDIT ROW, not the work.** A retried tool call runs
  again and returns a fresh result with `replayed: true`. That is safe because
  both current tools are READS. A mutating privileged tool would need to cache
  its own result first — stated on `ToolHandler` so it cannot be missed.
- **Search returns titles and dates, never transcripts.** Returning what was
  said would put a user's whole history one prompt injection away and flood the
  model's context to answer "which conversation was that?".
- **`escapeLikePattern` neutralises `%` and `_`** in the model's query. Without
  it a query of `"%"` matches everything the user has — verified in the exit
  test, which now sends exactly that and expects zero matches.

### Traps hit while building it

- **The rate limit is consumed BEFORE ownership is checked**, because the
  limiter is middleware and the handler runs after it. So a mint for someone
  else's conversation returns 404 *and* costs the caller one of their 20. That
  is correct — probing must cost the prober — but it surprised the exit test,
  which now expects 19 successes rather than 20.
- **`routeTree.gen.ts` must be regenerated before `pnpm typecheck` passes.** A
  new route file fails with *Argument of type '"/api/tools/$name"' is not
  assignable to parameter of type 'keyof FileRoutesByPath'* until the TanStack
  plugin has run. Start the dev server once; it regenerates on boot.
- **This machine's Bash tool mangles backslashes inside heredocs.** A
  `cat > file <<'EOF'` containing `/\\/g` lands on disk as `/\/g`, which is an
  invalid regex, and the same happens through a Python heredoc. Anything with a
  backslash in it must be written with an editor tool, not a shell heredoc. This
  silently corrupted `escapeLikePattern` twice before it was noticed.
- **`vi.fn(async () => ...)` types its call tuple as `[]`.** Every assertion
  about the request that was sent then fails to compile with *Tuple type '[]' of
  length '0' has no element at index '0'*. Declare the parameters on the stub
  even when it ignores them.

## What iteration 4 actually built

`apps/mobile`: the Expo app, the UI shell, and a dev build **installed and running
on the Note 8**. All four exit criteria were checked on the device, not inferred:

- app installs and launches — `BUILD SUCCESSFUL in 5m 24s`, 85MB debug APK
- sign-in works against the real server — form → `set-auth-token` → redirect
- mock amplitude visibly pulses the orb — measured 356 / 346 / 344 px across frames
- the sidebar swipe is smooth

Bundle Mode is confirmed ON DEVICE, which is the whole reason this iteration came
before the audio work:

```
LOG [Worklets] Bundle mode initialization: Downloaded the bundle for Worklet Runtimes.
Android Bundled 199ms node_modules/expo-router/entry.js (1 module)  <- incremental, watcher healthy
```

Tests: **182** — 119 server, 28 shared, 24 ai, 8 db, **63 mobile**.

### The Bundle Mode six things — CORRECTED

Still six, but two entries were wrong about *why*, and one cost most of a session.
Read this before touching `metro.config.js`.

1. `babel-preset-expo` with **both** `worklets: false` and `reanimated: false`. Unchanged.
2. Add the plugin manually with `bundleMode: true` and
   `importForwarding: { moduleNames: ['remend'] }`. Unchanged.
3. `worklets.staticFeatureFlags.BUNDLE_MODE_ENABLED: true` — in **`package.json`**.
4. `expo.autolinking.android.buildFromSource: ["react-native-worklets"]` — also in
   **`package.json`, NOT `app.json`**. Putting `autolinking` or `install` under the
   `expo` key of `app.json` fails config-schema validation; `expo-doctor` catches it.
5. **The two metro patches are GONE and are not needed.**
   `react-native-worklets@0.10.1` ships no `bundleMode/patches` directory, and
   installed metro is 0.84.5 / 0.87.0, not the 0.84.4 the old note pinned. The
   package instead exports `getBundleModeMetroConfig(config)`, labelled *"Use in
   Expo projects"*, which installs the resolver, the module-id factory and
   inlineRequires itself. `metro.config.js` is now ~15 lines.
6. The `.worklets` directory must be **created AND WATCHED**. Creating it is not
   enough — the earlier note said "watch folder" and it was read as "make the
   folder". Babel writes each worklet DURING the transform, so the files do not
   exist when Metro builds its file map, and anything outside a watch root is
   unknown to it:

   ```
   Error: Failed to get the SHA-1 for: .../.worklets/16897143079449.js
   ```

   ```js
   config.watchFolders = [...(config.watchFolders ?? []), workletsDir];
   ```

   This is the ONE legitimate `watchFolders` entry. The "do NOT add watchFolders"
   rule still stands — it is about the monorepo packages, not this.

**`expo export` CANNOT validate Bundle Mode.** It extracted 530 worklets and
bundled 2389 modules while the device path was completely broken, because a
one-shot export never uses the file watcher. Only a dev-server bundle to a real
device proves it. Do not accept an export as evidence again.

### The Windows path problem — SOLVED, and the old fix does not work

Moving to `C:\convo_ai` was necessary but **not sufficient**. The NDK compiles
worklets from wherever the package physically lives, and `buildFromSource` puts
that inside pnpm's virtual store. CMake mirrors the SOURCE path into the OBJECT
path, so the prefix is counted twice:

```
object dir 191 + object file 198 = 389   vs CMAKE_OBJECT_PATH_MAX 250
ninja: error: manifest 'build.ninja' still dirty after 100 tries
```

**Shortening `virtualStoreDir` cannot fix this at any setting.** It is arithmetic:
`total = 2 x prefix + 137`, `prefix = 66 + <store dir name>`, so a zero-length
store name still gives 269, and a zero-length name at `C:\c` gives 255. The old
note recommending `virtualStoreDir` was wrong.

**The fix is `nodeLinker: hoisted`** in `pnpm-workspace.yaml`, putting worklets at
`node_modules/react-native-worklets` → **229**, under the limit. `pnpm verify`
passed straight afterwards, so nothing was relying on strict linking.

Switching it is fiddly, and every step fails quietly:

- **pnpm 11 does not read `node-linker` from `.npmrc`.** `pnpm config get
  node-linker` returns `undefined` and installs silently keep the old layout.
  Settings live in `pnpm-workspace.yaml` (camelCase `nodeLinker`), like
  `allowBuilds`. Always confirm with `pnpm config get`.
- **`pnpm install` in a non-interactive shell HANGS.** Changing the linker makes
  pnpm prompt to purge `node_modules`; with no stdin it waits forever and prints
  nothing. Use `--config.confirmModulesPurge=false`.
- **pnpm will not migrate an existing `node_modules`.** `install`, `install
  --force`, and deleting `.modules.yaml` all no-op with "Already up to date".
- **`node_modules` had to go — it was RENAMED, never deleted.** A scan found
  **2552 reparse points, 10 pointing at real source** (`@convo/mobile` →
  `apps/mobile`, `@convo/server` → `apps/server`, plus the three packages). A
  recursive delete following those is precisely the August incident.
  `Rename-Item` touches one directory entry, cannot traverse into a link target,
  and is reversible. Source file counts were compared before and after.
  `node_modules.old/` is gitignored; delete it explicitly when done with it.
- **Switching the linker invalidates a prebuilt `android/`.** Gradle fails with
  *"Configuring project ':react-native-enriched-markdown' without an existing
  directory"*, naming a `.pnpm` path that no longer exists. Re-run
  `expo prebuild --platform android --clean`. It reads like the hoist failed; it
  is only stale codegen.

### Traps hit while building it

- **`remend` is a required peer of `react-native-streamdown` and nothing installs
  it.** The app fails at import without it. It is ESM-only (`import`-condition
  exports), which is exactly why `importForwarding: { moduleNames: ['remend'] }`
  exists.
- **Omitting the `expo-splash-screen` plugin does NOT remove its resource
  reference.** `styles.xml` points at `@drawable/splashscreen_logo` as soon as the
  package is autolinked, so dropping the plugin block leaves a dangling reference
  and resource linking fails. The plugin must be CONFIGURED WITH AN IMAGE.
  `assets/splash.png` is generated — the dormant orb, so launch does not jump.
- **`expo run:android --device <serial>` does not accept a serial.** With one
  device attached, omit the flag.
- **`npx expo install` exits non-zero under pnpm 11** whenever a package's build
  script is gated — reporting failure for an install that succeeded.
- **Expo buffers ALL its output until it exits.** A failing 15-minute build looks
  like an empty log. Watch Gradle instead:
  `C:\Users\JBZLB\.gradle\daemon\9.3.1\daemon-*.out.log`. That directory reuses
  logs across days, so newest-by-mtime can be a stale file — check contents, not
  the timestamp.
- **`expo-status-bar` lost `backgroundColor` in SDK 57**, same reason as
  `edgeToEdgeEnabled`. The root view supplies the colour.
- **`expo-constants` drags `react-native`'s Flow entry into tests**, which no
  runner can parse. `process.env.EXPO_PUBLIC_*` is the idiomatic SDK 50+ form and
  keeps the API client testable in plain Node.
- **A worklet created by a HOT RELOAD is not in the shipped bundle**: *"[Worklets]
  Unable to resolve worklet with hash ..."* until Metro restarts. Avoid adding
  worklets casually; `.runOnJS(true)` sidesteps it.
- **`dumpsys mCurrentFocus` is unreliable on this Note 8** — it reports a
  background app while ours is visibly on screen. Classify from screenshots.
- **`KEYCODE_BACK` exits the app rather than closing the drawer.** Close it by
  tapping the scrim. Two measurement runs were invalidated by this before it was
  noticed.
- **SecureStore survives `pm clear` and an APK reinstall.** A leftover token made
  the auth guard report `signed-in` and skip the sign-in screen, which looked like
  a broken redirect. Only a full `adb uninstall` gives a clean auth state.

### The sidebar button — measured, not guessed

The menu button dropped presses and felt laggy while the swipe felt perfect. Three
fixes were attempted; only the third was the cause, found by logging timestamps
rather than reasoning:

- **`edgeWidth` was the bug.** The drawer reserves that strip for its edge-swipe
  pan; the button sits at x 8..56dp, so at 48 they overlapped almost entirely and
  the pan won the touch. Measured **8 presses / 10 taps at 48, no drops at 20**. A
  swipe starts at the screen edge anyway, so 20dp costs the gesture nothing.
- **The ~293ms open is the drawer's spring, not JS.** `openDrawer()` returns in
  3–29ms. **Do not try to speed it up**: `mass = 1/animationSpeed`, so raising it
  pushes the damping ratio past 1 and the spring settles SLOWER —
  `animationSpeed: 1.25` measured 532ms and `2` measured 430ms against the
  default's 293ms. The default is slightly underdamped and reaches Reanimated's
  finished threshold soonest. Re-measured to rule out drift.
- Kept anyway, both genuine improvements: the render fixes (per-field Zustand
  selectors, `memo` on `Sidebar`, stable props, `useCallback` on
  `renderNavigationView` — it was rebuilding the whole drawer panel every render)
  and `BorderlessButton` with a 48dp target, a native gesture-handler button
  rather than RN's `Pressable`.

### Where iteration 5 starts

The shell is real and on the device; audio is the only missing half.

- `useMockAmplitude(...)` in `src/app/index.tsx` is the ONE line to replace. The
  shared value in `features/call/amplitude.ts` is already what the orb reads, so
  the swap is a source change, not a rewrite.
- The call machine in `features/call/call-store.ts` already has the phases; the
  `setTimeout`s in `index.tsx` that fake `connecting` and `ending` become WebRTC
  lifecycle events.
- `SCRIPTED_LINES` in `index.tsx` is the placeholder transcript — delete it.
- `POST /api/realtime/token` is live and returns `callsUrl`; the device POSTs its
  SDP offer there. Mint TTL is 60s but this machine's clock is ~25s fast, so the
  credential looks like ~34s. Fix the machine's time sync before debugging WebRTC.

## The API as built

All of it exists now. Kept as the one-page map of the surface.

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

Every row is DONE as of iteration 3.

Still outstanding from the pre-loss code: `security.ts` (recovered — see the
backup folder) was never reinstated, because iteration 1 wrote
`infrastructure/security/headers.ts` fresh instead. Nothing depends on it and
the new file covers CORS + the baseline headers, but nobody has diffed the two
to see whether the recovered one had anything extra. Worth ten minutes.

**`packages/db`** — four tables: `conversations` (denormalised `turnCount` /
`lastTurnAt`), `turns` (**unique index on `(conversationId, seq)`** — this is what
makes turn replay idempotent; `appendTurn` uses `onConflictDoNothing` in a
transaction then bumps counters), `realtime_sessions`, `tool_invocations`
(`idempotencyKey` unique). Plus the Better Auth tables. **Every repository function
takes `userId` and puts it in the WHERE clause** — that is what makes a cross-user
read return 404 rather than 403.

**`packages/ai`** — declaration only, never executes. `CLIENT_SECRET_TTL_SECONDS = 60`,
`MAX_OUTPUT_TOKENS = 1200`, `DEFAULT_TURN_DETECTION` (server_vad, barge-in on),
`DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1"`, `DEFAULT_REALTIME_VOICE = "marin"` —
all overridable from the environment, and `.env` currently pins
`REALTIME_MODEL=gpt-realtime-2`. `buildClientSecretRequest()` is the pure function
that produces the credential request body. Two tools: `get_current_time` (device)
and `search_conversations` (privileged). Imported by the server AND, later, by the
mobile app — so it must never gain a server-only dependency.

**`packages/shared`** — Zod contracts. There is no `RouteDoc` registry any more:
the document is discovered from the controllers with `import.meta.glob`, so there
is no registration step to forget.

**Tests** — 179 passing after iteration 3: 119 server, 28 shared, 24 ai, 8 db.
(93 after iteration 2.) The successor to the old `openapi.registry.test.ts` is
`tests/presentation/openapi/document.test.ts` — it still walks `src/routes/api`
ON DISK and fails if a route is undocumented or a document entry has no route.
Keep that property when adding endpoints.

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

Everything below was re-confirmed against the iteration-2 server on 20 Aug.

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

- **Rate limiting is in-process memory.** With more than one server instance the
  effective limit becomes `limit × instances`. The `RateLimiter` port exists
  precisely so this is a new class in `infrastructure/rate-limiting` and one line
  in the container - move to Redis before scaling out.
- **Sessions are never pruned.** Better Auth writes a row per sign-in with a
  30-day expiry and nothing deletes the expired ones. Harmless at this size;
  worth a job before this is more than a demo.
- **No integration test touches Postgres.** Every test runs against the in-memory
  repository, so the transaction in `appendTurn`, the row-value keyset predicate
  and now the `EXISTS`-based search are covered by the curl exit test and by
  nothing automated. That is what let the `Date`-binding bug reach a running
  server. A single suite against a throwaway database would close it, and it is
  the highest-value testing work left.
- **`search_conversations` uses `ILIKE`, which cannot use an index.** It scans
  the calling user's turns. Correct and fast enough at demo size; the fix when
  it matters is a `tsvector` column with a GIN index — a migration and a change
  to one repository method.
- **Tool idempotency deduplicates the AUDIT ROW, not the work.** A retried call
  re-executes and answers `replayed: true`. Safe because both tools are reads; a
  mutating privileged tool would have to cache its own result first. Stated on
  the `ToolHandler` port so it cannot be missed.
- **Only one privileged tool has a handler.** A tool declared privileged with no
  handler is a 500 by design, and two tests assert it — one that the gap fails
  loudly, one that the gap does not currently exist — so this cannot rot silently.
- **The tool handler map is an object literal in `container.ts`.** Fine at one
  entry; split it into a `infrastructure/tools/` module once there are more than
  about three.
- **`get_current_time` has no device implementation yet.** The server correctly
  refuses it with 403, but nothing runs it — that is iteration 5/6 work on the
  phone. Until then the model will call it and get nothing useful.

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
