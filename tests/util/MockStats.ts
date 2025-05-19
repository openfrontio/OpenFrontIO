import { Player } from "../../src/core/game/Game";
import { Stats } from "../../src/core/game/Stats";
import { AllPlayersStats, PlayerStats } from "../../src/core/Schemas";

export class MockStats implements Stats {
  getPlayerStats(player: Player): PlayerStats {
    return {
      betrayals: 0,
      boats: {
        trade: [0, 0, 0],
        trans: [0, 0, 0],
      },
      bombs: {
        abomb: [0, 0, 0],
        hbomb: [0, 0, 0],
        mirvw: [0, 0, 0],
        mirv: [0, 0, 0],
      },
      units: {
        city: [0, 0, 0, 0],
        defp: [0, 0, 0, 0],
        port: [0, 0, 0, 0],
        wshp: [0, 0, 0, 0],
        silo: [0, 0, 0, 0],
        saml: [0, 0, 0, 0],
      },
      attacks: [0, 0, 0],
      gold: [0, 0, 0],
    } satisfies PlayerStats;
  }

  stats(): AllPlayersStats {
    throw new Error("Method not implemented.");
  }

  attack(): void {
    // Do nothing
  }

  attackCancel(): void {
    // Do nothing
  }

  betray(): void {
    // Do nothing
  }

  boatSendTrade(): void {
    // Do nothing
  }

  boatArriveTrade(): void {
    // Do nothing
  }

  boatDestroyTrade(): void {
    // Do nothing
  }

  boatSendTroops(): void {
    // Do nothing
  }

  boatArriveTroops(): void {
    // Do nothing
  }

  boatDestroyTroops(): void {
    // Do nothing
  }

  bombLaunch(): void {
    // Do nothing
  }

  bombLand(): void {
    // Do nothing
  }

  bombIntercept(): void {
    // Do nothing
  }

  goldWar(): void {
    // Do nothing
  }

  goldWork(): void {
    // Do nothing
  }

  unitBuild(): void {
    // Do nothing
  }

  unitCapture(): void {
    // Do nothing
  }

  unitDestroy(): void {
    // Do nothing
  }

  unitLose(): void {
    // Do nothing
  }
}
