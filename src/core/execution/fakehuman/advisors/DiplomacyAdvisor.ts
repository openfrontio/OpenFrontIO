import { Player, PlayerID, Relation, Tick } from "../../../game/Game";
import { BaseAdvisor } from "../core/BaseAdvisor";
import { ActionRecommendation, AdvisorPriority } from "../core/types";

/**
 * DiplomacyAdvisor handles diplomatic decisions including:
 * - Alliance management (requests, extensions, betrayals)
 * - Embargo handling and relationship management
 * - Strategic diplomatic timing
 */
export class DiplomacyAdvisor extends BaseAdvisor {
  private readonly lastEmojiSent = new Map<Player, Tick>();
  private readonly embargoMalusApplied = new Set<PlayerID>();

  /**
   * Analyze diplomatic situation and recommend diplomatic actions
   */
  recommend(): ActionRecommendation | null {
    // Update relations from embargoes
    this.updateRelationsFromEmbargos();

    // Handle embargoes to hostile nations
    this.handleEmbargoesToHostileNations();

    // Consider strategic betrayals (currently just breaks alliances)
    const betrayalTarget = this.findBetrayalTarget();
    if (betrayalTarget) {
      return this.recommendBetrayal(betrayalTarget);
    }

    // Consider alliance requests
    const allianceRequest = this.recommendAllianceRequest();
    if (allianceRequest) {
      return allianceRequest;
    }

    return null;
  }

  /**
   * Update relations based on embargo status changes
   */
  private updateRelationsFromEmbargos(): void {
    const others = this.game
      .players()
      .filter((p) => p.id() !== this.player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(this.player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        this.player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(this.player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        this.player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  /**
   * Handle embargoes to hostile nations
   */
  private handleEmbargoesToHostileNations(): void {
    const others = this.game
      .players()
      .filter((p) => p.id() !== this.player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        this.player.relation(other) <= Relation.Hostile &&
        !this.player.hasEmbargoAgainst(other) &&
        !this.player.isOnSameTeam(other)
      ) {
        this.player.addEmbargo(other, false);
      } else if (
        this.player.relation(other) >= Relation.Neutral &&
        this.player.hasEmbargoAgainst(other)
      ) {
        this.player.stopEmbargo(other);
      }
    });
  }

  /**
   * Find potential betrayal targets
   * TODO: Implement strategic betrayal logic
   * Currently this just breaks alliances without strategic consideration.
   * Future implementation should consider:
   * - Relative strength (troop count, territory size) compared to target
   * - Risk vs reward of betrayal
   * - Potential impact on relations with other players
   * - Timing (don't betray when already fighting other enemies)
   * - Strategic value of target's territory
   * - If target is distracted
   */
  private findBetrayalTarget(): Player | null {
    // For now, no strategic betrayals
    return null;
  }

  /**
   * Recommend a betrayal action
   */
  private recommendBetrayal(target: Player): ActionRecommendation {
    return {
      execute: () => {
        const alliance = this.player.allianceWith(target);
        if (alliance) {
          this.player.breakAlliance(alliance);
        }
      },
      score: 200,
      priority: AdvisorPriority.Critical,
      description: `Strategic betrayal of ${target.id()}`,
    };
  }

  /**
   * Recommend alliance requests
   */
  private recommendAllianceRequest(): ActionRecommendation | null {
    // This is handled by BotBehavior in the original code
    // For now, return null as BotBehavior handles this
    return null;
  }
}
