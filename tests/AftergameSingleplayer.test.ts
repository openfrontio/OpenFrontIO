import { SAMLauncherExecution } from "../src/core/execution/SAMLauncherExecution";
import {
  Game,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Aftergame fun (nuking your own teammate once a winner is decided) is meant for
// human vs human multiplayer. In singleplayer a team can "insta-win" while the
// human is still actively playing against AI teammates, so the feature must stay
// disabled there. Covers PlayerImpl.nukeSpawn and SAMTargetingSystem.isValidNukeTarget.
describe("Aftergame teammate nuking", () => {
  async function setupTeammates(
    gameType: GameType,
  ): Promise<{ game: Game; p1: Player; p2: Player }> {
    const game = await setup(
      "plains",
      {
        gameType,
        gameMode: GameMode.Team,
        playerTeams: 2,
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("p1", PlayerType.Human, "c1", "p1", false, null, [], 0),
        new PlayerInfo("p2", PlayerType.Human, "c2", "p2", false, null, [], 0),
      ],
    );

    const p1 = game.player("p1");
    const p2 = game.player("p2");
    expect(p1.isOnSameTeam(p2)).toBe(true);

    p1.conquer(game.ref(0, 0));
    p2.conquer(game.ref(5, 5));
    p1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});

    return { game, p1, p2 };
  }

  describe("PlayerImpl.nukeSpawn (targeting a teammate)", () => {
    test("singleplayer: teammate stays un-nukeable even after the game is won", async () => {
      const { game, p1 } = await setupTeammates(GameType.Singleplayer);

      // Normal pre-game behavior: teammates are never nukeable.
      expect(p1.canBuild(UnitType.AtomBomb, game.ref(5, 5))).toBe(false);

      game.setWinner(p1, game.stats().stats());
      expect(game.getWinner()).not.toBeNull();

      // Aftergame is disabled in singleplayer, so this stays blocked.
      expect(p1.canBuild(UnitType.AtomBomb, game.ref(5, 5))).toBe(false);
    });

    test("multiplayer: teammate becomes nukeable once the game is won", async () => {
      const { game, p1 } = await setupTeammates(GameType.Public);

      // Normal pre-game behavior: teammates are never nukeable.
      expect(p1.canBuild(UnitType.AtomBomb, game.ref(5, 5))).toBe(false);

      game.setWinner(p1, game.stats().stats());
      expect(game.getWinner()).not.toBeNull();

      // Aftergame fun is preserved for human vs human multiplayer.
      expect(p1.canBuild(UnitType.AtomBomb, game.ref(5, 5))).not.toBe(false);
    });
  });

  describe("SAMTargetingSystem.isValidNukeTarget (intercepting a teammate's nuke)", () => {
    function launchNukeNearSam(p1: Player, game: Game) {
      return p1.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
        targetTile: game.ref(3, 1),
        trajectory: [
          { tile: game.ref(1, 1), targetable: true },
          { tile: game.ref(2, 1), targetable: true },
          { tile: game.ref(3, 1), targetable: true },
        ],
      });
    }

    test("singleplayer: a teammate's SAM does not intercept a teammate's nuke after the game is won", async () => {
      const { game, p1, p2 } = await setupTeammates(GameType.Singleplayer);
      game.setWinner(p1, game.stats().stats());

      const sam = p2.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
      game.addExecution(new SAMLauncherExecution(p2, null, sam));

      launchNukeNearSam(p1, game);
      executeTicks(game, 3);

      // SAM never fires on the teammate's nuke, so it stays in flight.
      expect(sam.isInCooldown()).toBeFalsy();
      expect(p1.units(UnitType.AtomBomb)).toHaveLength(1);
    });

    test("multiplayer: a teammate's SAM intercepts a teammate's nuke after the game is won (aftergame fun)", async () => {
      const { game, p1, p2 } = await setupTeammates(GameType.Public);
      game.setWinner(p1, game.stats().stats());

      const sam = p2.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
      game.addExecution(new SAMLauncherExecution(p2, null, sam));

      launchNukeNearSam(p1, game);
      executeTicks(game, 3);

      // Aftergame fun is preserved: the SAM shoots the teammate's nuke down.
      expect(sam.isInCooldown()).toBeTruthy();
      expect(p1.units(UnitType.AtomBomb)).toHaveLength(0);
    });
  });
});
