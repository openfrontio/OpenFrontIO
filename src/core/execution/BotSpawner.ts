import { consolex } from "../Consolex";
import {Cell, Game, PlayerType, Tile, TileEvent} from "../game/Game";
import {PseudoRandom} from "../PseudoRandom";
import {GameID, SpawnIntent} from "../Schemas";
import {bfs, dist as dist, manhattanDist, simpleHash} from "../Util";
import modernNames from '../../../resources/nationNames/modernNationNames.txt';
import historicNames from '../../../resources/nationNames/preHistoricNationNames.txt';

export class BotSpawner {
    private random: PseudoRandom
    private bots: SpawnIntent[] = [];
    private usedNames: Set<string>;
    private availableNames: string[] = [];
    constructor(private gs: Game, gameID: GameID) {
        this.random = new PseudoRandom(simpleHash(gameID))
        this.usedNames = new Set<string>();
        this.loadNames();
    }

    private loadNames(): void {
        const names1 = modernNames.split('\n').filter(name => name.trim());
        const names2 = historicNames.split('\n').filter(name => name.trim());
        this.availableNames = [...names1, ...names2];
    }
   

    private getRandomName(): string | null {
        const availableNewNames = this.availableNames.filter(name => !this.usedNames.has(name));
        if (availableNewNames.length === 0) return null;
        
        const randomIndex = this.random.nextInt(0, availableNewNames.length);
        const selectedName = availableNewNames[randomIndex];
        this.usedNames.add(selectedName);
        return selectedName;
    }

    spawnBots(numBots: number): SpawnIntent[] {
        
        let tries = 0
        while (this.bots.length < numBots) {
            let randomName = this.getRandomName();
            if (!randomName) {
                consolex.log('No more names available for bots');
                return this.bots;
            }
            
            if (tries > 10000) {
                consolex.log('too many retries while spawning bots, giving up')
                return this.bots
            }
            const spawn = this.spawnBot(randomName)
            if (spawn != null) {
                this.bots.push(spawn);
            } else {
                tries++
            }
        }
        return this.bots;
    }

    spawnBot(botName: string): SpawnIntent | null {
        const tile = this.randTile()
        if (!tile.isLand()) {
            return null
        }
        for (const spawn of this.bots) {
            if (manhattanDist(new Cell(spawn.x, spawn.y), tile.cell()) < 30) {
                return null
            }
        }
        return {
            type: 'spawn',
            playerID: this.random.nextID(),
            name: botName,
            playerType: PlayerType.Bot,
            x: tile.cell().x,
            y: tile.cell().y
        };
    }

    private randTile(): Tile {
        return this.gs.tile(new Cell(
            this.random.nextInt(0, this.gs.width()),
            this.random.nextInt(0, this.gs.height())
        ))
    }
}

