# Party Matchmaking Requirements

This document outlines the requirements for the external matchmaking service to support party-based matchmaking in OpenFrontIO.

## Overview

The party system allows players to group together before joining a game. The matchmaking service must ensure that all party members are placed in the same game and, when possible, on the same team.

## Current Implementation

### Client-Side

- Players can create or join parties using a 6-character party code
- Party information is sent to the matchmaking server during authentication:
  ```typescript
  this.socket?.send(
    JSON.stringify({
      type: "auth",
      playToken: getPlayToken(),
      partyCode: party?.code, // Party code sent here
    }),
  );
  ```

### Server-Side (OpenFrontIO Worker)

- Party codes are tracked when clients join games
- Party information flows through the game start process:
  1. `Client` object stores `partyCode`
  2. `GameStartInfo` includes `partyCode` for each player
  3. `PlayerInfo` objects are created with `partyCode`
  4. Team assignment prioritizes party grouping over clan grouping

## Required Matchmaking Service Changes

The external matchmaking service (at `${config.jwtIssuer()}/matchmaking/*`) needs to implement the following:

### 1. Track Party Codes in Queue

When players join the matchmaking queue, store their party code:

```typescript
interface QueuedPlayer {
  persistentID: string;
  playToken: string;
  partyCode?: string; // Track this
  // ... other player data
}
```

### 2. Group Party Members Together

When creating games, ensure all members of a party are assigned to the same game:

- **Priority**: Party members must be in the same game (highest priority)
- **Constraint**: If a party cannot fit in the current game, wait for the next game or create a new one
- **Timeout**: Consider implementing a timeout to prevent parties from waiting indefinitely

### 3. Game Assignment Logic

```typescript
// Pseudocode for matchmaking logic
function assignPlayersToGame(
  queuedPlayers: QueuedPlayer[],
  gameCapacity: number,
) {
  // Group players by party
  const parties = groupByParty(queuedPlayers);
  const soloPlayers = queuedPlayers.filter((p) => !p.partyCode);

  const game: QueuedPlayer[] = [];

  // First, assign complete parties
  for (const party of parties.sort((a, b) => b.length - a.length)) {
    if (game.length + party.length <= gameCapacity) {
      game.push(...party);
    }
  }

  // Then, fill remaining slots with solo players
  for (const player of soloPlayers) {
    if (game.length < gameCapacity) {
      game.push(player);
    }
  }

  return game;
}
```

### 4. Pass Party Information to Worker

When creating a game and notifying the worker, ensure party codes are preserved:

```typescript
// When sending game creation request to worker
{
  gameID: string,
  players: Array<{
    persistentID: string,
    playToken: string,
    partyCode?: string,  // Include this
    // ... other player data
  }>
}
```

## Team Assignment (Already Implemented)

The OpenFrontIO worker now handles team assignment with party awareness:

### Free-For-All (FFA) Games

- Party members are placed in the same game
- No team assignment needed (everyone plays individually)

### Team-Based Games

- **Primary Rule**: Party members are assigned to the same team
- **Overflow Handling**: If party size exceeds max team size, overflow members are placed on other teams in the same game
- **Priority Order**: Party grouping > Clan grouping > Balanced distribution

Example:

- Game with 2 teams, max 3 players per team
- Party of 4 players joins
- Result: 3 players on Team A, 1 player on Team B (all in same game)

## Testing Recommendations

### Test Cases for Matchmaking Service

1. **Basic Party Matching**

   - 2 parties of 2 players each should be in the same game

2. **Party Size Constraints**

   - Party of 4 in a 6-player game should work
   - Party of 8 in a 6-player game should wait or split (define behavior)

3. **Mixed Queue**

   - 1 party of 3 + 3 solo players should fill a 6-player game

4. **Priority Handling**

   - Parties should not be split across games
   - Solo players can fill remaining slots

5. **Edge Cases**
   - Empty party codes (solo players)
   - Invalid party codes
   - Party leader disconnects during matchmaking

## Implementation Checklist

- [ ] Add `partyCode` field to queued player data structure
- [ ] Implement party grouping logic in matchmaking algorithm
- [ ] Ensure party members are assigned to the same game
- [ ] Pass party codes to worker when creating games
- [ ] Add logging for party matchmaking events
- [ ] Test with various party sizes and game modes
- [ ] Handle edge cases (disconnects, timeouts, etc.)

## Notes

- The OpenFrontIO worker already handles team assignment, so the matchmaking service only needs to ensure party members are in the same **game**
- Party size is limited to 4 members (enforced by `PartyManager`)
- Party codes are 6-character alphanumeric strings generated by nanoid
- Parties automatically disband after 30 minutes of inactivity
