# API Usage

## Games

### List Game Metadata

Get game IDs and basic metadata for games that started within a specified time range. Results are sorted by start time and paginated.

**Constraints:**

- Maximum time range: 2 days
- Maximum limit per request: 1000 games

**Endpoint:**

```
GET https://api.openfront.io/public/games
```

**Query Parameters:**

- `start` (required): ISO 8601 timestamp
- `end` (required): ISO 8601 timestamp
- `type` (optional): Game type, must be one of `[Private, Public, Singleplayer]`
- `limit` (optional): Number of results (max 1000, default 50)
- `offset` (optional): Pagination offset

**Example Request:**

```bash
curl "https://api.openfront.io/public/games?start=2025-10-25T00:00:00Z&end=2025-10-26T23:59:59Z&type=Singleplayer&limit=10&offset=5"
```

**Response:**

```json
[
  {
    "game": "ABSgwin6",
    "start": "2025-10-25T00:00:10.526Z",
    "end": "2025-10-25T00:19:45.187Z",
    "type": "Singleplayer",
    "mode": "Free For All",
    "difficulty": "Medium"
  }
]
```

The response includes a `Content-Range` header indicating pagination (e.g., `games 5-15/399`).

---

### Get Game Info

Retrieve detailed information about a specific game.

**Endpoint:**

```
GET https://api.openfront.io/public/game/:gameId
```

**Query Parameters:**

- `turns` (optional): Set to `false` to exclude turn data and reduce response size

**Examples:**

```bash
# Full game data
curl "https://api.openfront.io/public/game/ABSgwin6"

# Without turn data
curl "https://api.openfront.io/public/game/ABSgwin6?turns=false"
```

**Note:** Public player IDs are stripped from game records for privacy.

## Players

### Get Player Info

Retrieve information and stats for a specific player.

**Endpoint:**

```
GET https://api.openfront.io/public/player/:playerId
```

**Example:**

```bash
curl "https://api.openfront.io/public/player/HabCsQYR"
```

### Get Player Sessions

Retrieve a list of games & client ids (session ids) for a specific player.

**Endpoint:**

```
GET https://api.openfront.io/public/player/:playerId/sessions
```

**Example:**

```bash
curl "https://api.openfront.io/public/player/HabCsQYR/sessions"
```

## Clans

### Clan Leaderboard

Shows the top 100 clans by `weighted wins`.

**Endpoint:**

```
GET https://api.openfront.io/public/clans/leaderboard
```

Weighted wins have a half-life of 30 days to favor recent wins.

Weighted wins are calculated using the following formula:

```
FUNCTION calculateScore(session: ClanSession, decay: NUMBER = 1) → NUMBER
    // 1. Calculate average team size
    avgTeamSize ← session.totalPlayerCount ÷ session.numTeams

    // 2. Determine how much the clan contributed to their team
    //    (clan players divided by average players per team)
    clanMemberRatio ← session.clanPlayerCount ÷ avgTeamSize

    // 3. Apply decay factor (e.g., for older sessions)
    weightedValue ← clanMemberRatio × decay

    // 4. Calculate match difficulty based on number of teams
    //    More teams → harder to win → higher reward for victory
    //    Uses square root to avoid extreme scaling
    difficulty ← MAX(1, √(session.numTeams - 1))

    // 5. Return final score:
    //    - Win:  reward is multiplied by difficulty
    //    - Loss: penalty is divided by difficulty (less punishment in harder matches)
    IF session.hasWon THEN
        RETURN weightedValue × difficulty
    ELSE
        RETURN weightedValue ÷ difficulty
    END IF
END FUNCTION
```

### Clan stats

Displays comprehensive clan performance statistics for a specified clan over a chosen time range. If no time range is provided, it shows lifetime stats (starting from early November 2025).

Key metrics include:

- Total games, wins, losses, and win rate
- Win/loss ratio and weighted win/loss ratio\* broken down by:
  - Team type (e.g., 2 teams, 3 teams, duos, trios, etc)
  - Number of teams in the game (2 teams, 5 teams, 20 teams, etc)

**Note:** No decay is used, so weighted wins will be different from in the leaderboard.

**Endpoint**

```
GET https://openfront.io/public/clan/:clanTag
```

**Query Parameters:**

- `start` (optional): ISO 8601 timestamp
- `end` (optional): ISO 8601 timestamp

**Example**

```bash
curl https://api.openfront.io/public/clan/UN?start=2025-11-15T00:00:00Z &
end=2025-11-18T23:59:59Z
```

### Clan Sessions

A clan session is created any time a player with that clan tag is in a public team game. If no start or end query parameter is provided, lifetime sessions (starting early November 2025) are shown.

**Endpoint**

```
GET https://api.openfront.io/public/clan/:clanTag/sessions
```

**Query Parameters:**

- `start` (optional): ISO 8601 timestamp
- `end` (optional): ISO 8601 timestamp

**Example**

```bash
curl https://api.openfront.io/public/clan/UN/sessions?start=2025-11-15T00:00:00Z &
end=2025-11-18T23:59:59Z
```
