# Handoff — 3 Sep 2026 (session 5)

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
| 5 | WebRTC audio on a real device | **BUILT + 2 device bugs fixed 3 Sep** — self-interruption test still open |
| 6 | Transcripts, persistence, history screen | **DONE 3 Sep, verified on the Note 8** - plus rename, delete and search |
| 7 | Hardening + measured latency over USB | Next |

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
- **Vite binds IPv6 only by default.** `vite.config.ts` pins `server.host`. Do NOT
  remove it: `adb reverse` forwards to the host's IPv4 loopback, and a phone on
  Wi-Fi reaches the LAN address - a `::1`-only bind refuses both. It was
  `"127.0.0.1"` through iteration 4; iteration 5 widened it to `true` so the demo
  can run over Wi-Fi. See *Running the device over Wi-Fi* below.
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

### What iteration 5 actually built

Real WebRTC audio on the Note 8. The call connects, the data channel opens, the
orb follows the actual microphone, and audio comes out of the **loudspeaker** in
`MODE_IN_COMMUNICATION`. Three dependencies, seven new files under
`features/call/`, three API modules, 48 new tests.

Verified on the device, not inferred:

```
LOG rn-webrtc:pc:DEBUG 0 ctor +0ms
LOG rn-webrtc:pc:DEBUG 0 addTrack +4ms
LOG rn-webrtc:pc:DEBUG 0 createOffer OK +11ms
LOG rn-webrtc:pc:DEBUG 0 setLocalDescription OK +48ms
LOG rn-webrtc:pc:DEBUG 0 setRemoteDescription +4s      <- ICE wait + mint + SDP POST
LOG rn-webrtc:pc:DEBUG 0 ontrack +178ms                <- remote audio arrived
LOG [call] realtime credential minted {"sessionId": "sess_EJHCf0ilLMdjBhY9R67CQ", ...}
LOG [Worklets] Bundle mode initialization: Downloaded the bundle for Worklet Runtimes.
Android Bundled 14118ms expo-router/entry.js (2621 modules)   <- was 2389
```

`dumpsys audio`, during the call:

```
setMode(MODE_IN_COMMUNICATION) from package=com.abiroot.convoai   14:44:27
rec start ... src:VOICE_COMMUNICATION pack:com.abiroot.convoai    14:44:32
Devices: speaker
setMode(MODE_NORMAL) from package=com.abiroot.convoai             14:46:04  <- hang-up
```

**The five-second gap between `setMode` and `rec start` is the point.** The audio
mode is set before `getUserMedia`, and the mode the mic is OPENED in is what
engages the hardware echo canceller. Reverse those two and the model hears itself
through the loudspeaker and cuts itself off.

Postgres afterwards: the conversation is `ended` with an `ended_at`, and the
`realtime_sessions` audit row points at it with the right model and voice.
`turn_count` is 0 — turn persistence is iteration 6, on purpose.

Build: `BUILD SUCCESSFUL in 6m 20s`, 96.8MB debug APK (was 85MB — that is
`libwebrtc`). Tests: **59 mobile** (see the count correction below), 119 server.

### Session 5 (3 Sep 2026): two device-only bugs, both fixed

Nothing was built this session. The app was run end to end on the Note 8 for the
first time since iteration 5, and two bugs fell out that **no server-side test
or curl probe can reach**. Both are fixed and verified; the pattern they share is
worth more than either fix.

**The shared pattern: curl is not a phone.** Both bugs live in headers curl never
sends and behaviour curl never has. Every probe in this file's "Auth — probed
against the running server" section passed against a server that was, at that
moment, broken for the only client that matters. When something works from the
laptop and fails on the device, stop re-testing from the laptop.

#### 1. Every auth POST 403s on the device — `MISSING_OR_NULL_ORIGIN`

Symptom: sign-in shows "Missing or null Origin" on the form, which reads like a
rejected password. Sign-up and sign-out fail the same way. `get-session` keeps
working, so the app looks half alive.

`auth.ts` claimed "the mobile app has no cookie jar". **That is false on
Android.** React Native's fetch runs on OkHttp, which keeps a native cookie jar
and faithfully replays the `better-auth.session_token` cookie Better Auth itself
set at sign-in. React Native sends no `Origin` to go with it. Better Auth runs
its CSRF origin check **only when a cookie is present**
(`origin-check.mjs`: `useCookies = headers.has("cookie")`), so cookie-without-origin
is a 403. Measured on the wire:

| client | origin | cookie | result |
|---|---|---|---|
| device `okhttp/4.9.2` | `null` | PRESENT | **403** |
| curl | absent | absent | 200 |
| curl | `convoai://` | PRESENT | 200 |

It is self-arming: the sign-in that succeeds is what stores the cookie that
breaks the next one. `adb shell pm clear` buys exactly one working sign-in.

Fix: `apps/server/src/infrastructure/auth/native-cookie.ts` — `stripPhantomCookie()`,
applied in `routes/api/auth/$.ts`. It drops the cookie **only when nothing
announces a browser** (no `Origin`, `Referer` or `Sec-Fetch-Site`). Removing the
credential removes the CSRF surface the check exists to protect; a real browser
always sends one of those three on a state-changing request, keeps its cookie,
and keeps full protection. Verified after the fix: sign-in/sign-up/sign-out all
200, `cookie + origin: https://evil.example` still 403 `INVALID_ORIGIN`, wrong
password still 401. 7 tests.

**Do not replace this with `advanced.disableCSRFCheck`.** It is the obvious lever
and the wrong one — Better Auth's own docs call it a security risk, and it
disables origin validation, Fetch Metadata checks and cross-site navigation
blocking for every caller.

Two dead ends recorded so they are not retried:

- **Sending `Origin` from the client does not work and was reverted.** `Origin` is
  a forbidden header name in the fetch spec. A control header (`x-app-origin`)
  proved the point differently — see the next paragraph.
- **The phone runs a RELEASE build, so no JS edit reaches it.** Hours can go into
  "why did my fix not apply". Metro logging no `Android Bundled` line after an
  app restart is the tell. This is by design (see *The demo needs a RELEASE
  build*) — but it means **a mobile fix cannot be tested without a rebuild**, and
  a server fix can be tested immediately.

#### 2. The call came out of the EARPIECE, not the loudspeaker

Iteration 5 recorded `Devices: speaker` as verified. **That was wrong** — the
force call was bailing, and the sample did not prove what it looked like.

`beginCallAudio()` passed `auto: false` to `InCallManager.start`, chosen to stop
the proximity sensor blanking the screen. It does that. It also does something
the JS side gives no hint of: `auto` sets `automatic`, and `updateAudioRoute()`
returns immediately when `automatic` is false. In `start()`, for `media: "audio"`:

```
setSpeakerphoneOn(false)     // defaultSpeakerOn is false for audio
audioDevices.clear()         // the available-device set is emptied
updateAudioRoute()           // no-op, because automatic == false  <- never refills it
```

So when `setForceSpeakerphoneOn(true)` calls `selectAudioDevice(SPEAKER_PHONE)`,
it hits `if (!audioDevices.contains(device)) return;` against an empty set and
bails. The last word on routing stays that `setSpeakerphoneOn(false)`.

Fix: add **`InCallManager.setSpeakerphoneOn(true)`** after the force flag. It
calls `AudioManager.setSpeakerphoneOn` directly with no device-set check, so it
works with `automatic` false — and since nothing re-routes afterwards, it holds
for the whole call. `setForceSpeakerphoneOn(true)` is kept because it sets
`forceSpeakerOn = 1`, which is what the state machine reads if anything ever does
re-evaluate.

Caught in the act on the device, on the fixed build:

```
11:09:07.940  setModeInt(mode=3)  = MODE_IN_COMMUNICATION   <- before the mic; AEC intact
11:09:08.089  setForceSpeakerphoneOn() flag: 1
11:09:08.089  E/InCallManager: Can not select SPEAKER_PHONE from available []   <- the bug
11:09:08.089  setSpeakerphoneOn(): true                     <- the fix, and it lands
11:09:10.336  AudioTrack usage=USAGE_VOICE_COMMUNICATION state=started
11:09:11.292  WebRtcAudioRecordExternal: audio source=VOICE_COMMUNICATION
11:09:21.622  setModeInt(mode=0)  = MODE_NORMAL             <- clean teardown
```

That `E/InCallManager` line is the one to grep for if routing regresses. It is an
**error-level log that changes nothing observable** except which speaker plays —
easy to scroll past.

#### Environment, as of this session

- Release APK rebuilt and installed 3 Sep 11:08. `BUILD SUCCESSFUL in 4m 32s`.
- LAN address is `192.168.10.59`; `apps/mobile/.env` matches. DHCP — recheck it.
- `adb` is not on PATH: `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe`.
- `JAVA_HOME` is `C:UsersJBZLBjdksjdk-17.0.20+8` (JDK 17, as AGP needs) even
  though `java` on PATH is 25. Gradle reads `JAVA_HOME`, so builds work as-is.
- Postgres is a native service on 5432, **not** Docker — Docker Desktop is not
  running and `docker ps` fails. `GET /api/ready` is the check that matters.
- A usable test account exists: `smoke-test@example.com` / `smoke-password-123`.
  `claude-probe@example.com` exists with an unknown password.

#### What is NOT yet verified

The exit test is *"say hello, hear the reply through the loudspeaker, and confirm
the model does not interrupt itself"* — and that needs a person to speak. An agent
driving `adb` can tap the orb and read `dumpsys`, but it cannot make a sound in the
room. Status after session 5:

1. ~~The model hears speech and replies out loud.~~ **CLOSED 3 Sep.** A real
   conversation ran on the device: "Hello." → "Hello! What’s on your mind today?"
2. It does **not** cut itself off while its own voice is in the room. **STILL
   OPEN, and it has never actually been under test.** Until 3 Sep the audio came
   out of the EARPIECE (see the speaker bug above), so the model’s voice was never
   in the room to be heard back. Every "no self-interruption" observation before
   that build is void — the loudspeaker was not playing. This is the first build
   on which the test means anything, and it is the thing most worth doing next.
3. Tool calls end to end - "what time is it" (device) and "what did we talk about
   before" (proxied). **STILL OPEN**, untouched this session.

Everything up to the point where a human has to speak is verified above.

### What iteration 6 actually built

Turn persistence, a real sidebar, and the three things a person does to a chat:
open it, rename it, delete it - plus search. Verified on the Note 8 at 12:26 on
3 Sep, not inferred.

**`POST /api/conversations/:id/turns` finally has a caller.** It existed since
iteration 2 and nothing had ever called it; every conversation in Postgres read
`turn_count = 0, title = null`. The device now posts each line as it completes,
and the first user turn names the conversation server-side.

#### `seq` is a POSITION, not a counter - and that is the whole design

`features/call/turn-recorder.ts` assigns `seq` from the line's slot index in the
assembler's order, 1-based. Not from a counter, and this is not a stylistic
choice:

- Input transcription is ASYNCHRONOUS. The model's reply finishes before the
  user's own words are transcribed - that is why `input_audio_buffer.committed`
  is handled at all. A counter incremented on each `*.transcript.done` would
  therefore number the REPLY 1 and the QUESTION 2, and the stored conversation
  would read backwards. `turn-recorder.test.ts` asserts exactly this ordering.
- A position is STABLE. The same line always computes the same seq, so a retry
  collides with the unique index on `(conversation_id, seq)` and is answered
  `replayed: true` rather than storing the sentence twice. A counter cannot do
  that: whether it was incremented before a failed request is precisely what a
  dropped response cannot tell you.

The recorder posts serially with a `[500, 2000, 5000]ms` backoff, dedupes by seq
locally, and NEVER throws - a turn that will not store is a missing line in a
history screen, while an unhandled rejection mid-sentence is a crash. Empty and
whitespace-only transcripts are dropped before they are posted: the VAD commits
coughs and doors, and the server 422s an empty `text`, so posting one would burn
three retries to store a blank row.

#### PATCH carries two intents, as a union

`PATCH /api/conversations/{id}` now accepts `{ title }` OR `{ status: "ended" }`,
declared as `z.union([renameConversationBody, endConversationBody])` rather than
one object with two optional fields. The reason is the published document: a
union makes both intents visible as named `$defs` under `anyOf`, and `{}` is
rejected BY THE SCHEMA - a `.refine()` would enforce it at runtime and vanish
from the OpenAPI output. Rename is listed first, so a body carrying both is read
as a rename; nothing sends both, the order is there so the answer is defined.

The controller branches on `"title" in body`. That is the one branch in
`conversations.controller.ts`, and it is deciding what the REQUEST MEANS, which
is presentation's job - not what should happen, which is the use case's.

#### DELETE erases the words, not the audit trail

`DELETE /api/conversations/{id}` gives 204, and a second one gives **404**.
Deliberately NOT idempotent, unlike `end`: ending is fired by the device as a
call tears down and must survive a retry, while deleting is a person tapping once
and by the second attempt the row genuinely is gone.

Turns go by `ON DELETE CASCADE`, already declared on the turns table. The
`realtime_sessions` and `tool_invocations` rows are `ON DELETE SET NULL` and
SURVIVE - deleting a chat is the user erasing their words, not erasing the record
that a session happened and what tools ran.

#### Search: one endpoint with a filter, not a second endpoint

`GET /api/conversations?q=...`. The term joins the SAME `WHERE` clause as the
keyset cursor, so a search pages exactly like an unfiltered list.

- **Filtering a fetched page in JS would break "load more" outright.** Thirty
  rows might hold two matches and the rest would be unreachable. Verified live:
  `q=the&limit=1` returned three single-row pages and correctly skipped three
  non-matching conversations in between.
- **It searches TURN TEXT, which is the entire reason it is server-side.** The
  device has titles; the words only exist in Postgres. Proved on the phone: the
  conversation titled `"Hello."` is returned by searching `today`, because the
  assistant said "What can I do for you today?". A client-side title filter shows
  "No chats match that" for that query.
- **`%` matches NOTHING.** `escapeLikePattern` now guards the user's box as well
  as the model's tool, and an empty `q` is a 422 rather than a silent "match
  all" - the same failure this API already refuses on the model's side.

`matchesQuery()` in `drizzle-conversation.repository.ts` is shared by `list` and
by the `search_conversations` tool. Written twice they would drift, and the
symptom is nasty: "the assistant cannot find a conversation I can see."

#### The drawer moved, and it was not tidiness

`components/sidebar.tsx` is now ONLY the gesture shell. The contents live in
`features/conversations/conversation-list.tsx`, which fetches its own data.

The voice screen re-renders on every `activity` change - several times a
sentence. With the search term or the query result held up there, every keystroke
and every refetch would reconcile the whole drawer panel behind the next tap,
which is the exact problem iteration 4 measured and fixed with `edgeWidth` and
memoisation. `renderNavigationView` now depends on three callbacks that never
change.

Other things in there worth not re-deriving:

- **`useMemo` on the flattened page list is load-bearing**, not a
  micro-optimisation: `pages.flatMap()` returns a fresh array identity per
  render and would defeat `memo(Sidebar)` on its own.
- **`RowEditor` is a separate component so it MOUNTS when renaming starts.** A
  `useState` initialiser runs once per mount, so a draft held by the
  always-mounted row would hold whatever the title was when the drawer first
  rendered - empty, for a conversation untitled until its first turn landed.
- **Rename and delete use `setQueriesData`, plural.** Each search term is its own
  cache entry under the `["conversations","list"]` prefix, so a singular
  `setQueryData` on the prefix matches NONE of them and the row keeps its old
  title in whichever list the user was not looking at.
- **Submitting a rename also blurs it**, so both handlers fire; `RowEditor` has a
  `committed` ref that makes the second a no-op rather than a second PATCH.

#### `URLSearchParams` is a stub in React Native

Building the list query string by hand is deliberate. RN's polyfill throws "not
implemented" for `set`, `get` and `delete`, and has no `size`. Node has the real
thing, so a test written against it passes while the device throws - the same
"curl is not a phone" trap as the two bugs in session 5. Search terms go through
`encodeURIComponent`, or an `&` in what someone typed rewrites the query string.

#### Expo bundles the JS at the START of a release build

Two APKs were built before this was noticed. `expo run:android --variant release`
writes the bundle in the first ~30 seconds and Gradle packages it minutes later,
so **any source edited after the build starts is silently absent from the APK**
while the build still reports success. The log line to check is
`Android Bundled ... Writing bundle output to: ...index.android.bundle` - compare
its time against `stat` on the source, not the APK's mtime.

`--no-bundler` does NOT stop Metro starting; the run still prints
`Waiting on http://localhost:8081` and tries a dev-client deep link. Harmless for
a release build, which loads its embedded bundle, but it is not evidence of
anything.

#### Verified on the device, 3 Sep 12:26-12:28

Release APK bundled 12:04, installed 12:25:51.

```
drawer            "New chat", a "Search chats" box, one row: "Hello."
                  <- a DERIVED title, so a turn was persisted and named it
q="hello"         row stays          (case-insensitive)
q="hellozzq"      "No chats match that"
cleared           row returns
q="today"         row stays          <- title has no "today"; the TURN does
```

Postgres afterwards, for that conversation:

```
baroud3@gmail.com  "Hello."  1 user      | Hello.
baroud3@gmail.com  "Hello."  2 assistant | Hi there! What can I do for you today?
```

Server surface, probed live against real Postgres before the app was touched:

```
POST /turns seq 1            201
POST /turns seq 1 again      200   (replayed, turn_count unmoved)
PATCH {"title":"  x  "}      200   stored trimmed
PATCH {}                     422
PATCH {"status":"ended"}     200
DELETE                       204
DELETE again                 404
GET after delete             404
q=dentist                    title match
q=boiler                     TURN match (title was "hello there")
q=%                          no rows
q= (empty)                   422
q=101 chars                  422
```

Tests after iteration 6: **142 server, 78 mobile, 41 shared, 24 ai, 8 db**.

### The demo runbook

Cable is needed ONCE to install. After that the phone is on Wi-Fi only.

```bash
# 1. check the laptop's LAN address - it is a DHCP lease and does move
ipconfig                       # Wi-Fi adapter IPv4

# 2. if it changed, update apps/mobile/.env and rebuild (step 4)
#    EXPO_PUBLIC_API_BASE_URL=http://<that address>:3000

# 3. API server - must stay running, it holds the OPENAI_API_KEY
pnpm server

# 4. install the RELEASE build (cable plugged in, one time)
pnpm --filter @convo/mobile exec expo run:android --variant release --no-bundler
```

Then unplug. The app starts from its own icon with no Metro and no `adb`.

What still has to be true during the demo:

- laptop and phone on the same Wi-Fi, laptop awake
- `pnpm server` running, and Postgres up (`GET /api/ready` says so)
- the OpenAI dashboard usage limit set - a live session bills per minute

### Running the device over Wi-Fi instead of USB

This is how the demo runs: the laptop serves both the API and Metro, the phone
reaches them over the LAN, and **no USB cable is involved**. `adb` is still needed
to *install* a build, never to run one.

Three things have to line up.

1. **The API server must bind more than loopback.** `apps/server/vite.config.ts`
   is `host: true`. It used to be `"127.0.0.1"`, which was right when the phone
   was on `adb reverse` and wrong the moment it was not. Vite left alone binds
   `::` only, which breaks BOTH paths - keep this pinned.
2. **The app must be told the LAN address.** `apps/mobile/.env`:
   `EXPO_PUBLIC_API_BASE_URL=http://<laptop LAN IP>:3000`. Metro INLINES
   `EXPO_PUBLIC_*` at bundle time, so this needs a Metro restart, not a reload -
   the log line `env: export EXPO_PUBLIC_API_BASE_URL` is the confirmation. The
   address is a DHCP lease and can change between sessions.
3. **The dev client must point Metro at the LAN IP too**, which is the part that
   fights back. See below.

Windows Firewall was NOT the problem: the Wi-Fi profile is Public, and there are
already inbound Allow rules for Node (`Get-NetFirewallApplicationFilter` shows
`C:\program files\nodejs\node.exe` allowed on both Public and Private), which is
the binary running both servers.

### `REACT_NATIVE_PACKAGER_HOSTNAME` is the only reliable lever

The dev client REMEMBERS the last dev-server URL and boots into it before it
processes anything else. Sending the launcher deep link does not override it:

```
adb shell am start -a android.intent.action.VIEW   -d "convoai://expo-development-client/?url=http%3A%2F%2F192.168.10.59%3A8081"
```

reports `Activity not started, intent has been delivered` and the app still fails
with:

```
Failed to connect to localhost/127.0.0.1:8081
Unable to load script. The device must either be USB connected ... or be on the
same Wi-Fi network as your computer (with bundler set to your computer IP)
```

`adb shell pm clear com.abiroot.convoai` resets the launcher's stored URL - and
also the RECORD_AUDIO grant, so the permission dialog comes back, which is a free
re-test. But the deep link STILL loses to the default on the next boot.

**What works is setting the hostname at build/launch time:**

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.10.59 pnpm mobile:android
```

That bakes the LAN address into the dev-server URL the launcher opens.

### The demo needs a RELEASE build, not a dev build

Symptom: tapping the app icon takes minutes to do anything, or never opens.

Cause: this project has **no `expo-dev-client`** - it is a plain React Native
debug build. RN's dev support decides the packager address itself, and when the
launcher icon starts `MainActivity` directly it falls back to `localhost:8081`:

```
The packager does not seem to be running as we got an IOException requesting
its status: Failed to connect to localhost/127.0.0.1:8081
java.lang.RuntimeException: Unable to load script.
```

`REACT_NATIVE_PACKAGER_HOSTNAME=<LAN IP> pnpm mobile:android` only fixes the
launch that `run:android` performs itself. It does NOT survive a cold start from
the icon, and `am start -W -n com.abiroot.convoai/.MainActivity` reports
`Status: timeout` because the activity never reaches idle. The
`convoai://expo-development-client/?url=...` deep link does nothing here either -
there is no dev-launcher package to handle it, the scheme filter just accepts the
intent and drops it.

**So a debug build always needs Metro, and needs to be started BY Metro.** That is
fine while developing and useless in front of an audience.

The fix is a release build: the JS bundle is embedded, so there is no dev server
to find, and Hermes runs bytecode with dev mode off. **Measured on the Note 8:**

| | debug | release |
|---|---|---|
| `am start -W` cold | `Status: timeout`, >10s | `Status: ok`, **TotalTime 1737ms** |
| APK | 96.8MB (4 ABIs) | **58MB** (arm64 only) |
| needs Metro | yes, and must be launched BY it | no |

Verified on the release build, over Wi-Fi, with no `adb reverse` on port 3000:
opens straight onto the voice screen, the orb goes live in about four seconds,
`setMode(MODE_IN_COMMUNICATION)` then `setMode(MODE_NORMAL)` on hang-up, and the
conversation is `ended` in Postgres with its `realtime_sessions` row. Worklets
Bundle Mode survives - no `Unable to resolve worklet` and the screen renders.

Two things that survive replacing the APK but NOT `adb shell pm clear`: the
SecureStore session token and the RECORD_AUDIO grant. So a reinstall keeps you
signed in; a `pm clear` makes you sign in again.

```bash
pnpm --filter @convo/mobile exec expo run:android --variant release --no-bundler
```

Two things make that work without extra setup:

- **Release is already signed with the debug keystore** in Expo's generated
  `android/app/build.gradle`, so no keystore is needed for a demo.
- **`android.enableMinifyInReleaseBuilds` defaults to false**, so ProGuard does
  not run - which matters, because `react-native-webrtc` needs ProGuard rules
  that are not configured here.

The one thing it DOES need is cleartext HTTP, because the API is plain `http://`
on the LAN. Expo enables that only in the debug manifest. `plugins/with-cleartext-traffic.js`
is a local config plugin that sets `android:usesCleartextTraffic="true"` in the
main manifest - a whole `expo-build-properties` dependency for one attribute was
not worth it, and `@expo/config-plugins` is already present. **Remove that plugin
before anything real ships.**

### Diagnosing "the phone cannot reach the server" - do not trust ping or netcat

Two red herrings cost real time here, both of which make a working server look
dead:

- **`ping` from the phone fails even when everything is fine.** Windows blocks
  ICMP echo by default. 100% packet loss proves nothing.
- **`toybox netcat` with a half-closed stdin makes Vite look like it is dropping
  connections.** `printf ... | netcat host 3000` returned instantly with exit 0
  and no body, while the identical request from the laptop returned 200, and a
  bare Node server on the same machine answered the phone fine. It is the
  half-close: Vite's server drops the connection when the client shuts down its
  write side before the response. **Hold stdin open and it works:**

  ```sh
  # the CRLFs below are literal backslash-r backslash-n inside the printf
  adb exec-out '{ printf "GET /api/health HTTP/1.1\r\nHost: h:3000\r\n\r\n"; sleep 5; } | toybox netcat -w 8 192.168.10.59 3000'
  ```

  That returns a real `HTTP/1.1 200` with this API's `x-request-id`. Metro (8081)
  answers either way, which is what made the two look different.

Useful control: a closed port gives `netcat: Timeout` and exit 1 after the full
`-w` wait, while a reachable one returns in 0s. That distinction is what actually
tells you whether the SYN got through.

### The clock skew is real, and it is only a lying log line

`expiresInSeconds: 35` on a 60-second TTL. Measured against OpenAI's `Date`
header, **this machine's clock is 23 seconds fast**, and `w32tm /query /status`
reports `Source: Local CMOS Clock`, never synced. `w32tm /resync` needs elevation.

But trace what it actually breaks: `expiresAt` comes from OpenAI, and
`expiresInSeconds` is `expiresAt - <local now>`, so a fast clock makes the number
come out SMALL. OpenAI validates the credential against its own clock, so the
handshake really does get the full 60 seconds. **Nothing in the app gates on that
value** — it is logged and nothing else. So it is a misleading log line, not a
broken handshake. Fix the clock anyway, from an elevated shell, before anyone
wastes a session chasing it.

### Traps hit while building it

- **`expo run:android` exits when the build finishes and takes Metro with it.**
  The app is left installed and launched, pointing at a dev server that no longer
  exists. Start Metro separately afterwards.
- **A wedged Metro holds port 8081 while answering nothing.** `curl :8081/status`
  timed out but the socket was listening, and `expo start` then asks
  *"Use port 8082 instead?"* — which hangs forever in a non-interactive shell.
  Confirm the command line with `Get-CimInstance Win32_Process` before killing
  anything, then restart on 8081.
- **`pnpm exec` triggers a dependency verification that tries to download every
  optional platform binary** (`@biomejs/cli-darwin-arm64`, every
  `@typescript/typescript-*`). It retries for minutes and never starts Metro. Run
  the CLI directly instead: `node node_modules/expo/bin/cli start --dev-client`.
- **`CI=1` disables Metro's watcher.** Fine for a one-shot bundle, not for
  iterating - and Bundle Mode needs the watcher (see the SHA-1 error above).
- **`vitest` was reading `node_modules.old/`.** Its default exclude is
  `**/node_modules/**`, which does not match `node_modules.old`, so the
  `@convo/shared` and `@convo/ai` suites were being re-run through the stale copy
  and counted as mobile tests. The "63 mobile tests" in the iteration 4 note was
  **11 real plus 52 duplicates**. Fixed with `apps/mobile/vitest.config.mts`
  restricting `include` to `src/**` — NOT by deleting the directory, which is full
  of links back into `apps/` and `packages/`.
- **`vitest.config.ts` warns under Vite 8** ("ESM syntax in a file loaded as
  CommonJS") unless it uses `import.meta` or has an `.mts` extension. The server's
  config escapes it by using `import.meta.url`; the mobile one is `.mts`.
- **The `@config-plugins/react-native-webrtc` compat table stops at Expo SDK 56**,
  but `15.0.2` works on 57 — its peer range is `expo: ">=56"`. It adds `CAMERA`
  unconditionally, which `android.blockedPermissions` removes.

### Where iteration 7 starts

Audio is real, it comes out of the loudspeaker, and conversations are now stored,
listed, searched, renamed, deleted and read back. Iteration 6 is closed.

**Two things from earlier iterations are still open, and both need a person.**
Neither is code:

1. **The self-interruption test.** Talk to the phone and confirm the model does
   not cut itself off while its own voice is in the room. It is the exit
   criterion for ITERATION 5 and it has still never been run under conditions
   where it could fail honestly - see item 2 under *What is NOT yet verified*.
   Every "no self-interruption" observation before the 3 Sep build is void,
   because the audio was coming out of the earpiece.
2. **Tool calls end to end.** `get_current_time` (device) and
   `search_conversations` (proxied) have never been exercised from a real call.
   The proxied one is now genuinely worth testing: before iteration 6 every
   conversation was empty, so the tool could only ever have returned nothing.

Then iteration 7 proper - barge-in, credential expiry mid-call, reconnect after
network loss, offline state, real error surfaces - and the measurement table in
`DESIGN.md` filled in with real Note 8 numbers rather than claims.

Known gaps left deliberately in iteration 6:

- **Search is `ilike`, so it scans the user's turns.** Correct at this size and
  honest about it. The fix when it matters is a `tsvector` column with a GIN
  index: one migration and one function, `matchesQuery()` in
  `drizzle-conversation.repository.ts`.
- **The history screen is read-only.** A finished conversation is a record, not
  somewhere to resume; talking always opens a NEW conversation. That is a design
  decision, not an omission.
- **A conversation is only listed after the call ends.** The sidebar is
  invalidated once the recorder has drained, so the row appears with its derived
  title rather than appearing untitled and renaming itself under the user.
- **`.expo/types/router.d.ts` lists files outside `src/app` as routes** (server
  use-cases, `turn-recorder`, `native-cookie`). Pre-existing typegen noise, extra
  union members only, harmless - but do not be alarmed by it.
- Navigation to a conversation must use the OBJECT href form,
  `router.push({ pathname: "/conversation/[id]", params: { id } })`. With typed
  routes an interpolated path does not typecheck against the route literal.

## The API as built

All of it exists now. Kept as the one-page map of the surface.

**`apps/server`** (TanStack Start) — routes are thin parse-and-delegate shells:

| Route | Behaviour |
|---|---|
| `GET /api/health` | Liveness. Touches nothing external. |
| `GET /api/ready` | Readiness. `checkConnection` on a 2s timeout, 503 + `degraded` when the DB is down. |
| `GET /api/openapi`, `GET /api/docs` | Gated on `DOCS_ENABLED`, else 404. |
| `POST /api/auth/$` | Bare splat delegating to Better Auth's own handler. **Deliberately not wrapped in `handler()`.** |
| `POST/GET /api/conversations` | Create (201) and list (keyset paginated). `?q=` searches titles AND turn text. |
| `GET/PATCH/DELETE /api/conversations/:id` | Detail; rename or end (union body); delete 204, second delete 404. |
| `POST /api/conversations/:id/turns` | Record a turn. 201 new / 200 replayed. |
| `POST /api/realtime/token` | Mint credential. Rate limited 20/hour/user. |
| `POST /api/tools/:name` | Execute a privileged tool. Rate limited 120/min/user. |

Every row was DONE as of iteration 3; the conversations rows gained search,
rename and delete in iteration 6.

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

Most of what follows was checked against real docs, real package source, or the
running server, and is the most valuable part of this file. The two sections
immediately below are the exception — later iterations disproved them, and they
are kept only as forward pointers.

### Windows path length — SUPERSEDED, see iteration 4

This section used to recommend a short project path or a short `virtualStoreDir`.
**Both are wrong**, and the arithmetic proving it is under
*"The Windows path problem — SOLVED, and the old fix does not work"* above. The
actual fix is `nodeLinker: hoisted` in `pnpm-workspace.yaml`. Read that section,
not this one.

### Worklets Bundle Mode needs SIX things — SUPERSEDED, see iteration 4

Still six, but the old list named two `pnpm patch` patches against `metro@0.84.4`
that **do not exist and are not needed**: `react-native-worklets@0.10.1` ships no
`bundleMode/patches` directory and exports `getBundleModeMetroConfig(config)`
instead. The corrected list is under *"The Bundle Mode six things — CORRECTED"*
above. Read that one.

> Everything from here down was checked on 20 Aug and still holds. The two
> sections above did not, which is why they now point forwards instead: a heading
> that says "do not rediscover these" is read as authoritative, and it was
> contradicting the corrections in the same file.

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

> **These probes were all run with curl, and curl is not a phone.** Every one of
> them passed against a server that was, at the same time, returning 403 to the
> app on every auth POST. See *Session 5: two device-only bugs* above before
> trusting anything in this section as evidence about the device.

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
- ~~**`get_current_time` has no device implementation.**~~ CLOSED in iteration 5.
  It runs in `apps/mobile/src/features/call/device-tools.ts`, from the phone's own
  clock and `Intl` timezone, and a zone the model invents falls back rather than
  throwing. The server still refuses to proxy it with 403, which is the point.
- **Tool routing has not been exercised against a live model.** The unit tests
  cover both branches and the server's own curl exit test covers the 403/404/200
  refusals, but no session has yet had the model actually ask for a tool. Say
  "what time is it" on the device to close this.

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
