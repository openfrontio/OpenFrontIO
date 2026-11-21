import {
  PlayerType,
  RankedType,
  type Team,
} from "@openfront/engine-api/game/GameTypes";
import type { ClientID, Winner } from "@openfront/engine-api/Schemas";

// Which card the end screen shows (if any): the player who eliminated you,
// the winner, or, for a Clan Wars win, the winning clan. A player's card only
// shows when they own one (`hasCard`: their start-info entry carries a card
// for this viewer). Bots, nations, a self-elimination, a killer who has left,
// a nation win and a cancelled match all show no card: today's screen.

export type EndScreenCard =
  | { kind: "none" }
  | { kind: "eliminatedBy"; clientID: ClientID }
  | { kind: "winner"; clientID: ClientID }
  | { kind: "clan"; clanTag: string; team: Team };

// What this reads of a player and of the game (PlayerView and GameView fit).
export interface EndCardPlayer {
  clientID(): ClientID | null;
  type(): PlayerType;
  team(): Team | null;
  numTilesOwned(): number;
  clanTag(): string | null;
  killedBy(): string | null;
}

export interface EndCardGame {
  players(): EndCardPlayer[];
  playerByClientID(id: ClientID): EndCardPlayer | null;
  rankedType(): RankedType | undefined;
}

const NONE: EndScreenCard = { kind: "none" };

function isHuman(p: EndCardPlayer): boolean {
  return p.type() === PlayerType.Human && p.clientID() !== null;
}

export function eliminatedByCard(
  me: EndCardPlayer,
  game: EndCardGame,
  hasCard: (id: ClientID) => boolean,
): EndScreenCard {
  const killerID = me.killedBy();
  if (killerID === null || killerID === me.clientID()) return NONE;
  const killer = game.playerByClientID(killerID);
  if (killer === null || !isHuman(killer)) return NONE;
  if (!hasCard(killerID)) return NONE;
  return { kind: "eliminatedBy", clientID: killerID };
}

export function winnerCard(
  winner: Winner,
  game: EndCardGame,
  hasCard: (id: ClientID) => boolean,
): EndScreenCard {
  if (winner === undefined) return NONE;
  if (winner[0] === "player") {
    const id = winner[1];
    return hasCard(id) ? { kind: "winner", clientID: id } : NONE;
  }
  if (winner[0] !== "team") return NONE;
  const team = winner[1];
  const members = game.players().filter((p) => p.team() === team && isHuman(p));
  if (members.length === 0) return NONE;
  if (game.rankedType() === RankedType.ClanWars) {
    const tag = members[0].clanTag();
    if (tag !== null && members.every((m) => m.clanTag() === tag)) {
      return { kind: "clan", clanTag: tag, team };
    }
  }
  const top = [...members].sort(
    (a, b) =>
      b.numTilesOwned() - a.numTilesOwned() ||
      (a.clientID()! < b.clientID()! ? -1 : 1),
  )[0];
  const id = top.clientID()!;
  return hasCard(id) ? { kind: "winner", clientID: id } : NONE;
}
