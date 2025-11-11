# Architecture

## Architecture Overview

OpenFront.io uses a client-server architecture with deterministic game simulation. The game state is simulated deterministically on both client and server, ensuring consistency while minimizing network traffic.

## System Components

### 1. Client (`src/client/`)

The client is responsible for:

- Rendering the game using PixiJS
- Handling user input
- Simulating game state locally
- Communicating with the server via WebSocket

**Key Files:**

- `Main.ts`: Entry point, manages UI and game lifecycle
- `ClientGameRunner.ts`: Manages game simulation on client
- `InputHandler.ts`: Handles user input (mouse, keyboard)
- `GameRenderer.ts`: Renders game graphics
- `graphics/layers/`: UI layer components

### 2. Core (`src/core/`)

Shared game logic used by both client and server:

- Game state simulation
- Game rules and mechanics
- Entity definitions (Player, Unit, Attack, etc.)

**Key Files:**

- `Game.ts`: Core game interfaces and types
- `GameImpl.ts`: Game state implementation
- `PlayerImpl.ts`: Player entity implementation
- `UnitImpl.ts`: Unit entity implementation
- `GameRunner.ts`: Game tick execution loop
- `execution/`: Action execution implementations

### 3. Server (`src/server/`)

The server manages:

- Game lobbies and matchmaking
- WebSocket connections
- Game state validation
- Game archiving

**Key Files:**

- `Server.ts`: Main server entry point
- `GameServer.ts`: Manages individual game instances
- `GameManager.ts`: Manages multiple games
- `Worker.ts`: Worker process management

## Game Loop Architecture

### Tick-Based System

The game runs on a deterministic tick-based system:

```
┌─────────────────────────────────────────┐
│           Game Tick (N)                  │
├─────────────────────────────────────────┤
│ 1. Process pending turns                 │
│ 2. Create Executions from turns          │
│ 3. Initialize new Executions             │
│ 4. Execute all active Executions         │
│ 5. Generate GameUpdates                  │
│ 6. Increment tick counter                │
└─────────────────────────────────────────┘
```

### Execution Flow

```
Player Action → Intent → Turn → Execution → Game Update
```

1. **Player Action**: User clicks/interacts with game
2. **Intent**: Client creates an Intent object
3. **Turn**: Intent is sent to server, added to turn queue
4. **Execution**: Server creates Execution object from Intent
5. **Game Update**: Execution modifies game state, generates updates

## Client-Server Communication

### WebSocket Protocol

The client and server communicate via WebSocket messages:

**Client → Server:**

- `Turn`: Player actions (attacks, builds, etc.)
- `Heartbeat`: Keep connection alive
- `Hash`: Game state hash for validation

**Server → Client:**

- `GameUpdate`: Game state updates
- `GameStart`: Game initialization data
- `Error`: Error messages

### Deterministic Simulation

Both client and server simulate the game state independently:

- Same random seed (based on game ID)
- Same execution order
- Same game rules

This allows:

- Reduced network traffic (only send player actions)
- Client-side prediction
- Game replay functionality

## Execution System

### Execution Interface

All game actions are implemented as `Execution` objects:

```typescript
interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
}
```

### Execution Lifecycle

1. **Creation**: Execution created from player Intent
2. **Initialization**: `init()` called once when execution starts
3. **Ticking**: `tick()` called every game tick while active
4. **Completion**: Execution sets `isActive()` to false

### Example: AttackExecution

```typescript
class AttackExecution implements Execution {
  init(mg: Game, ticks: number) {
    // Create attack, remove troops from player
    this.attack = this.owner.createAttack(...);
  }

  tick(ticks: number) {
    // Advance attack, conquer tiles
    if (this.attack.isActive()) {
      this.conquerTiles();
    } else {
      this.active = false;
    }
  }
}
```

## Game State Management

### Game Updates

Game state changes are communicated via `GameUpdate` objects:

```typescript
type GameUpdate =
  | TileUpdate      // Territory ownership change
  | UnitUpdate      // Unit created/destroyed/moved
  | PlayerUpdate    // Player stats/resources changed
  | AttackUpdate    // Attack started/ended
  | MessageUpdate   // In-game message
  | ...
```

### Update Batching

Updates are batched per tick and sent to clients:

- Reduces network overhead
- Ensures atomic state changes
- Simplifies client-side rendering

## Rendering Architecture

### PixiJS Layers

The client uses a layered rendering system:

```
┌─────────────────────────┐
│   UI Layer              │  (Modals, menus, HUD)
├─────────────────────────┤
│   Name Layer            │  (Player names)
├─────────────────────────┤
│   Unit Layer            │  (Units and structures)
├─────────────────────────┤
│   Territory Layer       │  (Territory colors)
├─────────────────────────┤
│   Background Layer      │  (Map terrain)
└─────────────────────────┘
```

### Layer System

Each layer is a separate PixiJS container:

- Independent update cycles
- Efficient culling and rendering
- Easy to add/remove layers

**Key Layers:**

- `TerritoryLayer`: Renders territory colors
- `UnitDisplay`: Renders units and structures
- `NameLayer`: Renders player names
- `FxLayer`: Renders visual effects (explosions, etc.)
- `UILayer`: Renders UI elements

## Worker Architecture

### Web Worker

Game simulation runs in a Web Worker:

- Keeps main thread responsive
- Allows background processing
- Enables parallel computation

### Worker Communication

```
Main Thread          Web Worker
    │                    │
    │─── init ──────────>│
    │                    │─── createGameRunner()
    │                    │
    │─── turn ──────────>│
    │                    │─── executeNextTick()
    │<─── update ────────│
    │                    │
```

## Configuration System

### Config Hierarchy

```
DefaultConfig (base)
    ↓
DevConfig / ProdConfig (environment-specific)
    ↓
GameConfig (per-game settings)
```

### Config Types

- **ServerConfig**: Server settings (ports, workers, etc.)
- **GameConfig**: Game rules (map, mode, difficulty, etc.)
- **Theme**: Visual theme (colors, fonts, etc.)

## Data Flow

### Player Action Flow

```
User Input
    ↓
InputHandler
    ↓
Intent Creation
    ↓
WebSocket Send
    ↓
Server Receives
    ↓
Turn Queue
    ↓
Execution Creation
    ↓
Game State Update
    ↓
GameUpdate Generation
    ↓
WebSocket Send
    ↓
Client Receives
    ↓
GameView Update
    ↓
Renderer Update
```

## Performance Considerations

### Optimization Strategies

1. **Spatial Indexing**: Units stored in spatial grid for fast queries
2. **Update Batching**: Multiple updates combined per tick
3. **Lazy Computation**: Expensive calculations cached
4. **Worker Threading**: Game simulation in background
5. **Efficient Rendering**: Only render visible areas

### Memory Management

- Units marked for deletion, cleaned up periodically
- Old game updates discarded
- Efficient data structures (Sets, Maps)

## Next Steps

- Read [Core Game Systems](./03-core-systems.md) for detailed mechanics
- Learn about [Execution System](./05-execution-system.md) in detail
- See [Adding New Features](./06-adding-features.md) for implementation guides
