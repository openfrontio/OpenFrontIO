# Client-Server Communication

This document explains how the client and server communicate and coordinate game state.

## Architecture Overview

OpenFront.io uses a deterministic client-server architecture:

- **Server**: Authoritative game state, validates actions
- **Client**: Simulates game locally, renders UI
- **Deterministic**: Both use same random seed and rules

## Communication Protocol

### WebSocket Connection

The client connects to the server via WebSocket:

```typescript
// Client connects to server
const ws = new WebSocket(`ws://${server}/game/${gameID}`);
```

### Message Types

#### Client → Server Messages

**Turn**

```typescript
{
  type: "turn",
  intents: Intent[]  // Player actions
}
```

**Heartbeat**

```typescript
{
  type: "heartbeat";
}
```

**Hash**

```typescript
{
  type: "hash",
  tick: number,
  hash: number
}
```

#### Server → Client Messages

**GameUpdate**

```typescript
{
  type: "game_update",
  tick: number,
  updates: GameUpdates,
  packedTileUpdates: BigUint64Array
}
```

**GameStart**

```typescript
{
  type: "game_start",
  gameStartInfo: GameStartInfo
}
```

**Error**

```typescript
{
  type: "error",
  message: string
}
```

## Turn Processing

### Client Side

1. **User Input**: Player clicks/interacts
2. **Intent Creation**: Client creates Intent object
3. **Turn Assembly**: Intents grouped into Turn
4. **Send to Server**: Turn sent via WebSocket

```typescript
// Example: Creating an attack intent
const intent: Intent = {
  type: "attack",
  clientID: myClientID,
  troops: 1000,
  targetID: enemyPlayerID,
};

const turn: Turn = {
  intents: [intent],
};

ws.send(JSON.stringify({ type: "turn", turn }));
```

### Server Side

1. **Receive Turn**: Server receives Turn from client
2. **Validation**: Validate turn (player exists, valid action)
3. **Add to Queue**: Add turn to game's turn queue
4. **Process on Tick**: Process turn during next game tick

```typescript
// Server receives turn
gameServer.addTurn(clientID, turn);

// During game tick
const executions = executor.createExecs(turn);
game.addExecution(...executions);
```

## Deterministic Simulation

### Why Deterministic?

Both client and server simulate the game independently:

- Reduces network traffic (only send actions, not state)
- Enables client-side prediction
- Allows game replay

### Random Seed

Game uses deterministic random number generation:

```typescript
const random = new PseudoRandom(simpleHash(gameID));
```

Same game ID = same random sequence = same game state.

### Synchronization

**Hash Validation:**

- Every 10 ticks, game generates state hash
- Client sends hash to server
- Server validates hash matches
- Mismatch indicates desync (rare)

**Reconnection:**

- If client disconnects, can reconnect
- Server sends current game state
- Client resynchronizes

## Game State Updates

### Update Types

**Tile Updates:**

- Territory ownership changes
- Packed efficiently (BigUint64Array)
- Sent only when tiles change

**Unit Updates:**

- Unit created/destroyed/moved
- Unit properties changed
- Sent per unit change

**Player Updates:**

- Player resources changed
- Player stats updated
- Sent per player change

**Attack Updates:**

- Attack started/ended
- Attack progress
- Sent per attack change

**Message Updates:**

- In-game messages
- Chat messages
- Sent per message

### Update Batching

Updates are batched per tick:

```typescript
// During game tick
const updates: GameUpdates = {
  [GameUpdateType.Tile]: [...],
  [GameUpdateType.Unit]: [...],
  [GameUpdateType.Player]: [...],
  ...
};

// Sent to clients
sendToClients({
  tick: game.ticks(),
  updates: updates
});
```

## Client Simulation

### Worker Thread

Game simulation runs in Web Worker:

```typescript
// Main thread
const worker = new Worker("Worker.worker.ts");

// Send init message
worker.postMessage({
  type: "init",
  gameStartInfo: gameStartInfo,
});

// Send turn
worker.postMessage({
  type: "turn",
  turn: turn,
});

// Receive updates
worker.onmessage = (e) => {
  const update = e.data;
  gameView.update(update);
  renderer.tick();
};
```

### Game Runner

Worker runs `GameRunner`:

```typescript
// Worker thread
const gameRunner = await createGameRunner(
  gameStartInfo,
  clientID,
  mapLoader,
  (update) => {
    // Send update to main thread
    postMessage(update);
  },
);

// Process turns
onmessage = (e) => {
  if (e.data.type === "turn") {
    gameRunner.addTurn(e.data.turn);
  }
  gameRunner.executeNextTick();
};
```

## Server Architecture

### Game Server

Each game has a `GameServer` instance:

```typescript
class GameServer {
  private game: Game;
  private clients: Map<ClientID, Client>;

  addTurn(clientID: ClientID, turn: Turn) {
    // Validate and queue turn
    this.turnQueue.push({ clientID, turn });
  }

  tick() {
    // Process turns
    // Execute game tick
    // Send updates to clients
  }
}
```

### Worker Processes

Server uses worker processes for game simulation:

```typescript
// Master process
const worker = spawnWorker(workerIndex);

// Worker process
const gameManager = new GameManager();
setInterval(() => {
  gameManager.tick();
}, TICK_INTERVAL);
```

## Error Handling

### Client Errors

**Connection Loss:**

- Client detects disconnection
- Attempts reconnection
- Resynchronizes game state

**Desync Detection:**

- Hash mismatch detected
- Client requests full state
- Resynchronizes

### Server Errors

**Invalid Actions:**

- Server validates all actions
- Invalid actions ignored
- Error sent to client

**Player Disconnection:**

- Player marked as disconnected
- AI takes over (optional)
- Player can reconnect

## Performance Optimization

### Network Optimization

**Update Compression:**

- Tile updates packed efficiently
- Only changed data sent
- Batched updates

**Message Batching:**

- Multiple intents per turn
- Updates batched per tick
- Reduces WebSocket overhead

### Simulation Optimization

**Worker Threading:**

- Game simulation in background
- Main thread stays responsive
- Parallel processing

**Efficient Updates:**

- Only send changed state
- Batch similar updates
- Compress large updates

## Security Considerations

### Input Validation

**Server-Side Validation:**

- All actions validated on server
- Invalid actions rejected
- Prevents cheating

**Rate Limiting:**

- Limits actions per tick
- Prevents spam
- Prevents abuse

### State Integrity

**Hash Validation:**

- Regular hash checks
- Detects desync
- Prevents tampering

**Authoritative Server:**

- Server is source of truth
- Client simulation for prediction
- Server validates all actions

## Debugging

### Client Debugging

**Console Logging:**

```typescript
console.log("Game tick:", game.ticks());
console.log("Player actions:", playerActions);
```

**State Inspection:**

```typescript
// Inspect game state
console.log(game.players());
console.log(game.units());
```

### Server Debugging

**Server Logs:**

```typescript
logger.info("Game tick", { gameID, tick });
logger.error("Error processing turn", { error });
```

**Metrics:**

- Tick execution time
- Client count
- Game count

## Next Steps

- Learn about [Execution System](./05-execution-system.md) to understand action processing
- Read [Adding New Features](./06-adding-features.md) to add new actions
- Check [Development Guide](./07-development.md) for debugging tips
