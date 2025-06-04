import {
  AllPlayers,
  Execution,
  Game,
  Player,
  TerraNullius,
} from "../game/Game";
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
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NoOpExecution } from "./NoOpExecution";
import { QuickChatExecution } from "./QuickChatExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SetTargetTroopRatioExecution } from "./SetTargetTroopRatioExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TransportShipExecution } from "./TransportShipExecution";

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
    // Check intent validity
    if (!this.checkIntent(intent)) {
      return new NoOpExecution();
    }

    // load players
    const owner = this.mg.playerByClientID(intent.clientID);
    if (!owner) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    let targetRegion: Player | TerraNullius = this.mg.terraNullius();
    if ("targetRegionID" in intent && intent.targetRegionID !== null) {
      targetRegion = this.mg.player(intent.targetRegionID);
    }

    let targetPlayer: Player = owner;
    if ("targetPlayerID" in intent) {
      targetPlayer = this.mg.player(intent.targetPlayerID);
      if (!targetPlayer) {
        console.warn(`player with clientID ${intent.targetPlayerID} not found`);
        return new NoOpExecution();
      }
    }

    let targetPlayers: Player | typeof AllPlayers = AllPlayers;
    if ("targetPlayersID" in intent && intent.targetPlayersID !== AllPlayers) {
      targetPlayers = this.mg.player(intent.targetPlayersID);
      if (!targetPlayers) {
        console.warn(
          `player with clientID ${intent.targetPlayersID} not found`,
        );
        return new NoOpExecution();
      }
    }

    let requestorPlayer: Player = owner;
    if ("requestorPlayerID" in intent) {
      requestorPlayer = this.mg.player(intent.requestorPlayerID);
      if (!requestorPlayer) {
        console.warn(
          `player with clientID ${intent.requestorPlayerID} not found`,
        );
        return new NoOpExecution();
      }
    }

    // create execution
    switch (intent.type) {
      case "attack": {
        return new AttackExecution(intent.troops, owner, targetRegion, null);
      }
      case "cancel_attack":
        return new RetreatExecution(owner, intent.attackID);
      case "cancel_boat":
        return new BoatRetreatExecution(owner, intent.unitID);
      case "move_warship":
        return new MoveWarshipExecution(owner, intent.unitId, intent.tile);
      case "spawn":
        return new SpawnExecution(
          owner.info(),
          this.mg.ref(intent.x, intent.y),
        );
      case "boat":
        let src: TileRef | null = null;
        if (intent.srcX !== null && intent.srcY !== null) {
          src = this.mg.ref(intent.srcX, intent.srcY);
        }
        return new TransportShipExecution(
          owner,
          targetRegion,
          this.mg.ref(intent.dstX, intent.dstY),
          intent.troops,
          src,
        );
      case "allianceRequest":
        return new AllianceRequestExecution(owner, targetPlayer);
      case "allianceRequestReply":
        return new AllianceRequestReplyExecution(
          requestorPlayer,
          owner,
          intent.accept,
        );
      case "breakAlliance":
        return new BreakAllianceExecution(owner, targetPlayer);
      case "targetPlayer":
        return new TargetPlayerExecution(owner, targetPlayer);
      case "emoji":
        return new EmojiExecution(owner, targetPlayers, intent.emoji);
      case "donate_troops":
        return new DonateTroopsExecution(owner, targetPlayer, intent.troops);
      case "donate_gold":
        return new DonateGoldExecution(owner, targetPlayer, intent.gold);
      case "troop_ratio":
        return new SetTargetTroopRatioExecution(owner, intent.ratio);
      case "embargo":
        return new EmbargoExecution(owner, targetPlayer, intent.action);
      case "build_unit":
        return new ConstructionExecution(
          owner,
          this.mg.ref(intent.x, intent.y),
          intent.unit,
        );
      case "quick_chat":
        return new QuickChatExecution(
          owner,
          targetPlayer,
          intent.quickChatKey,
          intent.variables ?? {},
        );
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  checkIntent(intent: Intent): boolean {
    if ("targetPlayerID" in intent) {
      if (!this.mg.hasPlayer(intent.targetPlayerID)) {
        console.warn(`targetPlayer with id ${intent.targetPlayerID} not found`);
        return false;
      }
    }
    if ("targetPlayersID" in intent) {
      if (
        intent.targetPlayersID !== AllPlayers &&
        !this.mg.hasPlayer(intent.targetPlayersID)
      ) {
        console.warn(
          `targetPlayer with id ${intent.targetPlayersID} not found`,
        );
        return false;
      }
    }
    if ("requestorPlayerID" in intent) {
      if (!this.mg.hasPlayer(intent.requestorPlayerID)) {
        console.warn(
          `requestorPlayer with id ${intent.requestorPlayerID} not found`,
        );
        return false;
      }
    }
    if ("targetRegionID" in intent && intent.targetRegionID !== null) {
      if (!this.mg.hasPlayer(intent.targetRegionID)) {
        console.warn(`targetRegion with id ${intent.targetRegionID} not found`);
        return false;
      }
    }
    return true;
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
