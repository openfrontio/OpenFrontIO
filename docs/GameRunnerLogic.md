# OpenFront `GameRunner` logic

Source: `src/core/GameRunner.ts` (branch `playbook-bot`), plus the pieces it calls into
(`Worker.worker.ts`, `ExecutionManager.ts`, `GameImpl.executeNextTick`).
Nodes tagged **[bot]** exist only on the `playbook-bot` branch.

Paste into https://mermaid.live or view in any Markdown viewer with Mermaid support (GitHub, VS Code, Obsidian).

---

## 1. Where GameRunner lives — the round trip

```mermaid
flowchart LR
    subgraph Main["Main thread (client)"]
        UI[Player action] --> Intent[Intent]
        Intent --> WS[WebSocket]
        Render[Render / UI] 
    end
    subgraph Server["Server"]
        WS --> GS[GameServer bundles intents into a Turn]
        GS --> WS2[Relay Turn to all clients]
    end
    subgraph Worker["Core Web Worker"]
        WS2 --> WC[WorkerClient postMessage]
        WC --> WW["Worker.worker.ts<br/>switch(message.type)"]
        WW -- "init" --> CGR[createGameRunner]
        WW -- "turn" --> AT["gr.addTurn(turn)"]
        AT --> Drain["scheduleDrain()<br/>loop ≤ MAX_TICKS_BEFORE_YIELD"]
        Drain --> ENT["gr.executeNextTick(pendingTurns)"]
        ENT --> CB[callBack GameUpdateViewData]
        CB --> Batch[sendGameUpdateBatch]
        WW -- "player_actions / player_buildables /<br/>player_profile / player_border_tiles /<br/>attack_clustered_positions / transport_ship_spawn" --> Q[GameRunner query methods]
    end
    Batch --> Render
    Q --> Render
```

---

## 2. `createGameRunner()` — construction

```mermaid
flowchart TD
    A["createGameRunner(gameStart, clientID, mapLoader, callBack, playbookBot=false)"]
    A --> B["new Config(gameStart.config, null, false, listed)"]
    B --> C["loadGameMap(map, size, mapLoader, renderLayers=false)<br/>skip image loading in the worker"]
    C --> D["random = PseudoRandom(simpleHash(gameID))<br/>deterministic seed"]
    D --> E["humans = gameStart.players → PlayerInfo(Human, clientID, random.nextID(), ...)"]
    E --> F["nations = createNationsForGame(gameStart, map.nations, map.additionalNations, humans.length, random)"]
    F --> G["game = createGame(humans, nations, gameMap, miniGameMap, config, teamGameSpawnAreas)"]
    G --> H["executor = new Executor(game, gameID, clientID, tribe names)"]
    H --> I{"playbookBot &&<br/>gameType === Singleplayer?"}
    I -- yes --> J["playbookBotClientID = clientID  [bot]"]
    I -- no --> K["playbookBotClientID = undefined"]
    J --> L["gr = new GameRunner(game, executor, callBack, playbookBotClientID, gameID)"]
    K --> L
    L --> M["gr.init()"]
    M --> N[return gr]
```

---

## 3. `init()` — the standing executions

Executions added once, before any turn. They live for the whole game.

```mermaid
flowchart TD
    I["init()"]
    I --> S1{"gameType !== Singleplayer?"}
    S1 -- yes --> E1["+ SpawnTimerExecution<br/>(ends spawn phase on a timer)"]
    I --> S2{"config.spawnNations()?"}
    S2 -- yes --> E2["+ executor.nationExecutions()<br/>(one AI execution per nation)"]
    I --> S3{"config.isRandomSpawn()?"}
    S3 -- yes --> E3["+ executor.spawnPlayers()<br/>PlayerSpawner → SpawnExecution per human"]
    I --> S4{"config.bots() > 0?"}
    S4 -- yes --> E4["+ executor.spawnTribes(n)<br/>TribeSpawner → SpawnExecution per tribe"]
    I --> E5["+ WinCheckExecution (always)"]
    I --> S6{"doomsdayClockConfig().enabled?"}
    S6 -- yes --> E6["+ DoomsdayClockExecution"]
    I --> S7{"Factory unit not disabled?"}
    S7 -- yes --> E7["+ RecomputeRailClusterExecution(railNetwork)"]
```

---

## 4. `executeNextTick(pendingTurns)` — the per-tick loop (the heart)

```mermaid
flowchart TD
    Start(["executeNextTick(pendingTurns?)"])
    Start --> G1{isExecuting?}
    G1 -- yes --> R0([return false])
    G1 -- no --> G2{"currTurn >= turns.length?<br/>(no turn buffered)"}
    G2 -- yes --> R0
    G2 -- no --> Lock["isExecuting = true"]

    Lock --> T1["game.addExecution(...executor.createExecs(turns[currTurn]))<br/>one Execution per intent in the Turn"]
    T1 --> T2["currTurn++"]
    T2 --> T3["wasInSpawnPhase = game.inSpawnPhase()"]

    T3 --> Try{{"try"}}
    Try --> T4["t0 = performance.now()<br/>updates = game.executeNextTick()<br/>tickExecutionDuration = now - t0"]
    Try -. "catch" .-> Err["console.error<br/>callBack({errMsg, stack} as ErrorUpdate)<br/>isExecuting = false"]
    Err --> R1([return false])

    T4 --> V1["viewDataChanged = false"]
    V1 --> SP{game.inSpawnPhase()?}
    SP -- yes --> SPn["for each Human/Nation with a spawnTile:<br/>playerViewData[id] = placeSpawnName()<br/>viewDataChanged = true"]
    SP -- no --> SE
    SPn --> SE["spawnJustEnded = wasInSpawnPhase && !inSpawnPhase()"]

    SE --> BOT0{{"[bot] Playbook phase 0 — see §5"}}
    BOT0 --> BOT1{{"[bot] Playbook handoff — see §5"}}

    BOT1 --> NM{"spawnJustEnded<br/>|| ticks < 3<br/>|| ticks % 30 === 0?"}
    NM -- yes --> NMy["for every player:<br/>playerViewData[id] = placeName()<br/>viewDataChanged = true"]
    NM -- no --> Drain
    NMy --> Drain["drain packed buffers from game:<br/>packedTileUpdates<br/>packedMotionPlans<br/>packedPlayerUpdates<br/>packedAttackUpdates<br/>nukeImpacts → Uint32Array"]

    Drain --> CB["callBack({<br/>tick, packedTileUpdates,<br/>packedMotionPlans?, packedPlayerUpdates?,<br/>packedAttackUpdates?, packedNukeImpacts?,<br/>updates,<br/>playerNameViewData? (only if viewDataChanged),<br/>tickExecutionDuration,<br/>pendingTurns ?? 0 })"]
    CB --> Unlock["isExecuting = false"]
    Unlock --> R2([return true])
```

### 4a. Inside `game.executeNextTick()` (GameImpl)

```mermaid
flowchart TD
    A["GameImpl.executeNextTick()"]
    A --> B["reset updates map + tileUpdatePairs"]
    B --> C["for e of execs:<br/>if (!inSpawnPhase || e.activeDuringSpawnPhase) && e.isActive → e.tick(ticks)"]
    C --> D["for e of unInitExecs:<br/>allowed now? → e.init(game, ticks) → inited<br/>else → keep in unInited"]
    D --> E["removeInactiveExecutions()"]
    E --> F["execs.push(...inited); unInitExecs = unInited"]
    F --> G["for each player: player.toUpdate(statsQuads, attackTroopsQuads) → addUpdate"]
    G --> H{"ticks % 10 === 0?"}
    H -- yes --> I["addUpdate(Hash update) — desync detection"]
    H -- no --> J
    I --> J["waterManager.tick() → recordTileUpdate for changed tiles"]
    J --> K["ticks++"]
    K --> L[return updates]
```

Note: an execution added during tick N is *initialised* at the end of tick N and first *ticks* at N+1.

---

## 5. **[bot]** Playbook branch inside `executeNextTick`

Runs only when `playbookBotClientID` is set (dev `?bot=1`, singleplayer only).

```mermaid
flowchart TD
    P0(["after spawnJustEnded is computed"])
    P0 --> C1{"playbookBotClientID set?"}
    C1 -- no --> Skip([skip both blocks])
    C1 -- yes --> C2{"inSpawnPhase()?"}

    %% phase 0
    C2 -- yes --> C3{"ticks >= 2?"}
    C3 -- no --> Skip
    C3 -- yes --> C4{"ticks >= 10<br/>OR every nation has landed<br/>(hasPlayer && spawnTile !== undefined)?"}
    C4 -- no --> Skip
    C4 -- yes --> C5{"!botSpawnQueued?"}
    C5 -- no --> Skip
    C5 -- yes --> C6["me = game.playerByClientID(id)"]
    C6 --> C7{"me !== null && !me.hasSpawned()?"}
    C7 -- no --> Skip
    C7 -- yes --> C8["tile = PlaybookBotExecution.pickSpawn(game)"]
    C8 --> C9{"tile !== null?"}
    C9 -- yes --> C10["addExecution(new SpawnExecution(gameID, me.info(), tile))<br/>botSpawnQueued = true"]
    C9 -- no --> Skip

    %% handoff
    C2 -- no --> H1["me = game.playerByClientID(id)"]
    H1 --> H2{"me !== null?"}
    H2 -- yes --> H3["addExecution(new PlaybookBotExecution(me))<br/>bot now drives this player every tick"]
    H2 -- no --> H4
    H3 --> H4["playbookBotClientID = undefined<br/>(one-shot: never re-added)"]
```

Why `ticks >= 2`: nations land at ticks 2–3, and the picker wants to see where they are. `ticks >= 10` is the fallback so a nation that never lands can't block the bot's spawn forever.

---

## 6. `Executor.createExec(intent)` — Turn → Executions

```mermaid
flowchart LR
    T["Turn.intents[]"] --> M["createExec(intent)<br/>switch(intent.type)"]
    M --> a["attack → AttackExecution"]
    M --> b["cancel_attack / cancel_boat"]
    M --> c["move_warship"]
    M --> d["spawn → SpawnExecution"]
    M --> e["boat → TransportShipExecution"]
    M --> f["allianceRequest / allianceReject /<br/>breakAlliance / allianceExtension"]
    M --> g["targetPlayer / emoji / quick_chat"]
    M --> h["donate_troops / donate_gold"]
    M --> i["embargo / embargo_all"]
    M --> j["build_unit / upgrade_structure / delete_unit"]
    M --> k["mark_disconnected / toggle_pause"]
```

---

## 7. Query methods (worker request → response, no state change)

```mermaid
flowchart LR
    W["Worker message"] --> PA["playerActions(playerID, x?, y?, units?)<br/>canAttack, buildableUnits, canSendEmojiAllPlayers,<br/>canEmbargoAll, + interaction{} if tile has an owner:<br/>sharedBorder, canTarget, alliance flags, donate flags, embargo, allianceInfo"]
    W --> PB["playerBuildables(playerID, x?, y?, units?)<br/>→ player.buildableUnits(tile, units)"]
    W --> PP["playerProfile(smallID) → player.playerProfile()"]
    W --> PBT["playerBorderTiles(playerID)<br/>→ new Set(borderTiles) (TileSet can't structured-clone)"]
    W --> ACP["attackClusteredPositions(smallID, attackID?)<br/>→ [{id, positions:[{x,y}]}] over outgoing+incoming"]
    W --> BTS["bestTransportShipSpawn(playerID, targetTile) → TileRef | false"]
    W --> PT["pendingTurns() → max(0, turns.length - currTurn)"]
```

---

## 8. State held by a `GameRunner` instance

| Field | Purpose |
|---|---|
| `game: Game` | the deterministic simulation |
| `execManager: Executor` | intent → Execution factory, nation/tribe/player spawners |
| `callBack` | where each tick's `GameUpdateViewData` (or `ErrorUpdate`) goes |
| `turns: Turn[]` / `currTurn` | buffered turns from the server; one consumed per tick |
| `isExecuting` | re-entrancy guard |
| `playerViewData` | cached name-box placements, only shipped when recomputed |
| `playbookBotClientID` **[bot]** | which player the bot owns; cleared after handoff |
| `botSpawnQueued` **[bot]** | phase-0 spawn issued exactly once |
| `gameID` | passed into the bot's `SpawnExecution` |
