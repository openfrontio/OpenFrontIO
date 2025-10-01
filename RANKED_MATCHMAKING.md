# Ranked Matchmaking System

## Overview

OpenFront's ranked matchmaking system provides competitive 1v1 gameplay with skill-based ratings, leaderboards, and match history tracking. The system uses the Glicko-2 rating algorithm and includes features like dodge penalties, match acceptance flow, and real-time updates via WebSocket.

## Features

### Core Functionality

- **Skill-Based Matchmaking**: Players are matched based on MMR (Match Making Rating) using Glicko-2
- **Queue System**: Players join a queue and are automatically matched with opponents of similar skill
- **Match Acceptance**: Found matches require player acceptance within a time limit
- **Rating System**: Glicko-2 algorithm tracks player skill with rating, rating deviation (RD), and volatility
- **Leaderboards**: Global rankings showing top players by rating
- **Match History**: Complete history of past matches with ratings and outcomes
- **Dodge Penalties**: Escalating time penalties for declining matches or timing out
- **Username Support**: Players can set usernames that appear in leaderboards

### Real-Time Features

- **WebSocket Updates**: Live queue status and match notifications
- **Fallback Polling**: Automatic polling when WebSocket is unavailable
- **Match Ready Notifications**: Modal dialog when match is found

## Architecture

### Backend Components

#### 1. RankedCoordinator (`src/server/ranked/RankedCoordinator.ts`)

The main orchestrator that manages the entire ranked matchmaking lifecycle.

**Key Responsibilities:**

- Queue management and matchmaking
- Match creation and game server integration
- Rating calculations after matches
- Season management
- Telemetry and logging

**Important Methods:**

- `joinQueue()`: Add player to queue
- `leaveQueue()`: Remove player from queue
- `finalizeMatch()`: Create game when all players accept
- `recordMatchResult()`: Update ratings after match completion

#### 2. RankedQueueService (`src/server/ranked/RankedQueueService.ts`)

Handles queue operations and matchmaking logic.

**Key Features:**

- MMR-based matching within configurable tolerance
- Region-based queuing
- Queue timeout handling
- Ticket lifecycle management

**Matching Parameters:**

- Initial MMR tolerance: ±100
- Max MMR tolerance: ±500
- Max queue time: 2 minutes
- Modes: 1v1 (Duel)
- Regions: Global

#### 3. AcceptCoordinator (`src/server/ranked/AcceptCoordinator.ts`)

Manages the match acceptance phase.

**Features:**

- Accept/decline tracking
- Timeout monitoring (30 seconds)
- Dodge penalty application
- Progress updates to players

**Dodge Penalties:**

- 1st dodge: 2 minutes
- 2nd dodge: 5 minutes
- 3rd+ dodge: 10 minutes
- Penalties reset after 24 hours

#### 4. RatingService (`src/server/ranked/RatingService.ts`)

Implements Glicko-2 rating calculations.

**Default Values:**

- Initial rating: 1500
- Initial RD: 350
- Initial volatility: 0.06
- Tau (system constant): 0.5

**Rating Updates:**

- Considers opponent rating and RD
- Adjusts for wins, losses, and draws
- Updates volatility based on consistency
- Tracks win/loss streaks

#### 5. RankedRepository (`src/server/ranked/RankedRepository.ts`)

SQLite database layer for persistence.

**Database Tables:**

- `ranked_seasons`: Season definitions
- `ranked_queue_tickets`: Active queue entries
- `player_ranked_ratings`: Player ratings per season
- `ranked_matches`: Match records
- `ranked_match_participants`: Player participation in matches
- `ranked_rating_history`: Historical rating changes

**Key Methods:**

- `getOrCreatePlayerRating()`: Get/create player rating record
- `upsertPlayerRating()`: Update player rating
- `getLeaderboard()`: Get top players
- `getPlayerMatchHistory()`: Get player's match history
- `saveMatch()`: Persist match data

#### 6. RankedTelemetry (`src/server/ranked/RankedTelemetry.ts`)

Redis-based telemetry for monitoring.

**Tracked Metrics:**

- Queue size
- Average queue time
- Matches created
- Match results
- Player activity

### Frontend Components

#### 1. Main UI (`src/client/Main.ts`)

Main client interface for ranked matchmaking.

**Features:**

- Queue join/leave
- Match acceptance modal
- Leaderboard display
- Match history display
- Real-time status updates

#### 2. RankedQueueClient (`src/client/ranked/RankedQueueClient.ts`)

API client for ranked endpoints.

**API Methods:**

- `joinRankedQueue()`: Join queue
- `leaveRankedQueue()`: Leave queue
- `getRankedTicket()`: Get current ticket status
- `acceptRankedMatch()`: Accept found match
- `declineRankedMatch()`: Decline match
- `fetchRankedLeaderboard()`: Get leaderboard
- `fetchRankedHistory()`: Get match history

#### 3. RankedWebSocket (`src/client/ranked/RankedWebSocket.ts`)

WebSocket client for real-time updates.

**Messages:**

- `subscribe`: Subscribe to ticket updates
- `ticket_update`: Receive ticket state changes
- `error`: Error notifications

#### 4. RankedMatchModal (`src/client/RankedMatchModal.ts`)

Modal dialog for match acceptance.

**Features:**

- Countdown timer (30 seconds)
- Accept/Decline buttons
- Player acceptance progress
- Auto-close on timeout

## API Endpoints

### Queue Management

#### POST `/api/ranked/queue/join`

Join the ranked queue.

**Request Body:**

```json
{
  "playerId": "string",
  "mode": "1v1",
  "region": "global",
  "mmr": 1500,
  "username": "optional-username"
}
```

**Response:**

```json
{
  "ticketId": "string",
  "playerId": "string",
  "mode": "1v1",
  "region": "global",
  "mmr": 1500,
  "state": "queued",
  "joinedAt": 1234567890,
  "updatedAt": 1234567890
}
```

#### POST `/api/ranked/queue/leave`

Leave the ranked queue.

**Request Body:**

```json
{
  "playerId": "string",
  "ticketId": "string"
}
```

#### GET `/api/ranked/queue/ticket/:ticketId`

Get current ticket status.

**Response:**

```json
{
  "ticketId": "string",
  "state": "matched",
  "match": {
    "matchId": "string",
    "state": "awaiting_accept",
    "gameId": "string",
    "acceptDeadline": 1234567890,
    "acceptedCount": 1,
    "totalPlayers": 2
  }
}
```

### Match Management

#### POST `/api/ranked/match/:matchId/accept`

Accept a matched game.

**Request Body:**

```json
{
  "ticketId": "string",
  "playerId": "string",
  "acceptToken": "string"
}
```

#### POST `/api/ranked/match/:matchId/decline`

Decline a matched game.

**Request Body:**

```json
{
  "ticketId": "string",
  "playerId": "string"
}
```

### Stats & History

#### GET `/api/ranked/leaderboard`

Get ranked leaderboard.

**Query Parameters:**

- `limit`: Number of entries (max 100, default 25)
- `offset`: Pagination offset (default 0)
- `seasonId`: Optional season filter

**Response:**

```json
{
  "seasonId": 1,
  "entries": [
    {
      "playerId": "string",
      "username": "optional-username",
      "rank": 1,
      "rating": 1650,
      "rd": 150,
      "matchesPlayed": 25,
      "wins": 15,
      "losses": 10
    }
  ]
}
```

#### GET `/api/ranked/history`

Get player match history.

**Query Parameters:**

- `limit`: Number of matches (max 100, default 20)
- `offset`: Pagination offset (default 0)
- `seasonId`: Optional season filter

**Response:**

```json
{
  "seasonId": 1,
  "matches": [
    {
      "matchId": "string",
      "gameId": "string",
      "createdAt": 1234567890,
      "finishedAt": 1234567890,
      "mode": "1v1",
      "region": "global",
      "outcome": "win",
      "ratingBefore": 1500,
      "ratingAfter": 1525,
      "ratingDelta": 25,
      "opponentPlayerId": "string"
    }
  ]
}
```

## Configuration

### Environment Variables

```bash
# Redis Configuration (for telemetry)
REDIS_HOST=localhost
REDIS_PORT=6379

# Worker Configuration
WORKER_ID=0 # Worker index for game distribution

# Ranked Configuration
RANKED_ENABLED=true
RANKED_SEASONS_ENABLED=true
```

### Dev Configuration (`src/core/configuration/DevConfig.ts`)

```typescript
{
  rankedMatchmaking: {
    enabled: true,
    telemetry: {
      enabled: true,
      redisHost: process.env.REDIS_HOST || "localhost",
      redisPort: parseInt(process.env.REDIS_PORT || "6379")
    }
  }
}
```

## Database Schema

### ranked_seasons

```sql
CREATE TABLE ranked_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 0
);
```

### player_ranked_ratings

```sql
CREATE TABLE player_ranked_ratings (
  player_id TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  rating REAL NOT NULL DEFAULT 1500,
  rd REAL NOT NULL DEFAULT 350,
  volatility REAL NOT NULL DEFAULT 0.06,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER,
  last_match_id TEXT,
  username TEXT,
  PRIMARY KEY (player_id, season_id)
);
```

### ranked_matches

```sql
CREATE TABLE ranked_matches (
  id TEXT PRIMARY KEY,
  season_id INTEGER,
  mode_id TEXT NOT NULL,
  region TEXT NOT NULL,
  map_id TEXT,
  game_id TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  state TEXT NOT NULL,
  average_mmr REAL,
  team_size INTEGER NOT NULL
);
```

### ranked_match_participants

```sql
CREATE TABLE ranked_match_participants (
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  outcome TEXT,
  rating_before REAL,
  rating_after REAL,
  PRIMARY KEY (match_id, player_id)
);
```

## User Flow

### Joining Queue

1. Player clicks "Join Ranked Queue" button
2. Frontend sends join request with player ID and optional username
3. Backend creates ticket and adds to queue
4. WebSocket connection established for real-time updates
5. Player sees "Searching for match..." status

### Match Found

1. RankedQueueService finds suitable opponent
2. AcceptCoordinator creates match acceptance state
3. Both players receive match notification via WebSocket
4. Modal dialog appears with 30-second countdown
5. Players must click "Accept" to continue

### Match Acceptance

1. Player clicks "Accept" button
2. Frontend sends accept request with accept token
3. Backend validates and marks player as accepted
4. Progress bar updates showing acceptance count
5. When all players accept, game is created

### Game Creation

1. RankedCoordinator generates worker-appropriate game ID
2. Game server creates ranked match with 2 human players + 2 bots
3. Map: World (Small)
4. Mode: Free For All
5. Players automatically join game lobby

### Match Completion

1. Game ends with winner/loser
2. Worker reports result to RankedCoordinator
3. RatingService calculates new ratings using Glicko-2
4. Ratings updated in database
5. Match record saved with outcome
6. Players can view updated ratings in leaderboard

### Declining Match

1. Player clicks "Decline" or timeout occurs
2. Dodge penalty applied (2/5/10 minutes)
3. Match cancelled for all players
4. Players returned to queue (except decliner)
5. Decliner must wait penalty duration before rejoining

## Troubleshooting

### Common Issues

#### Game doesn't start after acceptance

- **Cause**: Worker routing mismatch
- **Fix**: `generateGameIdForCurrentWorker()` ensures game ID hashes to correct worker
- **Check**: Logs should show "Generated gameId for ranked match" with matching worker ID

#### Username not appearing in leaderboard

- **Cause**: Username not being saved or not mapped from database
- **Fix**: Ensure username is passed in join request and `mapPlayerRatingRow()` includes username field
- **Check**: Database query should include username column

#### WebSocket not connecting

- **Cause**: Incorrect worker path or authentication
- **Fix**: Verify worker path configuration and auth token
- **Check**: Browser console for WebSocket connection errors

#### Ratings not updating

- **Cause**: Match result not being reported or rating calculation error
- **Fix**: Check `recordMatchResult()` is called with correct winner
- **Check**: Logs should show "Recording ranked match result"

## Testing

### Manual Testing Checklist

- [ ] Join queue with username
- [ ] Match with another player
- [ ] Accept match within timeout
- [ ] Game starts on correct worker
- [ ] Game completes and ratings update
- [ ] Username appears in leaderboard
- [ ] Match appears in history with correct outcome
- [ ] Replay link works from history
- [ ] Decline match applies penalty
- [ ] Penalty prevents re-queuing

### Unit Tests

- `tests/server/ranked/RankedCoordinator.test.ts`: Core matchmaking logic
- `tests/server/ranked/RankedQueueService.test.ts`: Queue operations

## Future Enhancements

### Planned Features

- [ ] Team modes (2v2, 3v3)
- [ ] Multiple regions with region-specific queues
- [ ] Rank tiers (Bronze, Silver, Gold, etc.)
- [ ] Seasonal rewards
- [ ] Matchmaking preferences (map, mode)
- [ ] Party queuing
- [ ] Replay analysis

### Performance Optimizations

- [ ] Redis-based queue for horizontal scaling
- [ ] Database connection pooling
- [ ] Leaderboard caching
- [ ] Match history pagination
