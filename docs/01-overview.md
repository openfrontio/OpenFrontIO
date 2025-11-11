# Game Overview

## What is OpenFront.io?

OpenFront.io is an online real-time strategy game focused on territorial control and alliance building. Players compete to expand their territory, build structures, manage resources, and form strategic alliances across various maps based on real-world geography.

## Key Features

### Core Gameplay

- **Territorial Control**: Expand your territory by conquering tiles
- **Resource Management**: Balance gold and troops for expansion and defense
- **Unit Construction**: Build various structures and units to strengthen your position
- **Combat System**: Engage in ground attacks and naval warfare
- **Alliance System**: Form alliances with other players for mutual defense
- **Diplomacy**: Manage relations, send emojis, donate resources, and embargo enemies

### Game Modes

- **Singleplayer**: Play against AI bots and NPCs
- **Public**: Join public multiplayer games
- **Private**: Create private lobbies with friends

### Game Types

- **Free For All**: Every player for themselves
- **Team**: Players are assigned to teams

### Maps

The game features 30+ maps including:

- Continental maps (World, Europe, Asia, Africa, etc.)
- Regional maps (Iceland, Japan, Britannia, etc.)
- Fantasy maps (Mars, Pluto, Pangaea, etc.)

## Technology Stack

- **Language**: TypeScript
- **Client**: PixiJS for rendering, Webpack for bundling
- **Server**: Node.js with Express and WebSockets
- **Architecture**: Client-server with deterministic game simulation
- **Testing**: Jest

## Project Structure

```
OpenFrontIO/
├── src/
│   ├── client/          # Frontend game client
│   │   ├── graphics/     # Rendering and UI layers
│   │   ├── sound/        # Audio management
│   │   └── ...          # Client-side logic
│   ├── core/            # Shared game logic
│   │   ├── game/        # Core game entities (Player, Unit, Game)
│   │   ├── execution/   # Game action executions
│   │   ├── configuration/ # Game configuration
│   │   └── ...          # Shared utilities
│   └── server/          # Backend game server
│       ├── GameServer.ts # Game server logic
│       ├── Worker.ts     # Worker processes
│       └── ...          # Server-side logic
├── resources/           # Static assets
│   ├── maps/           # Game map files
│   ├── sprites/        # Unit sprites
│   ├── lang/           # Translation files
│   └── ...
├── tests/              # Test files
└── docs/               # Documentation (this folder)
```

## Core Concepts

### Game Tick

The game runs on a deterministic tick-based system. Each tick represents a fixed time interval where game state updates occur.

### Execution System

Player actions are converted into `Execution` objects that are processed during game ticks. This ensures deterministic gameplay and allows for replay functionality.

### Deterministic Simulation

The game uses deterministic random number generation based on the game ID seed. This ensures all clients simulate the same game state without constant synchronization.

### Client-Server Architecture

- **Server**: Manages game lobbies, validates actions, and coordinates game state
- **Client**: Renders the game, handles user input, and simulates game state locally
- **Worker**: Runs game simulation in a Web Worker for performance

## Game Flow

1. **Lobby Phase**: Players join a lobby and configure game settings
2. **Spawn Phase**: Players select spawn locations (or random spawn)
3. **Game Phase**: Main gameplay loop with turns and ticks
4. **End Phase**: Winner is determined and game is archived

## Key Entities

### Player

Represents a player in the game with:

- Territory (owned tiles)
- Resources (gold, troops)
- Units (structures and mobile units)
- Relations (diplomatic status with other players)
- Alliances (active alliances)

### Unit

Represents any game entity:

- **Structures**: City, Port, Defense Post, SAM Launcher, Missile Silo, Factory
- **Mobile Units**: Transport Ship, Warship, Trade Ship, Train
- **Projectiles**: Shell, SAM Missile
- **Nukes**: Atom Bomb, Hydrogen Bomb, MIRV, MIRV Warhead

### Attack

Represents an ongoing attack between players:

- Ground attacks (conquering territory)
- Naval attacks (boat invasions)
- Can be retreated or cancelled

### Alliance

Represents a diplomatic alliance between two players:

- Temporary (expires after a duration)
- Can be extended by mutual agreement
- Can be broken by either player

## Next Steps

- Read [Architecture](./02-architecture.md) to understand the system design
- Explore [Core Game Systems](./03-core-systems.md) to learn about game mechanics
- Check [Adding New Features](./06-adding-features.md) to start contributing
