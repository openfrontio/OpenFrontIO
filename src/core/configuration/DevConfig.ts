import { GameType, Player, PlayerInfo, UnitInfo, UnitType } from "../game/Game";
import { DefaultConfig } from "./DefaultConfig";

export const devConfig = new class extends DefaultConfig {
    discordBotSecret(): string {
        throw new Error("Method not implemented.");
    }
    unitInfo(type: UnitType): UnitInfo {
        const info = super.unitInfo(type)
        const oldCost = info.cost
        // info.cost = (p: Player) => oldCost(p) / 10000
        return info
    }

    percentageTilesOwnedToWin(): number {
        return 95
    }
    numSpawnPhaseTurns(gameType: GameType): number {
        return gameType == GameType.Singleplayer ? 40 : 200
        // return 100
    }
    gameCreationRate(): number {
        return 10 * 1000
    }
    lobbyLifetime(): number {
        return 10 * 1000
    }
    // tradeShipSpawnRate(): number {
    //     return 10
    // }
    // boatMaxDistance(): number {
    //     return 5000
    // }

    // numBots(): number {
    //     return 1
    // }
    // spawnNPCs(): boolean {
    //     return false
    // }

}