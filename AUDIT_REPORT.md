# OpenFrontIO Security & Performance Audit Report

**Date:** April 2026  
**Scope:** Comprehensive static analysis of `src/core`, `src/server`, and `src/client` directories (~50 files, ~25,000+ lines of code).

---

## 📝 Executive Summary & Note to the Project Owner

We have conducted a deep technical audit of the OpenFrontIO codebase to identify potential vulnerabilities, stability risks, and architectural bottlenecks. The analysis yielded **23 total findings**, categorized into Critical Security/Bugs, Potential Edge Cases, Performance Bottlenecks, and Architectural Suggestions.

**Actionable Next Steps:** We have already identified the exact root causes for these issues and have the code patches ready. **If approved, we can immediately push these fixes to the repository via Pull Request.**

---

## 🔴 Critical Security Vulnerabilities & Bugs (6 Findings)

### 1. SEC-02: `start_game` Endpoint Lacks Authentication

- **File:** `src/server/Worker.ts`
- **Issue:** The `POST /api/start_game/:id` endpoint does not verify the caller's identity. Any user who knows or guesses a private game ID can trigger the game to start immediately, bypassing the lobby creator.
- **Proposed Solution:** Implement JWT/token verification on the endpoint and assert that the `persistentID` of the caller strictly matches `gameInfo().lobbyCreatorClientID` before invoking `game.start()`. _(Fix is ready to deploy)_

### 2. BUG-02: Server Crash Risk on WebSocket `send()`

- **File:** `src/server/GameServer.ts`
- **Issue:** During `endTurn()`, the server iterates over all active clients and calls `c.ws.send(msg)`. If a client disconnects precisely at the turn boundary, this call will throw an exception and crash the Node.js server instance.
- **Proposed Solution:** Wrap the `c.ws.send(msg)` call in a `if (c.ws.readyState === WebSocket.OPEN)` guard, matching the pattern correctly used in `broadcastLobbyInfo()`. _(Fix is ready to deploy)_

### 3. SEC-01: Rate Limiter `totalBytes` Memory Leak / Auto-Kick

- **File:** `src/server/ClientMsgRateLimiter.ts`
- **Issue:** The `totalBytes` counter accumulates indefinitely for each client. In long-running games (e.g., 2-3 hours), legitimate players will inevitably hit the 2MB limit and be automatically kicked for "spamming", ruining the user experience.
- **Proposed Solution:** Convert the byte counter into a sliding window (e.g., reset the byte counter every 60 seconds) rather than a lifetime accumulation. _(Fix is ready to deploy)_

### 4. BUG-01: Attack `retreat()` Stat Recording Failure

- **File:** `src/core/execution/AttackExecution.ts`
- **Issue:** The `retreat()` method calls `this.attack.delete()` which clears the attack state, and _then_ checks `if (this.attack.retreated())`. This always evaluates to false, causing retreat statistics to be permanently lost at the end of the game.
- **Proposed Solution:** Capture the boolean result of `this.attack.retreated()` into a local variable _before_ calling `this.attack.delete()`. _(Fix is ready to deploy)_

### 5. SEC-03: `hostCheats` Unconditional Override

- **File:** `src/server/GameServer.ts`
- **Issue:** In `updateConfig()`, while other fields are safely guarded by `!== undefined` checks, `hostCheats` is unconditionally assigned. An unrelated lobby config update can accidentally erase the existing host cheats.
- **Proposed Solution:** Wrap the assignment in an `if (gameConfig.hostCheats !== undefined)` guard. _(Fix is ready to deploy)_

### 6. BUG-03: Typo in Server Error Logs

- **File:** `src/server/GameServer.ts`
- **Issue:** Log message reads `"error handline websocket request"`.
- **Proposed Solution:** Correct to `"error handling..."` to fix log parsing and filtering.

---

## 🟡 Potential Bugs & Edge Cases (5 Findings)

### 7. BUG-06: Division by Zero in `WinCheckExecution`

- **Issue:** In the event of a heavy nuclear war where all land tiles are covered in fallout, `numTilesWithoutFallout` becomes `0`. This results in a division by zero (`NaN` or `Infinity`), breaking the win condition logic.
- **Proposed Solution:** Add a mathematical guard to default the ownership percentage to `0` if the denominator is zero, falling back safely to time-based win conditions. _(Fix is ready to deploy)_

### 8. BUG-04: Shared Reference in `playerViewData`

- **Issue:** `GameRunner.executeNextTick()` assigns the same reference to `playerViewData` on every tick. This can cause rendering anomalies if the asynchronous renderer reads stale data.
- **Proposed Solution:** Deep-copy or snapshot the view data to ensure immutability across the game loop.

### 9. BUG-05: Dead Defender Tile Iteration Limit

- **Issue:** `AttackExecution.handleDeadDefender()` limits conquering to 10 iterations while regenerating the `tiles()` Set each time. For massive empires, 10 iterations may not be enough, leaving "ghost" tiles.
- **Proposed Solution:** Refactor the loop to dynamically exhaust the tile set rather than relying on a hardcoded loop limit.

### 10. BUG-07: `bfs()` is actually a DFS Implementation

- **Issue:** `GameMapImpl.bfs()` uses `Array.pop()` (Stack/LIFO) instead of `Array.shift()` (Queue/FIFO). It behaves identically in terms of results but searches depth-first.
- **Proposed Solution:** This is actually a smart performance optimization (`shift()` is O(n)). We recommend keeping the code but adding explicit JSDoc comments so future developers don't mistakenly assume breadth-first traversal order. _(Fix is ready to deploy)_

### 11. BUG-08: Non-null Assertion on `this.src` in NukeExecution

- **Issue:** `this.src` can theoretically remain undefined if a nuke spawn fails, causing `this.src!` to throw a runtime error.
- **Proposed Solution:** Add an early return or explicit undefined check.

---

## 🔵 Performance Bottlenecks (4 Findings)

### 12. PERF-01: `incomingAllianceRequests()` is O(n) per call

- **Issue:** Called frequently in hot paths (`canSendAllianceRequest`, etc.), this method iterates over the entire global alliance list every time.
- **Proposed Solution:** Introduce a player-specific hash map or array to track active alliances per player, achieving O(1) lookups.

### 13. PERF-02: `tiles()` Generates a New Set

- **Issue:** `PlayerImpl.tiles()` runs `new Set(this._tiles.values())` on every invocation. For large players, this creates immense Garbage Collection (GC) pressure.
- **Proposed Solution:** Expose a `ReadonlySet` directly or use an iterator.

### 14. PERF-03: `GameImpl.units()` Uses `flatMap`

- **Issue:** Rebuilding the entire unit array via `flatMap` every tick (e.g., during Nuke detonation checks) is highly inefficient.
- **Proposed Solution:** Maintain a cached global unit list that updates only on unit creation/destruction.

### 15. PERF-04: Nuke Detonation is O(n²)

- **Issue:** Calculating fallout deaths iterates through all global attacks/transports _per impacted tile_.
- **Proposed Solution:** Batch calculate the bounding box of the nuke and check intersections once.

---

## 🟢 Architectural & Code Quality Suggestions (8 Findings)

1. **SUG-07 (Architecture):** `src/core` modules (`GameRunner.ts`, `PlayerImpl.ts`) directly import from `src/client/Utils`. Core game logic should be entirely decoupled from the client UI. These utilities must be moved to a shared library.
2. **SUG-02 (Strictness):** `tsconfig.json` lacks full `"strict": true` mode (specifically `strictPropertyInitialization`). Enabling this will prevent a whole class of runtime undefined errors.
3. **SUG-03 (Hashing):** `simpleHash()` in `Util.ts` uses a weak bitwise algorithm with high collision rates for short strings. It should be replaced with a stronger standard hash to prevent uneven team assignments.
4. **SUG-08 (Middleware):** `Worker.ts` applies `express.json()` twice (once with a 5MB limit, once default). The duplicate should be removed to prevent payload parsing conflicts. _(Fix is ready to deploy)_
5. **SUG-06 (Readability):** `disconnectedTimeout` is written as `1 * 30 * 1000` which is confusing. It should be `30_000`. _(Fix is ready to deploy)_
6. **SUG-04 (Generation):** `generateGameIdForWorker()` relies on a 1000-attempt brute force loop. A deterministic ID generation strategy bound to the worker ID is safer at scale.
7. **SUG-05 (Optimization):** `sharesBorderWith()` iterates over every border tile of a massive country. Needs spatial partitioning or a neighbor cache.
8. **SUG-01 (Debugging):** `Executor.createExec()` returns a silent `NoOpExecution` when a player is missing. It should log the requested intent type to aid debugging.

---

### 📊 Summary Table

| Category                    | Count  | Priority                      |
| --------------------------- | ------ | ----------------------------- |
| 🔴 Critical Security / Bugs | 6      | High (Immediate Fix Required) |
| 🟡 Potential Edge Cases     | 5      | Medium                        |
| 🔵 Performance Bottlenecks  | 4      | Medium                        |
| 🟢 Architecture & Quality   | 8      | Low-Medium                    |
| **Total Findings**          | **23** |                               |

---

_End of Report._
**We are standing by to implement the necessary code patches upon your review.**
