import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, Structures } from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "../../game/Game";

// What a bot's territory touches, seen from the player planning to take it
interface BotSurroundings {
  bot: Player;
  bordersUs: boolean;
  // Touches water, the map edge, free land or anyone but us and bots we may attack
  open: boolean;
  // The other bots it borders
  bots: Set<Player>;
}

// Bots that border only us and aren't under our attack yet: any attack makes the engine annex them
export function walledInBots(
  game: Game,
  player: Player,
  bots: Player[],
): Player[] {
  const scanner = new BotScanner(game, player);
  const attacking = attackedBy(player);
  return bots.filter(
    (bot) =>
      !attacking.has(bot) &&
      scanner.scan(bot, true, NO_BOTS)?.bordersUs === true,
  );
}

// Bots to attack, best first: a checkerboard of bots across our front and the row behind it is
// left to be annexed for free, and the bots walling them in go first
export function planBotAttacks(
  game: Game,
  player: Player,
  bots: Player[],
): Player[] {
  const scanner = new BotScanner(game, player);
  const region = new Map<Player, BotSurroundings>();
  for (const bot of bots) region.set(bot, scanner.scan(bot, false)!);
  const front = bots.filter((bot) => region.get(bot)!.bordersUs);
  // Open bots behind the front are never kept, so only the closed ones are needed
  const behind = new Set<Player>();
  for (const bot of front) {
    for (const other of region.get(bot)!.bots) {
      if (region.has(other) || behind.has(other)) continue;
      behind.add(other);
      const s = scanner.scan(other, true);
      if (s !== null) region.set(other, s);
    }
  }
  const attacking = attackedBy(player);

  // Largest first, bots that don't border each other; each neighbor earns a share of the land it walls in
  const candidates = [...region.values()]
    .filter(
      (s) =>
        !s.open &&
        s.bots.size > 0 &&
        !attacking.has(s.bot) &&
        !ownsStructures(s.bot),
    )
    .sort((a, b) => b.bot.numTilesOwned() - a.bot.numTilesOwned());
  const kept = new Set<Player>();
  const nextToKept = new Set<Player>();
  const walledIn = new Map<Player, number>();
  for (const s of candidates) {
    if (nextToKept.has(s.bot)) continue;
    kept.add(s.bot);
    const share = s.bot.numTilesOwned() / s.bots.size;
    for (const other of s.bots) {
      nextToKept.add(other);
      walledIn.set(other, (walledIn.get(other) ?? 0) + share);
    }
  }

  // Most land per bot troop, counting the land it walls in
  const value = (bot: Player) =>
    (bot.numTilesOwned() + (walledIn.get(bot) ?? 0)) /
    Math.max(1, bot.troops());
  const byValue = (a: Player, b: Player) => value(b) - value(a);
  const targets = bots
    .filter((bot) => {
      const s = region.get(bot)!;
      const walled = s.bordersUs && !s.open && s.bots.size === 0;
      return !kept.has(bot) && !walled;
    })
    .sort(byValue);
  // Behind water or the map edge, kept bots can be all we border: then they're the way on
  if (!targets.some((bot) => region.get(bot)!.bordersUs)) {
    targets.push(...front.filter((bot) => kept.has(bot)).sort(byValue));
  }
  return targets;
}

const NO_BOTS = new Set<Player>();

function attackedBy(player: Player): Set<Player> {
  const targets = new Set<Player>();
  for (const attack of player.outgoingAttacks()) {
    const target = attack.target();
    if (target.isPlayer()) targets.add(target);
  }
  return targets;
}

function ownsStructures(player: Player): boolean {
  return player.units().some((u) => Structures.has(u.type()));
}

// Mirrors PlayerExecution's surrounded check: every land tile next to the bot's border counts
class BotScanner {
  private readonly nbuf: TileRef[] = [0, 0, 0, 0];
  // smallID -> a bot we may attack, or null for anyone else
  private readonly attackableBots = new Map<number, Player | null>();

  constructor(
    private readonly game: Game,
    private readonly player: Player,
  ) {}

  // Gives up (null) once the bot turns out open if `closedOnly`, or borders a bot outside `within`
  scan(
    bot: Player,
    closedOnly: boolean,
    within: Set<Player> | null = null,
  ): BotSurroundings | null {
    const map = this.game.map();
    const us = this.player.smallID();
    const self = bot.smallID();
    const s: BotSurroundings = {
      bot,
      bordersUs: false,
      open: false,
      bots: new Set(),
    };
    let gaveUp = false;
    // forEach, not for..of: TileSet.values() is a generator.
    bot.borderTiles().forEach((tile) => {
      if (gaveUp) return;
      if (map.isOceanShore(tile) || map.isOnEdgeOfMap(tile)) {
        s.open = true;
        gaveUp = closedOnly;
        return;
      }
      const n = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < n; i++) {
        const id = map.ownerID(this.nbuf[i]);
        if (id === self) continue;
        if (id === us) {
          s.bordersUs = true;
          continue;
        }
        const other = id === 0 ? null : this.attackableBot(id);
        if (other === null) {
          s.open = true;
          gaveUp = closedOnly;
        } else if (within !== null && !within.has(other)) {
          gaveUp = true;
        } else {
          s.bots.add(other);
        }
        if (gaveUp) return;
      }
    });
    return gaveUp ? null : s;
  }

  private attackableBot(smallID: number): Player | null {
    let bot = this.attackableBots.get(smallID);
    if (bot === undefined) {
      const owner = this.game.playerBySmallID(smallID);
      bot =
        owner.isPlayer() &&
        owner.type() === PlayerType.Bot &&
        !this.player.isFriendly(owner)
          ? owner
          : null;
      this.attackableBots.set(smallID, bot);
    }
    return bot;
  }
}
