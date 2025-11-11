# Execution System

The execution system is the core mechanism for processing player actions and game events. This document explains how it works.

## Overview

The execution system converts player actions (Intents) into executable game logic (Executions) that run over multiple game ticks.

## Execution Interface

All executions implement the `Execution` interface:

```typescript
interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
}
```

### Methods

**`isActive()`**: Returns whether execution should continue running

- `true`: Execution continues
- `false`: Execution removed from game

**`activeDuringSpawnPhase()`**: Whether execution runs during spawn phase

- `true`: Runs during spawn phase
- `false`: Only runs after spawn phase

**`init(mg: Game, ticks: number)`**: Called once when execution starts

- Initialize execution state
- Create game entities
- Set up initial conditions

**`tick(ticks: number)`**: Called every game tick while active

- Update execution state
- Modify game state
- Check completion conditions

## Execution Lifecycle

```
Intent → Execution Creation → init() → tick() → tick() → ... → isActive() = false
```

1. **Creation**: Execution created from Intent
2. **Initialization**: `init()` called once
3. **Ticking**: `tick()` called every game tick
4. **Completion**: `isActive()` returns false, execution removed

## Execution Manager

The `ExecutionManager` (Executor) creates executions from intents:

```typescript
class Executor {
  createExec(intent: Intent): Execution {
    switch (intent.type) {
      case "attack":
        return new AttackExecution(...);
      case "spawn":
        return new SpawnExecution(...);
      // ... more cases
    }
  }
}
```

## Game Tick Processing

During each game tick:

```typescript
executeNextTick() {
  // 1. Process new executions
  const newExecutions = executor.createExecs(turn);
  game.addExecution(...newExecutions);

  // 2. Initialize new executions
  unInitExecs.forEach(exec => {
    if (!inSpawnPhase() || exec.activeDuringSpawnPhase()) {
      exec.init(game, ticks);
      inited.push(exec);
    }
  });

  // 3. Execute active executions
  execs.forEach(exec => {
    if (exec.isActive()) {
      exec.tick(ticks);
    }
  });

  // 4. Remove inactive executions
  removeInactiveExecutions();
}
```

## Common Execution Patterns

### One-Tick Execution

Executions that complete immediately:

```typescript
class SpawnExecution implements Execution {
  private active = true;

  init(mg: Game, ticks: number) {
    // Spawn player
    mg.spawnPlayer(this.playerInfo, this.tile);
    this.active = false;
  }

  tick(ticks: number) {
    // Already completed
  }

  isActive() {
    return this.active;
  }
}
```

### Multi-Tick Execution

Executions that run over multiple ticks:

```typescript
class AttackExecution implements Execution {
  private active = true;
  private attack: Attack | null = null;

  init(mg: Game, ticks: number) {
    // Create attack
    this.attack = this.owner.createAttack(...);
  }

  tick(ticks: number) {
    if (!this.attack.isActive()) {
      this.active = false;
      return;
    }

    // Advance attack
    this.conquerTiles();
  }

  isActive() {
    return this.active;
  }
}
```

### Conditional Execution

Executions that check conditions:

```typescript
class CityExecution implements Execution {
  private active = true;
  private constructionTicks = 0;

  init(mg: Game, ticks: number) {
    // Start construction
  }

  tick(ticks: number) {
    this.constructionTicks++;

    if (this.constructionTicks >= CONSTRUCTION_DURATION) {
      // Complete construction
      this.createCity();
      this.active = false;
    }
  }

  isActive() {
    return this.active && !this.cityDestroyed;
  }
}
```

## Example Executions

### AttackExecution

Handles ground attacks:

```typescript
class AttackExecution implements Execution {
  constructor(
    private troops: number,
    private owner: Player,
    private targetID: PlayerID,
  ) {}

  init(mg: Game, ticks: number) {
    const target = mg.player(this.targetID);

    // Remove troops from owner
    this.owner.removeTroops(this.troops);

    // Create attack
    this.attack = this.owner.createAttack(
      target,
      this.troops,
      null, // sourceTile
      new Set(),
    );
  }

  tick(ticks: number) {
    if (!this.attack.isActive()) {
      this.active = false;
      return;
    }

    // Conquer tiles
    this.conquerTiles();
  }

  private conquerTiles() {
    // Attack logic here
    // Conquer border tiles
    // Update attack state
  }
}
```

### NukeExecution

Handles nuclear weapon launches:

```typescript
class NukeExecution implements Execution {
  private nuke: Unit | null = null;

  init(mg: Game, ticks: number) {
    // Create nuke unit
    this.nuke = this.owner.buildUnit(UnitType.AtomBomb, this.spawnTile, {
      trajectory: this.trajectory,
    });
  }

  tick(ticks: number) {
    if (!this.nuke || !this.nuke.isActive()) {
      this.active = false;
      return;
    }

    // Move nuke along trajectory
    this.advanceNuke();

    if (this.nuke.reachedTarget()) {
      // Explode
      this.explode();
      this.active = false;
    }
  }
}
```

### AllianceRequestExecution

Handles alliance requests:

```typescript
class AllianceRequestExecution implements Execution {
  private request: AllianceRequest | null = null;

  init(mg: Game, ticks: number) {
    const recipient = mg.player(this.recipientID);

    if (!this.requestor.canSendAllianceRequest(recipient)) {
      this.active = false;
      return;
    }

    // Create alliance request
    this.request = this.requestor.createAllianceRequest(recipient);
  }

  tick(ticks: number) {
    // Check if request expired
    if (
      this.request.status() === "accepted" ||
      this.request.status() === "rejected"
    ) {
      this.active = false;
      return;
    }

    // Check expiration
    if (
      mg.ticks() - this.request.createdAt() >
      mg.config().allianceRequestDuration()
    ) {
      this.request.reject();
      this.active = false;
    }
  }
}
```

## Execution Best Practices

### 1. Clean State Management

Always clean up when execution completes:

```typescript
tick(ticks: number) {
  if (this.shouldComplete()) {
    this.cleanup();
    this.active = false;
  }
}
```

### 2. Error Handling

Handle errors gracefully:

```typescript
init(mg: Game, ticks: number) {
  try {
    // Initialize
  } catch (error) {
    console.error("Execution init failed:", error);
    this.active = false;
  }
}
```

### 3. Performance

Keep tick() methods efficient:

```typescript
tick(ticks: number) {
  // Avoid expensive operations every tick
  // Cache results when possible
  // Use early returns
}
```

### 4. State Validation

Validate state before modifying:

```typescript
tick(ticks: number) {
  if (!this.attack || !this.attack.isActive()) {
    this.active = false;
    return;
  }

  // Safe to proceed
}
```

## Execution Ordering

Executions are processed in order:

1. New executions initialized
2. Active executions ticked
3. Inactive executions removed

Within each phase, order is not guaranteed. If order matters, use dependencies or multiple execution types.

## Spawn Phase

Some executions only run after spawn phase:

```typescript
activeDuringSpawnPhase(): boolean {
  return false; // Only runs after spawn
}
```

Common spawn-phase-only executions:

- Attacks
- Unit construction
- Alliances

Spawn-phase executions:

- Player spawning
- NPC spawning
- Bot spawning

## Testing Executions

Test executions in isolation:

```typescript
describe("AttackExecution", () => {
  it("creates attack on init", () => {
    const exec = new AttackExecution(1000, player, targetID);
    exec.init(game, 0);

    expect(player.outgoingAttacks().length).toBe(1);
  });

  it("conquers tiles over time", () => {
    const exec = new AttackExecution(1000, player, targetID);
    exec.init(game, 0);

    exec.tick(1);
    exec.tick(2);

    expect(exec.isActive()).toBe(true);
  });
});
```

## Common Pitfalls

### 1. Forgetting to Set active = false

Always set `active = false` when done:

```typescript
// BAD
tick(ticks: number) {
  if (this.completed) {
    return; // Execution never removed!
  }
}

// GOOD
tick(ticks: number) {
  if (this.completed) {
    this.active = false;
    return;
  }
}
```

### 2. Modifying Game State in init()

Avoid modifying game state in `init()` if it should happen over time:

```typescript
// BAD - happens instantly
init(mg: Game, ticks: number) {
  this.conquerAllTiles(); // Should happen over time
}

// GOOD - happens over ticks
init(mg: Game, ticks: number) {
  // Setup only
}

tick(ticks: number) {
  this.conquerTiles(); // Happens over time
}
```

### 3. Not Checking isActive()

Always check if execution should continue:

```typescript
tick(ticks: number) {
  if (!this.isActive()) {
    return; // Early return
  }

  // Continue processing
}
```

## Next Steps

- Read [Adding New Features](./06-adding-features.md) to create new executions
- Check [Core Game Systems](./03-core-systems.md) for game mechanics
- Review [Development Guide](./07-development.md) for testing tips
