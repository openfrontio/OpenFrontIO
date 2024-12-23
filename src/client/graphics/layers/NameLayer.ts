import { AllPlayers, Cell, Game, Player, PlayerType, Tick } from "../../../core/game/Game"
import { PseudoRandom } from "../../../core/PseudoRandom"
import { calculateBoundingBox } from "../../../core/Util"
import { Theme } from "../../../core/configuration/Config"
import { Layer } from "./Layer"
import { placeName } from "../NameBoxCalculator"
import { TransformHandler } from "../TransformHandler"
import { renderTroops } from "../../Utils"
import traitorIcon from '../../../../resources/images/TraitorIcon.png';
import allianceIcon from '../../../../resources/images/AllianceIcon.png';
import crownIcon from '../../../../resources/images/CrownIcon.png';
import targetIcon from '../../../../resources/images/TargetIcon.png';
import { ClientID } from "../../../core/Schemas"


class RenderInfo {
    public isVisible = true
    constructor(
        public player: Player,
        public lastRenderCalcTick: Tick,
        public lastBoundingCalculatedTick: Tick,
        public boundingBox: { min: Cell, max: Cell },
        public location: Cell,
        public fontSize: number
    ) { }
}

export class NameLayer implements Layer {

    private lastChecked = 0
    private refreshRate = 1000

    private rand = new PseudoRandom(10)
    private renders: RenderInfo[] = []
    private seenPlayers: Set<Player> = new Set()
    private traitorIconImage: HTMLImageElement;
    private allianceIconImage: HTMLImageElement;
    private targetIconImage: HTMLImageElement;
    private crownIconImage: HTMLImageElement;

    private myPlayer: Player | null = null

    private firstPlace: Player | null = null

    constructor(private game: Game, private theme: Theme, private transformHandler: TransformHandler, private clientID: ClientID) {
        this.traitorIconImage = new Image();
        this.traitorIconImage.src = traitorIcon;

        this.allianceIconImage = new Image()
        this.allianceIconImage.src = allianceIcon

        this.crownIconImage = new Image()
        this.crownIconImage.src = crownIcon

        this.targetIconImage = new Image()
        this.targetIconImage.src = targetIcon
    }

    shouldTransform(): boolean {
        return true
    }

    public init(game: Game) {

    }

    // TODO: remove tick, move this to render
    public tick() {
        const now = Date.now()
        if (now - this.lastChecked > this.refreshRate) {
            this.lastChecked = now

            const sorted = this.game.players().sort((a, b) => b.numTilesOwned() - a.numTilesOwned())
            if (sorted.length > 0) {
                this.firstPlace = sorted[0]
            }

            this.renders = this.renders.filter(r => r.player.isAlive())
            for (const player of this.game.players()) {
                if (player.isAlive()) {
                    if (!this.seenPlayers.has(player)) {
                        this.seenPlayers.add(player)
                        this.renders.push(new RenderInfo(player, 0, 0, null, null, 0))
                    }
                } else {
                    this.seenPlayers.delete(player)
                }
            }
        }
        const currTick = this.game.ticks()
        const recalcRate = this.game.inSpawnPhase() ? 2 : 10
        for (const render of this.renders) {
            const territoryUpdated = render.boundingBox == null || render.player.lastTileChange() > render.lastBoundingCalculatedTick
            if (!territoryUpdated) {
                continue
            }
            if (currTick - render.lastBoundingCalculatedTick > recalcRate) {
                render.lastBoundingCalculatedTick = currTick
                render.boundingBox = calculateBoundingBox(render.player.borderTiles());
            }
            if (render.isVisible && currTick - render.lastRenderCalcTick > recalcRate) {
                render.lastRenderCalcTick = currTick
                this.calculateRenderInfo(render)
            }
        }
    }

    public renderLayer(mainContex: CanvasRenderingContext2D) {
        const [upperLeft, bottomRight] = this.transformHandler.screenBoundingRect()
        for (const render of this.renders) {
            render.isVisible = this.isVisible(render, upperLeft, bottomRight)
            if (render.player.isAlive() && render.isVisible && render.fontSize * this.transformHandler.scale > 10) {
                this.renderPlayerInfo(render, mainContex, this.transformHandler.scale, upperLeft, bottomRight)
            }
        }
    }

    isVisible(render: RenderInfo, min: Cell, max: Cell): boolean {
        if (render.boundingBox == null) {
            return false
        }
        const ratio = (max.x - min.x) / Math.max(20, (render.boundingBox.max.x - render.boundingBox.min.x))
        if (render.player.type() == PlayerType.Bot) {
            if (ratio > 35) {
                return false
            }
        } else {
            if (ratio > 35) {
                return false
            }
        }
        if (render.boundingBox.max.x < min.x || render.boundingBox.max.y < min.y || render.boundingBox.min.x > max.x || render.boundingBox.min.y > max.y) {
            return false
        }
        return true
    }

    calculateRenderInfo(render: RenderInfo) {
        if (render.player.numTilesOwned() == 0) {
            render.fontSize = 0
            return
        }
        const [cell, size] = placeName(this.game, render.player)
        render.location = cell
        render.fontSize = Math.max(1, Math.floor(size))
    }

    renderPlayerInfo(render: RenderInfo, context: CanvasRenderingContext2D, scale: number, uppperLeft: Cell, bottomRight: Cell) {
        const nameCenterX = Math.floor(render.location.x - this.game.width() / 2)
        const nameCenterY = Math.floor(render.location.y - this.game.height() / 2)

        const iconSize = render.fontSize * 2; // Adjust size as needed
        // const iconX = nameCenterX + render.fontSize * 2; // Position to the right of the name
        // const iconY = nameCenterY - render.fontSize / 2;

        if (render.player == this.firstPlace) {
            context.drawImage(
                this.crownIconImage,
                nameCenterX - iconSize / 2,
                nameCenterY - iconSize / 2,
                iconSize,
                iconSize
            );
        }


        if (render.player.isTraitor() && this.traitorIconImage.complete) {
            context.drawImage(
                this.traitorIconImage,
                nameCenterX - iconSize / 2,
                nameCenterY - iconSize / 2,
                iconSize,
                iconSize
            );
        }

        const myPlayer = this.getPlayer()
        if (myPlayer != null && myPlayer.isAlliedWith(render.player)) {
            context.drawImage(
                this.allianceIconImage,
                nameCenterX - iconSize / 2,
                nameCenterY - iconSize / 2,
                iconSize,
                iconSize
            );
        }

        if (myPlayer != null && new Set(myPlayer.transitiveTargets()).has(render.player)) {
            context.drawImage(
                this.targetIconImage,
                nameCenterX - iconSize / 2,
                nameCenterY - iconSize / 2,
                iconSize,
                iconSize
            );
        }


        context.textRendering = "optimizeSpeed";

        context.font = `${render.fontSize}px ${this.theme.font()}`;
        context.fillStyle = this.theme.playerInfoColor(render.player.id()).toHex();
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        context.fillText(render.player.name(), nameCenterX, nameCenterY - render.fontSize / 2);
        context.font = `bold ${render.fontSize}px ${this.theme.font()}`;

        context.fillText(renderTroops(render.player.troops()), nameCenterX, nameCenterY + render.fontSize);


        if (myPlayer != null) {
            const emojis = render.player.outgoingEmojis().filter(e => e.recipient == AllPlayers || e.recipient == myPlayer)
            if (emojis.length > 0) {
                context.font = `${render.fontSize * 4}px ${this.theme.font()}`;
                context.fillStyle = this.theme.playerInfoColor(render.player.id()).toHex();
                context.textAlign = 'center';
                context.textBaseline = 'middle';

                context.fillText(emojis[0].emoji, nameCenterX, nameCenterY + render.fontSize / 2);
            }
        }
    }

    private getPlayer(): Player | null {
        if (this.myPlayer != null) {
            return this.myPlayer
        }
        this.myPlayer = this.game.players().find(p => p.clientID() == this.clientID)
        return this.myPlayer
    }
}
