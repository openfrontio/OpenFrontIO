# OpenFront API

This is the public HTTP and WebSocket API exposed by the OpenFront API
worker. It documents endpoints intended for the game client, public websites,
and player integrations. It is kept aligned with the route registry and
endpoint schemas in the infra repository.

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

| Method | Path                              | Purpose                                             |
| ------ | --------------------------------- | --------------------------------------------------- |
| GET    | /.well-known/jwks.json            | JWT verification keys                               |
| GET    | /ping                             | Health check                                        |
| GET    | /cosmetics.json                   | Public shop/catalog configuration                   |
| GET    | /news.json                        | Published news                                      |
| GET    | /featured-stream.json             | Featured stream configuration                       |
| GET    | /live-streams.json                | Current live-stream configuration                   |
| GET    | /public/games                     | Archived game summaries                             |
| GET    | /public/game/:gameId              | Archived game record                                |
| GET    | /game/:gameId                     | Legacy alias for the archived game record           |
| GET    | /public/player/:publicId          | Public player profile                               |
| GET    | /player/:publicId                 | Legacy alias for the public player profile          |
| GET    | /public/player/:publicId/sessions | Public player sessions                              |
| GET    | /public/player/:publicId/games    | Public player game history                          |
| GET    | /public/clans/leaderboard         | Rolling clan leaderboard                            |
| GET    | /public/clan/:clanTag             | Clan statistics                                     |
| GET    | /public/clan/:clanTag/exists      | Clan existence check                                |
| GET    | /public/clan/:clanTag/sessions    | Clan game sessions                                  |
| GET    | /leaderboard/public/ffa           | Public free-for-all leaderboard                     |
| GET    | /leaderboard/ranked               | Ranked 1v1 and 2v2 leaderboards                     |
| GET    | /leaderboard/tribes               | Custom tribe-name leaderboard                       |
| GET    | /users/:persistentId              | Anonymous persistent-player lookup                  |
| GET    | /matchmaking/join                 | Matchmaking WebSocket                               |
| GET    | /public/\*                        | Public asset fallback, mainly for local development |

The OAuth and session endpoints are also unauthenticated at the HTTP layer:

| Method | Path                   | Purpose                             |
| ------ | ---------------------- | ----------------------------------- |
| POST   | /auth/logout           | Clear the current refresh session   |
| POST   | /auth/refresh          | Refresh or create a guest session   |
| POST   | /auth/revoke           | Revoke the current provider session |
| GET    | /auth/login/discord    | Start Discord login                 |
| GET    | /auth/login/google     | Start Google login                  |
| GET    | /auth/login/token      | Consume a one-time login token      |
| POST   | /auth/magic-link       | Send a magic-link login             |
| GET    | /auth/callback/discord | Discord OAuth callback              |
| GET    | /auth/callback/google  | Google OAuth callback               |
| POST   | /auth/crazygames       | Exchange a CrazyGames token         |
| POST   | /auth/steam            | Exchange a Steam ticket             |

### Authenticated player endpoints

Every endpoint in this table requires a user JWT unless noted otherwise.
Clan endpoints additionally require the role shown in the detailed reference.

| Method       | Path                               | Required role or purpose            |
| ------------ | ---------------------------------- | ----------------------------------- |
| GET, POST    | /users/@me                         | Read or change profile visibility   |
| PUT          | /users/@me/username                | Change username                     |
| GET, POST    | /users/@me/tribe_names             | Read or buy custom tribe names      |
| POST         | /users/@me/tribe_names/:id/boosts  | Boost one owned tribe name          |
| GET, POST    | /marketing/consent                 | Read or change email consent        |
| GET          | /auth/link/google                  | Start Google account linking        |
| POST         | /colors/random                     | Generate a random player color      |
| POST         | /archive_singleplayer_game         | Archive a browser singleplayer game |
| POST         | /flares_granted/temporary          | Grant a short-lived cosmetic trial  |
| GET          | /friends                           | List friends                        |
| GET          | /friends/requests                  | List friend requests                |
| POST, DELETE | /friends/requests/:publicId        | Create or withdraw a request        |
| POST         | /friends/requests/:publicId/accept | Accept a request                    |
| DELETE       | /friends/:publicId                 | Remove a friend                     |
| GET          | /clans                             | Browse clans                        |
| GET          | /clans/:clanTag                    | Read clan details                   |
| GET          | /clans/:clanTag/members            | Member list (member)                |
| GET          | /clans/:clanTag/games              | Clan game history (member)          |
| PATCH        | /clans/:clanTag                    | Update clan (officer)               |
| DELETE       | /clans/:clanTag                    | Disband clan (leader)               |
| POST         | /clans/:clanTag/join               | Join or request to join             |
| POST         | /clans/:clanTag/leave              | Leave clan (member)                 |
| POST         | /clans/:clanTag/kick               | Kick a member (officer)             |
| POST         | /clans/:clanTag/ban                | Ban a player (officer)              |
| POST         | /clans/:clanTag/unban              | Remove a clan ban (officer)         |
| POST         | /clans/:clanTag/promote            | Promote a member (leader)           |
| POST         | /clans/:clanTag/demote             | Demote an officer (leader)          |
| POST         | /clans/:clanTag/transfer           | Transfer leadership (leader)        |
| GET          | /clans/:clanTag/bans               | List bans (officer)                 |
| GET          | /clans/:clanTag/requests           | List join requests (officer)        |
| POST         | /clans/:clanTag/requests/approve   | Approve a join request (officer)    |
| POST         | /clans/:clanTag/requests/deny      | Deny a join request (officer)       |
| POST         | /clans/:clanTag/requests/withdraw  | Withdraw your join request          |
| POST         | /subscriptions/@me/cancel          | Cancel a subscription               |
| POST         | /subscriptions/@me/change-tier     | Change subscription tier            |
| POST         | /subscriptions/@me/portal          | Create a billing-portal session     |
| POST         | /rewards/claim-all                 | Claim all available rewards         |
| POST         | /rewards/:rewardId/claim           | Claim one reward                    |
| POST         | /shop/purchase                     | Spend in-game currency              |

## Common conventions

### Authentication

Send a short-lived player JWT as:

    Authorization: Bearer <jwt>

The API also sets an HttpOnly refresh-session cookie. Access tokens expire
after about 15 minutes; refresh sessions expire after about 30 days. Browser
clients should send credentials on cross-origin requests.

The JWKS endpoint is:

    GET /.well-known/jwks.json

It returns a standard JSON Web Key Set for verifying API-issued JWTs. JWT
claims include a subject, issuer, audience, issued-at time, expiry, and a
session identifier (jti). Do not put refresh cookies or signing keys in
client-visible documentation or logs.

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

Unless an endpoint says otherwise, timestamps are ISO 8601 strings. Public
player references accept a public ID, a full display name in base.disc form,
or a bare premium name. Player references are limited to 25 characters.

Page-based endpoints use page numbers starting at 1. Cursor values are opaque:
clients must not parse or manufacture them, and should retain the cursor
alongside the filters that produced it.

## Authentication and sessions

### Refresh, logout, and revoke

#### POST /auth/refresh

Refresh the session represented by the refresh cookie. If there is no refresh
cookie, the endpoint creates a guest session and sets one.

Response:

    {
      "jwt": "eyJ...",
      "expiresIn": 900
    }

#### POST /auth/logout

Deletes the current refresh session and clears the refresh cookie. The response
has no body.

#### POST /auth/revoke

Deletes the current refresh session. For a Discord-backed session it also
revokes the provider token when available. The response has no body.

### OAuth login

#### GET /auth/login/discord

#### GET /auth/login/google

Query parameters:

- redirect_uri: an allowlisted callback destination

The API generates and stores the OAuth state; callers do not supply it.
These endpoints redirect to the provider. The corresponding callbacks are:

#### GET /auth/callback/discord

#### GET /auth/callback/google

The callbacks validate the state and provider response, set the refresh
cookie, and redirect to the original allowlisted destination. Integrations
should use the documented redirect flow rather than expecting a JWT in a URL
fragment.

### One-time login links

#### POST /auth/magic-link

Body:

    {
      "email": "player@example.com",
      "redirectDomain": "https://example.com"
    }

The endpoint sends a one-time link when the address is eligible. The token is
valid for 15 minutes.

#### GET /auth/login/token?login-token=<token>

Consumes the one-time token, sets the refresh cookie, and returns the
authenticated email. A successful response is:

    { "email": "player@example.com" }

A token cannot be reused. This endpoint does not perform an additional
redirect; the link's client can navigate after receiving the response.

### Platform login

#### POST /auth/crazygames

Body:

    { "token": "crazygames-sdk-token" }

#### POST /auth/steam

Body:

    { "ticket": "steamworks-auth-ticket" }

Both successful exchanges return the same session shape:

    {
      "jwt": "eyJ...",
      "expiresIn": 900
    }

They also set the refresh-session cookie.

### Link Google

#### GET /auth/link/google?redirect_uri=<allowlisted-uri>

Requires a user JWT. Returns:

    { "url": "https://accounts.google.com/..." }

The returned URL starts the linking flow. The callback redirects with a
completion status such as link=google, cancel, already_linked, or error.

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
- playerTeams: team filter, up to 20 characters
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
      "lobbyFillTime": 15,
      "playerTeams": "2v2",
      "rankedType": "unranked"
    }

Values such as end, difficulty, player counts, lobbyFillTime,
playerTeams, and rankedType may be null. The response includes:

    Content-Range: games <offset>-<last>/<total>

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
stats exclude singleplayer games from the public unranked aggregates.

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

Nullable session fields may be null. A player with no sessions returns 404.

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
          "map": "map-id",
          "mode": "Team",
          "type": "Public",
          "playerTeams": "2v2",
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
that game session. Unknown players return 404.

### GET /users/:persistentId

Looks up the public player ID associated with an anonymous persistent player.
The path accepts a UUID or the literal REDACTED. A successful response is:

    { "player": { "publicId": "..." } }

This endpoint only resolves anonymous players without a linked Discord
identity. Other cases return 404.

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
player's current membership has changed.

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

The response is cached for about one hour. The implementation also applies
the configured historical cutoff when calculating the rolling window.

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

user may be null when there is no public linked Discord profile. This route is
cached briefly (about one minute).

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

playerReach is the accumulated impression/reach metric, not a distinct-player
count. ownerUsername can be null. This leaderboard is cached for about one
hour.

## Public feeds and catalog

These feeds are intentionally unauthenticated and are suitable for loading
the public website or game client. They are normally cached for about one
minute unless stated otherwise.

### GET /cosmetics.json

Returns the public catalog grouped by:

- patterns
- flags
- skins
- crowns
- effects
- colorPalettes
- currencyPacks
- subscriptions
- tribeNames

Purchasable entries include price as a display string, priceInCents,
productId, and priceId when applicable; unavailable products have a null
product entry. Cosmetic entries also expose their name, rarity, optional
affiliateCode, and soft/hard in-game prices. Patterns include pattern,
description, and optional color-palette availability. Flags, skins, and crowns
include a public url. Effects are grouped by effect type; current groups
include transportShipTrail, nukeTrail, nukeExplosion, structures, and warship,
with type-specific attributes.

Color palettes contain name, primaryColor, and nullable secondaryColor.
Currency packs contain name, displayName, currency, amount, bonusAmount,
rarity, and a product when purchasable. Subscription entries contain name,
description, priceMonthly, daily soft/hard currency, lobby/ranked
entitlements, signup bonus, rarity, and a product. Tribe-name catalog entries
include the current hard-currency name price, boost price, and boost duration.
Clients should use this feed instead of hard-coding catalog prices or asset
URLs.

### GET /ping

Returns 204 when the API worker is reachable.

### GET /news.json

Returns published news, omitting disabled entries:

    [
      {
        "id": "news-id",
        "title": "Headline",
        "description": "Short description",
        "url": "https://example.com/article",
        "type": "news"
      }
    ]

url may be null. The exact type values are managed by the API catalog.

### GET /featured-stream.json

Returns:

    {
      "enabled": true,
      "channels": ["openfrontio"]
    }

channels contains valid Twitch login names.

### GET /live-streams.json

Returns the current configured roster:

    {
      "enabled": true,
      "streams": [
        {
          "platform": "twitch",
          "channel": "openfrontio",
          "displayName": "OpenFrontIO",
          "title": "Playing OpenFront",
          "viewers": 42,
          "avatarUrl": "https://...",
          "url": "https://twitch.tv/openfrontio"
        }
      ]
    }

platform is twitch or youtube. title, viewers, avatarUrl, and url may be
omitted when the provider has not supplied them.

### GET /public/\*

Serves an asset from the configured public bucket when the API is running in
a mode with public-bucket fallback enabled. Production clients should use the
asset URLs returned by /cosmetics.json; they should not construct bucket keys
or depend on this fallback route.

## Authenticated account endpoints

The endpoints in this section require Authorization: Bearer <jwt>.

### GET /users/@me

Returns the authenticated account and player state. The response has this
shape; dates are serialized as ISO strings:

    {
      "user": {
        "discord": {
          "id": "discord-id",
          "avatar": "avatar-hash-or-null",
          "username": "discord-name",
          "global_name": "Display name",
          "discriminator": "0",
          "locale": "en-US"
        },
        "google": { "email": "player@example.com" },
        "email": "player@example.com",
        "steam": {
          "steamId": "steam-id",
          "personaName": "Steam name",
          "avatarUrl": "https://..."
        }
      },
      "ban": null,
      "player": {
        "adfree": false,
        "username": "Player.1234",
        "usernameBase": "Player",
        "usernameDiscriminator": "1234",
        "usernameStatus": "unclaimed",
        "usernameClaimExpiresAt": null,
        "nextUsernameChangeAt": null,
        "canCreatePublicLobbies": false,
        "unlimitedRanked": false,
        "publicId": "player-public-id",
        "flares": ["pattern:example"],
        "flareExpiration": {},
        "tempFlaresCooldown": false,
        "achievements": {},
        "leaderboard": {
          "oneVone": { "elo": 1000, "maxElo": 1000 },
          "twoVtwo": { "elo": 1000, "maxElo": 1000 }
        },
        "currency": { "soft": "0", "hard": "0" },
        "rewards": [],
        "clans": [],
        "clanRequests": [],
        "friends": [],
        "subscription": null,
        "marketingConsent": {
          "consented": "no_response",
          "hasEmail": false
        }
      }
    }

user contains only the identity providers linked to the account. ban is null
or an object with category, reason, and expiresAt. The player fields report
entitlements, cosmetics, achievements, ranked ELO, currency balances, pending
rewards, clan memberships, pending clan requests, friend public IDs,
subscription status, and marketing-consent state.

currency and reward amounts are decimal strings to preserve integer precision.
rewards are not included in the balance until claimed. subscription is null or
contains tier, status, currentPeriodEnd, and cancelAtPeriodEnd. The four
usernameStatus values are unclaimed, claimed, premium, and indefinite.

### POST /users/@me

Changes profile visibility.

Body:

    { "public": true }

Returns 204.

### PUT /users/@me/username

Body:

    { "username": "NewName" }

username is trimmed, must contain 3–20 ASCII letters, numbers, underscores,
or hyphens, and is subject to the username moderation and namespace checks.
The change cooldown is 30 days.

Response:

    {
      "username": "NewName.1234",
      "base": "NewName",
      "discriminator": "1234",
      "usernameStatus": "unclaimed",
      "nextUsernameChangeAt": "2026-02-01T00:00:00.000Z"
    }

A profane or invalid name returns 400, an unavailable name returns 409, and a
cooldown returns 429 with Retry-After when available.

### GET /users/@me/tribe_names

Returns at most the 100 most recent purchased names:

    {
      "names": [
        {
          "id": "123",
          "displayName": "Example Tribe",
          "status": "pending",
          "rejectionKind": null,
          "reviewReason": null,
          "pricePaid": "200",
          "baseWeight": 1,
          "activeBoosts": 0,
          "boostExpiresAt": null,
          "createdAt": "2026-01-01T00:00:00.000Z",
          "approvedAt": null,
          "gamesAppeared": 0,
          "playerReach": 0
        }
      ]
    }

status is managed by moderation and can be pending, live, rejected, or
revoked. rejectionKind and reviewReason can be null. activeBoosts counts
unexpired boosts, and boostExpiresAt is the next boost expiry. playerReach is
an impression metric, not a distinct-player count.

### POST /users/@me/tribe_names

Purchases a custom tribe name and puts it into the moderation queue.

Body:

    { "name": "Example Tribe" }

The name is limited to 100 characters and is screened before purchase. The
current hard-currency price is published by cosmetics.json. A successful
purchase returns 201:

    {
      "id": "123",
      "displayName": "Example Tribe",
      "status": "pending",
      "pricePaid": "200"
    }

Active names are globally unique; duplicate names return 409.

### POST /users/@me/tribe_names/:id/boosts

Adds a 30-day rotation boost to an owned active name. Boosts stack.

The current hard-currency price is published by cosmetics.json (currently 100).
The optional Idempotency-Key header makes a retry safe for the same purchase.

Response:

    {
      "id": "456",
      "customTribeNameId": "123",
      "expiresAt": "2026-02-01T00:00:00.000Z",
      "pricePaid": "100"
    }

Insufficient currency or an inactive/non-owned name returns 400 or 404 as
appropriate.

### GET /marketing/consent

Returns:

    {
      "consented": "approved",
      "hasEmail": true
    }

consented is approved, denied, or no_response. The state is associated with
the account's verified contact email.

### POST /marketing/consent

Body:

    { "consented": true }

Returns the normalized state:

    { "consented": "approved" }

An account without a verified email returns 404.

### POST /colors/random

Generates and stores a random player color:

    { "color": "#A1B2C3" }

The endpoint is limited to once per minute per player and returns 429 when
called sooner.

### POST /flares_granted/temporary

Grants a six-minute trial for a shop pattern. Body:

    { "flare": "pattern:example" }

The pattern must exist and be for sale. Each player can use this trial once
per 24 hours. Response:

    { "expiresAt": "2026-01-01T12:06:00.000Z" }

### POST /archive_singleplayer_game

Archives a client-authored singleplayer GameRecord. The payload must pass the
game-record schema, have config.gameType=Singleplayer, and contain exactly one
player. The server stamps that player's persistent identity from the JWT and
removes untrusted external flag URLs.

Clients may gzip the JSON body and send:

    Content-Encoding: gzip

Success returns 204. Duplicate game IDs return 409; malformed or invalid
records return 400. This endpoint is rate-limited to one archive per minute.

## Friends

### GET /friends

Query parameters:

- page: positive integer, default 1
- limit: 1–50, default 10

Response:

    {
      "results": [
        {
          "publicId": "player-public-id",
          "username": "Friend.1234",
          "createdAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "total": 1,
      "page": 1,
      "limit": 10
    }

Friends are newest first. username may be null.

### GET /friends/requests

Returns both directions. publicId in each entry identifies the other player:

    {
      "incoming": [
        {
          "publicId": "player-public-id",
          "username": "Player",
          "createdAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "outgoing": []
    }

### POST /friends/requests/:publicId

Sends a request to a public ID, full display name, or bare premium name. The
body is empty.

Normally the response is 202:

    { "status": "requested" }

If the other player already requested you, the inverse request is accepted
and the response is 201:

    { "status": "accepted" }

Self-targeting returns 400. Already-friends, duplicate-request, and a full
recipient inbox return 409.

### POST /friends/requests/:publicId/accept

Accepts an incoming request. The body is empty and success returns 204.

### DELETE /friends/requests/:publicId

Denies an incoming request or withdraws an outgoing request. The body is empty
and success returns 204.

### DELETE /friends/:publicId

Removes an existing friendship. The body is empty and success returns 204.

The request, accept, and delete paths accept the same player-reference forms
as the public player endpoints. Missing relationships return 404.

## Player-facing clans

Clan tags are 2–5 uppercase ASCII letters or digits. Lookup is
case-insensitive. A user JWT is required for all endpoints in this section;
the member, officer, and leader roles are checked against the target clan.

### GET /clans

Browse and search clans.

Query parameters:

- page: positive integer, default 1
- limit: 1–50, default 10
- search: optional, 2–100 characters; searches tag and name
- sortField: tag, name, or memberCount
- sortOrder: ASC or DESC

Response:

    {
      "results": [
        {
          "name": "Example Clan",
          "tag": "ABC",
          "description": "A description",
          "isOpen": true,
          "createdAt": "2026-01-01T00:00:00.000Z",
          "memberCount": 12
        }
      ],
      "total": 1,
      "page": 1,
      "limit": 10
    }

### GET /clans/:clanTag

Returns:

    {
      "name": "Example Clan",
      "tag": "ABC",
      "description": "A description",
      "isOpen": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "memberCount": 12,
      "discordUrl": "https://discord.gg/example"
    }

discordUrl can be null.

### GET /clans/:clanTag/members

Requires clan membership. Query parameters:

- page: positive integer, default 1
- limit: 1–50, default 10
- sort: default, winsTotal, lossesTotal, winsFfa, lossesFfa, winsTeam,
  lossesTeam, winsHvn, lossesHvn, winsRanked, lossesRanked, wins1v1, or
  losses1v1
- order: asc or desc

Response:

    {
      "results": [
        {
          "role": "member",
          "joinedAt": "2026-01-01T00:00:00.000Z",
          "publicId": "player-public-id",
          "username": "Player",
          "stats": {
            "total": { "wins": 10, "losses": 5 },
            "ffa": { "wins": 2, "losses": 1 },
            "team": { "wins": 8, "losses": 4 },
            "hvn": { "wins": 0, "losses": 0 },
            "duos": { "wins": 3, "losses": 2 },
            "trios": { "wins": 2, "losses": 1 },
            "quads": { "wins": 1, "losses": 0 },
            "2": { "wins": 0, "losses": 0 },
            "3": { "wins": 0, "losses": 0 },
            "4": { "wins": 0, "losses": 0 },
            "5": { "wins": 0, "losses": 0 },
            "6": { "wins": 0, "losses": 0 },
            "7": { "wins": 0, "losses": 0 },
            "ranked": { "wins": 1, "losses": 0 },
            "1v1": { "wins": 1, "losses": 0 }
          }
        }
      ],
      "total": 1,
      "page": 1,
      "limit": 10,
      "pendingRequests": 0
    }

username can be null. pendingRequests is included for managers and can be
omitted or null for ordinary members. All stats are public-game clan stats;
the bucket names describe the aggregation used by the API.

### GET /clans/:clanTag/games

Requires clan membership. Query parameters:

- filter: ffa, team, hvn, or ranked
- cursor: opaque cursor from the previous response

The page size is fixed at 10. The response is:

    {
      "results": [
        {
          "gameId": "game-id",
          "start": "2026-01-01T12:00:00.000Z",
          "durationSeconds": 1200,
          "map": "map-id",
          "mode": "Team",
          "playerTeams": "2v2",
          "rankedType": "unranked",
          "result": "victory",
          "totalPlayers": 10,
          "clanPlayers": [
            {
              "publicId": "player-public-id",
              "username": "Player",
              "verified": true,
              "won": true
            }
          ]
        }
      ],
      "nextCursor": "opaque-cursor-or-null"
    }

result is victory, defeat, or incomplete. totalPlayers and playerTeams can be
null; rankedType is a string. The cursor is tied to filter.

### PATCH /clans/:clanTag

Requires an officer. Send one or more fields:

    {
      "name": "New Clan Name",
      "description": "Updated description",
      "discordUrl": "https://discord.gg/example",
      "isOpen": false
    }

name is 1–30 characters using ASCII letters, digits, spaces, underscores, or
hyphens. description is at most 200 characters. Set discordUrl to null or an
empty string to clear it. Only the leader can change isOpen or discordUrl;
Discord invites must be valid and never-expiring.

Response:

    {
      "name": "New Clan Name",
      "tag": "ABC",
      "description": "Updated description",
      "discordUrl": "https://discord.gg/example",
      "isOpen": false
    }

### DELETE /clans/:clanTag

Requires the leader and disbands the clan. Leadership must be transferred
before a leader can leave. Success returns 204.

### POST /clans/:clanTag/join

The body is empty. An open clan adds the player immediately and returns 201:

    { "status": "joined" }

A closed clan creates a pending request and returns 202:

    { "status": "requested" }

The endpoint is rate-limited to one join attempt per minute. A banned player
gets 403 with code BANNED and an optional reason. Existing membership or a
duplicate request returns 409.

### POST /clans/:clanTag/leave

Requires membership, has an empty body, and returns 204. Leaders receive 400
until they transfer leadership or disband the clan.

### Clan member actions

The following endpoints take:

    { "targetPublicId": "player-public-id" }

- POST /clans/:clanTag/kick — officer; leaders can kick officers and members,
  officers can kick members
- POST /clans/:clanTag/ban — officer; uses the same target plus an optional
  reason of at most 200 characters
- POST /clans/:clanTag/unban — officer
- POST /clans/:clanTag/promote — leader; member to officer
- POST /clans/:clanTag/demote — leader; officer to member
- POST /clans/:clanTag/transfer — leader; transfers leadership to a member

These successful mutations return 204. Self-targeting and invalid role
transitions return 400 or 403; missing players/members return 404. Banning an
already-banned player returns 409.

### GET /clans/:clanTag/bans

Requires an officer. Query parameters page and limit have the standard clan
pagination defaults (page 1, limit 10, maximum 50).

Response entries contain publicId, username, bannedBy, bannedByUsername,
reason, and createdAt. Usernames may be null.

### GET /clans/:clanTag/requests

Requires an officer. Standard page and limit parameters are supported.
Response:

    {
      "results": [
        {
          "publicId": "player-public-id",
          "username": "Player",
          "createdAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "total": 1,
      "page": 1,
      "limit": 10
    }

### POST /clans/:clanTag/requests/approve

### POST /clans/:clanTag/requests/deny

Require an officer and take the targetPublicId body shown above. Success
returns 204. Approving a banned player returns 409; missing requests return 404.

### POST /clans/:clanTag/requests/withdraw

Requires a user JWT, takes an empty body, and withdraws the caller's pending
request. Success returns 204; no pending request returns 404.

## Currency, rewards, and subscriptions

### POST /rewards/:rewardId/claim

Claims one pending reward and credits the balance atomically. The response is:

    {
      "id": "123",
      "currencyType": "hard",
      "amount": "100",
      "reason": "subscription_signup_bonus",
      "note": "Subscription signup bonus",
      "claimedAt": "2026-01-01T00:00:00.000Z",
      "currency": {
        "soft": "2500",
        "hard": "100"
      }
    }

Amounts are decimal strings. Unknown, already-claimed, or another player's
reward returns 404.

### POST /rewards/claim-all

Claims all pending rewards in one transaction. The response is:

    {
      "claimed": [
        {
          "id": "123",
          "currencyType": "hard",
          "amount": "100",
          "reason": "subscription_daily",
          "note": "Daily subscription reward",
          "claimedAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "currency": {
        "soft": "2500",
        "hard": "100"
      }
    }

Calling this with no pending rewards is successful and returns an empty
claimed array.

### POST /shop/purchase

Purchases a cosmetic with in-game currency.

Body:

    {
      "cosmeticType": "pattern",
      "cosmeticName": "example",
      "currencyType": "hard",
      "colorPaletteName": "sunset"
    }

cosmeticType is pattern, skin, flag, effect, or crown. colorPaletteName is
optional and is used for palette variants. The chosen cosmetic must have a
positive price in the requested soft or hard currency.

Response:

    {
      "flareName": "pattern:example",
      "currencyType": "hard",
      "amount": "100"
    }

Already-owned items return 409. Insufficient balance or unavailable items
return 400.

### POST /subscriptions/@me/cancel

Cancels the current subscription at the end of its paid period. Response:

    {
      "status": "active",
      "currentPeriodEnd": "2026-02-01T00:00:00.000Z",
      "cancelAtPeriodEnd": true
    }

The player retains entitlements until period end. An already-pending
cancellation returns 409; no entitled subscription returns 404. An
administrator-granted subscription has no Stripe period and is revoked
immediately.

### POST /subscriptions/@me/change-tier

Body:

    { "tierName": "premium" }

The target tier must be active and different from the current tier. Response:

    {
      "tier": "premium",
      "cancelAtPeriodEnd": false
    }

Upgrades invoice the difference immediately; downgrades use Stripe
proration. The local tier is canonical after the Stripe webhook, so clients
should refetch /users/@me. This operation is rate-limited to once per minute.

### POST /subscriptions/@me/portal

Body:

    { "returnUrl": "https://openfront.io/account" }

returnUrl must be an allowlisted URL. Response:

    { "url": "https://billing.stripe.com/..." }

The endpoint requires an active Stripe-backed subscription. Admin-granted
subscriptions do not have a Stripe billing portal.

## Matchmaking WebSocket

### GET /matchmaking/join

This endpoint upgrades to a WebSocket. It is not authenticated by an HTTP
Authorization header; authenticate the socket by sending the JWT in the first
message.

Query parameters:

- instance_id: matchmaking instance name
- mode: 1v1 or 2v2, default 1v1

Production example:

    wss://api.openfront.io/matchmaking/join?instance_id=eu-west&mode=1v1

After the socket opens, send:

    {
      "type": "join",
      "jwt": "eyJ...",
      "clanTag": "ABC"
    }

clanTag is optional and is relevant to 2v2 matching. When supplied for 2v2,
the player must be a member of that clan. The server also checks the player's
ranked-play allowance.

While queued, the server may send:

    { "type": "queue-size", "count": 4 }

When a match is assigned:

    { "type": "match-assignment", "gameId": "game-id" }

Invalid JWT, ranked-play limits, or an invalid clan close the socket with
policy code 1008. A failed clan verification can use 1011. Missing
instance_id or an invalid mode returns HTTP 400; a non-WebSocket request
returns HTTP 426.
