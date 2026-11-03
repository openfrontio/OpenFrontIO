import {
  ColoredTeams,
  Duos,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Team,
  Trios,
} from "@openfront/engine-api/game/GameTypes";
import { ClientID, TeamCountConfig } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";

export function assignTeams(
  players: PlayerInfo[],
  teams: Team[],
  isDuosTriosQuads: boolean,
  maxTeamSize: number = getMaxTeamSize(players.length, teams.length),
): Map<PlayerInfo, Team | "kicked"> {
  const result = new Map<PlayerInfo, Team | "kicked">();
  const teamPlayerCount = new Map<Team, number>();

  // Matchmade games arrive with a server-pinned team slot (teamIndex). The
  // matchmaker already balanced those teams, so pins are honored
  // unconditionally — before and regardless of clan/friend grouping and
  // maxTeamSize — and seed the counts the balancing below sees.
  const unpinned: PlayerInfo[] = [];
  for (const p of players) {
    const pinnedTeam = p.teamIndex === null ? undefined : teams[p.teamIndex];
    if (pinnedTeam === undefined) {
      unpinned.push(p);
      continue;
    }
    result.set(p, pinnedTeam);
    teamPlayerCount.set(pinnedTeam, (teamPlayerCount.get(pinnedTeam) ?? 0) + 1);
  }

  // Clans are strict: a clan goes to one team together, and any overflow
  // members get kicked. (You opted into the clan, so we honor "all or
  // nothing" for placement.)
  const clanGroups = new Map<string, PlayerInfo[]>();
  const nonClanPlayers: PlayerInfo[] = [];
  for (const p of unpinned) {
    if (p.clanTag) {
      if (!clanGroups.has(p.clanTag)) clanGroups.set(p.clanTag, []);
      clanGroups.get(p.clanTag)!.push(p);
    } else {
      nonClanPlayers.push(p);
    }
  }

  const sortedClans = Array.from(clanGroups.values()).sort(
    (a, b) => b.length - a.length,
  );
  for (const clan of sortedClans) {
    let team: Team | null = null;
    let teamSize = 0;
    for (const t of teams) {
      const p = teamPlayerCount.get(t) ?? 0;
      if (team !== null && teamSize <= p) continue;
      teamSize = p;
      team = t;
    }
    if (team === null) continue;
    for (const player of clan) {
      if (teamSize < maxTeamSize) {
        teamSize++;
        result.set(player, team);
      } else {
        result.set(player, "kicked");
      }
    }
    teamPlayerCount.set(team, teamSize);
  }

  // Friend edges are a soft preference: when placing a player, prefer the
  // team where the most of their friends already are. If that team is full
  // we spill onto the next-emptiest non-full team rather than kicking — you
  // didn't opt into being grouped with friend-of-friend, so a chain that
  // doesn't fit shouldn't bench anyone.
  const presentClientIDs = new Set<ClientID>();
  for (const p of players) {
    if (p.clientID !== null) presentClientIDs.add(p.clientID);
  }
  const friendGraph = new Map<ClientID, Set<ClientID>>();
  const addEdge = (a: ClientID, b: ClientID) => {
    let s = friendGraph.get(a);
    if (s === undefined) {
      s = new Set();
      friendGraph.set(a, s);
    }
    s.add(b);
  };
  for (const p of players) {
    if (p.clientID === null) continue;
    for (const friendID of p.friends) {
      if (!presentClientIDs.has(friendID)) continue;
      addEdge(p.clientID, friendID);
      addEdge(friendID, p.clientID);
    }
  }

  const teamByClientID = new Map<ClientID, Team>();
  for (const [player, team] of result.entries()) {
    if (player.clientID !== null && team !== "kicked") {
      teamByClientID.set(player.clientID, team);
    }
  }

  // groupLeft counts this player and the members of their friend group still
  // to be seated after them. Among teams with equally many friends, prefer
  // the one that seats the most of the group, so the first friend doesn't
  // take the last seat beside a stranger.
  const placePlayer = (p: PlayerInfo, groupLeft: number) => {
    const myFriends =
      p.clientID !== null ? friendGraph.get(p.clientID) : undefined;
    let bestTeam: Team | null = null;
    let bestFriendCount = -1;
    let bestGroupSeats = -1;
    let bestSize = isDuosTriosQuads ? -1 : Infinity;
    for (const t of teams) {
      const size = teamPlayerCount.get(t) ?? 0;
      if (size >= maxTeamSize) continue;
      let friendsOnTeam = 0;
      if (myFriends !== undefined) {
        for (const friendID of myFriends) {
          if (teamByClientID.get(friendID) === t) friendsOnTeam++;
        }
      }
      const groupSeats = Math.min(groupLeft, maxTeamSize - size);
      if (
        friendsOnTeam > bestFriendCount ||
        (friendsOnTeam === bestFriendCount &&
          (groupSeats > bestGroupSeats ||
            (groupSeats === bestGroupSeats &&
              (isDuosTriosQuads ? size > bestSize : size < bestSize))))
      ) {
        bestFriendCount = friendsOnTeam;
        bestGroupSeats = groupSeats;
        bestSize = size;
        bestTeam = t;
      }
    }
    if (bestTeam === null) {
      result.set(p, "kicked");
      return;
    }
    teamPlayerCount.set(bestTeam, (teamPlayerCount.get(bestTeam) ?? 0) + 1);
    result.set(p, bestTeam);
    if (p.clientID !== null) teamByClientID.set(p.clientID, bestTeam);
  };

  let nationPlayers = nonClanPlayers.filter(
    (p) => p.playerType === PlayerType.Nation,
  );
  if (nationPlayers.length > 0) {
    const random = new PseudoRandom(simpleHash(nationPlayers[0].id));
    nationPlayers = random.shuffleArray(nationPlayers);
  }
  const otherPlayers = nonClanPlayers.filter(
    (p) => p.playerType !== PlayerType.Nation,
  );

  // Seat each friend group back to back, so strangers who joined between two
  // friends can't fill the first friend's team before the second is placed.
  // Groups with a friend already seated (a clan member or a pinned player) go
  // first, before other groups can fill that friend's team.
  for (const group of friendGroups(otherPlayers, friendGraph, teamByClientID)) {
    group.forEach((p, i) => placePlayer(p, group.length - i));
  }
  for (const p of nationPlayers) {
    placePlayer(p, 1);
  }

  return result;
}

// Splits players into groups connected by friend edges, each group in the
// order it was reached. Groups with a friend already seated come first,
// grown from the member who has that friend so they are placed beside them;
// then largest groups first (ties keep join order). Players with no friends
// among `players` are groups of one.
function friendGroups(
  players: PlayerInfo[],
  friendGraph: Map<ClientID, Set<ClientID>>,
  seated: ReadonlyMap<ClientID, Team>,
): PlayerInfo[][] {
  const byClientID = new Map<ClientID, PlayerInfo>();
  for (const p of players) {
    if (p.clientID !== null) byClientID.set(p.clientID, p);
  }
  const hasSeatedFriend = (p: PlayerInfo): boolean => {
    if (p.clientID === null) return false;
    for (const friendID of friendGraph.get(p.clientID) ?? []) {
      if (seated.has(friendID)) return true;
    }
    return false;
  };
  // Starting from anchored players first means any group containing one is
  // reached from it, so its first member's flag marks the whole group.
  const anchored = players.filter(hasSeatedFriend);
  const starts = anchored.concat(players.filter((p) => !hasSeatedFriend(p)));
  const grouped = new Set<PlayerInfo>();
  const groups: PlayerInfo[][] = [];
  for (const start of starts) {
    if (grouped.has(start)) continue;
    grouped.add(start);
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      const clientID = group[i].clientID;
      if (clientID === null) continue;
      for (const friendID of friendGraph.get(clientID) ?? []) {
        const friend = byClientID.get(friendID);
        if (friend === undefined || grouped.has(friend)) continue;
        grouped.add(friend);
        group.push(friend);
      }
    }
    groups.push(group);
  }
  const anchoredStarts = new Set(anchored);
  const rank = (g: PlayerInfo[]) => (anchoredStarts.has(g[0]) ? 1 : 0);
  return groups.sort((a, b) => rank(b) - rank(a) || b.length - a.length);
}

export function assignTeamsLobbyPreview(
  players: PlayerInfo[],
  teams: Team[],
  teamCount: TeamCountConfig,
  nationCount: number,
): Map<PlayerInfo, Team | "kicked"> {
  const maxTeamSize = getMaxTeamSize(
    players.length + nationCount,
    teams.length,
  );
  return assignTeams(
    players,
    teams,
    teamCount === Duos || teamCount === Trios || teamCount === Quads,
    maxTeamSize,
  );
}

export function getMaxTeamSize(numPlayers: number, numTeams: number): number {
  return Math.ceil(numPlayers / numTeams);
}

export function resolveTeamsList(
  config: TeamCountConfig,
  totalPlayers: number,
): Team[] {
  if (config === HumansVsNations) {
    return [ColoredTeams.Humans, ColoredTeams.Nations];
  }
  let numTeams: number;
  if (typeof config !== "number") {
    const divisor =
      config === Duos ? 2 : config === Trios ? 3 : config === Quads ? 4 : 0;
    if (divisor === 0) {
      throw new Error(`Unknown TeamCountConfig ${config}`);
    }
    // At least 2, even when attendance can't fill two teams: public lobbies
    // start on their countdown no matter how few players are seated (or none,
    // when only spectators remain), and a private Duos lobby can start with a
    // single clan packed onto one team. Throwing here ("Too few teams") killed
    // game construction on every client — the game ran server-side while
    // everyone hung on the loading screen. The lobby preview already clamps
    // the same way (LobbyPlayerView.getTeamList), so this keeps them in step.
    numTeams = Math.max(2, Math.ceil(totalPlayers / divisor));
  } else {
    numTeams = config;
  }
  // Numeric configs state the team count outright, so below 2 is a
  // misconfiguration (e.g. a Team game with playerTeams unset resolves to 0)
  // and should stay loud rather than be silently reshaped.
  if (numTeams < 2) {
    throw new Error(`Too few teams: ${numTeams}`);
  }
  if (numTeams < 8) {
    const teams = [ColoredTeams.Red, ColoredTeams.Blue];
    if (numTeams >= 3) teams.push(ColoredTeams.Yellow);
    if (numTeams >= 4) teams.push(ColoredTeams.Green);
    if (numTeams >= 5) teams.push(ColoredTeams.Purple);
    if (numTeams >= 6) teams.push(ColoredTeams.Orange);
    if (numTeams >= 7) teams.push(ColoredTeams.Teal);
    return teams;
  }
  return Array.from({ length: numTeams }, (_, i) => `Team ${i + 1}`);
}
