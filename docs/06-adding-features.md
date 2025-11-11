# Adding New Features

This guide walks you through adding new features to OpenFrontIO. Follow these steps to extend the game safely and correctly.

## Table of Contents

1. [Adding a New Unit Type](#adding-a-new-unit-type)
2. [Adding a New Execution](#adding-a-new-execution)
3. [Adding a New Intent Type](#adding-a-new-intent-type)
4. [Adding a New Game Update](#adding-a-new-game-update)
5. [Adding UI Elements](#adding-ui-elements)
6. [Adding Radial Menu Items](#adding-radial-menu-items)
7. [Best Practices](#best-practices)

## Adding a New Unit Type

### Step 1: Define Unit Type

Add to `src/core/game/Game.ts`:

```typescript
export enum UnitType {
  // ... existing types
  NewUnit = "New Unit",
}
```

### Step 2: Define Unit Info

Add to `src/core/configuration/DefaultConfig.ts`:

```typescript
unitInfo(type: UnitType): UnitInfo {
  switch (type) {
    // ... existing cases
    case UnitType.NewUnit:
      return {
        cost: this.costWrapper(() => 100_000, UnitType.NewUnit),
        territoryBound: true,
        maxHealth: 500,
        damage: 100,
        constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        upgradable: true,
      };
  }
}
```

### Step 3: Implement Unit Logic

Create `src/core/game/NewUnitImpl.ts` (if needed) or extend `UnitImpl.ts`:

```typescript
// Most units can use UnitImpl directly
// Only create custom implementation if special behavior needed
```

### Step 4: Add Unit Parameters

If unit needs special parameters, add to `UnitParamsMap` in `Game.ts`:

```typescript
export interface UnitParamsMap {
  // ... existing
  [UnitType.NewUnit]: {
    specialProperty: number;
  };
}
```

### Step 5: Add Execution

Create `src/core/execution/NewUnitExecution.ts`:

```typescript
import {
  Execution,
  Game,
  Player,
  UnitType,
  TileRef,
  UnitParams,
} from "../game/Game";

export class NewUnitExecution implements Execution {
  private active = true;
  private unit: Unit | null = null;
  private constructionTicks = 0;
  private readonly CONSTRUCTION_DURATION = 5 * 10; // 5 seconds at 10 ticks/second

  constructor(
    private owner: Player,
    private spawnTile: TileRef,
    private params: UnitParams<UnitType.NewUnit>,
  ) {}

  init(mg: Game, ticks: number): void {
    // Check if can build
    const canBuild = this.owner.canBuild(UnitType.NewUnit, this.spawnTile);
    if (canBuild === false) {
      console.warn("Cannot build NewUnit at tile:", this.spawnTile);
      this.active = false;
      return;
    }

    // Check if instant build (spawn phase or config setting)
    if (mg.inSpawnPhase() || mg.config().instantBuild()) {
      // Build immediately
      this.unit = this.owner.buildUnit(
        UnitType.NewUnit,
        this.spawnTile,
        this.params,
      );
      this.active = false;
    } else {
      // Start construction
      this.constructionTicks = 0;
      // Create construction unit
      const construction = this.owner.buildUnit(
        UnitType.Construction,
        this.spawnTile,
        {},
      );
      construction.setConstructionType(UnitType.NewUnit);
    }
  }

  tick(ticks: number): void {
    if (!this.active) return;

    // Handle construction
    if (this.unit === null) {
      this.constructionTicks++;

      if (this.constructionTicks >= this.CONSTRUCTION_DURATION) {
        // Complete construction
        const construction = this.owner
          .units(UnitType.Construction)
          .find(
            (u) =>
              u.tile() === this.spawnTile &&
              u.constructionType() === UnitType.NewUnit,
          );

        if (construction) {
          // Build the actual unit
          this.unit = this.owner.buildUnit(
            UnitType.NewUnit,
            this.spawnTile,
            this.params,
          );
          // Remove construction
          construction.delete();
        }

        this.active = false;
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true; // Can build during spawn phase
  }
}
```

**Key Points:**

- Check if building is allowed before proceeding
- Handle instant build vs construction duration
- Create construction unit for visual feedback
- Clean up construction unit when done
- Set `active = false` when complete

### Step 6: Add to Execution Manager

Update `src/core/execution/ExecutionManager.ts`:

```typescript
import { NewUnitExecution } from "./NewUnitExecution";

export class Executor {
  createExec(intent: Intent): Execution {
    const player = this.mg.playerByClientID(intent.clientID);
    if (!player) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    switch (intent.type) {
      // ... existing cases
      case "build_new_unit": {
        return new NewUnitExecution(player, intent.tile, intent.params);
      }
      // ... more cases
    }
  }
}
```

**Important Notes:**

- Always check if player exists before creating execution
- Return `NoOpExecution` if player not found
- Pass correct parameters to execution constructor
- Handle errors gracefully

### Step 7: Add Intent Type

Update `src/core/Schemas.ts`:

```typescript
export type Intent =
  // ... existing types
  {
    type: "build_new_unit";
    clientID: ClientID;
    tile: TileRef;
    params: UnitParams<UnitType.NewUnit>;
  };
```

**Intent Structure:**

- `type`: Unique string identifier for the intent type
- `clientID`: ID of the client sending the intent
- Additional fields: Intent-specific data

**Best Practices:**

- Use descriptive type names: `build_new_unit` not `build1`
- Include all necessary data in intent
- Keep intent data minimal (don't include computed values)

### Step 8: Add Client UI

Update `src/client/graphics/layers/BuildMenu.ts`:

```typescript
import { UnitType } from "../../../core/game/Game";
import newUnitIcon from "../../../../resources/images/NewUnitIcon.svg";

export const buildTable: BuildItemDisplay[][] = [
  [
    // ... existing units
    {
      unitType: UnitType.NewUnit,
      icon: newUnitIcon,
      description: "build_menu.desc.new_unit",
      key: "unit_type.new_unit",
      countable: true, // Shows count in tooltip
    },
  ],
];
```

**BuildItemDisplay Properties:**

- `unitType`: The unit type enum value
- `icon`: Path to icon SVG file
- `description`: Translation key for description
- `key`: Translation key for unit name
- `countable`: Whether to show count in tooltip

**Icon Requirements:**

- SVG format preferred
- White/light colored (menu uses dark background)
- Square aspect ratio recommended
- Size: 32x32px or larger (scaled automatically)

### Step 9: Add Sprite

Add sprite to `resources/sprites/newunit.png` and update sprite loader if needed.

**Sprite Requirements:**

- PNG format
- Transparent background
- Appropriate size (typically 64x64px or larger)
- Clear, recognizable design
- Matches game art style

**Sprite Loading:**
Most sprites are loaded automatically. If you need custom loading logic, update `src/client/graphics/SpriteLoader.ts`.

### Step 10: Add Translations

Add to `resources/lang/en.json`:

```json
{
  "unit_type": {
    "new_unit": "New Unit"
  },
  "build_menu": {
    "desc": {
      "new_unit": "A new unit that does something special"
    }
  }
}
```

**Translation Keys:**

- `unit_type.*`: Unit name translations
- `build_menu.desc.*`: Unit description translations
- Use descriptive keys: `unit_type.new_unit` not `unit1`

**Adding to Other Languages:**

- Add same keys to other language files in `resources/lang/`
- Use Crowdin for community translations
- Keep keys consistent across languages

### Step 11: Add Tests

Create `tests/NewUnitExecution.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "@jest/globals";
import { NewUnitExecution } from "../src/core/execution/NewUnitExecution";
import { UnitType } from "../src/core/game/Game";
import { setupGame, createPlayer } from "./util/Setup";

describe("NewUnitExecution", () => {
  let game: Game;
  let player: Player;

  beforeEach(() => {
    const setup = setupGame();
    game = setup.game;
    player = createPlayer(setup.game, "TestPlayer");
  });

  it("creates new unit on init in spawn phase", () => {
    const tile = game.ref(10, 10);
    const exec = new NewUnitExecution(player, tile, {});

    exec.init(game, 0);

    expect(game.units(UnitType.NewUnit).length).toBe(1);
    expect(exec.isActive()).toBe(false);
  });

  it("creates construction unit during game phase", () => {
    // Exit spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const tile = game.ref(10, 10);
    player.conquer(tile);
    const exec = new NewUnitExecution(player, tile, {});

    exec.init(game, game.ticks());

    expect(game.units(UnitType.Construction).length).toBe(1);
    expect(exec.isActive()).toBe(true);
  });

  it("completes construction after duration", () => {
    // Exit spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const tile = game.ref(10, 10);
    player.conquer(tile);
    const exec = new NewUnitExecution(player, tile, {});

    exec.init(game, game.ticks());

    // Advance ticks
    for (let i = 0; i < 50; i++) {
      exec.tick(game.ticks());
      game.executeNextTick();
    }

    expect(game.units(UnitType.NewUnit).length).toBe(1);
    expect(game.units(UnitType.Construction).length).toBe(0);
    expect(exec.isActive()).toBe(false);
  });

  it("fails if cannot build", () => {
    const tile = game.ref(10, 10);
    // Don't conquer tile - should fail
    const exec = new NewUnitExecution(player, tile, {});

    exec.init(game, game.ticks());

    expect(game.units(UnitType.NewUnit).length).toBe(0);
    expect(exec.isActive()).toBe(false);
  });
});
```

**Test Coverage:**

- ✅ Unit creation in spawn phase
- ✅ Construction during game phase
- ✅ Construction completion
- ✅ Error handling
- ✅ Edge cases

**Test Best Practices:**

- Test both spawn phase and game phase
- Test error conditions
- Test edge cases
- Use descriptive test names
- Keep tests isolated

## Adding a New Execution

### Step 1: Create Execution Class

Create `src/core/execution/NewExecution.ts`:

```typescript
import { Execution, Game } from "../game/Game";

export class NewExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private param1: number,
    private param2: string,
  ) {}

  init(mg: Game, ticks: number): void {
    // Initialize execution
    // Create entities, modify state
  }

  tick(ticks: number): void {
    // Update every tick
    if (this.shouldComplete()) {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false; // or true if should run during spawn
  }

  private shouldComplete(): boolean {
    // Check completion conditions
    return false;
  }
}
```

### Step 2: Add to Execution Manager

Update `src/core/execution/ExecutionManager.ts`:

```typescript
createExec(intent: Intent): Execution {
  switch (intent.type) {
    // ... existing cases
    case "new_action":
      return new NewExecution(
        player,
        intent.param1,
        intent.param2
      );
  }
}
```

### Step 3: Add Intent Type

Update `src/core/Schemas.ts`:

```typescript
export type Intent =
  // ... existing types
  {
    type: "new_action";
    clientID: ClientID;
    param1: number;
    param2: string;
  };
```

### Step 4: Add Client Handler

Update `src/client/InputHandler.ts` or appropriate handler:

```typescript
handleNewAction(param1: number, param2: string) {
  const intent: Intent = {
    type: "new_action",
    clientID: this.clientID,
    param1,
    param2,
  };

  this.sendTurn([intent]);
}
```

### Step 5: Add Tests

Create `tests/NewExecution.test.ts`:

```typescript
describe("NewExecution", () => {
  it("executes correctly", () => {
    const exec = new NewExecution(player, 5, "test");
    exec.init(game, 0);

    expect(exec.isActive()).toBe(true);

    exec.tick(1);
    // Assert expected behavior
  });
});
```

## Adding a New Intent Type

### Step 1: Define Intent Schema

Update `src/core/Schemas.ts`:

```typescript
export type Intent =
  // ... existing types
  {
    type: "new_intent";
    clientID: ClientID;
    // Add intent-specific fields
    field1: number;
    field2: string;
  };
```

### Step 2: Add Execution

Create execution class (see [Adding a New Execution](#adding-a-new-execution)).

### Step 3: Add to Execution Manager

Update `ExecutionManager.ts` to handle new intent type.

### Step 4: Add Client Handler

Add handler in appropriate client file to create and send intent.

## Adding a New Game Update

### Step 1: Define Update Type

Update `src/core/game/GameUpdates.ts`:

```typescript
export enum GameUpdateType {
  // ... existing types
  NewUpdate = "NewUpdate",
}

export type GameUpdate =
  // ... existing types
  {
    type: GameUpdateType.NewUpdate;
    // Add update-specific fields
    field1: number;
    field2: string;
  };
```

### Step 2: Generate Updates

In your execution or game logic:

```typescript
this.mg.addUpdate({
  type: GameUpdateType.NewUpdate,
  field1: 5,
  field2: "value",
});
```

### Step 3: Handle Updates Client-Side

Update `src/client/ClientGameRunner.ts` or appropriate handler:

```typescript
gu.updates[GameUpdateType.NewUpdate].forEach((update) => {
  // Handle update
  this.handleNewUpdate(update);
});
```

## Adding UI Elements

### Step 1: Create UI Component

Create `src/client/graphics/layers/NewUIElement.ts`:

```typescript
import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { Layer } from "./Layer";

@customElement("new-ui-element")
export class NewUIElement extends LitElement implements Layer {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      /* Add your styles */
    }
  `;

  render() {
    return html`
      <!-- Component HTML -->
      <div class="ui-container">
        <!-- Your UI content -->
      </div>
    `;
  }

  init() {
    // Initialize component
  }

  tick() {
    // Update component every tick if needed
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render to canvas if needed
  }

  shouldTransform(): boolean {
    return false; // Return true if should transform with camera
  }
}
```

### Step 2: Add to Renderer

Update `src/client/graphics/GameRenderer.ts`:

```typescript
import { NewUIElement } from "./layers/NewUIElement";

export class GameRenderer {
  private newUIElement: NewUIElement;

  initialize() {
    // ... existing initialization
    this.newUIElement = new NewUIElement();
    this.newUIElement.init();
    // Add to appropriate layer
    this.uiLayer.addChild(this.newUIElement);
  }

  tick() {
    // ... existing tick logic
    this.newUIElement.tick();
  }
}
```

### Step 3: Update UI State

Update `src/client/graphics/UIState.ts` if needed for UI state management:

```typescript
export class UIState {
  // Add state properties
  private newUIState: boolean = false;

  // Add getters/setters
  setNewUIState(state: boolean) {
    this.newUIState = state;
  }

  getNewUIState(): boolean {
    return this.newUIState;
  }
}
```

### Step 4: Handle Events

Connect UI element to event bus if needed:

```typescript
constructor(private eventBus: EventBus) {
  super();

  this.eventBus.on(SomeEvent, (event) => {
    // Handle event
    this.updateUI();
  });
}
```

## Adding Radial Menu Items

For detailed information on adding radial menu items, see the [Radial Menu System](./08-radial-menu.md) documentation.

### Quick Example

```typescript
// In RadialMenuElements.ts
export const myNewMenuItem: MenuElement = {
  id: "my_new_item",
  name: "My New Item",
  disabled: (params: MenuElementParams) => {
    return params.game.inSpawnPhase();
  },
  color: "#ff0000",
  icon: myIconPath,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleMyNewAction(params.tile);
    params.closeMenu();
  },
};

// Add to rootMenuElement.subMenu
export const rootMenuElement: MenuElement = {
  // ...
  subMenu: (params: MenuElementParams) => {
    return [
      // ... existing items
      myNewMenuItem,
    ];
  },
};
```

See [Radial Menu System](./08-radial-menu.md) for complete details.

## Best Practices

### 1. Follow Existing Patterns

Look at similar features and follow their patterns:

- Similar units → follow unit pattern
- Similar executions → follow execution pattern
- Similar UI → follow UI pattern

### 2. Write Tests

**Required for core changes:**

- All `src/core` changes must have tests
- Test execution logic
- Test game state changes

**Recommended for client changes:**

- Test UI components
- Test user interactions

### 3. Update Documentation

Update relevant documentation:

- Add to this guide if new pattern
- Update API docs if public API
- Update README if user-facing

### 4. Handle Edge Cases

Consider:

- What if player disconnects?
- What if unit destroyed during execution?
- What if game ends during execution?
- What if invalid input?

### 5. Performance

Keep efficient:

- Avoid expensive operations every tick
- Cache results when possible
- Use early returns
- Batch operations

### 6. Error Handling

Handle errors gracefully:

- Validate inputs
- Check preconditions
- Log errors
- Fail safely

### 7. Code Style

Follow project conventions:

- Use TypeScript strictly
- Follow naming conventions
- Use existing utilities
- Match code style

### 8. Translation Support

Add translations:

- Add to `resources/lang/en.json`
- Use translation keys in UI
- Support all languages

### 9. Backward Compatibility

Consider:

- Can old games replay with new code?
- Are new features optional?
- Do changes break existing features?

### 10. Review Process

Before submitting:

- Run tests: `npm test`
- Lint code: `npm run lint`
- Format code: `npm run format`
- Test manually
- Get code review

## Common Patterns

### Pattern: Conditional Execution

```typescript
tick(ticks: number) {
  if (!this.precondition()) {
    this.active = false;
    return;
  }

  // Continue execution
}
```

### Pattern: Timed Execution

```typescript
private startTick: number = 0;
private duration: number = 100;

init(mg: Game, ticks: number) {
  this.startTick = ticks;
}

tick(ticks: number) {
  if (ticks - this.startTick >= this.duration) {
    this.complete();
    this.active = false;
  }
}
```

### Pattern: State Machine

```typescript
private state: "init" | "active" | "completing" = "init";

tick(ticks: number) {
  switch (this.state) {
    case "init":
      this.initialize();
      this.state = "active";
      break;
    case "active":
      this.update();
      if (this.shouldComplete()) {
        this.state = "completing";
      }
      break;
    case "completing":
      this.finish();
      this.active = false;
      break;
  }
}
```

## Testing Checklist

Before submitting a feature:

- [ ] Unit tests written and passing
- [ ] Integration tests if applicable
- [ ] Manual testing completed
- [ ] Edge cases handled
- [ ] Error cases handled
- [ ] Performance acceptable
- [ ] Code linted and formatted
- [ ] Documentation updated
- [ ] Translations added
- [ ] Backward compatibility considered

## Getting Help

If stuck:

1. Check existing similar features
2. Review [Architecture](./02-architecture.md) docs
3. Ask in [Discord](https://discord.gg/K9zernJB5z)
4. Check GitHub issues
5. Review test files for examples

## Next Steps

- Read [Development Guide](./07-development.md) for setup and testing
- Review [Core Game Systems](./03-core-systems.md) for game mechanics
- Check [Architecture](./02-architecture.md) for system design
