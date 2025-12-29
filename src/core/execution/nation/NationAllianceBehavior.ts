import {
  Difficulty,
  Game,
  Player,
  PlayerType,
  Relation,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever } from "../../Util";
import { AllianceExtensionExecution } from "../alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import {
  EMOJI_CONFUSED,
  EMOJI_HANDSHAKE,
  EMOJI_LOVE,
  EMOJI_SCARED_OF_THREAT,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";

export class NationAllianceBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      if (this.getAllianceDecision(req.requestor(), true)) {
        req.accept();
      } else {
        req.reject();
      }
    }
  }

  handleAllianceExtensionRequests() {
    for (const alliance of this.player.alliances()) {
      // Alliance expiration tracked by Events Panel, only human ally can click Request to Renew
      // Skip if no expiration yet/ ally didn't request extension yet / nation already agreed to extend
      if (!alliance.onlyOneAgreedToExtend()) continue;

      const human = alliance.other(this.player);
      if (!this.getAllianceDecision(human, true)) continue;

      this.game.addExecution(
        new AllianceExtensionExecution(this.player, human.id()),
      );
    }
  }

  maybeSendAllianceRequests(borderingEnemies: Player[]) {
    // Only easy nations are allowed to send alliance requests to bots
    const isAcceptablePlayerType = (p: Player) =>
      (p.type() === PlayerType.Bot &&
        this.game.config().gameConfig().difficulty === Difficulty.Easy) ||
      p.type() !== PlayerType.Bot;

    for (const enemy of borderingEnemies) {
      if (
        this.random.chance(20) &&
        isAcceptablePlayerType(enemy) &&
        this.player.canSendAllianceRequest(enemy) &&
        this.getAllianceDecision(enemy, false)
      ) {
        this.game.addExecution(
          new AllianceRequestExecution(this.player, enemy.id()),
        );
      }
    }
  }

  private getAllianceDecision(
    otherPlayer: Player,
    isResponse: boolean,
  ): boolean {
    // Easy (dumb) nations sometimes get confused and accept/reject randomly (Just like dumb humans do)
    if (this.isConfused()) {
      return this.random.chance(2);
    }
    // Nearly always reject traitors
    if (otherPlayer.isTraitor() && this.random.nextInt(0, 100) >= 10) {
      if (isResponse && this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_CONFUSED);
      }
      return false;
    }
    // Before caring about the relation, first check if the otherPlayer is a threat
    // Easy (dumb) nations are blinded by hatred, they don't care about threats, they care about the relation
    // Impossible (smart) nations on the other hand are analyzing the facts
    if (this.isAlliancePartnerThreat(otherPlayer)) {
      if (!isResponse && this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_SCARED_OF_THREAT);
      }
      if (isResponse && this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_LOVE);
      }
      return true;
    }
    // Reject if relation is bad
    if (this.player.relation(otherPlayer) < Relation.Neutral) {
      if (isResponse && this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_CONFUSED);
      }
      return false;
    }
    // Maybe accept if relation is friendly
    if (this.isAlliancePartnerFriendly(otherPlayer)) {
      if (this.random.chance(3)) {
        this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_HANDSHAKE);
      }
      return true;
    }
    // Reject if we already have some alliances, we don't want to ally with the entire map
    if (this.checkAlreadyEnoughAlliances(otherPlayer)) {
      return false;
    }
    // Maybe accept if we are in the earlygame
    if (this.isEarlygame()) {
      return true;
    }
    // Accept if we are similarly strong
    return this.isAlliancePartnerSimilarlyStrong(otherPlayer);
  }

  private isConfused(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.chance(10); // 10% chance to be confused on easy
      case Difficulty.Medium:
        return this.random.chance(20); // 5% chance to be confused on medium
      case Difficulty.Hard:
        return this.random.chance(40); // 2.5% chance to be confused on hard
      case Difficulty.Impossible:
        return false; // No confusion on impossible
      default:
        assertNever(difficulty);
    }
  }

  private isEarlygame(): boolean {
    const spawnTicks = this.game.config().numSpawnPhaseTurns();
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // On easy, accept 90% in the first 5 minutes
        return (
          this.game.ticks() < 3000 + spawnTicks &&
          this.random.nextInt(0, 100) >= 10
        );
      case Difficulty.Medium:
        // On medium, accept 70% in the first 3 minutes
        return (
          this.game.ticks() < 1800 + spawnTicks &&
          this.random.nextInt(0, 100) >= 30
        );
      case Difficulty.Hard:
        // On hard, accept 50% in the first 3 minutes
        return (
          this.game.ticks() < 1800 + spawnTicks &&
          this.random.nextInt(0, 100) >= 50
        );
      case Difficulty.Impossible:
        // On impossible, accept 30% in the first minute
        return (
          this.game.ticks() < 600 + spawnTicks &&
          this.random.nextInt(0, 100) >= 70
        );
      default:
        assertNever(difficulty);
    }
  }

  private isAlliancePartnerThreat(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // On easy we are very dumb, we don't see anybody as a threat
        return false;
      case Difficulty.Medium:
        // On medium we just see players with much more troops as a threat
        return otherPlayer.troops() > this.player.troops() * 2.5;
      case Difficulty.Hard:
        // On hard we are smarter, we check for maxTroops to see the actual strength
        return (
          otherPlayer.troops() > this.player.troops() &&
          this.game.config().maxTroops(otherPlayer) >
            this.game.config().maxTroops(this.player) * 2
        );
      case Difficulty.Impossible: {
        // On impossible we check for multiple factors and try to not mess with stronger players (we want to steamroll over weaklings)
        const otherHasMoreTroops =
          otherPlayer.troops() > this.player.troops() * 1.5;
        const otherHasMoreMaxTroops =
          otherPlayer.troops() > this.player.troops() &&
          this.game.config().maxTroops(otherPlayer) >
            this.game.config().maxTroops(this.player) * 1.5;
        const otherHasMoreTiles =
          otherPlayer.troops() > this.player.troops() &&
          otherPlayer.numTilesOwned() > this.player.numTilesOwned() * 1.5;
        return otherHasMoreTroops || otherHasMoreMaxTroops || otherHasMoreTiles;
      }
      default:
        assertNever(difficulty);
    }
  }

  private checkAlreadyEnoughAlliances(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return false; // On easy we never think we have enough alliances
      case Difficulty.Medium:
        return this.player.alliances().length >= this.random.nextInt(5, 8);
      case Difficulty.Hard:
      case Difficulty.Impossible: {
        // On hard and impossible we try to not ally with all our neighbors (If we have 3+ neighbors)
        const borderingPlayers = this.player
          .neighbors()
          .filter(
            (n): n is Player => n.isPlayer() && n.type() !== PlayerType.Bot,
          );
        const borderingFriends = borderingPlayers.filter(
          (o) => this.player?.isFriendly(o) === true,
        );
        if (
          borderingPlayers.length >= 3 &&
          borderingPlayers.includes(otherPlayer)
        ) {
          return borderingPlayers.length <= borderingFriends.length + 1;
        }
        if (difficulty === Difficulty.Hard) {
          return this.player.alliances().length >= this.random.nextInt(3, 6);
        }
        return this.player.alliances().length >= this.random.nextInt(2, 5);
      }
      default:
        assertNever(difficulty);
    }
  }

  private isAlliancePartnerFriendly(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
      case Difficulty.Medium:
        return this.player.relation(otherPlayer) === Relation.Friendly;
      case Difficulty.Hard:
        return (
          this.player.relation(otherPlayer) === Relation.Friendly &&
          this.random.nextInt(0, 100) >= 17
        );
      case Difficulty.Impossible:
        return (
          this.player.relation(otherPlayer) === Relation.Friendly &&
          this.random.nextInt(0, 100) >= 33
        );
      default:
        assertNever(difficulty);
    }
  }

  // It would make a lot of sense to use nextFloat here, but "there's a chance floats can cause desyncs"
  private isAlliancePartnerSimilarlyStrong(otherPlayer: Player): boolean {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return (
          otherPlayer.troops() >
          this.player.troops() * (this.random.nextInt(60, 70) / 100)
        );
      case Difficulty.Medium:
        return (
          otherPlayer.troops() >
          this.player.troops() * (this.random.nextInt(70, 80) / 100)
        );
      case Difficulty.Hard:
        return (
          otherPlayer.troops() >
          this.player.troops() * (this.random.nextInt(75, 85) / 100)
        );
      case Difficulty.Impossible:
        return (
          otherPlayer.troops() >
          this.player.troops() * (this.random.nextInt(80, 90) / 100)
        );
      default:
        assertNever(difficulty);
    }
  }

  // Betray friends if we have 10 times more troops than them
  // TODO: Implement better and deeper strategies, for example:
  // Check impact on relations with other players
  // Check value of targets territory
  // Check if target is distracted
  // Check the targets territory size
  maybeBetray(otherPlayer: Player): boolean {
    if (
      this.player.isAlliedWith(otherPlayer) &&
      this.player.troops() >= otherPlayer.troops() * 10
    ) {
      this.betray(otherPlayer);
      return true;
    }
    return false;
  }

  private betray(target: Player): void {
    const alliance = this.player.allianceWith(target);
    if (!alliance) return;
    this.player.breakAlliance(alliance);
  }
}
