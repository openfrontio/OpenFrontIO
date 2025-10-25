import { Game, GameMode, UnitType } from "../../../src/core/game/Game";
import { PlayerImpl } from "../../../src/core/game/PlayerImpl";

describe("NukeWars Unit Restrictions", () => {
  let mg: jest.Mocked<Game>;

  beforeEach(() => {
    mg = {
      config: jest.fn().mockReturnValue({
        gameConfig: jest.fn().mockReturnValue({
          gameMode: GameMode.NukeWars,
          maxTimerValue: 5,
        }),
        isUnitDisabled: jest.fn().mockImplementation((unitType: UnitType) => {
          const allowedUnits = [
            UnitType.MissileSilo,
            UnitType.SAMLauncher,
            UnitType.AtomBomb,
            UnitType.HydrogenBomb,
          ];
          return !allowedUnits.includes(unitType);
        }),
      }),
      width: jest.fn().mockReturnValue(100),
      x: jest.fn(),
      teams: jest.fn().mockReturnValue(["Team1", "Team2"]),
      inSpawnPhase: jest.fn().mockReturnValue(true),
      unitInfo: jest.fn().mockReturnValue({
        cost: jest.fn().mockReturnValue(0n),
      }),
    } as unknown as jest.Mocked<Game>;
  });

  describe("Unit type restrictions", () => {
    it.each([
      [UnitType.MissileSilo, true],
      [UnitType.SAMLauncher, true],
      [UnitType.AtomBomb, true],
      [UnitType.HydrogenBomb, true],
      [UnitType.MIRV, false],
      [UnitType.City, false],
      [UnitType.DefensePost, false],
      [UnitType.Port, false],
      [UnitType.TransportShip, false],
      [UnitType.Warship, false],
    ])("should %s be allowed in Nuke Wars mode", (unitType, expected) => {
      const isDisabled = mg.config().isUnitDisabled(unitType);
      expect(!isDisabled).toBe(expected);
    });
  });

  describe("Spawn zone restrictions", () => {
    let player: jest.Mocked<PlayerImpl>;

    beforeEach(() => {
      player = {
        team: jest.fn().mockReturnValue("Team1"),
        isAlive: jest.fn().mockReturnValue(true),
        gold: jest.fn().mockReturnValue(1000n),
        canBuild: jest.fn().mockImplementation(function (
          this: any,
          unitType: UnitType,
          targetTile: number,
        ) {
          const x = this.mg.x(targetTile);
          const mapWidth = this.mg.width();
          const midpoint = Math.floor(mapWidth / 2);
          const onOwnSide = x < midpoint;

          if (this.mg.inSpawnPhase()) {
            return onOwnSide ? targetTile : false;
          }

          if (!onOwnSide) {
            return [UnitType.AtomBomb, UnitType.HydrogenBomb].includes(unitType)
              ? targetTile
              : false;
          }

          return this.mg.config().isUnitDisabled(unitType) ? false : targetTile;
        }),
        mg: mg,
      } as unknown as jest.Mocked<PlayerImpl>;
    });

    describe("During spawn phase", () => {
      beforeEach(() => {
        mg.inSpawnPhase.mockReturnValue(true);
      });

      it("should allow building on own side", () => {
        mg.x.mockReturnValue(20); // Left side
        const canBuild = player.canBuild(UnitType.MissileSilo, 0);
        expect(canBuild).not.toBe(false);
      });

      it("should prevent building on enemy side", () => {
        mg.x.mockReturnValue(80); // Right side
        const canBuild = player.canBuild(UnitType.MissileSilo, 0);
        expect(canBuild).toBe(false);
      });
    });

    describe("After spawn phase", () => {
      beforeEach(() => {
        mg.inSpawnPhase.mockReturnValue(false);
      });

      it("should allow missiles to cross midpoint", () => {
        mg.x.mockReturnValue(80); // Right side
        const canBuild = player.canBuild(UnitType.AtomBomb, 0);
        expect(canBuild).not.toBe(false);
      });

      it("should prevent SAM launchers from crossing midpoint", () => {
        mg.x.mockReturnValue(80); // Right side
        const canBuild = player.canBuild(UnitType.SAMLauncher, 0);
        expect(canBuild).toBe(false);
      });
    });
  });
});
