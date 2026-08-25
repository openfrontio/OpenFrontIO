# GameServer.ts — testing & refactor plan

`src/server/GameServer.ts` is ~2,400 lines, changes in most feature PRs, and
has 13 responsibilities in one class. This document is the plan for making it
testable and then splitting it up. It is a living checklist: tick items off as
PRs land.

## Diagnosis

**The class.** ~40 public methods; features land as "add a field, add a method,
add a branch in `joinClient` / `handleIntent` / `phase()`", so those three keep
growing.

**The tests (the actual problem).** Tests could only exercise the class by
reaching past its API:

- ~150 `(game as any).x` reach-ins across 29 private members. Top offenders:
  `gameStartInfo`, `archiveGame` (spied), `intents`, `_hasStarted = true`,
  `winner`, `handleClientDisconnect`.
- 6 files `vi.mock("../../src/core/Schemas")` to stub
  `GameStartInfoSchema.safeParse` — only because fixture IDs like `"p1"` fail
  the 8-char `ID` regex.
- 13 files each define their own `makeMockWs` / `makeClient` / `mockLogger`.
- Hidden dependencies force the rest: `archive()`, `fetchCustomTribes()`,
  `ServerEnv.env()` (static), `console.error`, two internal `setInterval`s.

**Coverage gaps** (no test at all): duplicate-session kick, 3-per-IP cap,
`host_left` lobby close, `rejoinClient` identity / verified-badge update and
`lastTurn` slicing, the "ws already closed" race in `addListeners`,
`maxGameDuration`, 60s ping prune in `phase()`, `checkDisconnectedStatus`
toggling, `findOutOfSyncClients` majority logic.

**Structural smells.**

- Seven parallel collections describe one population: `activeClients` (public
  array), `allClients`, `websockets`, `persistentIdToClientId`,
  `admittedPersistentIds`, `kickedPersistentIds`, `clientsDisconnectedStatus`.
  Hand-reconciled in `joinClient`, `rejoinClient`, `kickClient`,
  `handleClientDisconnect`, `phase()`.
- `phase()` is a query with side effects (closes sockets, prunes clients,
  re-tallies the winner) and `GameManager` calls it 2–3× per tick.
- Lifecycle is four booleans (`_hasPrestarted`, `_hasStarted`, `_hasEnded`,
  `isPaused`) plus `hasReachedMaxPlayerCount`; `hasStarted()` means
  "prestarted OR started".
- `updateGameConfig` is 100 lines of field-by-field copy.
- `end()` is `async` but awaits nothing; the promise from `archive()` is not
  awaited, so the surrounding `try/catch` only catches synchronous throws.

## Principles

1. **Client-visible wire behaviour must not change.** The contract is the
   frames on the socket and the archived record.
2. **Tests before moves.** No extraction lands without characterization tests
   for the code being moved.
3. **One concern per PR**, each deleting the reach-ins for that concern.
4. **Don't fix behaviour while moving it.** Suspected bugs get a note and their
   own PR.

## Phase 0 — Test infrastructure (no production changes)

- [x] `tests/util/GameServerHarness.ts`: one `mockLogger()`, `makeMockWs()`
      (drivable: `emit(ClientMessage)`, `trigger("close")`, captured sends),
      `makeClient(opts)`, `makeGame(opts)`, `startGame(game)` that runs real
      `prestart()` + `start()` instead of setting `_hasStarted`.
- [x] Schema-valid fixture IDs (`cid("p1")` → `"p1000000"`), then delete every
      `vi.mock("../../src/core/Schemas")`.
- [x] Golden wire transcript test: a scripted full game under fake timers;
      snapshot the decoded server frames per client and the archived record.
      This is the regression net for every later phase.
- [x] Migrate the duplicated helpers onto the harness (thin local adapters are
      fine; test bodies stay unchanged).

Verify: `npm test` green; no `vi.mock` of `Schemas` under `tests/server`.

Status (2026-08-25): done. `tests/util/GameServerHarness.ts`,
`tests/server/GameServerWire.test.ts` (+ snapshot). Reach-ins 150 → 82,
`Schemas` mocks 6 → 0, private `makeMockWs` copies 13 → 0. What is left
reaches for `archiveGame` (10), `gameStartInfo` (9), `intents` (8), `winner`
(6) — Phase 2's dependency injection and a `startInfo()` accessor remove most
of it.

## Phase 1 — Characterization tests for uncovered paths

Written against current behaviour, using the harness:

- [ ] `joinClient`: dup-session kicks the _old_ client (Prod), 3-IP cap
      (Public, non-Dev), host-left closes lobby and `phase()` → `Finished`.
- [ ] `rejoinClient`: identity update drops `verified` only when the username
      changes; ignored after start; `lastTurn` slicing; old socket closed.
- [ ] `addListeners`: corrupt frame → `invalid_message` kick; ws
      `readyState >= 2` race handled as a disconnect.
- [ ] `phase()`: 60s ping prune, `maxGameDuration`, the
      `noActive && warmupOver && noRecentPings` exit.
- [ ] `findOutOfSyncClients`: majority, strict-majority flip, single client,
      `turns[n].hash` set on agreement.
- [ ] `checkDisconnectedStatus`: only every 5 turns, flips both ways,
      spectators emit no `mark_disconnected`.

## Phase 2 — Inject the hidden dependencies

- [ ] Replace the 10-positional-arg constructor with `GameServerOptions` plus a
      `GameServerDeps` object `{ archive, fetchTribes, env, turnIntervalMs,
  telemetry, buildHash }` defaulting to the real modules.
      `GameManager.createGame` is the only production caller.
- [ ] Replace `console.error` in `prestart()` with `this.log.error`.
- [ ] Leave `Date.now()` alone — fake timers already cover it.

Verify: golden snapshot unchanged; no `vi.mock` of server modules in
GameServer tests; no `archiveGame` spies.

## Phase 3 — Extract pure modules (lowest risk first)

Each is a move, not a rewrite. Existing tests are re-pointed at the module.

| Module                                                                    | From                                                | Existing tests to re-home                              |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `ConfigPatch.ts`: `applyGameConfigPatch()`, `hostCheatsEnabled`           | `updateGameConfig`                                  | AdminBotIntent, HostedLobbyListing                     |
| `NameVisibility.ts`: `seesReal`, `anonName`, `startInfoFor`, lobby roster | name-visibility helpers, `startInfoFor`, `gameInfo` | AnonymizeNames, AnonymizeNamesTeammates, AdminClanTags |
| `DesyncDetector.ts`: `findOutOfSyncClients` + sent set                    | `handleSynchronization`                             | new (Phase 1)                                          |
| `Consensus.ts`: winner vote + retally, live-stats rounds + prune          | `handleWinner`, `handleLiveStats`                   | WinnerVoteRetally, LiveStats                           |
| `ListingState.ts`: listed/listedAt/label/accent/featured/autoStart        | scattered fields                                    | HostedLobbyListing                                     |
| `MatchTelemetryRecorder.ts`: sequence, tick counts, finished flag         | `emitTelemetry*`                                    | MatchTelemetryIntegration                              |

Notes:

- `applyGameConfigPatch` must preserve `null → undefined` on nullable keys and
  the _unconditional_ `hostCheats` assignment.
- The `allowedPublicIds` → delist side effect stays in `GameServer`.

Verify per PR: golden snapshot unchanged; module has its own unit tests; the
corresponding `(game as any)` uses are gone.

## Phase 4 — Roster

- [ ] `Roster.ts` collapsing the seven collections: `add`, `reconnect`,
      `markLeft`, `kick`, `pruneStale(now)`, `active()`, `players()`,
      `byPersistentId()`, `votingUniqueIPs()`, `wasAdmitted()`, `isKicked()`.
- [ ] `GameServer` keeps the _policy_ (allowlist, IP cap, dup-session,
      host-left) and delegates bookkeeping.
- [ ] Make `activeClients` private; `GameManager.activeClients()` uses
      `numClients()`.

Only after Phases 1–3: every roster path then has a test.

## Phase 5 — Message ingress and intent dispatch

- [ ] `ClientSocket.attach(client, { onMessage, onClose })`: decode → validate
      → rate-limit → spectator-block. `GameServer.handleClientMessage(client,
  msg)` keeps the switch. Tests call `handleClientMessage` directly; keep a
      few frame-level tests for the decode/kick paths.
- [ ] `authorizeIntent(intent, actor): IntentOutcome | null` (pure guards,
      table-testable) separated from the effects in `handleIntent`.

## Phase 6 — Lifecycle state machine

- [ ] One `state: "lobby" | "prestart" | "started" | "ended"` plus `paused`
      replaces the booleans. `hasStarted()` becomes `state !== "lobby"`.
- [ ] Split `phase()` into `pruneStaleClients()` (side effects; called once per
      `GameManager.tick`) and a pure `phase()`. `publicLobbies()` /
      `listedLobbies()` stop mutating state.
- [ ] Decide whether `end()` should await `archive()` after checking how
      `Archive.ts` handles rejections.

## Out of scope

Renaming intents/messages; changing the archive record shape (replays depend
on it — `tests/replay/ReplayGame.ts`); touching `Worker.ts` / `Master.ts`
beyond the constructor call.

## Expected result

`GameServer.ts` ≈ 700–900 lines of orchestration, ~6 focused modules with
direct unit tests, and no `(game as any)` under `tests/server`.
