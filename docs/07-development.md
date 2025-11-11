# Development Guide

This guide covers development setup, testing, debugging, and best practices for contributing to OpenFrontIO.

## Table of Contents

1. [Setup](#setup)
2. [Development Workflow](#development-workflow)
3. [Testing](#testing)
4. [Debugging](#debugging)
5. [Code Style](#code-style)
6. [Performance](#performance)
7. [Troubleshooting](#troubleshooting)

## Setup

### Prerequisites

- **Node.js**: v10.9.2 or higher
- **npm**: Comes with Node.js
- **Git**: For version control
- **Modern Browser**: Chrome, Firefox, Edge, etc.

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/openfrontio/OpenFrontIO.git
   cd OpenFrontIO
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Verify installation:**
   ```bash
   npm test
   ```

### Environment Setup

Create `.env` file (optional, uses defaults if not present):

```bash
cp example.env .env
```

Edit `.env` with your configuration if needed.

## Development Workflow

### Running Development Server

**Full development mode (client + server):**

```bash
npm run dev
```

This will:

- Start webpack dev server (client)
- Start game server (development mode)
- Open game in browser
- Enable hot reloading

**Client only:**

```bash
npm run start:client
```

**Server only:**

```bash
npm run start:server-dev
```

### Connecting to Staging/Production

**Staging:**

```bash
npm run dev:staging
```

**Production:**

```bash
npm run dev:prod
```

### Building for Production

**Build client:**

```bash
npm run build-prod
```

**Build development:**

```bash
npm run build-dev
```

## Testing

### Running Tests

**Run all tests:**

```bash
npm test
```

**Run tests in watch mode:**

```bash
npm test -- --watch
```

**Run specific test file:**

```bash
npm test -- Attack.test.ts
```

**Run tests with coverage:**

```bash
npm run test:coverage
```

### Writing Tests

**Test Structure:**

```typescript
import { describe, it, expect } from "@jest/globals";
import { AttackExecution } from "../src/core/execution/AttackExecution";

describe("AttackExecution", () => {
  it("creates attack on init", () => {
    // Arrange
    const exec = new AttackExecution(1000, player, targetID);

    // Act
    exec.init(game, 0);

    // Assert
    expect(player.outgoingAttacks().length).toBe(1);
  });
});
```

**Test Utilities:**

```typescript
import { setupGame } from "./util/Setup";

describe("MyFeature", () => {
  it("works correctly", () => {
    const game = setupGame();
    // Test with game
  });
});
```

### Test Requirements

**Required Tests:**

- All `src/core` changes must have tests
- Execution logic must be tested
- Game state changes must be tested

**Recommended Tests:**

- UI component tests
- Integration tests for complex features

### Test Best Practices

1. **Test Behavior, Not Implementation:**

   ```typescript
   // BAD
   expect(exec.privateField).toBe(5);

   // GOOD
   expect(game.units().length).toBe(1);
   ```

2. **Use Descriptive Test Names:**

   ```typescript
   // BAD
   it("test1", () => {});

   // GOOD
   it("creates unit when execution completes", () => {});
   ```

3. **Test Edge Cases:**

   ```typescript
   it("handles zero troops", () => {});
   it("handles disconnected player", () => {});
   it("handles game end during execution", () => {});
   ```

4. **Keep Tests Isolated:**
   ```typescript
   // Each test should be independent
   beforeEach(() => {
     // Reset state
   });
   ```

## Debugging

### Client-Side Debugging

**Browser DevTools:**

- Open browser DevTools (F12)
- Check Console for errors
- Use Debugger for breakpoints
- Inspect Network tab for WebSocket messages

**Console Logging:**

```typescript
console.log("Game tick:", game.ticks());
console.log("Player actions:", playerActions);
console.error("Error:", error);
```

**Debugging Game State:**

```typescript
// Inspect game state
console.log(game.players());
console.log(game.units());
console.log(game.alliances());
```

### Server-Side Debugging

**Server Logs:**

```typescript
import { Logger } from "./Logger";

const log = new Logger();
log.info("Game tick", { gameID, tick });
log.error("Error processing turn", { error });
```

**Debugging Executions:**

```typescript
// Add logging to executions
init(mg: Game, ticks: number) {
  console.log("Init execution:", this);
  // ...
}
```

### Debugging WebSocket

**Client:**

```typescript
ws.onmessage = (event) => {
  console.log("Received:", JSON.parse(event.data));
};
```

**Server:**

```typescript
client.on("message", (data) => {
  console.log("Received:", data);
});
```

### Debugging Deterministic Simulation

**Hash Validation:**

```typescript
// Check game state hash
const hash = game.hash();
console.log("Game hash:", hash);

// Compare client and server hashes
if (clientHash !== serverHash) {
  console.error("Desync detected!");
}
```

### Performance Debugging

**Tick Timing:**

```typescript
const startTime = performance.now();
game.executeNextTick();
const endTime = performance.now();
console.log("Tick duration:", endTime - startTime);
```

**Memory Profiling:**

- Use browser DevTools Memory profiler
- Check for memory leaks
- Monitor object counts

## Code Style

### Formatting

**Format code:**

```bash
npm run format
```

**Lint code:**

```bash
npm run lint
```

**Fix linting issues:**

```bash
npm run lint:fix
```

### TypeScript Guidelines

**Use Strict Types:**

```typescript
// BAD
function process(data: any) {}

// GOOD
function process(data: GameUpdate) {}
```

**Avoid `any`:**

```typescript
// BAD
const value: any = getValue();

// GOOD
const value: number = getValue();
```

**Use Interfaces:**

```typescript
// GOOD
interface PlayerAction {
  type: string;
  playerID: PlayerID;
}
```

### Naming Conventions

**Files:**

- PascalCase for classes: `PlayerImpl.ts`
- camelCase for utilities: `util.ts`

**Variables:**

- camelCase: `playerName`, `gameState`
- Descriptive names: `incomingAttacks` not `attacks`

**Constants:**

- UPPER_SNAKE_CASE: `MAX_TROOPS`, `TICK_INTERVAL`

**Classes:**

- PascalCase: `GameRunner`, `AttackExecution`

### Code Organization

**File Structure:**

```
src/
  core/
    game/          # Game entities
    execution/     # Executions
    configuration/ # Configuration
  client/
    graphics/      # Rendering
    ...           # Client logic
  server/
    ...           # Server logic
```

**Import Order:**

1. External dependencies
2. Internal core modules
3. Local imports
4. Type imports

## Performance

### Optimization Guidelines

1. **Avoid Expensive Operations in Tick:**

   ```typescript
   // BAD - searches all units every tick
   tick(ticks: number) {
     const units = game.units();
     units.forEach(...);
   }

   // GOOD - cache or use spatial index
   init(mg: Game, ticks: number) {
     this.units = mg.units(UnitType.Warship);
   }
   ```

2. **Use Early Returns:**

   ```typescript
   tick(ticks: number) {
     if (!this.isActive()) return;
     if (!this.unit) return;
     // Continue processing
   }
   ```

3. **Batch Operations:**

   ```typescript
   // BAD - multiple updates
   updates.forEach((u) => game.addUpdate(u));

   // GOOD - batch updates
   game.addUpdate(...updates);
   ```

4. **Cache Expensive Calculations:**

   ```typescript
   private cachedValue: number | null = null;

   getValue(): number {
     if (this.cachedValue === null) {
       this.cachedValue = expensiveCalculation();
     }
     return this.cachedValue;
   }
   ```

### Performance Testing

**Benchmark Tests:**

```typescript
import { benchmark } from "benchmark";

benchmark("AttackExecution", () => {
  const exec = new AttackExecution(...);
  exec.init(game, 0);
  exec.tick(1);
});
```

**Run Performance Tests:**

```bash
npm run perf
```

## Troubleshooting

### Common Issues

**Issue: Tests failing**

- Check Node.js version: `node --version`
- Clear node_modules: `rm -rf node_modules && npm install`
- Check test file syntax

**Issue: Build failing**

- Check TypeScript errors: `npm run lint`
- Check webpack errors
- Clear build cache

**Issue: Game not starting**

- Check server logs
- Check browser console
- Verify WebSocket connection
- Check game configuration

**Issue: Desync errors**

- Check random seed consistency
- Verify execution order
- Check for non-deterministic code
- Review hash validation

**Issue: Performance issues**

- Profile with DevTools
- Check tick execution time
- Look for memory leaks
- Optimize expensive operations

### Getting Help

1. **Check Documentation:**

   - Review relevant docs
   - Check code comments
   - Look at similar code

2. **Search Issues:**

   - Check GitHub issues
   - Search Discord history

3. **Ask for Help:**
   - Join [Discord](https://discord.gg/K9zernJB5z)
   - Create GitHub issue
   - Ask specific questions

## Best Practices

### Development

1. **Start Small:**

   - Make small, focused changes
   - Test incrementally
   - Get feedback early

2. **Follow Patterns:**

   - Look at similar features
   - Follow existing code style
   - Use existing utilities

3. **Write Tests:**

   - Write tests first (TDD)
   - Test edge cases
   - Keep tests simple

4. **Document Changes:**
   - Add code comments
   - Update docs if needed
   - Write clear commit messages

### Code Review

**Before Submitting:**

- [ ] Tests written and passing
- [ ] Code linted and formatted
- [ ] Manual testing completed
- [ ] Documentation updated
- [ ] No console.logs left
- [ ] No commented code
- [ ] Performance acceptable

**Review Checklist:**

- Code follows patterns
- Tests are comprehensive
- Edge cases handled
- Error handling present
- Performance acceptable
- Documentation updated

### Git Workflow

**Branch Naming:**

- `feature/description`: New features
- `fix/description`: Bug fixes
- `docs/description`: Documentation

**Commit Messages:**

```
feat: Add new unit type
fix: Fix attack execution bug
docs: Update architecture docs
```

**Pull Request:**

- Clear description
- Link related issues
- Include screenshots if UI changes
- Describe testing done

## Next Steps

- Read [Adding New Features](./06-adding-features.md) to start contributing
- Review [Architecture](./02-architecture.md) for system design
- Check [Core Game Systems](./03-core-systems.md) for game mechanics
