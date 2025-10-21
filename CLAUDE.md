# OpenFrontIO - Codebase Context for AI Assistants

> **Last Updated:** 2025-10-21
> **Purpose:** This document provides comprehensive context about the OpenFrontIO codebase to help AI assistants understand the project quickly and work more effectively.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture](#architecture)
4. [Directory Structure](#directory-structure)
5. [Key Features & Modules](#key-features--modules)
6. [API & Routing](#api--routing)
7. [Build & Deployment](#build--deployment)
8. [Testing](#testing)
9. [Development Workflow](#development-workflow)
10. [Important Files Reference](#important-files-reference)

---

## Project Overview

**OpenFrontIO** is a real-time multiplayer strategy game focused on territorial control and alliance building. Players compete to expand territory, build structures, and form alliances on maps based on real-world geography.

### Key Facts
- **Language:** TypeScript (ES2020)
- **Runtime:** Node.js 24
- **Game Type:** Real-time strategy with turn-based execution (100ms ticks)
- **Architecture:** Master-Worker cluster for horizontal scalability
- **Frontend:** Pixi.js (WebGL 2D rendering)
- **Backend:** Express.js + WebSockets
- **Deployment:** Docker containers with Nginx reverse proxy

### Game Features
- 30+ geographical maps (World, Europe, Asia, Mars, etc.)
- Multiplayer modes: Public lobbies, Private lobbies, Singleplayer
- Team modes: Free-for-All, Duos, Trios, Quads
- Difficulty levels: Easy, Medium, Hard, Impossible
- Alliance system with negotiations and expiration
- Combat: Ground forces, naval units, missiles, nuclear weapons
- Infrastructure: Cities, factories, ports, train stations, defense posts
- Resource management: Gold, troops, territory

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| **TypeScript** | 5.7.2 | Primary language |
| **Pixi.js** | 8.11.0 | WebGL 2D rendering engine |
| **Lit** | 3.3.1 | Web components (UI modals) |
| **Tailwind CSS** | 3.4.17 | Utility-first styling |
| **Webpack** | 5.100.2 | Module bundler |
| **Howler.js** | 2.2.4 | Audio playback |
| **D3.js** | 7.9.0 | Data visualization |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 24 | Runtime environment |
| **Express.js** | 4.21.1 | HTTP server framework |
| **WebSocket (ws)** | 8.18.0 | Real-time communication |
| **Jose** | 6.0.10 | JWT authentication |
| **Zod** | 4.0.5 | Runtime type validation |
| **Winston** | 3.17.0 | Logging |
| **OpenTelemetry** | 1.9.0+ | Observability |
| **AWS SDK S3** | 3.758.0 | Game archive storage |

### Development Tools
| Tool | Version | Purpose |
|------|---------|---------|
| **Jest** | 30.0.0 | Testing framework |
| **ESLint** | 9.21.0 | Code linting |
| **Prettier** | 3.5.3 | Code formatting |
| **Husky** | 9.1.7 | Git hooks |
| **ts-node** | 10.9.2 | TypeScript execution |

### Infrastructure
- **Docker** - Containerization (Node 24-slim base)
- **Nginx** - Reverse proxy and static file serving
- **Supervisor** - Process management in containers
- **Cloudflare Tunnels** - Secure connectivity
- **GitHub Actions** - CI/CD pipelines

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Main.ts     │  │ GameRenderer │  │  Transport   │      │
│  │  (Entry)     │─▶│  (Pixi.js)   │  │ (WebSocket)  │      │
│  └──────────────┘  └──────────────┘  └──────┬───────┘      │
└─────────────────────────────────────────────┼──────────────┘
                                               │ WebSocket
                                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    SERVER (Node.js Cluster)                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ MASTER PROCESS (Port 3000)                             │ │
│  │  • Serves static files (HTML/CSS/JS)                   │ │
│  │  • Public lobby management                             │ │
│  │  • Load balancing to workers                           │ │
│  └────────────────┬───────────────────────────────────────┘ │
│                   │ Routes to workers by gameID hash        │
│  ┌────────────────┼───────────────────────────────────────┐ │
│  │ WORKER PROCESSES (Ports 3001+)                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │ │
│  │  │ Worker 0 │  │ Worker 1 │  │ Worker N │            │ │
│  │  │ (3001)   │  │ (3002)   │  │ (300N)   │            │ │
│  │  │          │  │          │  │          │            │ │
│  │  │ GameMgr  │  │ GameMgr  │  │ GameMgr  │            │ │
│  │  │ WSServer │  │ WSServer │  │ WSServer │            │ │
│  │  └──────────┘  └──────────┘  └──────────┘            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Architectural Patterns

#### 1. Master-Worker Cluster
- **Master Process** (`src/server/Master.ts`): HTTP server, lobby management, load balancing
- **Worker Processes** (`src/server/Worker.ts`): Game instances, WebSocket handling
- **Scaling**: Workers assigned via `gameID` hash for horizontal scaling
- **Ports**: Master on 3000, Workers on 3001-3041 (40 workers max)

#### 2. Event-Driven Architecture
- **EventBus** (`src/core/EventBus.ts`): Central event system
- Custom event classes for game actions (attack, spawn, alliance, etc.)
- Decouples components for maintainability

#### 3. Execution System (Command Pattern)
- **ExecutionManager** (`src/core/execution/ExecutionManager.ts`): Orchestrates turn execution
- **45+ Execution Classes**: Specialized handlers for each game action
  - Examples: `AttackExecution`, `NukeExecution`, `AllianceRequestExecution`, `FakeHumanExecution` (bot AI)
- Each execution is independent and testable

#### 4. Layer-Based Rendering
- **40+ Rendering Layers** stack to create complete game view:
  - Terrain → Territory → Structures → Units → Names → UI → FX
- **GameRenderer** (`src/client/graphics/GameRenderer.ts`): Main orchestrator
- **TransformHandler**: Camera panning/zoom

#### 5. Shared Game Logic
- **GameRunner** (`src/core/GameRunner.ts`): Deterministic turn-by-turn simulation
- Used by:
  - **Server**: Official game state
  - **Client**: Local state replay for synchronization
  - **Replay System**: Historical game reconstruction

#### 6. WebSocket Protocol
- **Transport Layer** (`src/client/Transport.ts`): Bidirectional communication
- **Message Types**:
  - Client → Server: `ClientIntentMessage` (player actions)
  - Server → Client: `ServerTurnMessage` (game state updates)
- **Validation**: All messages validated with Zod schemas

---

## Directory Structure

```
/home/user/OpenFrontIO/
├── src/
│   ├── client/          # Frontend (107 TypeScript files)
│   │   ├── Main.ts                   # Entry point
│   │   ├── ClientGameRunner.ts       # Client-side game orchestration
│   │   ├── Transport.ts              # WebSocket communication
│   │   ├── InputHandler.ts           # Keyboard/mouse input
│   │   ├── components/               # UI components (modals, buttons)
│   │   ├── graphics/                 # Pixi.js rendering
│   │   │   ├── GameRenderer.ts       # Main renderer
│   │   │   ├── layers/               # 40+ rendering layers
│   │   │   ├── fx/                   # Visual effects
│   │   │   └── TransformHandler.ts   # Camera management
│   │   ├── sound/                    # Audio management
│   │   ├── data/                     # JSON data (countries, cosmetics)
│   │   └── styles/                   # CSS stylesheets
│   │
│   ├── core/            # Shared game logic (104 TypeScript files, 18K+ lines)
│   │   ├── game/                     # Core game mechanics
│   │   │   ├── Game.ts / GameImpl.ts        # Game state management
│   │   │   ├── PlayerImpl.ts                # Player logic (31.5KB)
│   │   │   ├── UnitImpl.ts                  # Unit behaviors
│   │   │   ├── GameMap.ts                   # Terrain/tile management
│   │   │   ├── AllianceImpl.ts              # Alliance system
│   │   │   ├── RailNetworkImpl.ts           # Rail infrastructure
│   │   │   └── StatsImpl.ts                 # Statistics tracking
│   │   │
│   │   ├── execution/                # 45+ execution classes
│   │   │   ├── ExecutionManager.ts          # Turn execution orchestrator
│   │   │   ├── AttackExecution.ts           # Combat logic
│   │   │   ├── NukeExecution.ts             # Nuclear weapons
│   │   │   ├── FakeHumanExecution.ts        # Bot AI (19.5KB)
│   │   │   └── [40+ other execution types]
│   │   │
│   │   ├── pathfinding/              # A* pathfinding algorithms
│   │   ├── configuration/            # Config management (Dev/Preprod/Prod)
│   │   ├── worker/                   # Web Worker communication
│   │   ├── validations/              # Input validation
│   │   ├── utilities/                # Utility functions
│   │   ├── Schemas.ts                # Zod schemas for type validation
│   │   ├── GameRunner.ts             # Turn-by-turn game engine
│   │   └── EventBus.ts               # Event system
│   │
│   └── server/          # Backend (15 TypeScript files)
│       ├── Server.ts                 # Entry point (cluster setup)
│       ├── Master.ts                 # Master process
│       ├── Worker.ts                 # Worker process
│       ├── GameServer.ts             # Game instance management (25KB)
│       ├── GameManager.ts            # Game lifecycle
│       ├── Client.ts                 # Connected client representation
│       ├── Archive.ts                # Game archival to S3
│       ├── jwt.ts                    # JWT authentication
│       └── Logger.ts                 # Winston logging
│
├── tests/               # Test suite (39 test files, 6K+ lines)
│   ├── [Unit tests]                  # Game logic tests
│   ├── [Integration tests]           # Multi-component tests
│   ├── client/graphics/              # Client UI tests
│   ├── core/executions/              # Execution tests
│   ├── core/game/                    # Game state tests
│   ├── perf/                         # Performance benchmarks
│   └── util/                         # Test utilities
│
├── resources/           # Static assets
│   ├── images/                       # Sprites, flags, UI graphics
│   ├── QuickChat.json                # Quick chat messages
│   └── version.txt
│
├── map-generator/       # Map generation tool (Go)
├── webpack.config.js    # Webpack bundler configuration
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── jest.config.ts       # Jest testing configuration
├── Dockerfile           # Container image definition
├── nginx.conf           # Nginx reverse proxy config
└── .github/workflows/   # CI/CD pipelines
```

---

## Key Features & Modules

### Core Game Features

#### 1. Unit System (17 Unit Types)
**Location:** `src/core/game/UnitImpl.ts`

| Category | Units |
|----------|-------|
| **Structures** | City, Construction, DefensePost, SAMLauncher, MissileSilo, Port |
| **Military** | Warship, SAMMissile, Shell, AtomBomb, HydrogenBomb, MIRV, MIRVWarhead |
| **Transport** | TransportShip, TradeShip, Train |
| **Production** | Factory |

#### 2. Execution System (45+ Game Actions)
**Location:** `src/core/execution/`

**Military Operations:**
- `AttackExecution` - Ground combat
- `WarshipExecution` - Naval warfare
- `NukeExecution` - Atomic strikes
- `SAMLauncherExecution` - Air defense
- `MIRVExecution` - Multi-warhead missiles

**Infrastructure:**
- `ConstructionExecution` - Building structures
- `FactoryExecution` - Unit production
- `TrainStationExecution` / `RailroadExecution` - Rail networks
- `PortExecution` - Maritime logistics

**Diplomacy:**
- `AllianceRequestExecution` - Create alliances
- `AllianceRequestReplyExecution` - Accept/reject
- `BreakAllianceExecution` - End alliances

**Player Actions:**
- `SpawnExecution` - Initial spawn
- `DonateGoldExecution` / `DonateTroopsExecution` - Resource sharing
- `FakeHumanExecution` - Bot AI behavior (19.5KB)

#### 3. Alliance System
**Location:** `src/core/game/AllianceImpl.ts`

- Alliance creation and management
- Request/accept/reject flow
- Extension mechanism
- Expiration tracking
- Embargo system for trade restrictions

#### 4. Combat System
**Location:** `src/core/execution/AttackExecution.ts`

- Attack resolution based on troop counts and difficulty
- Retreat mechanics (land and sea)
- Missile defense (SAM interception)
- Nuclear weapons with area-of-effect damage
- Naval combat with warship movement

#### 5. Client UI System
**Location:** `src/client/`

**13 Primary Modals:**
- `AccountModal`, `HostLobbyModal`, `JoinPrivateLobbyModal`
- `SinglePlayerModal`, `LanguageModal`, `UserSettingModal`
- `HelpModal`, `TokenLoginModal`, `GameStartingModal`
- `FlagInputModal`, `TerritoryPatternsModal`, `NewsModal`
- `PublicLobby`

**40+ Rendering Layers:**
- Game board: `TerrainLayer`, `TerritoryLayer`, `UnitLayer`, `StructureLayer`
- HUD: `MainRadialMenu`, `PlayerPanel`, `Leaderboard`, `ChatDisplay`
- Effects: `FxLayer` (nukes, explosions, conquests)

---

## API & Routing

### HTTP Endpoints

#### Master Process (Port 3000)
| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/api/env` | Environment configuration | None |
| GET | `/api/public_lobbies` | List public game lobbies | None |
| POST | `/api/kick_player/:gameID/:clientID` | Kick player | Admin |
| GET | `*` | SPA fallback (index.html) | None |

#### Worker Process (Port 3001+)
| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/api/create_game/:id` | Create game instance | Admin |
| POST | `/api/start_game/:id` | Start private lobby | Admin |
| PUT | `/api/game/:id` | Update game config | Admin |
| GET | `/api/game/:id` | Retrieve game info | None |
| POST | `/api/archive_singleplayer_game` | Archive completed game | JWT |
| WebSocket | `/` | Real-time game communication | JWT/UUID |

### Authentication Layers

#### Layer 1: Admin Endpoints
- Header: `x-admin-key: {ADMIN_TOKEN}`
- Used for: game creation, player kicking
- Dev token: `WARNING_DEV_ADMIN_KEY_DO_NOT_USE_IN_PRODUCTION`
- Prod token: `process.env.ADMIN_TOKEN`

#### Layer 2: JWT Authentication
- **Issuer:** Configured via `jwtIssuer()` in ServerConfig
- **Verification:** EdDSA signature with JWKS public key
- **Acquisition:** Discord OAuth, token login, or UUID fallback
- **Refresh:** Auto-refresh if token age >= 3 days

#### Layer 3: WebSocket Join
- Required: `clientID`, `token`, `gameID`, `username`
- Validates JWT signature and user profile
- Checks cosmetic privileges against user "flares"

#### Layer 4: Privilege/Cosmetic Authorization
- Based on user "flares" (permissions)
- Validates: patterns, colors, flags
- Cached via `PrivilegeRefresher` (3-minute refresh)

### Message Schemas
**Location:** `src/core/Schemas.ts`

**Client Messages:**
- `join` - Player joining game
- `intent` - Game action (21 intent types)
- `ping` - Keep-alive
- `hash` - State validation

**Server Messages:**
- `turn` - Game state update (every 100ms)
- `start` - Game started
- `prestart` - Pre-game countdown
- `desync` - Synchronization error

---

## Build & Deployment

### Build Scripts

```bash
# Development
npm run dev                    # Client + Server concurrently
npm run dev:staging            # Connect to staging API
npm run dev:prod               # Connect to production API

# Production
npm run build-prod             # Webpack production build (minified)
npm run start:server           # Node.js server (port 3000)

# Testing
npm test                       # Run Jest tests
npm run test:coverage          # Run tests with coverage
npm run perf                   # Performance benchmarks

# Code Quality
npm run lint                   # ESLint check
npm run lint:fix               # ESLint auto-fix
npm run format                 # Prettier formatting
```

### Webpack Configuration
**File:** `webpack.config.js`

- **Entry:** `./src/client/Main.ts`
- **Output:** `./static/js/main.[contenthash].js`
- **Dev Server:** Port 9000 with HMR
- **Asset Handling:** Images, fonts, audio, binary files
- **CSS Pipeline:** Tailwind → PostCSS → Autoprefixer
- **Code Splitting:** Vendor bundle separation

### Docker Deployment

**Multi-Stage Build:**
1. **Base:** Node 24-slim
2. **Dependencies:** Nginx, supervisor, cloudflared
3. **Build:** `npm run build-prod`
4. **Prod-files:** Remove map data for smaller image
5. **Final:** Combine all layers

**Container Components:**
- **Nginx** (port 80): Reverse proxy, static file serving
- **Supervisor**: Process management (nginx + node)
- **Cloudflared**: Secure tunnel integration
- **Node.js**: Game server (port 3000)

**Deployment Script:** `deploy.sh`
```bash
./deploy.sh <version> <environment> <host> [subdomain]
# Examples:
./deploy.sh v1.2.3 prod falk1
./deploy.sh v1.2.3 staging staging api
```

### CI/CD Pipeline
**Location:** `.github/workflows/`

**CI Pipeline** (`ci.yml`):
- **Build Job:** Webpack production build
- **Test Job:** Jest with coverage
- **ESLint Job:** Code linting
- **Prettier Job:** Code formatting
- Runs on: PRs, push to main, merge queue

**Deploy Workflow** (`deploy.yml`):
- Manual or auto-triggered on push
- Builds Docker image
- Deploys to staging/production
- Verifies deployment via `/commit.txt` polling
- GitHub Deployments API integration

**Release Workflow** (`release.yml`):
- Triggered on GitHub release creation
- Multi-environment deployment:
  - Alpha (staging) - immediate
  - Beta, Blue, Green (falk1) - requires approval

### Environment Configuration

**Files:**
- `src/core/configuration/DevConfig.ts` - Development
- `src/core/configuration/PreprodConfig.ts` - Staging
- `src/core/configuration/ProdConfig.ts` - Production

**Environment Variables:**
- `GAME_ENV`: dev, preprod, or prod
- `ADMIN_TOKEN`: Admin API key
- `CF_ACCOUNT_ID`, `CF_API_TOKEN`: Cloudflare
- `R2_ACCESS_KEY`, `R2_SECRET_KEY`: S3 storage
- `OTEL_ENDPOINT`, `OTEL_USERNAME`: OpenTelemetry

---

## Testing

### Test Framework
- **Jest 30.0.0** - Main testing framework
- **Chai 5.1.1** - Assertion library
- **Sinon 21.0.0** - Mocking/spying
- **Benchmark.js 2.1.4** - Performance tests

### Test Organization
**Location:** `/tests/` (39 test files, 6,052 lines)

```
tests/
├── [27 root-level tests]     # Core game logic
├── client/graphics/          # UI component tests (3 files)
├── core/executions/          # Execution tests (5 files)
├── core/game/                # Game state tests (4 files)
├── perf/                     # Performance benchmarks (1 file)
└── util/                     # Test utilities
```

### Test Types

**Unit Tests** (~20 files):
- `Colors.test.ts` - Color allocation
- `Stats.test.ts` - Statistics calculations
- `Team.test.ts` - Team data structures

**Integration Tests** (~14 files):
- `GameImpl.test.ts` - Full game flow
- `Attack.test.ts` - Combat mechanics
- `BotBehavior.test.ts` - Bot AI decisions
- `Alliance.test.ts` - Alliance interactions

**Graphics Tests** (3 files):
- `ProgressBar.test.ts` - Canvas rendering
- `InputHandler.test.ts` - Input handling
- `RadialMenuElements.test.ts` - Menu rendering

**Performance Tests** (1 file):
- `AstarPerf.ts` - Pathfinding benchmarks

### Coverage Thresholds
- Statements: 21.5%
- Branches: 16%
- Lines: 21.0%
- Functions: 20.5%

### Test Utilities
**Location:** `tests/util/`

- `Setup.ts` - Game initialization for tests
- `TestConfig.ts` - Test-specific configuration
- `utils.ts` - Helper functions

**Test Maps:** `tests/testdata/maps/`
- Small: `plains`, `ocean_and_land`
- Large: `giantworldmap` (9.6MB)

---

## Development Workflow

### Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Run Development Server:**
   ```bash
   npm run dev          # Client + Server
   # OR
   npm run start:client # Client only (port 9000)
   npm run start:server # Server only (port 3000)
   ```

3. **Run Tests:**
   ```bash
   npm test
   npm run test:coverage
   ```

### Code Quality

**Pre-commit Hooks (Husky):**
- ESLint checks
- Prettier formatting
- Configured in `.husky/pre-commit`

**Linting:**
```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

**Formatting:**
```bash
npm run format      # Format all files with Prettier
```

### Configuration Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript compiler options |
| `jest.config.ts` | Test configuration |
| `eslint.config.js` | Linting rules (flat config) |
| `.prettierrc` | Code formatting rules |
| `webpack.config.js` | Build configuration |
| `tailwind.config.js` | CSS utility configuration |
| `postcss.config.js` | CSS processing pipeline |

### Important Conventions

1. **Module System:** ES Modules (ESNext)
2. **TypeScript Target:** ES2020
3. **File Extensions:** `.ts` for TypeScript, `.tsx` not used
4. **Imports:** Use absolute paths where configured
5. **Validation:** All API payloads validated with Zod schemas
6. **Logging:** Use Winston logger (`src/server/Logger.ts`)

---

## Important Files Reference

### Entry Points

| File | Purpose |
|------|---------|
| `src/client/Main.ts` | Client-side entry point (browser) |
| `src/server/Server.ts` | Server-side entry point (Node.js cluster) |

### Core Game Logic

| File | Lines | Purpose |
|------|-------|---------|
| `src/core/GameRunner.ts` | - | Turn-by-turn game simulation |
| `src/core/game/GameImpl.ts` | 23KB | Game state implementation |
| `src/core/game/PlayerImpl.ts` | 31KB | Player logic (largest core file) |
| `src/core/execution/ExecutionManager.ts` | - | Turn execution orchestrator |
| `src/core/execution/FakeHumanExecution.ts` | 19KB | Bot AI behavior |

### Client-Side

| File | Purpose |
|------|---------|
| `src/client/ClientGameRunner.ts` | Client game orchestration |
| `src/client/Transport.ts` | WebSocket communication layer |
| `src/client/InputHandler.ts` | User input management |
| `src/client/graphics/GameRenderer.ts` | Main Pixi.js renderer |
| `src/client/graphics/TransformHandler.ts` | Camera/viewport |

### Server-Side

| File | Lines | Purpose |
|------|-------|---------|
| `src/server/Master.ts` | - | Master process (lobby, load balancing) |
| `src/server/Worker.ts` | - | Worker process (game instances) |
| `src/server/GameServer.ts` | 25KB | Game instance management |
| `src/server/GameManager.ts` | - | Game lifecycle management |
| `src/server/jwt.ts` | - | JWT authentication logic |

### Schemas & Types

| File | Purpose |
|------|---------|
| `src/core/Schemas.ts` | Client/server message schemas (Zod) |
| `src/core/ApiSchemas.ts` | JWT, user profiles, stats schemas |
| `src/core/WorkerSchemas.ts` | Game creation/update schemas |
| `src/core/CosmeticSchemas.ts` | Cosmetic validation schemas |

### Configuration

| File | Purpose |
|------|---------|
| `src/core/configuration/Config.ts` | Configuration interface |
| `src/core/configuration/DefaultConfig.ts` | Base configuration |
| `src/core/configuration/DevConfig.ts` | Development overrides |
| `src/core/configuration/ProdConfig.ts` | Production settings |
| `src/core/configuration/PreprodConfig.ts` | Staging settings |

### Infrastructure

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage container build |
| `nginx.conf` | Reverse proxy configuration |
| `supervisord.conf` | Process management in container |
| `build.sh` | Docker image builder |
| `deploy.sh` | Deployment orchestrator |
| `update.sh` | Server-side container updater |

---

## Quick Reference

### Common Tasks

**Adding a New Game Action:**
1. Define intent schema in `src/core/Schemas.ts`
2. Create execution class in `src/core/execution/`
3. Add to ExecutionManager registry
4. Add UI handler in client
5. Write tests in `tests/core/executions/`

**Adding a New UI Modal:**
1. Create component in `src/client/components/`
2. Use Lit web component pattern
3. Style with Tailwind classes
4. Register in `Main.ts`

**Modifying Game Config:**
1. Update interface in `src/core/configuration/Config.ts`
2. Update `DefaultConfig.ts` with default value
3. Override in `DevConfig.ts` or `ProdConfig.ts` if needed

**Adding API Endpoint:**
1. Add route in `src/server/Master.ts` or `Worker.ts`
2. Define schema in `src/core/ApiSchemas.ts` or `WorkerSchemas.ts`
3. Validate request with Zod
4. Add authentication if needed

### Debugging Tips

**Client-Side:**
- Enable DevTools: Check Network tab for WebSocket messages
- Inspect game state: `window.game` (exposed in dev mode)
- Check console for errors and warnings

**Server-Side:**
- Logs: Winston logger outputs to stdout
- Debug mode: Set `GAME_ENV=dev` for verbose logging
- Monitor WebSocket: Check worker process logs

**Common Issues:**
- **Desync errors:** Check GameRunner logic for non-deterministic operations
- **Performance:** Profile rendering layers, check UnitGrid spatial indexing
- **Connection issues:** Verify WebSocket URL matches server configuration

---

## Additional Resources

- **Repository:** https://github.com/MaxHT0x/OpenFrontIO
- **CI/CD:** GitHub Actions (`.github/workflows/`)
- **Map Generator:** `/map-generator/` (Go tool)
- **Test Data:** `/tests/testdata/maps/`

---

**Document Version:** 1.0
**Last Updated:** 2025-10-21
**Generated By:** Claude AI Assistant
