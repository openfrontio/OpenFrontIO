# Game Architecture

The game is split into four components:

1. **client** - Handles rendering and UI for the user

2. **core** - Deterministic simulation. It is pure TypeScript/JavaScript code with no external dependencies. It must be fully deterministic.

3. **server** - Handles coordination and relays of intents/requests

4. **api** - A closed source Cloudflare Worker that handles auth, stats, game data storage, cosmetics, and monetization

## Simulation Architecture

The game simulation logic does not run on the server. Instead, each client runs their own instance of core, which is why it must be deterministic. At the end of each tick, data is sent from core to client via GameUpdates. Core and client run in different threads - the core runs in a worker thread.

## Intents

When a user performs an action, it creates an "Intent" which is sent to the server. The server stores all intents for that tick/turn, and at the end, relays all intents to all clients in a bundle called a "turn". Each client receives the turn and sends it to its core simulation. The core then creates an "Execution" for each intent. Executions are the only thing that can modify the game state.

## Flow

1. Client sends intent to game server
2. Game server sends turn to client
3. Client forwards turn to core
4. Core creates an execution for each intent
5. Core calls `executeNextTick()`
6. All executions run
7. At the end of the tick core sends updates to client
8. Client renders the updates
