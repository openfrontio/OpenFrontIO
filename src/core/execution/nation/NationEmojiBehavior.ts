import {
  AllPlayers,
  Difficulty,
  Game,
  GameMode,
  Player,
  PlayerType,
  Relation,
  Team,
  Tick,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { flattenedEmojiTable } from "../../Util";
import { EmojiExecution } from "../EmojiExecution";

const emojiId = (e: (typeof flattenedEmojiTable)[number]) =>
  flattenedEmojiTable.indexOf(e);
export const EMOJI_ASSIST_ACCEPT = (["👍", "⛵", "🤝", "🎯"] as const).map(
  emojiId,
);
export const EMOJI_ASSIST_RELATION_TOO_LOW = (["🥱", "🤦‍♂️"] as const).map(
  emojiId,
);
export const EMOJI_ASSIST_TARGET_ME = (["🥺", "💀"] as const).map(emojiId);
export const EMOJI_ASSIST_TARGET_ALLY = (["🕊️", "👎"] as const).map(emojiId);
export const EMOJI_AGGRESSIVE_ATTACK = (["😈"] as const).map(emojiId);
export const EMOJI_ATTACK = (["😡"] as const).map(emojiId);
export const EMOJI_WARSHIP_RETALIATION = (["⛵"] as const).map(emojiId);
export const EMOJI_NUKE = (["☢️", "💥"] as const).map(emojiId);
export const EMOJI_GOT_INSULTED = (["🖕", "😡", "🤡", "😞", "😭"] as const).map(
  emojiId,
);
export const EMOJI_LOVE = (["❤️", "😊", "🥰"] as const).map(emojiId);
export const EMOJI_CONFUSED = (["❓", "🤡"] as const).map(emojiId);
export const EMOJI_BRAG = (["👑", "🥇", "💪"] as const).map(emojiId);
export const EMOJI_CHARM_ALLIES = (["🤝", "😇", "💪"] as const).map(emojiId);
export const EMOJI_CLOWN = (["🤡"] as const).map(emojiId);
export const EMOJI_RAT = (["🐀"] as const).map(emojiId);
export const EMOJI_OVERWHELMED = (
  ["💀", "🆘", "😱", "🥺", "😭", "😞", "🫡", "👋"] as const
).map(emojiId);
export const EMOJI_CONGRATULATE = (["👏"] as const).map(emojiId);
export const EMOJI_SCARED_OF_THREAT = (["🙏", "🥺"] as const).map(emojiId);
export const EMOJI_BORED = (["🥱"] as const).map(emojiId);
export const EMOJI_HANDSHAKE = (["🤝"] as const).map(emojiId);
export const EMOJI_DONATION_OK = (["👍"] as const).map(emojiId);
export const EMOJI_DONATION_TOO_SMALL = (["❓", "🥱"] as const).map(emojiId);

export class NationEmojiBehavior {
  private readonly lastEmojiSent = new Map<Player, Tick>();
  private hasSentWinnerClap = false;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  maybeSendCasualEmoji() {
    this.checkOverwhelmedByAttacks();
    this.checkVerySmallAttack();
    this.congratulateWinner();
    this.brag();
    this.charmAllies();
    this.annoyTraitors();
    this.findRat();
  }

  private checkOverwhelmedByAttacks(): void {
    if (!this.random.chance(4)) return;

    const incomingAttacks = this.player.incomingAttacks();
    if (incomingAttacks.length === 0) return;

    const incomingTroops = incomingAttacks.reduce(
      (sum, attack) => sum + attack.troops(),
      0,
    );
    const ourTroops = this.player.troops();

    // If incoming troops are at least 3x our troops, we're overwhelmed
    if (incomingTroops >= ourTroops * 3) {
      this.sendEmoji(AllPlayers, EMOJI_OVERWHELMED);
    }
  }

  private checkVerySmallAttack(): void {
    if (!this.random.chance(4)) return;

    const incomingAttacks = this.player.incomingAttacks();
    if (incomingAttacks.length === 0) return;

    const ourTroops = this.player.troops();
    if (ourTroops <= 0) return;

    // Find attacks from humans that are very small (less than 10% of our troops)
    for (const attack of incomingAttacks) {
      const attacker = attack.attacker();
      if (attacker.type() !== PlayerType.Human) continue;

      if (attack.troops() < ourTroops * 0.1) {
        this.maybeSendEmoji(
          attacker,
          this.random.chance(2) ? EMOJI_CONFUSED : EMOJI_BORED,
        );
      }
    }
  }

  // Check if game is over - send congratulations
  private congratulateWinner(): void {
    if (this.hasSentWinnerClap) return;

    const percentToWin = this.game.config().percentageTilesOwnedToWin();
    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    const isTeamGame =
      this.game.config().gameConfig().gameMode === GameMode.Team;

    if (isTeamGame) {
      // Team game: all nations congratulate if another team won
      const teamToTiles = new Map<Team, number>();
      for (const player of this.game.players()) {
        const team = player.team();
        if (team === null) continue;
        teamToTiles.set(
          team,
          (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
        );
      }

      const sorted = Array.from(teamToTiles.entries()).sort(
        (a, b) => b[1] - a[1],
      );
      if (sorted.length === 0) return;

      const [winningTeam, winningTiles] = sorted[0];
      const winningPercent = (winningTiles / numTilesWithoutFallout) * 100;
      if (winningPercent < percentToWin) return;

      // Don't congratulate if it's our own team
      if (winningTeam === this.player.team()) return;

      this.hasSentWinnerClap = true;
      this.sendEmoji(AllPlayers, EMOJI_CONGRATULATE);
    } else {
      // FFA game: The largest nation congratulates if a human player won
      const sorted = this.game
        .players()
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

      if (sorted.length === 0) return;

      const firstPlace = sorted[0];

      // Check if first place has won (crossed the win threshold)
      const firstPlacePercent =
        (firstPlace.numTilesOwned() / numTilesWithoutFallout) * 100;
      if (firstPlacePercent < percentToWin) return;

      // Only send if first place is a human
      if (firstPlace.type() !== PlayerType.Human) return;

      // Only the largest nation sends the congratulation
      const largestNation = this.game
        .players()
        .filter((p) => p.type() === PlayerType.Nation)
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
      if (largestNation !== this.player) return;

      this.hasSentWinnerClap = true;
      this.sendEmoji(firstPlace, EMOJI_CONGRATULATE);
    }
  }

  // Brag with our crown
  private brag(): void {
    if (!this.random.chance(100)) return;

    const sorted = this.game
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

    if (sorted.length === 0 || sorted[0] !== this.player) return;

    this.sendEmoji(AllPlayers, EMOJI_BRAG);
  }

  private charmAllies(): void {
    if (!this.random.chance(250)) return;

    const humanAllies = this.player
      .allies()
      .filter((p) => p.type() === PlayerType.Human);
    if (humanAllies.length === 0) return;

    const ally = this.random.randElement(humanAllies);
    const emojiList = this.random.chance(3) ? EMOJI_LOVE : EMOJI_CHARM_ALLIES;
    this.sendEmoji(ally, emojiList);
  }

  private annoyTraitors(): void {
    if (!this.random.chance(40)) return;

    const traitors = this.game
      .players()
      .filter(
        (p) =>
          p.type() === PlayerType.Human &&
          !p.isFriendly(this.player) &&
          p.isTraitor(),
      );

    if (traitors.length === 0) return;

    const traitor = this.random.randElement(traitors);
    this.sendEmoji(traitor, EMOJI_CLOWN);
  }

  private findRat(): void {
    if (!this.random.chance(10000)) return;

    const totalLand = this.game.numLandTiles();
    const threshold = totalLand * 0.01; // 1% of land

    const smallPlayers = this.game
      .players()
      .filter(
        (p) =>
          p.type() === PlayerType.Human &&
          p.numTilesOwned() < threshold &&
          p.numTilesOwned() > 0,
      );

    if (smallPlayers.length === 0) return;

    const smallPlayer = this.random.randElement(smallPlayers);
    this.sendEmoji(smallPlayer, EMOJI_RAT);
  }

  maybeSendEmoji(
    otherPlayer: Player | typeof AllPlayers,
    emojisList: number[],
  ) {
    if (!this.shouldSendEmoji(otherPlayer)) return;

    return this.sendEmoji(otherPlayer, emojisList);
  }

  maybeSendAttackEmoji(otherPlayer: Player) {
    if (!this.shouldSendEmoji(otherPlayer)) return;

    // If we have a good relation to the other player, we are probably attacking first (aggressive)
    if (this.player.relation(otherPlayer) >= Relation.Neutral) {
      if (!this.random.chance(2)) return;
      this.sendEmoji(otherPlayer, EMOJI_AGGRESSIVE_ATTACK);
      return;
    }

    // We are probably retaliating
    if (!this.random.chance(4)) return;
    this.sendEmoji(otherPlayer, EMOJI_ATTACK);
  }

  sendEmoji(otherPlayer: Player | typeof AllPlayers, emojisList: number[]) {
    if (!this.shouldSendEmoji(otherPlayer, false)) return;

    this.game.addExecution(
      new EmojiExecution(
        this.player,
        otherPlayer === AllPlayers ? AllPlayers : otherPlayer.id(),
        this.random.randElement(emojisList),
      ),
    );
  }

  private shouldSendEmoji(
    otherPlayer: Player | typeof AllPlayers,
    limitEmojisByTime: boolean = true,
  ): boolean {
    if (otherPlayer === AllPlayers) return true;
    if (this.player.type() === PlayerType.Bot) return false;
    if (otherPlayer.type() !== PlayerType.Human) return false;

    if (limitEmojisByTime) {
      const lastSent = this.lastEmojiSent.get(otherPlayer) ?? -300;
      if (this.game.ticks() - lastSent <= 300) return false;
      this.lastEmojiSent.set(otherPlayer, this.game.ticks());
    }

    return true;
  }
}

export function respondToEmoji(
  game: Game,
  random: PseudoRandom,
  sender: Player,
  recipient: Player | typeof AllPlayers,
  emojiString: string,
): void {
  if (recipient === AllPlayers || recipient.type() !== PlayerType.Nation) {
    return;
  }

  if (emojiString === "🖕") {
    recipient.updateRelation(sender, -100);
    game.addExecution(
      new EmojiExecution(
        recipient,
        sender.id(),
        random.randElement(EMOJI_GOT_INSULTED),
      ),
    );
  }

  if (emojiString === "🤡") {
    recipient.updateRelation(sender, -10);
    game.addExecution(
      new EmojiExecution(
        recipient,
        sender.id(),
        random.randElement(EMOJI_CONFUSED),
      ),
    );
  }

  if (["🕊️", "🏳️", "❤️", "🥰", "👏"].includes(emojiString)) {
    if (game.config().gameConfig().difficulty === Difficulty.Easy) {
      recipient.updateRelation(sender, 15);
    }
    game.addExecution(
      new EmojiExecution(
        recipient,
        sender.id(),
        sender.relation(recipient) >= Relation.Neutral
          ? random.randElement(EMOJI_LOVE)
          : random.randElement(EMOJI_CONFUSED),
      ),
    );
  }
}
