import { consolex } from "../Consolex";
import {Cell, Game, PlayerType, Tile, TileEvent} from "../game/Game";
import {PseudoRandom} from "../PseudoRandom";
import {GameID, SpawnIntent} from "../Schemas";
import {bfs, dist as dist, manhattanDist, simpleHash} from "../Util";
import {BOT_NAME_PREFIXES, BOT_NAME_SUFFIXES} from "./utils/BotNames";


export class BotSpawner {
    private random: PseudoRandom;
    private bots: SpawnIntent[] = [];

    constructor(private gs: Game, gameID: GameID) {
        this.random = new PseudoRandom(simpleHash(gameID));
    }

    spawnBots(numBots: number): SpawnIntent[] {
        let tries = 0;
        while (this.bots.length < numBots) {
            if (tries > 10000) {
                consolex.log("too many retries while spawning bots, giving up");
                return this.bots;
            }
            const botName = this.randomBotName();
            const spawn = this.spawnBot(botName);
            if (spawn != null) {
                this.bots.push(spawn);
            } else {
                tries++;
            }
        }
        return this.bots;
    }

    private randomBotName(): string {
        const prefixIndex = this.random.nextInt(0, BOT_NAME_PREFIXES.length);
        const suffixIndex = this.random.nextInt(0, BOT_NAME_SUFFIXES.length);
        return `${BOT_NAME_PREFIXES[prefixIndex]} ${BOT_NAME_SUFFIXES[suffixIndex]}`;
    }

    spawnBot(botName: string): SpawnIntent | null {
        const tile = this.randTile();
        if (!tile.isLand()) {
            return null;
        }
        for (const spawn of this.bots) {
            if (manhattanDist(new Cell(spawn.x, spawn.y), tile.cell()) < 30) {
                return null;
            }
        }
        return {
            type: "spawn",
            playerID: this.random.nextID(),
            name: botName,
            playerType: PlayerType.Bot,
            x: tile.cell().x,
            y: tile.cell().y
        };
    }

    private randTile(): Tile {
        return this.gs.tile(
            new Cell(
                this.random.nextInt(0, this.gs.width()),
                this.random.nextInt(0, this.gs.height())
            )
        );
    }
}
