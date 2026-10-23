import {
  Difficulty,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { CHEAPEST_TROOP_RATIO } from "@openfront/engine/configuration/EngineConfig";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { planBotAttacks } from "@openfront/engine/execution/nation/BotAnnexation";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// plains: 100x100, all land
describe("Bot annexation", () => {
  let game: Game;
  let nation: Player;

  async function setupPlains(
    difficulty: Difficulty,
    bots: string[],
    realAttackLogic = false,
  ) {
    game = await setup(
      "plains",
      { difficulty },
      [
        new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
        ...bots.map((id) => new PlayerInfo(id, PlayerType.Bot, null, id)),
      ],
      undefined,
      realAttackLogic ? UseRealAttackLogic : undefined,
    );
    nation = game.player("nation");
    nation.setTroops(500_000);
  }

  // Hands each tile to whoever `owner` names
  function paint(owner: (x: number, y: number) => string) {
    game.map().forEachTile((tile) => {
      game.player(owner(game.x(tile), game.y(tile))).conquer(tile);
    });
  }

  function behavior(): NationAttackBehavior {
    return new NationAttackBehavior(
      new PseudoRandom(42),
      game,
      nation,
      0, // triggerRatio
      0, // reserveRatio
      0, // expandRatio
      { maybeBetray: vi.fn() } as any,
      { maybeSendAttackEmoji: vi.fn(), sendEmoji: vi.fn() } as any,
      {} as any,
    );
  }

  function botsNearby(): Player[] {
    return nation
      .nearby()
      .filter((p): p is Player => p.isPlayer() && p.type() === PlayerType.Bot);
  }

  function attacksSent(run: () => void): AttackExecution[] {
    const spy = vi.spyOn(game, "addExecution");
    run();
    const sent = spy.mock.calls
      .map((c) => c[0])
      .filter((e): e is AttackExecution => e instanceof AttackExecution);
    spy.mockRestore();
    return sent;
  }

  // The nation holds the top 30 rows; below, bot "a" (left) and bot "c" (right) border it.
  // Bot "pocket" sits inside "a", away from the map edge, so it borders only "a".
  async function setupPocketBehindA(difficulty = Difficulty.Hard) {
    await setupPlains(difficulty, ["a", "c", "pocket"]);
    paint((x, y) => {
      if (y < 30) return "nation";
      if (x >= 10 && x < 40 && y >= 40 && y < 90) return "pocket";
      return x < 50 ? "a" : "c";
    });
    // "c" has the lower troop density, "a" walls in the pocket
    game.player("a").setTroops(2_000);
    game.player("c").setTroops(2_500);
    game.player("pocket").setTroops(1_000);
  }

  // The nation holds the left 30 columns. Bot "q" borders it and is walled in by bot "a" elsewhere.
  async function setupPocketOnFront(difficulty = Difficulty.Hard) {
    await setupPlains(difficulty, ["a", "q"]);
    paint((x, y) => {
      if (x < 30) return "nation";
      if (x < 40 && y >= 40 && y < 60) return "q";
      return "a";
    });
    game.player("a").setTroops(50_000);
    game.player("q").setTroops(100);
  }

  it("first attacks the bot that walls in another bot", async () => {
    await setupPocketBehindA();
    const targets = planBotAttacks(game, nation, botsNearby());
    expect(targets.map((b) => b.id())).toEqual(["a", "c"]);
  });

  it("leaves a bot alone while the bots that wall it in are ours to take", async () => {
    await setupPocketOnFront();
    const sent = attacksSent(() => behavior()["attackBots"]());
    expect(sent.map((e) => e.targetID())).toEqual(["a"]);
  });

  it("leaves a bot alone whose last neighbor is two attacks away", async () => {
    // "k" borders the nation, "a" and "y"; "y" sits behind "k" and borders no one we border but "a"
    await setupPlains(Difficulty.Hard, ["a", "k", "y", "c"]);
    paint((x, y) => {
      if (x < 30) return "nation";
      if (x < 40 && y >= 35 && y < 65) return "k";
      if (x >= 40 && x < 50 && y >= 40 && y < 60) return "y";
      return x < 50 ? "a" : "c";
    });
    for (const id of ["a", "k", "y", "c"]) game.player(id).setTroops(1_000);
    const sent = attacksSent(() => behavior()["attackBots"]());
    expect(sent.map((e) => e.targetID())).toEqual(["a"]);
  });

  it("attacks a kept bot when it is all it borders", async () => {
    // The nation is an enclave in "b", which "c" surrounds up to the map edge
    await setupPlains(Difficulty.Hard, ["b", "c"]);
    paint((x, y) => {
      const inside = (lo: number, hi: number) =>
        x >= lo && x < hi && y >= lo && y < hi;
      if (inside(40, 60)) return "nation";
      return inside(30, 70) ? "b" : "c";
    });
    game.player("b").setTroops(1_000);
    game.player("c").setTroops(1_000);
    const sent = attacksSent(() => behavior()["attackBots"]());
    expect(sent.map((e) => e.targetID())).toEqual(["b"]);
  });

  it("Medium still attacks bots by troop density", async () => {
    await setupPocketOnFront(Difficulty.Medium);
    const sent = attacksSent(() => behavior()["attackBots"]());
    expect(sent[0].targetID()).toBe("q");
  });

  it("attacks a bot that also borders the map edge", async () => {
    await setupPlains(Difficulty.Hard, ["a", "q"]);
    paint((x, y) => {
      if (x < 30) return "nation";
      if (x < 40 && y < 20) return "q";
      return "a";
    });
    game.player("a").setTroops(50_000);
    game.player("q").setTroops(100);
    const sent = attacksSent(() => behavior()["attackBots"]());
    expect(sent.map((e) => e.targetID())).toContain("q");
  });

  it("annexes a bot it walls in with a small attack", async () => {
    await setupPlains(Difficulty.Impossible, ["e"]);
    paint((x, y) => (x >= 30 && x < 40 && y >= 40 && y < 60 ? "e" : "nation"));
    const bot = game.player("e");
    bot.setTroops(20_000);
    executeTicks(game, 1);
    game.addExecution(new PlayerExecution(bot));
    executeTicks(game, 30);
    // Untouched, the engine never rechecks the bot
    expect(bot.isAlive()).toBe(true);

    const sent = attacksSent(() => behavior()["annexWalledInBots"]());
    expect(sent.map((e) => e.targetID())).toEqual(["e"]);
    expect(sent[0]["startTroops"]).toBeLessThanOrEqual(5_000);
    executeTicks(game, 30);
    expect(bot.isAlive()).toBe(false);
    expect(nation.numTilesOwned()).toBe(100 * 100);
    expect(nation.troops()).toBeGreaterThan(490_000);
  });

  describe("bot attack troops", () => {
    // The nation holds the left 30 columns, bot "a" the rest, densely manned
    async function setupDenseBot(difficulty: Difficulty) {
      await setupPlains(difficulty, ["a"]);
      paint((x) => (x < 30 ? "nation" : "a"));
      nation.setTroops(2_000_000);
      const bot = game.player("a");
      bot.setTroops(200_000);
      return bot;
    }

    const troopsSent = (sent: AttackExecution[]) =>
      sent.reduce((sum, e) => sum + (e["startTroops"] ?? 0), 0);

    it("Medium sends four times the bot's troops", async () => {
      await setupDenseBot(Difficulty.Medium);
      const sent = attacksSent(() => behavior()["attackBots"]());
      expect(troopsSent(sent)).toBe(800_000);
    });

    it("Hard sends what keeps the attack at its cheapest loss rate", async () => {
      const bot = await setupDenseBot(Difficulty.Hard);
      const sent = attacksSent(() => behavior()["attackBots"]());
      const troops = troopsSent(sent);
      expect(troops).toBeGreaterThan(bot.troops() / CHEAPEST_TROOP_RATIO);
      expect(troops).toBeLessThan(bot.troops() * 3);
    });

    it("Hard attacks a bot with no troops", async () => {
      await setupPlains(Difficulty.Hard, ["a"], true);
      paint((x) => (x < 30 ? "nation" : "a"));
      game.player("a").setTroops(0);
      const sent = attacksSent(() => behavior()["attackBots"]());
      expect(sent.map((e) => e.targetID())).toEqual(["a"]);
    });

    it("tops up a running attack instead of adding another full one", async () => {
      await setupDenseBot(Difficulty.Impossible);
      const ai = behavior();
      const first = troopsSent(attacksSent(() => ai["attackBots"]()));
      executeTicks(game, 1);
      let busy = false;
      const second = troopsSent(
        attacksSent(() => {
          busy = ai["attackBots"]();
        }),
      );
      expect(second).toBeLessThan(first * 0.2);
      expect(busy).toBe(true);
    });

    it("adds the troops of the bot's own attack, which cancel out against ours", async () => {
      const bot = await setupDenseBot(Difficulty.Impossible);
      const ai = behavior();
      game.addExecution(new AttackExecution(50_000, bot, nation.id()));
      executeTicks(game, 1);
      const incoming = nation
        .incomingAttacks()
        .reduce((sum, a) => sum + a.troops(), 0);
      expect(incoming).toBeGreaterThan(0);
      const sent = troopsSent(attacksSent(() => ai["attackBots"]()));
      expect(sent).toBeCloseTo(
        ai["botAttackTroopsNeeded"](bot) * 1.3 + incoming,
      );
    });
  });
});
