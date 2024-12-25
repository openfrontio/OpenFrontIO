import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Layer } from './Layer';
import { Game, Player, Unit, UnitType } from '../../../core/game/Game';
import { ClientID } from '../../../core/Schemas';
import { EventBus } from '../../../core/EventBus';
import { TransformHandler } from '../TransformHandler';
import { MouseMoveEvent } from '../../InputHandler';
import { euclideanDist, distSortUnit } from '../../../core/Util';
import { renderNumber, renderTroops } from '../../Utils';

@customElement('player-info-overlay')
export class PlayerInfoOverlay extends LitElement implements Layer {
    @property({ type: Object })
    public game!: Game;

    @property({ type: String })
    public clientID!: ClientID;

    @property({ type: Object })
    public eventBus!: EventBus;

    @property({ type: Object })
    public transform!: TransformHandler;

    @state()
    private player: Player | null = null;

    @state()
    private unit: Unit | null = null;

    @state()
    private _isVisible: boolean = false;

    init(game: Game) {
        this.game = game;
        this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) => this.onMouseEvent(e));
    }

    private onMouseEvent(event: MouseMoveEvent) {
        this.setVisible(false);
        this.unit = null;
        this.player = null;

        const worldCoord = this.transform.screenToWorldCoordinates(event.x, event.y);
        if (!this.game.isOnMap(worldCoord)) {
            return;
            return;
        }

        const tile = this.game.tile(worldCoord);
        const owner = tile.owner();

        if (owner.isPlayer()) {
            this.player = owner;
            this.setVisible(true);
        } else if (!tile.isLand()) {
            const units = this.game.units(UnitType.Destroyer, UnitType.Battleship, UnitType.TradeShip)
                .filter(u => euclideanDist(worldCoord, u.tile().cell()) < 50)
                .sort(distSortUnit(tile));

            if (units.length > 0) {
                this.unit = units[0];
                this.setVisible(true);
            }
        }
    }

    private onExitButtonClick() {
        window.location.reload();
    }

    tick() {
        this.requestUpdate()
        // Implementation for Layer interface
    }

    renderLayer(context: CanvasRenderingContext2D) {
        // Implementation for Layer interface
    }

    shouldTransform(): boolean {
        return false;
    }

    setVisible(visible: boolean) {
        this._isVisible = visible;
        this.requestUpdate();
    }

    private myPlayer(): Player | null {
        if (!this.game) {
            return null;
        }
        return this.game.playerByClientID(this.clientID);
    }

    private renderPlayerInfo(player: Player) {
        const isAlly = (this.myPlayer()?.isAlliedWith(player) || player == this.myPlayer()) ?? false;
        return html`
            <div class="info-content">
                <div class="player-name ${isAlly ? 'ally' : ''}">${player.name()}</div>
                <div class="type-label">Troops: ${renderTroops(player.troops())}</div>
                <div class="type-label">Gold: ${renderNumber(player.gold())}</div>
            </div>
        `;
    }

    private renderUnitInfo(unit: Unit) {
        const isAlly = (unit.owner() == this.myPlayer() || this.myPlayer()?.isAlliedWith(unit.owner())) ?? false;
        return html`
        <div class="info-content">
            <div class="player-name ${isAlly ? 'ally' : ''}">${unit.owner().name()}</div>
            <div class="unit-details">
                <div class="type-label">${unit.type()}</div>
                ${unit.hasHealth() ? html`
                    <div class="type-label">Health: ${unit.health()}</div>
                ` : ''}
            </div>
        </div>
    `
    }

    render() {
        return html`
            <div class="container">
                <div class="controls">
                    <button class="exit-button" @click=${this.onExitButtonClick}>×</button>
                </div>
                <div class="player-info ${!this._isVisible ? 'hidden' : ''}">
                    ${this.player != null ? this.renderPlayerInfo(this.player) : ''}
                    ${this.unit != null ? this.renderUnitInfo(this.unit) : ''}
                </div>
            </div>
        `;
    }

    static styles = css`
        :host {
            display: block;
        }

        .container {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
        }

        .controls {
            align-self: flex-end;
            margin-bottom: 4px;
            z-index: 2;
        }

        .player-info {
            background-color: rgba(30, 30, 30, 0.7);
            padding: 8px 12px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(5px);
            transition: opacity 0.3s ease-in-out, visibility 0.3s ease-in-out;
            color: white;
            font-size: 18px;
            min-width: 120px;
            text-align: left;
        }
        .hidden {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }

        .info-content {
            margin-top: 8px;
        }
        .player-name {
            font-weight: bold;
            margin-bottom: 4px;
        }

        .player-name.ally {
            color: #4CAF50;
        }

        .type-label {
            font-size: 14px;
            opacity: 0.8;
        }

        .unit-details {
            margin-top: 4px;
        }

        .health-bar {
            height: 4px;
            background-color: rgba(255, 255, 255, 0.2);
            border-radius: 2px;
            margin-top: 4px;
        }

        .health-fill {
            height: 100%;
            background-color: #4CAF50;
            border-radius: 2px;
            transition: width 0.2s ease-out;
        }

        .exit-button {
            background: none;
            border: none;
            color: white;
            font-size: 40px;
            cursor: pointer;
            padding: 4px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }

        .exit-button:hover {
            opacity: 1;
        }

        @media (max-width: 768px) {
            .container {
                top: 5px;
                right: 5px;
            }
            
            .player-info {
                padding: 6px 10px;
                font-size: 12px;
                min-width: 100px;
            }
            
            .exit-button {
                font-size: 16px;
            }
            
            .type-label {
                font-size: 12px;
            }
        }
    `;
}