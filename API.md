## API Usage

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
  },
  ...
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

---

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
