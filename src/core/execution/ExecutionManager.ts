import { Execution, Game } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID, GameID, StampedIntent, Turn } from "../Schemas";
import { simpleHash } from "../Util";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { AllianceRejectExecution } from "./alliance/AllianceRejectExecution";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { BoatRetreatExecution } from "./BoatRetreatExecution";
import { ConstructionExecution } from "./ConstructionExecution";
import { DeleteUnitExecution } from "./DeleteUnitExecution";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";
import { EmbargoAllExecution } from "./EmbargoAllExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { EmojiExecution } from "./EmojiExecution";
import { MarkDisconnectedExecution } from "./MarkDisconnectedExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NationExecution } from "./NationExecution";
import { NoOpExecution } from "./NoOpExecution";
import { PauseExecution } from "./PauseExecution";
import { QuickChatExecution } from "./QuickChatExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { TribeSpawner } from "./TribeSpawner";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";
import { PlayerSpawner } from "./utils/PlayerSpawner";

export class Executor {
  // private random = new PseudoRandom(999)
  private random: PseudoRandom;

  constructor(
    private mg: Game,
    private gameID: GameID,
    private clientID: ClientID | undefined,
  ) {
    // Add one to avoid id collisions with tribes.
    this.random = new PseudoRandom(simpleHash(gameID) + 1);
  }

  createExecs(turn: Turn): Execution[] {
    // In the rare case a client sends multiple troopRatio-orders,
    // we need to "merge" their orders instead of executing them in parallel.
    // (two 60% attacks should be one 84% attack, not one 120% attack)
    // But, they may be of different types/on different targets
    // (hence we do two (84/120)*60% = 42% attacks).
    let remainingTroopRatio_perClientID = new Map<ClientID, number>();
    var totalRatioUsage_perClientID = new Map<ClientID, number>();
    for (const intent of turn.intents) {
      switch (intent.type) {
        case "boat":
        case "attack": {
          remainingTroopRatio_perClientID.set(
            intent.clientID,
            (remainingTroopRatio_perClientID.get(intent.clientID) ?? 1) *
              (1 - intent.troopRatio),
          );
          totalRatioUsage_perClientID.set(
            intent.clientID,
            (totalRatioUsage_perClientID.get(intent.clientID) ?? 0) +
              intent.troopRatio,
          );
        }
        default:
          break;
      }
    }

    return turn.intents.map((intent) =>
      this.createExec(
        intent,
        remainingTroopRatio_perClientID.has(intent.clientID)
          ? (1 - remainingTroopRatio_perClientID.get(intent.clientID)!) /
              totalRatioUsage_perClientID.get(intent.clientID)!
          : undefined,
      ),
    );
  }

  createExec(intent: StampedIntent, troopRatioFactor?: number): Execution {
    const player = this.mg.playerByClientID(intent.clientID);
    if (!player) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    // create execution
    switch (intent.type) {
      case "attack": {
        return new AttackExecution(
          Math.floor(
            Math.min(
              troopRatioFactor! * intent.troopRatio * intent.troopCount,
              intent.maxTroopSent ?? intent.troopCount,
            ),
          ),
          player,
          intent.targetID,
          null,
        );
      }
      case "cancel_attack":
        return new RetreatExecution(player, intent.attackID);
      case "cancel_boat":
        return new BoatRetreatExecution(player, intent.unitID);
      case "move_warship":
        return new MoveWarshipExecution(player, intent.unitIds, intent.tile);
      case "spawn":
        return new SpawnExecution(this.gameID, player.info(), intent.tile);
      case "boat":
        return new TransportShipExecution(
          player,
          intent.dst,
          Math.floor(troopRatioFactor! * intent.troopRatio * intent.troopCount),
        );
      case "allianceRequest":
        return new AllianceRequestExecution(player, intent.recipient);
      case "allianceReject":
        return new AllianceRejectExecution(intent.requestor, player);
      case "breakAlliance":
        return new BreakAllianceExecution(player, intent.recipient);
      case "targetPlayer":
        return new TargetPlayerExecution(player, intent.target);
      case "emoji":
        return new EmojiExecution(player, intent.recipient, intent.emoji);
      case "donate_troops":
        return new DonateTroopsExecution(
          player,
          intent.recipient,
          intent.troops,
        );
      case "donate_gold":
        return new DonateGoldExecution(player, intent.recipient, intent.gold);
      case "embargo":
        return new EmbargoExecution(player, intent.targetID, intent.action);
      case "embargo_all":
        return new EmbargoAllExecution(player, intent.action);
      case "build_unit":
        return new ConstructionExecution(
          player,
          intent.unit,
          intent.tile,
          intent.rocketDirectionUp,
        );
      case "allianceExtension": {
        return new AllianceExtensionExecution(player, intent.recipient);
      }

      case "upgrade_structure":
        return new UpgradeStructureExecution(player, intent.unitId);
      case "delete_unit":
        return new DeleteUnitExecution(player, intent.unitId);
      case "quick_chat":
        return new QuickChatExecution(
          player,
          intent.recipient,
          intent.quickChatKey,
          intent.target,
        );
      case "mark_disconnected":
        return new MarkDisconnectedExecution(player, intent.isDisconnected);
      case "toggle_pause":
        return new PauseExecution(player, intent.paused);
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnTribes(numTribes: number): SpawnExecution[] {
    return new TribeSpawner(this.mg, this.gameID).spawnTribes(numTribes);
  }

  spawnPlayers(): SpawnExecution[] {
    return new PlayerSpawner(this.mg, this.gameID).spawnPlayers();
  }

  nationExecutions(): Execution[] {
    const execs: Execution[] = [];
    for (const nation of this.mg.nations()) {
      execs.push(new NationExecution(this.gameID, nation));
    }
    return execs;
  }
}
