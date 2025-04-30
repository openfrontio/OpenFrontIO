import { Execution, Game, PlayerInfo, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID, GameID, Intent, Turn } from "../Schemas";
import { simpleHash } from "../Util";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "./alliance/AllianceRequestReplyExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { BotSpawner } from "./BotSpawner";
import { ConstructionExecution } from "./ConstructionExecution";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { EmojiExecution } from "./EmojiExecution";
import { FakeHumanExecution } from "./FakeHumanExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NoOpExecution } from "./NoOpExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SetTargetTroopRatioExecution } from "./SetTargetTroopRatioExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TransportShipExecution } from "./TransportShipExecution";

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
          player.info(),
          this.mg.ref(intent.x, intent.y),
        );
      case "boat":
        let src = null;
        if (intent.srcX != null || intent.srcY != null) {
          src = this.mg.ref(intent.srcX, intent.srcY);
        }
        return new TransportShipExecution(
          playerID,
          intent.targetID,
          this.mg.ref(intent.dstX, intent.dstY),
          intent.troops,
          src,
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
      case "donate_troops":
        return new DonateTroopsExecution(
          playerID,
          intent.recipient,
          intent.troops,
        );
      case "donate_gold":
        return new DonateGoldExecution(playerID, intent.recipient, intent.gold);
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
