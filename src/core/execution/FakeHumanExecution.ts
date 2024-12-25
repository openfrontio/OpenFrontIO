import { Cell, Execution, MutableGame, MutablePlayer, Player, PlayerInfo, PlayerType, TerrainType, TerraNullius, Tile, UnitType } from "../game/Game"
import { PseudoRandom } from "../PseudoRandom"
import { and, bfs, dist, euclDist, manhattanDist, simpleHash } from "../Util";
import { AttackExecution } from "./AttackExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { SpawnExecution } from "./SpawnExecution";
import { PortExecution } from "./PortExecution";
import { ParallelAStar, WorkerClient } from "../worker/WorkerClient";
import { PathFinder } from "../pathfinding/PathFinding";
import { DestroyerExecution } from "./DestroyerExecution";
import { BattleshipExecution } from "./BattleshipExecution";
import { GameID } from "../Schemas";
import { consolex } from "../Consolex";

export class FakeHumanExecution implements Execution {

    private firstMove = true

    private active = true
    private random: PseudoRandom;
    private mg: MutableGame
    private player: MutablePlayer = null

    private enemy: Player | null = null

    private rejected: Set<Player> = new Set<Player>

    private relations = new Map<Player, number>()

    constructor(gameID: GameID, private worker: WorkerClient, private playerInfo: PlayerInfo, private cell: Cell, private strength: number) {
        this.random = new PseudoRandom(simpleHash(playerInfo.id) + simpleHash(gameID))
    }

    init(mg: MutableGame, ticks: number) {
        this.mg = mg
        if (this.random.chance(10)) {
            // this.isTraitor = true
        }
    }

    tick(ticks: number) {
        if (this.mg.inSpawnPhase()) {
            if (ticks % this.random.nextInt(5, 30) == 0) {
                const rl = this.randomLand()
                if (rl == null) {
                    consolex.warn(`cannot spawn ${this.playerInfo.name}`)
                    return
                }
                this.mg.addExecution(new SpawnExecution(
                    this.playerInfo,
                    rl.cell()
                ))
            }
            return
        }
        if (this.player == null) {
            this.player = this.mg.players().find(p => p.id() == this.playerInfo.id)
            if (this.player == null) {
                return
            } else {
                this.player.setTroops(this.player.troops() * this.strength)
            }
        }
        if (this.firstMove) {
            this.firstMove = false
            this.sendAttack(this.mg.terraNullius())
            return
        }

        if (ticks % this.random.nextInt(40, 80) != 0) {
            return
        }

        if (this.player.troops() > 100_000 && this.player.targetTroopRatio() > .7) {
            this.player.setTargetTroopRatio(.7)
        }

        this.handleAllianceRequests()
        this.handleEnemies()
        this.handleUnits()


        const enemyborder = Array.from(this.player.borderTiles()).flatMap(t => t.neighbors()).filter(t => t.isLand() && t.owner() != this.player)

        if (enemyborder.length == 0) {
            if (this.random.chance(5)) {
                this.sendBoat()
            }
            return
        }
        if (this.random.chance(10)) {
            this.sendBoat()
            return
        }

        const enemiesWithTN = enemyborder.map(t => t.owner())
        if (enemiesWithTN.filter(o => !o.isPlayer()).length > 0) {
            this.sendAttack(this.mg.terraNullius())
            return
        }

        const enemies = enemiesWithTN.filter(o => o.isPlayer()).map(o => o as Player).sort((a, b) => a.troops() - b.troops())

        if (this.random.chance(20)) {
            const toAlly = this.random.randElement(enemies)
            if (!this.player.isAlliedWith(toAlly) && !this.player.recentOrPendingAllianceRequestWith(toAlly)) {
                this.player.createAllianceRequest(toAlly)
                return
            }
        }

        if (this.random.chance(2)) {
            const weakest = enemies[0]
            if (!this.player.isAlliedWith(weakest)) {
                if (weakest.info().playerType != PlayerType.Human || weakest.isTraitor()) {
                    this.sendAttack(weakest)
                }
            }
        } else {
            const toAttack = this.random.randElement(enemies)
            if (!this.player.isAlliedWith(toAttack)) {
                if (toAttack.info().playerType != PlayerType.Human || toAttack.isTraitor()) {
                    this.sendAttack(toAttack)
                } else if (this.random.chance(4)) {
                    // Less likely to attack players who are not traitors.
                    this.sendAttack(toAttack)
                }
            }
        }
    }

    handleEnemies() {
        if (this.mg.ticks() % 100 == 0) {
            this.enemy = null
        }

        if (this.enemy == null) {
            this.enemy = this.mg.executions()
                .filter(e => e instanceof AttackExecution)
                .map(e => e as AttackExecution)
                .filter(e => e.targetID() == this.player.id())
                .map(e => e.owner())
                .find(enemy => enemy && enemy.type() == PlayerType.Human)
        }

        if (this.enemy) {
            if (this.player.sharesBorderWith(this.enemy) && !this.player.isAlliedWith(this.enemy)) {
                this.sendAttack(this.enemy)
            }
            return
        }

    }

    private handleUnits() {
        const ports = this.player.units(UnitType.Port)
        if (ports.length == 0 && this.player.gold() > this.cost(UnitType.Port)) {
            const oceanTiles = Array.from(this.player.borderTiles()).filter(t => t.isOceanShore())
            if (oceanTiles.length > 0) {
                const buildTile = this.random.randElement(oceanTiles)
                this.mg.addExecution(new PortExecution(this.player.id(), buildTile.cell(), this.worker))
            }
            return
        }
        if (this.maybeSpawnWarship(UnitType.Destroyer)) {
            return
        }
        if (this.maybeSpawnWarship(UnitType.Battleship)) {
            return
        }
    }

    private maybeSpawnWarship(shipType: UnitType.Destroyer | UnitType.Battleship): boolean {
        if (!this.random.chance(30)) {
            return false
        }
        const ports = this.player.units(UnitType.Port)
        const ships = this.player.units(shipType)
        if (ports.length > 0 && ships.length == 0 && this.player.gold() > this.cost(shipType)) {
            const port = this.random.randElement(ports)
            const targetTile = this.warshipSpawnTile(port.tile())
            if (targetTile == null) {
                return false
            }
            const canBuild = this.player.canBuild(UnitType.Destroyer, targetTile)
            if (canBuild == false) {
                consolex.warn('cannot spawn destroyer')
                return false
            }
            switch (shipType) {
                case UnitType.Destroyer:
                    this.mg.addExecution(new DestroyerExecution(this.player.id(), targetTile.cell()))
                    break
                case UnitType.Battleship:
                    this.mg.addExecution(new BattleshipExecution(this.player.id(), targetTile.cell()))
                    break
            }
            return true
        }
        return false
    }

    private warshipSpawnTile(portTile: Tile): Tile | null {
        const radius = this.mg.config().boatMaxDistance() / 2
        for (let attempts = 0; attempts < 50; attempts++) {
            const randX = this.random.nextInt(portTile.cell().x - radius, portTile.cell().x + radius)
            const randY = this.random.nextInt(portTile.cell().y - radius, portTile.cell().y + radius)
            const cell = new Cell(randX, randY)
            if (!this.mg.isOnMap(cell)) {
                continue
            }
            // Sanity check
            if (manhattanDist(cell, portTile.cell()) >= this.mg.config().boatMaxDistance()) {
                continue
            }
            const tile = this.mg.tile(cell)
            if (!tile.isOcean()) {
                continue
            }
            return tile
        }
        return null
    }

    private cost(type: UnitType): number {
        return this.mg.unitInfo(type).cost(this.player)
    }

    handleAllianceRequests() {
        for (const req of this.player.incomingAllianceRequests()) {
            if (req.requestor().isTraitor() || req.requestor().alliances().length >= 3) {
                req.reject()
            } else {
                req.accept()
            }
        }
    }

    sendBoat(tries: number = 0, oceanShore: Tile[] = null) {
        if (tries > 10) {
            return
        }

        if (oceanShore == null) {
            oceanShore = Array.from(this.player.borderTiles()).filter(t => t.isOceanShore())
        }
        if (oceanShore.length == 0) {
            return
        }

        const src = this.random.randElement(oceanShore)
        const otherShore = Array.from(
            bfs(
                src,
                and((t) => t.isOcean() || t.isOceanShore(), dist(src, 200))
            )
        ).filter(t => t.isOceanShore() && t.owner() != this.player)

        if (otherShore.length == 0) {
            return
        }

        for (let i = 0; i < 20; i++) {
            const dst = this.random.randElement(otherShore)
            if (this.isSmallIsland(dst)) {
                continue
            }
            if (dst.owner().isPlayer() && this.player.isAlliedWith(dst.owner() as Player)) {
                continue
            }

            this.mg.addExecution(new TransportShipExecution(
                this.player.id(),
                dst.hasOwner() ? dst.owner().id() : null,
                dst.cell(),
                this.player.troops() / 5,
            ))
            return
        }
        this.sendBoat(tries + 1, oceanShore)
    }

    randomLand(): Tile | null {
        const delta = 25
        let tries = 0
        while (tries < 50) {
            tries++
            const cell = new Cell(
                this.random.nextInt(this.cell.x - delta, this.cell.x + delta),
                this.random.nextInt(this.cell.y - delta, this.cell.y + delta)
            )
            if (!this.mg.isOnMap(cell)) {
                continue
            }
            const tile = this.mg.tile(cell)
            if (tile.isLand() && !tile.hasOwner()) {
                if (tile.terrain() == TerrainType.Mountain && this.random.chance(2)) {
                    continue
                }
                return tile
            }
        }
        return null
    }

    sendAttack(toAttack: Player | TerraNullius) {
        this.mg.addExecution(new AttackExecution(
            this.player.troops() / 5,
            this.player.id(),
            toAttack.isPlayer() ? toAttack.id() : null,
            null,
            null
        ))
    }

    isSmallIsland(tile: Tile): boolean {
        return bfs(tile, and((t) => t.isLand(), dist(tile, 10))).size < 50
    }

    owner(): MutablePlayer {
        return null
    }

    isActive(): boolean {
        return this.active
    }

    activeDuringSpawnPhase(): boolean {
        return true
    }
}