import { Execution, Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID, GameID, Intent, Turn } from "../Schemas";
import { simpleHash } from "../Util";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "./alliance/AllianceRequestReplyExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { BoatRetreatExecution } from "./BoatRetreatExecution";
import { BotSpawner } from "./BotSpawner";
import { ConstructionExecution } from "./ConstructionExecution";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { EmojiExecution } from "./EmojiExecution";
import { FakeHumanExecution } from "./FakeHumanExecution";
import { MarkDisconnectedExecution } from "./MarkDisconnectedExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NoOpExecution } from "./NoOpExecution";
import { QuickChatExecution } from "./QuickChatExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SetTargetTroopRatioExecution } from "./SetTargetTroopRatioExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";

export class Executor {
  // private random = new PseudoRandom(999)
  private random: PseudoRandom;

  constructor(
    private mg: Game,
    private gameID: GameID,
    private clientID: ClientID,
  ) {
    // Add one to avoid id collisions with bots.
    this.random = new PseudoRandom(simpleHash(gameID) + 1);
  }

  createExecs(turn: Turn): Execution[] {
    return turn.intents.map((i) => this.createExec(i));
  }

  createExec(intent: Intent): Execution {
    const player = this.mg.playerByClientID(intent.clientID);
    if (!player) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    // create execution
    switch (intent.type) {
      case "attack": {
        // Validate an optional focused-attack source tile. The tile must be on the map,
        // owned by the attacking player, located on land, and share a border with at
        // least one non-friendly neighbour. If any check fails we fall back to a
        // generic attack by keeping src = null.
        let src: TileRef | null = null;
        if (
          typeof intent.srcX === "number" &&
          typeof intent.srcY === "number"
        ) {
          const candidate = this.mg.ref(intent.srcX, intent.srcY);

          // Must be owned by attacker and on land
          if (
            this.mg.owner(candidate) === player &&
            this.mg.isLand(candidate)
          ) {
            const isBorder = this.mg
              .neighbors(candidate)
              .some((n) => this.mg.owner(n) !== player);

            if (isBorder) {
              src = candidate;
            }
          }
        }
        return new AttackExecution(intent.troops, player, intent.targetID, src);
      }
      case "cancel_attack":
        return new RetreatExecution(player, intent.attackID);
      case "cancel_boat":
        return new BoatRetreatExecution(player, intent.unitID);
      case "move_warship":
        return new MoveWarshipExecution(player, intent.unitId, intent.tile);
      case "spawn":
        return new SpawnExecution(
          player.info(),
          this.mg.ref(intent.x, intent.y),
        );
      case "boat":
        let src: TileRef | null = null;
        if (
          typeof intent.srcX === "number" &&
          typeof intent.srcY === "number"
        ) {
          src = this.mg.ref(intent.srcX, intent.srcY);
        }
        return new TransportShipExecution(
          player,
          intent.targetID,
          this.mg.ref(intent.dstX, intent.dstY),
          intent.troops,
          src,
        );
      case "allianceRequest":
        return new AllianceRequestExecution(player, intent.recipient);
      case "allianceRequestReply":
        return new AllianceRequestReplyExecution(
          intent.requestor,
          player,
          intent.accept,
        );
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
      case "troop_ratio":
        return new SetTargetTroopRatioExecution(player, intent.ratio);
      case "embargo":
        return new EmbargoExecution(player, intent.targetID, intent.action);
      case "build_unit":
        return new ConstructionExecution(
          player,
          this.mg.ref(intent.x, intent.y),
          intent.unit,
        );
      case "upgrade_structure":
        return new UpgradeStructureExecution(player, intent.unitId);
      case "quick_chat":
        return new QuickChatExecution(
          player,
          intent.recipient,
          intent.quickChatKey,
          intent.target,
        );
      case "mark_disconnected":
        return new MarkDisconnectedExecution(player, intent.isDisconnected);
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnBots(numBots: number): Execution[] {
    return new BotSpawner(this.mg, this.gameID).spawnBots(numBots);
  }

  fakeHumanExecutions(): Execution[] {
    const execs: Execution[] = [];
    for (const nation of this.mg.nations()) {
      execs.push(new FakeHumanExecution(this.gameID, nation));
    }
    return execs;
  }
}
