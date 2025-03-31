import {
  Cell,
  Execution,
  Game,
  Player,
  PlayerInfo,
  TerraNullius,
  PlayerType,
  Alliance,
  UnitType,
} from "../game/Game";
import {
  AttackIntent,
  BoatAttackIntentSchema,
  ClientID,
  GameID,
  Intent,
  Turn,
} from "../Schemas";
import { AttackExecution } from "./AttackExecution";
import { SpawnExecution } from "./SpawnExecution";
import { BotSpawner } from "./BotSpawner";
import { TransportShipExecution } from "./TransportShipExecution";
import { PseudoRandom } from "../PseudoRandom";
import { FakeHumanExecution } from "./FakeHumanExecution";
import { sanitize, simpleHash } from "../Util";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "./alliance/AllianceRequestReplyExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { EmojiExecution } from "./EmojiExecution";
import { DonateExecution } from "./DonateExecution";
import { SetTargetTroopRatioExecution } from "./SetTargetTroopRatioExecution";
import { ConstructionExecution } from "./ConstructionExecution";
import { fixProfaneUsername, isProfaneUsername } from "../validations/username";
import { NoOpExecution } from "./NoOpExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { RetreatExecution } from "./RetreatExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";

export class Executor {
  // private random = new PseudoRandom(999)
  private random: PseudoRandom = null;

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
    const playerID = player.id();

    switch (intent.type) {
      case "attack": {
        return new AttackExecution(
          intent.troops,
          playerID,
          intent.targetID,
          null,
        );
      }
      case "cancel_attack":
        return new RetreatExecution(playerID, intent.attackID);
      case "move_warship":
        return new MoveWarshipExecution(intent.unitId, intent.tile);
      case "spawn":
        return new SpawnExecution(
          new PlayerInfo(
            intent.flag,
            // Players see their original name, others see a sanitized version
            intent.clientID == this.clientID
              ? sanitize(intent.name)
              : fixProfaneUsername(sanitize(intent.name)),
            PlayerType.Human,
            intent.clientID,
            playerID,
          ),
          this.mg.ref(intent.x, intent.y),
        );
      case "boat":
        return new TransportShipExecution(
          playerID,
          intent.targetID,
          this.mg.ref(intent.x, intent.y),
          intent.troops,
        );
      case "allianceRequest":
        return new AllianceRequestExecution(playerID, intent.recipient);
      case "allianceRequestReply":
        return new AllianceRequestReplyExecution(
          intent.requestor,
          playerID,
          intent.accept,
        );
      case "breakAlliance":
        return new BreakAllianceExecution(playerID, intent.recipient);
      case "targetPlayer":
        return new TargetPlayerExecution(playerID, intent.target);
      case "emoji":
        return new EmojiExecution(playerID, intent.recipient, intent.emoji);
      case "donate":
        return new DonateExecution(playerID, intent.recipient, intent.troops);
      case "troop_ratio":
        return new SetTargetTroopRatioExecution(playerID, intent.ratio);
      case "embargo":
        return new EmbargoExecution(player, intent.targetID, intent.action);
      case "build_unit":
        return new ConstructionExecution(
          playerID,
          this.mg.ref(intent.x, intent.y),
          intent.unit,
        );
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnBots(numBots: number): Execution[] {
    return new BotSpawner(this.mg, this.gameID).spawnBots(numBots);
  }

  fakeHumanExecutions(): Execution[] {
    const execs = [];
    for (const nation of this.mg.nations()) {
      execs.push(
        new FakeHumanExecution(
          this.gameID,
          new PlayerInfo(
            nation.flag || "",
            nation.name,
            PlayerType.FakeHuman,
            null,
            this.random.nextID(),
            nation,
          ),
        ),
      );
    }
    return execs;
  }
}
