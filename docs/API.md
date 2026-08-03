# OpenFront API

This is the public HTTP and WebSocket API exposed by the OpenFront API
worker. It documents endpoints intended for the game client, public websites,
and player integrations. It is kept aligned with the route registry and
endpoint schemas in the infra repository.

## API Usage

> **Warning:** Rate limits are very strict. Join the [Discord](https://discord.gg/K9zernJB5z) to request higher rate limits.

## Base URLs

Production:

    https://api.openfront.io

Development:

    https://api.openfront.dev

All examples below are relative to one of these hosts. JSON responses use
UTF-8 and the API sends CORS credentials when the request origin is allowed.
The API exposes Content-Range and accepts these request headers:

- Content-Type
- Authorization
- x-persistent-id
- Idempotency-Key
- Content-Encoding

## Quick reference

### Public endpoints

| Method | Path                              | Purpose                                    |
| ------ | --------------------------------- | ------------------------------------------ |
| GET    | /ping                             | Health check                               |
| GET    | /public/games                     | Archived game summaries                    |
| GET    | /public/game/:gameId              | Archived game record                       |
| GET    | /game/:gameId                     | Legacy alias for the archived game record  |
| GET    | /public/player/:publicId          | Public player profile                      |
| GET    | /player/:publicId                 | Legacy alias for the public player profile |
| GET    | /public/player/:publicId/sessions | Public player sessions                     |
| GET    | /public/player/:publicId/games    | Public player game history                 |
| GET    | /public/clans/leaderboard         | Rolling clan leaderboard                   |
| GET    | /public/clan/:clanTag             | Clan statistics                            |
| GET    | /public/clan/:clanTag/exists      | Clan existence check                       |
| GET    | /public/clan/:clanTag/sessions    | Clan game sessions                         |
| GET    | /leaderboard/public/ffa           | Public free-for-all leaderboard            |
| GET    | /leaderboard/ranked               | Ranked 1v1 and 2v2 leaderboards            |
| GET    | /leaderboard/tribes               | Custom tribe-name leaderboard              |

## Common conventions

### Authentication

Send a short-lived player JWT as:

    Authorization: Bearer <jwt>

The API also sets an HttpOnly refresh-session cookie. Access tokens expire
after about 15 minutes. Refresh sessions expire after 30 days of inactivity;
successful refreshes renew the cookie and periodically rotate the session
token. Browser clients should send credentials on cross-origin requests.

### Responses and errors

Successful JSON responses are normally 200. Other success statuses used by
the API are:

- 201 for a created resource
- 202 when an operation is accepted for later processing
- 204 when there is no response body

Errors are JSON objects. Common shapes are:

    { "error": "Bad request", "message": "..." }
    { "error": "Unauthorized", "message": "..." }
    { "error": "Forbidden", "message": "..." }
    { "error": "Not found", "message": "..." }
    { "error": "Conflict", "message": "..." }
    { "error": "Too many requests", "message": "..." }

Some validation errors add fields such as code, reason, or details. A 429 may
also include Retry-After.

### Dates, identifiers, and pagination

Unless an endpoint says otherwise, timestamps are ISO 8601 strings. Where a
path accepts a player reference rather than a literal public ID, it accepts a
public ID, a full display name in base.disc form, or a bare premium name.
Player references are limited to 25 characters.

Page-based endpoints use page numbers starting at 1. Cursor values are opaque:
clients must not parse or manufacture them, and should retain the cursor
alongside the filters that produced it.

## Public games and players

### GET /public/games

Lists archived games in ascending start-time order.

Required query parameters:

- start: ISO 8601 lower bound
- end: ISO 8601 upper bound

The requested range may be at most two days. Optional filters:

- type: Singleplayer, Public, or Private
- mode: Free For All or Team
- rankedType: unranked, 1v1, or 2v2
- playerTeams: exact non-empty player-team label, at most 20 characters (for
  example Duos, Trios, Quads, Humans Vs Nations, 5v5, or 4v4v4)
- limit: 1–1000, default 50
- offset: non-negative integer, default 0

Each result contains:

    {
      "game": "game-id",
      "start": "2026-01-01T12:00:00.000Z",
      "end": "2026-01-01T12:20:00.000Z",
      "type": "Public",
      "mode": "Team",
      "difficulty": null,
      "numPlayers": 10,
      "maxPlayers": 20,
      "lobbyFillTime": 15000,
      "playerTeams": "Duos",
      "rankedType": "unranked"
    }

Values such as end, difficulty, player counts, lobbyFillTime,
playerTeams, and rankedType may be null. lobbyFillTime is milliseconds from
lobby visibility or creation until the game starts. The response includes:

    Content-Range: games <offset>-<exclusiveEnd>/<total>

exclusiveEnd is offset plus the number of entries returned.

### GET /public/game/:gameId

### GET /game/:gameId

Returns the archived GameRecord for a game. The second path is a legacy alias.
Pass turns=false to omit the potentially large turns array:

    GET /public/game/<gameId>?turns=false

The identifier may be an older eight-character ID or a newer encoded game ID.
Unknown games return 404.

### GET /public/player/:publicId

### GET /player/:publicId

Returns a public player profile. The second path is a legacy alias. A profile
contains:

- publicId and createdAt
- username, when one is set
- the linked Discord user object when the player has made the profile public
- aggregated stats, including wins, losses, total games, and nested
  FFA/team/Humans-vs-Nations/ranked counters
- current clan memberships with tag, name, role, joinedAt, and memberCount

Private Discord identity data is omitted for a private profile. The profile
stats exclude singleplayer games from the public unranked aggregates. The
wins, losses, and total counters in each populated stats leaf are decimal
strings to preserve integer precision. The path segment also accepts a
base.disc display name or bare premium username and returns the canonical
publicId. The sessions and games subroutes below require that canonical public
ID rather than a username reference.

### GET /public/player/:publicId/sessions

Returns the player's recorded sessions. A result has this shape:

    {
      "gameId": "game-id",
      "gameStart": "2026-01-01T12:00:00.000Z",
      "gameEnd": "2026-01-01T12:20:00.000Z",
      "gameType": "Public",
      "gameMode": "Team",
      "gameRankedType": "unranked",
      "clientId": "client-id",
      "username": "Player",
      "clanTag": "ABC",
      "hasWon": true
    }

Nullable session fields may be null. Session order is unspecified. A player
with no sessions returns 404.

### GET /public/player/:publicId/games

Returns a keyset-paginated public game history. The page size is fixed at 10.

Query parameters:

- filter: ffa, team, hvn, or ranked
- type: public, private, or singleplayer
- cursor: opaque cursor from the previous response

The cursor is tied to filter and type; changing either while reusing a cursor
returns 400. The response is:

    {
      "results": [
        {
          "gameId": "game-id",
          "start": "2026-01-01T12:00:00.000Z",
          "durationSeconds": 1200,
          "map": "TestMap",
          "mode": "Team",
          "type": "Public",
          "playerTeams": "Duos",
          "rankedType": "unranked",
          "result": "victory",
          "totalPlayers": 10,
          "username": "Player",
          "clanTag": "ABC"
        }
      ],
      "nextCursor": "opaque-cursor-or-null"
    }

result is victory, defeat, or incomplete. totalPlayers, playerTeams, and
clanTag can be null. username and clanTag reflect the identity recorded in
that game session. Results are ordered by descending session game ID, normally
newest first. Unknown players return 404.

## Public clans and leaderboards

Clan tags are case-insensitive in lookup paths and are returned uppercase.
Public clan statistics use only public, unranked Team games and exclude Humans
vs Nations games.

### GET /public/clan/:clanTag/exists

Returns a minimal existence check:

    { "exists": true }

An existing clan returns 200. A missing clan returns 404.

### GET /public/clan/:clanTag

Required query parameters:

- start: ISO 8601 interval start
- end: ISO 8601 interval end

The interval must be no longer than one day and end must not precede start.
Both bounds are required; neither may be omitted.

Response:

    {
      "start": "2026-01-01T00:00:00.000Z",
      "end": "2026-01-02T00:00:00.000Z",
      "clan": {
        "clanTag": "ABC",
        "games": 12,
        "playerSessions": 45,
        "wins": 8,
        "losses": 4,
        "weightedWins": 7.2,
        "weightedLosses": 4.8,
        "weightedWLRatio": 1.5,
        "teamTypeWL": {
          "2v2": {
            "wl": [5, 2],
            "weightedWL": [4.6, 2.4]
          }
        },
        "teamCountWL": {
          "2": {
            "wl": [5, 2],
            "weightedWL": [4.6, 2.4]
          }
        }
      }
    }

teamTypeWL keys are player-team labels, such as 2v2. teamCountWL keys are
team-count labels. Each wl and weightedWL value is [wins, losses]. The
weighted values use the clan's team-size ratio and game difficulty; this
endpoint does not apply the rolling leaderboard's time decay.

A valid tag with no matching sessions, including an unregistered tag, returns
200 with zero-valued statistics.

### GET /public/clan/:clanTag/sessions

Uses the same required start and end parameters and one-day maximum as the
clan statistics endpoint. Optional pagination:

- page: positive integer, default 1
- limit: 1–50, default 10

Response:

    {
      "results": [
        {
          "gameId": "game-id",
          "clanTag": "ABC",
          "clanPlayerCount": 4,
          "hasWon": true,
          "numTeams": 2,
          "playerTeams": "2v2",
          "totalPlayerCount": 10,
          "gameStart": "2026-01-01T12:00:00.000Z",
          "score": 2.1
        }
      ],
      "total": 12,
      "page": 1,
      "limit": 10
    }

Sessions are newest first. score is positive for a win and negative for a
loss. A session can include historical clan-member counts even when the
player's current membership has changed. A valid tag with no matching
sessions, including an unregistered tag, returns 200 with results: [] and
total: 0.

### GET /public/clans/leaderboard

Returns the public clan leaderboard for a rolling 90-day window. The window
uses a 30-day half-life for time decay. It contains public, unranked Team
games and excludes Humans vs Nations games.

The leaderboard normally requires at least 100 games per clan, while always
retaining the top 10 clans so a new/low-volume leaderboard is useful. Results
are sorted by weightedWins and the response is:

    {
      "start": "2025-12-01T00:00:00.000Z",
      "end": "2026-03-01T00:00:00.000Z",
      "clans": [
        {
          "clanTag": "ABC",
          "games": 120,
          "wins": 75,
          "losses": 45,
          "playerSessions": 500,
          "weightedWins": 62.4,
          "weightedLosses": 38.1,
          "weightedWLRatio": 1.64
        }
      ]
    }

The response is cached for about one hour. The implementation also applies a
historical cutoff of 2025-11-12 when calculating the rolling window.

### GET /leaderboard/:type/:mode

The legacy leaderboard route only accepts type=public and mode=ffa, so the
canonical URL is /leaderboard/public/ffa. It covers public Free For All games,
requires more than 20 games, excludes banned players, and returns at most 40
entries.

Each entry contains:

    {
      "wlr": 1.75,
      "wins": 35,
      "losses": 20,
      "total": 55,
      "public_id": "player-public-id",
      "username": "Player",
      "user": {
        "id": "discord-id",
        "username": "discord-name",
        "global_name": "Display name"
      }
    }

user may be null when there is no public linked Discord profile. username may
be null when the player has not set an account username. This route is cached
briefly (about one minute).

### GET /leaderboard/ranked

Query parameter:

- page: 1 or 2, default 1

Each page has up to 50 entries for both ranked ladders. The response has
separate 1v1 and 2v2 arrays:

    {
      "1v1": [
        {
          "rank": 1,
          "elo": 1500,
          "peakElo": 1600,
          "wins": 20,
          "losses": 5,
          "total": 25,
          "public_id": "player-public-id",
          "accountUsername": "Player",
          "username": "Player"
        }
      ],
      "2v2": []
    }

peakElo and accountUsername can be null. username is the display-name
fallback used by clients. This leaderboard is cached for about one hour.

### GET /leaderboard/tribes

Query parameter:

- page: 1 or 2, default 1

This is a rolling 30-day leaderboard for purchased custom tribe names. The
response is:

    {
      "windowDays": 30,
      "start": "2026-01-01",
      "end": "2026-01-31",
      "tribes": [
        {
          "rank": 1,
          "name": "Example Tribe",
          "gamesAppeared": 42,
          "playerReach": 1000,
          "ownerPublicId": "player-public-id",
          "ownerUsername": "Player",
          "activeBoosts": 2
        }
      ]
    }

Each page contains up to 50 entries, and ranks are absolute across pages.
Entries are sorted by playerReach descending, then gamesAppeared descending,
then stable internal ID order. playerReach is the accumulated impression/reach
metric, not a distinct-player count. ownerUsername can be null. This
leaderboard is cached for about one hour.

## Health

### GET /ping

Returns 204 when the API worker is reachable.
