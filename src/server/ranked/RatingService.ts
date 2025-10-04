import { Logger } from "winston";
import { Glicko2 } from "./Glicko2";
import { RankedRepository } from "./RankedRepository";
import { RankedMode, RankedPlayerRating, RankedRegion } from "./types";

export interface RatingParticipantInput {
  playerId: string;
  clientId?: string;
  persistentId?: string;
}

export interface MatchRatingInput {
  matchId: string;
  gameId: string;
  finishedAt: number;
  mode: RankedMode;
  region: RankedRegion;
  participants: RatingParticipantInput[];
  winnerPlayerIds: string[];
}

export interface MatchRatingSummary {
  averageRatingBefore: number;
  seasonId: number;
  playerResults: Array<{
    playerId: string;
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
    outcome: "win" | "loss" | "draw";
  }>;
}

export class RatingService {
  private readonly glicko: Glicko2;

  constructor(
    private readonly log: Logger,
    private readonly repository: RankedRepository | null,
  ) {
    this.glicko = new Glicko2({
      tau: 0.5, // System constant - controls volatility changes
      defaultRating: 1500,
      defaultRD: 350,
      defaultVolatility: 0.06,
    });
  }

  async recordMatch(
    input: MatchRatingInput,
  ): Promise<MatchRatingSummary | null> {
    if (!this.repository) {
      this.log.debug("Ranked repository unavailable; skipping rating update", {
        matchId: input.matchId,
      });
      return null;
    }

    if (await this.repository.isMatchAlreadyRated(input.matchId)) {
      this.log.info("Ranked match already processed", {
        matchId: input.matchId,
      });
      return null;
    }

    if (input.participants.length < 2) {
      this.log.warn("Insufficient participants to rate match", {
        matchId: input.matchId,
        participants: input.participants.length,
      });
      return null;
    }

    if (input.participants.length !== 2) {
      this.log.warn("RatingService currently only supports 1v1 matches", {
        matchId: input.matchId,
        participants: input.participants.length,
      });
      return null;
    }

    const seasonId = await this.repository.getActiveSeasonId(
      new Date(input.finishedAt),
    );
    if (seasonId === null) {
      this.log.warn("No active ranked season; skipping rating update", {
        matchId: input.matchId,
      });
      return null;
    }

    const participants = await Promise.all(
      input.participants.map(async (participant) => {
        const rating = await this.repository!.getOrCreatePlayerRating(
          seasonId,
          participant.playerId,
        );
        return {
          ...participant,
          rating,
        };
      }),
    );

    const winnerSet = new Set(input.winnerPlayerIds);
    if (winnerSet.size === 0) {
      this.log.warn("No winners reported for ranked match", {
        matchId: input.matchId,
      });
      return null;
    }

    const [playerA, playerB] = participants;
    const winnerA = winnerSet.has(playerA.playerId);
    const winnerB = winnerSet.has(playerB.playerId);

    const scoreA = this.resolveScore(winnerA, winnerB);
    const scoreB = this.resolveScore(winnerB, winnerA);

    const ratingBeforeA = playerA.rating.rating;
    const ratingBeforeB = playerB.rating.rating;
    const rdBeforeA = playerA.rating.rd;
    const rdBeforeB = playerB.rating.rd;

    // Use Glicko-2 to update ratings
    const newRatingA = this.glicko.updateRating(
      {
        rating: playerA.rating.rating,
        ratingDeviation: playerA.rating.rd,
        volatility: playerA.rating.volatility,
      },
      [
        {
          opponentRating: playerB.rating.rating,
          opponentRD: playerB.rating.rd,
          score: scoreA,
        },
      ],
    );

    const newRatingB = this.glicko.updateRating(
      {
        rating: playerB.rating.rating,
        ratingDeviation: playerB.rating.rd,
        volatility: playerB.rating.volatility,
      },
      [
        {
          opponentRating: playerA.rating.rating,
          opponentRD: playerA.rating.rd,
          score: scoreB,
        },
      ],
    );

    const outcomeA =
      scoreA > scoreB ? "win" : scoreA < scoreB ? "loss" : "draw";
    const outcomeB =
      outcomeA === "win" ? "loss" : outcomeA === "loss" ? "win" : "draw";

    this.applyRecordUpdate(
      playerA.rating,
      newRatingA,
      outcomeA,
      input.matchId,
      input.finishedAt,
    );
    this.applyRecordUpdate(
      playerB.rating,
      newRatingB,
      outcomeB,
      input.matchId,
      input.finishedAt,
    );

    await this.repository.upsertPlayerRating(playerA.rating);
    await this.repository.upsertPlayerRating(playerB.rating);

    await this.repository.insertRatingHistory({
      playerId: playerA.playerId,
      seasonId,
      matchId: input.matchId,
      delta: this.roundRating(newRatingA.rating - ratingBeforeA),
      ratingAfter: newRatingA.rating,
      reason: "match_completed",
    });

    await this.repository.insertRatingHistory({
      playerId: playerB.playerId,
      seasonId,
      matchId: input.matchId,
      delta: this.roundRating(newRatingB.rating - ratingBeforeB),
      ratingAfter: newRatingB.rating,
      reason: "match_completed",
    });

    await this.repository.updateParticipantResult({
      matchId: input.matchId,
      playerId: playerA.playerId,
      ratingBefore: ratingBeforeA,
      rdBefore: rdBeforeA,
      volatilityBefore: playerA.rating.volatility,
      ratingAfter: newRatingA.rating,
      rdAfter: newRatingA.ratingDeviation,
      volatilityAfter: newRatingA.volatility,
      outcome: outcomeA,
    });

    await this.repository.updateParticipantResult({
      matchId: input.matchId,
      playerId: playerB.playerId,
      ratingBefore: ratingBeforeB,
      rdBefore: rdBeforeB,
      volatilityBefore: playerB.rating.volatility,
      ratingAfter: newRatingB.rating,
      rdAfter: newRatingB.ratingDeviation,
      volatilityAfter: newRatingB.volatility,
      outcome: outcomeB,
    });

    return {
      averageRatingBefore: this.roundRating(
        (ratingBeforeA + ratingBeforeB) / 2,
      ),
      seasonId,
      playerResults: [
        {
          playerId: playerA.playerId,
          ratingBefore: ratingBeforeA,
          ratingAfter: newRatingA.rating,
          delta: this.roundRating(newRatingA.rating - ratingBeforeA),
          outcome: outcomeA,
        },
        {
          playerId: playerB.playerId,
          ratingBefore: ratingBeforeB,
          ratingAfter: newRatingB.rating,
          delta: this.roundRating(newRatingB.rating - ratingBeforeB),
          outcome: outcomeB,
        },
      ],
    };
  }

  private resolveScore(isWinner: boolean, opponentWinner: boolean): number {
    if (isWinner && opponentWinner) {
      return 0.5;
    }
    if (isWinner) {
      return 1;
    }
    if (opponentWinner) {
      return 0;
    }
    return 0.5;
  }

  private applyRecordUpdate(
    record: RankedPlayerRating,
    newGlicko: { rating: number; ratingDeviation: number; volatility: number },
    outcome: "win" | "loss" | "draw",
    matchId: string,
    finishedAt: number,
  ): void {
    record.rating = this.roundRating(newGlicko.rating);
    record.rd = this.roundRating(newGlicko.ratingDeviation);
    record.volatility = newGlicko.volatility;
    record.matchesPlayed += 1;
    if (outcome === "win") {
      record.wins += 1;
      record.streak = record.streak >= 0 ? record.streak + 1 : 1;
    } else if (outcome === "loss") {
      record.losses += 1;
      record.streak = record.streak <= 0 ? record.streak - 1 : -1;
    } else {
      record.streak = 0;
    }
    record.lastActiveAt = finishedAt;
    record.lastMatchId = matchId;
  }

  private roundRating(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
