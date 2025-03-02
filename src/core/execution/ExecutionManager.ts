import { Execution, Game, PlayerInfo, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID, GameID, Intent, Turn } from "../Schemas";
import { sanitize, simpleHash } from "../Util";
import { fixProfaneUsername } from "../validations/username";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "./alliance/AllianceRequestReplyExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { BotSpawner } from "./BotSpawner";
import { ConstructionExecution } from "./ConstructionExecution";
import { DonateExecution } from "./DonateExecution";
import { EmojiExecution } from "./EmojiExecution";
import { FakeHumanExecution } from "./FakeHumanExecution";
import { NoOpExecution } from "./NoOpExecution";
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
    if (intent.type != "spawn") {
      if (!this.mg.hasPlayer(intent.playerID)) {
        console.warn(
          `player ${intent.playerID} not found on intent ${intent.type}`,
        );
        return new NoOpExecution();
      }
      const player = this.mg.player(intent.playerID);
      if (player.clientID() != intent.clientID) {
        console.warn(
          `intent ${intent.type} has incorrect clientID ${intent.clientID} for player ${player.name()} with clientID ${player.clientID()}`,
        );
        return new NoOpExecution();
      }
    }
    switch (intent.type) {
      case "attack": {
        return new AttackExecution(
          intent.troops,
          intent.playerID,
          intent.targetID,
          null,
        );
      }
      case "spawn":
        return new SpawnExecution(
          new PlayerInfo(
            intent.flag,
            // Players see their original name, others see a sanitized version
            intent.clientID == this.clientID
              ? sanitize(intent.name)
              : fixProfaneUsername(sanitize(intent.name)),
            intent.playerType,
            intent.clientID,
            intent.playerID,
          ),
          this.mg.ref(intent.x, intent.y),
        );
      case "boat":
        return new TransportShipExecution(
          intent.playerID,
          intent.targetID,
          this.mg.ref(intent.x, intent.y),
          intent.troops,
        );
      case "allianceRequest":
        return new AllianceRequestExecution(intent.playerID, intent.recipient);
      case "allianceRequestReply":
        return new AllianceRequestReplyExecution(
          intent.requestor,
          intent.playerID,
          intent.accept,
        );
      case "breakAlliance":
        return new BreakAllianceExecution(intent.playerID, intent.recipient);
      case "targetPlayer":
        return new TargetPlayerExecution(intent.playerID, intent.target);
      case "emoji":
        return new EmojiExecution(
          intent.playerID,
          intent.recipient,
          intent.emoji,
        );
      case "donate":
        return new DonateExecution(
          intent.playerID,
          intent.recipient,
          intent.troops,
        );
      case "troop_ratio":
        return new SetTargetTroopRatioExecution(intent.playerID, intent.ratio);
      case "build_unit":
        return new ConstructionExecution(
          intent.playerID,
          this.mg.ref(intent.x, intent.y),
          intent.unit,
        );
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnBots(numBots: number): Execution[] {
    return new BotSpawner(this.mg, this.gameID)
      .spawnBots(numBots)
      .map((i) => this.createExec(i));
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
