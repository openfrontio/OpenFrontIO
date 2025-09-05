import { EventBus } from "../../../core/EventBus";
import { PlayerID, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { PlayerView } from "../../../core/game/GameView";
import {
  BuildUnitIntentEvent,
  SendAllianceReplyIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmojiIntentEvent,
  SendSetTargetTroopRatioEvent,
  SendSpawnIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";

export interface AttackDecision {
  targetID: PlayerID | null;
  troops: number;
  confidence: number;
  reasoning: string;
}

export interface BuildDecision {
  unitType: UnitType;
  tile: TileRef;
  priority: number;
  reasoning: string;
}

export interface AllianceDecision {
  targetPlayer: PlayerView;
  action: "request" | "accept" | "reject" | "break";
  reasoning: string;
}

export interface BoatAttackDecision {
  targetID: PlayerID | null;
  destinationTile: TileRef;
  troops: number;
  sourceTile?: TileRef;
  reasoning: string;
}

export class ActionExecutor {
  constructor(private eventBus: EventBus) {}

  /**
   * Execute a spawn decision
   */
  public executeSpawn(tile: TileRef): void {
    console.log(`ActionExecutor: Spawning at tile ${tile}`);
    this.eventBus.emit(new SendSpawnIntentEvent(tile));
  }

  /**
   * Execute an attack decision
   */
  public executeAttack(decision: AttackDecision): void {
    console.log(
      `ActionExecutor: Attacking player ${decision.targetID} with ${decision.troops} troops`,
    );
    console.log(`Reasoning: ${decision.reasoning}`);

    this.eventBus.emit(
      new SendAttackIntentEvent(decision.targetID, decision.troops),
    );
  }

  /**
   * Execute a boat attack decision
   */
  public executeBoatAttack(decision: BoatAttackDecision): void {
    console.log(
      `ActionExecutor: Boat attack to ${decision.destinationTile} with ${decision.troops} troops`,
    );
    console.log(`Reasoning: ${decision.reasoning}`);

    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        decision.targetID,
        decision.destinationTile,
        decision.troops,
        decision.sourceTile ?? null,
      ),
    );
  }

  /**
   * Execute a build decision
   */
  public executeBuild(decision: BuildDecision): void {
    // Validate that we have a valid tile
    if (typeof decision.tile !== "number" || decision.tile < 0) {
      console.error(
        `ActionExecutor: Invalid tile for building: ${decision.tile}`,
      );
      return;
    }

    console.log(
      `ActionExecutor: Building ${decision.unitType} at tile ${decision.tile}`,
    );
    console.log(`Reasoning: ${decision.reasoning}`);

    this.eventBus.emit(
      new BuildUnitIntentEvent(decision.unitType, decision.tile),
    );
  }

  /**
   * Execute an alliance decision
   */
  public executeAlliance(decision: AllianceDecision): void {
    console.log(
      `ActionExecutor: Alliance ${decision.action} with ${decision.targetPlayer.name()}`,
    );
    console.log(`Reasoning: ${decision.reasoning}`);

    // For alliance actions, we need to get the current player as the requestor
    // This is a simplified implementation - in a real scenario, we'd need access to the current player
    const myPlayer = decision.targetPlayer; // Placeholder - would need actual current player

    switch (decision.action) {
      case "request":
        this.eventBus.emit(
          new SendAllianceRequestIntentEvent(myPlayer, decision.targetPlayer),
        );
        break;
      case "accept":
        this.eventBus.emit(
          new SendAllianceReplyIntentEvent(
            decision.targetPlayer, // requestor
            myPlayer, // recipient (us)
            true,
          ),
        );
        break;
      case "reject":
        this.eventBus.emit(
          new SendAllianceReplyIntentEvent(
            decision.targetPlayer, // requestor
            myPlayer, // recipient (us)
            false,
          ),
        );
        break;
      case "break":
        this.eventBus.emit(
          new SendBreakAllianceIntentEvent(myPlayer, decision.targetPlayer),
        );
        break;
    }
  }

  /**
   * Execute target player decision
   */
  public executeTargetPlayer(targetID: PlayerID, reasoning: string): void {
    console.log(`ActionExecutor: Targeting player ${targetID}`);
    console.log(`Reasoning: ${reasoning}`);

    this.eventBus.emit(new SendTargetPlayerIntentEvent(targetID));
  }

  /**
   * Execute emoji communication
   */
  public executeEmoji(
    recipient: PlayerView,
    emoji: number,
    reasoning: string,
  ): void {
    console.log(
      `ActionExecutor: Sending emoji ${emoji} to ${recipient.name()}`,
    );
    console.log(`Reasoning: ${reasoning}`);

    this.eventBus.emit(new SendEmojiIntentEvent(recipient, emoji));
  }

  /**
   * Execute gold donation
   */
  public executeDonateGold(
    recipient: PlayerView,
    amount: bigint,
    reasoning: string,
  ): void {
    console.log(
      `ActionExecutor: Donating ${amount} gold to ${recipient.name()}`,
    );
    console.log(`Reasoning: ${reasoning}`);

    this.eventBus.emit(new SendDonateGoldIntentEvent(recipient, amount));
  }

  /**
   * Execute troop donation
   */
  public executeDonateTroops(
    recipient: PlayerView,
    amount: number,
    reasoning: string,
  ): void {
    console.log(
      `ActionExecutor: Donating ${amount} troops to ${recipient.name()}`,
    );
    console.log(`Reasoning: ${reasoning}`);

    this.eventBus.emit(new SendDonateTroopsIntentEvent(recipient, amount));
  }

  /**
   * Execute troop ratio adjustment
   */
  public executeSetTroopRatio(ratio: number): void {
    console.log(`ActionExecutor: Setting troop ratio to ${ratio.toFixed(2)}`);

    this.eventBus.emit(new SendSetTargetTroopRatioEvent(ratio));
  }

  /**
   * Execute a batch of decisions
   */
  public executeBatch(
    decisions: Array<{
      type: "attack" | "build" | "alliance" | "boat" | "spawn";
      decision: any;
    }>,
  ): void {
    console.log(
      `ActionExecutor: Executing batch of ${decisions.length} decisions`,
    );

    for (const { type, decision } of decisions) {
      try {
        switch (type) {
          case "attack":
            this.executeAttack(decision as AttackDecision);
            break;
          case "build":
            this.executeBuild(decision as BuildDecision);
            break;
          case "alliance":
            this.executeAlliance(decision as AllianceDecision);
            break;
          case "boat":
            this.executeBoatAttack(decision as BoatAttackDecision);
            break;
          case "spawn":
            this.executeSpawn(decision as TileRef);
            break;
          default:
            console.warn(`ActionExecutor: Unknown decision type ${type}`);
        }
      } catch (error) {
        console.error(
          `ActionExecutor: Error executing ${type} decision:`,
          error,
        );
      }
    }
  }
}
