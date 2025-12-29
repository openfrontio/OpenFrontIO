import { AnalyticsRecord, PlayerRecord } from "../../../../core/Schemas";
import {
  GOLD_INDEX_STEAL,
  GOLD_INDEX_TRADE,
  GOLD_INDEX_WAR,
} from "../../../../core/StatsSchemas";

export enum RankType {
  Conquests = "Conquests",
  Atoms = "Atoms",
  Hydros = "Hydros",
  MIRV = "MIRV",
  TotalGold = "TotalGold",
  StolenGold = "StolenGold",
  TradedGold = "TradedGold",
  ConqueredGold = "ConqueredGold",
  Lifetime = "Lifetime",
}

export interface PlayerInfo {
  id: string;
  rawUsername: string;
  username: string;
  tag?: string;
  killedAt?: number;
  gold: bigint[];
  conquests: number;
  flag?: string;
  winner: boolean;
  atoms: number;
  hydros: number;
  mirv: number;
}

function hasPlayed(player: PlayerRecord): boolean {
  return (
    player.stats !== undefined &&
    (player.stats.units !== undefined ||
      player.stats.killedAt !== undefined ||
      player.stats.conquests !== undefined)
  );
}

export class Ranking {
  private readonly duration: number;
  private players: PlayerInfo[];

  constructor(session: AnalyticsRecord) {
    this.duration = session.info.duration;
    this.players = this.summarizePlayers(session);
  }

  get allPlayers() {
    return this.players;
  }

  sortedBy(type: RankType): PlayerInfo[] {
    return [...this.players].sort(
      (a, b) => this.getAdjustedScore(b, type) - this.getAdjustedScore(a, type),
    );
  }

  score(player: PlayerInfo, type: RankType): number {
    return this.getScore(player, type);
  }

  private summarizePlayers(session: AnalyticsRecord): PlayerInfo[] {
    const players: Record<string, PlayerInfo> = {};

    for (const player of session.info.players) {
      if (player === undefined || !hasPlayed(player)) continue;
      const stats = player.stats!;
      const match = player.username.match(/^\[(.*?)\]\s*(.*)$/);
      let username = player.username;
      if (player.clanTag && match) {
        username = match[2];
      }
      const gold = (stats.gold ?? []).map((v) => BigInt(v ?? 0));
      players[player.clientID] = {
        id: player.clientID,
        rawUsername: player.username,
        username,
        tag: player.clanTag,
        conquests: Number(stats.conquests) || 0,
        flag: player.cosmetics?.flag ?? undefined,
        killedAt: stats.killedAt !== null ? Number(stats.killedAt) : undefined,
        gold,
        atoms: Number(stats.bombs?.abomb?.[0]) || 0,
        hydros: Number(stats.bombs?.hbomb?.[0]) || 0,
        mirv: Number(stats.bombs?.mirv?.[0]) || 0,
        winner: false,
      };
    }

    const winnerBlock = session.info.winner;
    if (
      winnerBlock !== undefined &&
      Array.isArray(winnerBlock) &&
      winnerBlock.length > 0
    ) {
      if (winnerBlock[0] === "player") {
        const id = winnerBlock[1];
        if (players[id]) players[id].winner = true;
      } else if (winnerBlock[0] === "team") {
        // First element is the team color, which we don't care for
        for (let i = 2; i < winnerBlock.length; i++) {
          const id = winnerBlock[i];
          if (players[id]) {
            players[id].winner = true;
          }
        }
      }
    }

    return Object.values(players);
  }

  private getScore(player: PlayerInfo, type: RankType): number {
    switch (type) {
      case RankType.Lifetime:
        if (player.killedAt) {
          return (player.killedAt / Math.max(this.duration, 1)) * 10;
        }
        return 100;
      case RankType.Conquests:
        return player.conquests;
      case RankType.Atoms:
        return player.atoms;
      case RankType.Hydros:
        return player.hydros;
      case RankType.MIRV:
        return player.mirv;
      case RankType.TotalGold:
        return Number(player.gold.reduce((sum, gold) => sum + gold, 0n));
      case RankType.StolenGold:
        return Number(player.gold[GOLD_INDEX_STEAL] ?? 0n);
      case RankType.TradedGold:
        return Number(player.gold[GOLD_INDEX_TRADE] ?? 0n);
      case RankType.ConqueredGold:
        return Number(player.gold[GOLD_INDEX_WAR] ?? 0n);
    }
  }

  private getAdjustedScore(player: PlayerInfo, type: RankType): number {
    let score = this.getScore(player, type);
    // Other things being equals, winners should be better ranked than other players
    if (player.winner) score += 0.1;
    return score;
  }
}
