import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderTroops, translateText } from "../../../client/Utils";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameMode } from "../../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";
import { FogOfWarLayer } from "./FogOfWarLayer";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
  player: PlayerView;
}

export class GoToPlayerEvent implements GameEvent {
  constructor(public player: PlayerView) {}
}

export class GoToPositionEvent implements GameEvent {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export class GoToUnitEvent implements GameEvent {
  constructor(public unit: UnitView) {}
}

// Event to view another player's vision (for eliminated players)
export class ViewPlayerVisionEvent implements GameEvent {
  constructor(public player: PlayerView) {}
}

@customElement("leader-board")
export class Leaderboard extends LitElement implements Layer {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;
  /**
   * Referência à camada de Fog of War para controlar visibilidade no leaderboard
   */
  public fogOfWarLayer: FogOfWarLayer | null = null; // Reference to FogOfWarLayer

  players: Entry[] = [];
  // Track players that have been seen in fog 0 in local mode
  private seenPlayersInLocalMode = new Set<string>();

  @property({ type: Boolean }) visible = false;
  private showTopFive = true;

  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";
  
  // Leaderboard mode: 'local' for visible only, 'global' for all players
  @state()
  private _leaderboardMode: "local" | "global" = "local";
  
  // Track which player's vision is currently being viewed
  private viewingPlayerVision: PlayerView | null = null;

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {
    // Clear the seen players when initializing a new game
    this.seenPlayersInLocalMode.clear();
  }

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this.visible) return;
    if (this.game.ticks() % 10 === 0) {
      this.updateLeaderboard();
    }
  }

  private setSort(key: "tiles" | "gold" | "maxtroops") {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateLeaderboard();
  }
  
  // Check if the player can access the global leaderboard mode
  private canAccessGlobalMode(): boolean {
    // In Fog of War mode, only eliminated players can access global mode
    if (this.game?.config().gameConfig().gameMode === GameMode.FogOfWar) {
      const myPlayer = this.game.myPlayer();
      return myPlayer !== null && !myPlayer.isAlive();
    }
    
    // In other modes, everyone can access global mode
    return true;
  }
  
  // Method to set the player whose vision we want to view
  public setViewingPlayerVision(player: PlayerView | null) {
    // If we have a FogOfWarLayer reference, update it
    if (this.fogOfWarLayer && typeof this.fogOfWarLayer.setObservedPlayer === 'function') {
      this.fogOfWarLayer.setObservedPlayer(player);
    }
    
    // Update our local tracking
    this.viewingPlayerVision = player;
  }
  
  // Method to get the currently viewed player
  public getViewingPlayerVision(): PlayerView | null {
    return this.viewingPlayerVision;
  }

  // Toggle between leaderboard modes
  private toggleLeaderboardMode() {
    // Check if the player can access global mode
    if (this.game?.config().gameConfig().gameMode === GameMode.FogOfWar) {
      if (!this.canAccessGlobalMode() && this._leaderboardMode === "local") {
        // If the player is alive and trying to switch to global mode, don't allow
        return;
      }
    }
    
    if (this.game?.config().gameConfig().gameMode === GameMode.FogOfWar) {
      this._leaderboardMode = this._leaderboardMode === "local" ? "global" : "local";
      this.updateLeaderboard();
    }
  }

  // Check if a player is visible in Fog of War mode
  private isPlayerVisible(player: PlayerView): boolean {
    // If we're not in Fog of War mode, all players are visible
    if (!this.game || this.game.config().gameConfig().gameMode !== GameMode.FogOfWar || !this.fogOfWarLayer) {
      return true;
    }

    // If the player is eliminated, they are not visible in the normal leaderboard
    if (!player.isAlive()) {
      return false;
    }

    // Get the player's position
    const nameLocation = player.nameLocation();
    if (!nameLocation) {
      return false;
    }

    const x = nameLocation.x;
    const y = nameLocation.y;

    // Check if coordinates are valid
    if (x >= 0 && y >= 0 && x < this.game.width() && y < this.game.height()) {
      const idx = y * this.game.width() + x;
      const fogValue = this.fogOfWarLayer.getFogValueAt(idx);

      // Consider visible only if fog is 0 (completely visible area)
      return fogValue === 0;
    }

    return false;
  }

  private updateLeaderboard() {
    if (this.game === null) throw new Error("Not initialized");
    const myPlayer = this.game.myPlayer();

    let sorted = this.game.playerViews();

    const compare = (a: number, b: number) =>
      this._sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);

    switch (this._sortKey) {
      case "gold":
        sorted = sorted.sort((a, b) =>
          compare(Number(a.gold()), Number(b.gold())),
        );
        break;
      case "maxtroops":
        sorted = sorted.sort((a, b) => compare(maxTroops(a), maxTroops(b)));
        break;
      default:
        sorted = sorted.sort((a, b) =>
          compare(a.numTilesOwned(), b.numTilesOwned()),
        );
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    // In Fog of War mode, filter players based on visibility and player state
    let filteredPlayers = sorted;
    if (this.game.config().gameConfig().gameMode === GameMode.FogOfWar) {
      if (this._leaderboardMode === "local") {
        // Local mode: show all players but hide information for non-visible players
        // Always include my player and allies
        filteredPlayers = sorted.filter((player) => {
          // Always show my player
          if (myPlayer && player === myPlayer) {
            return true;
          }
          
          // Always show allies
          if (myPlayer && myPlayer.isAlliedWith(player)) {
            return true;
          }
          
          // For others, check if they are alive and have been seen before
          if (player.isAlive()) {
            // Check if player has been seen in fog 0 before
            if (!this.seenPlayersInLocalMode.has(player.id())) {
              // Only add to seen players if currently visible (fog 0)
              if (this.isPlayerVisible(player)) {
                this.seenPlayersInLocalMode.add(player.id());
                return true;
              }
              return false; // Not visible and not seen before, don't add
            } else {
              // Player has been seen before, always include in local leaderboard
              return true;
            }
          } else {
            // Player is not alive, remove from seen players if they were there
            this.seenPlayersInLocalMode.delete(player.id());
            return false; // Don't show dead players in local leaderboard
          }
        });
      } else {
        // Global mode: check if the current player is eliminated
        const isPlayerEliminated = myPlayer !== null && !myPlayer.isAlive();
        
        // If the current player is eliminated, show all players
        // If the current player is alive, show only visible alive players
        if (isPlayerEliminated) {
          // Eliminated players can see all players in global mode
          filteredPlayers = sorted;
        } else {
          // Alive players can only see visible alive players in global mode
          // But always include my player and allies
          filteredPlayers = sorted.filter((player) => {
            // Always show my player
            if (myPlayer && player === myPlayer) {
              return true;
            }
            
            // Always show allies
            if (myPlayer && myPlayer.isAlliedWith(player)) {
              return true;
            }
            
            // For others, check if they are alive and visible
            return player.isAlive() && this.isPlayerVisible(player);
          });
        }
      }
    }

    const alivePlayers = filteredPlayers.filter((player) => player.isAlive());
    const playersToShow = this.showTopFive
      ? alivePlayers.slice(0, 5)
      : alivePlayers;

    this.players = playersToShow.map((player, index) => {
      
      // In Fog of War local mode, hide player information if not visible
      let playerName = player.displayName();
      let playerScore = formatPercentage(player.numTilesOwned() / numTilesWithoutFallout);
      let playerGold = renderNumber(player.gold());
      const currentPlayerMaxTroops = this.game!.config().maxTroops(player);
      let playerMaxTroops = renderTroops(currentPlayerMaxTroops || 0);
      
      if (this.game && this.game.config().gameConfig().gameMode === GameMode.FogOfWar && 
          this._leaderboardMode === "local" && 
          !this.isPlayerVisible(player) && 
          !(myPlayer && player === myPlayer) && 
          !(myPlayer && myPlayer.isAlliedWith(player))) {
        // Hide information for non-visible players (except my player and allies)
        playerName = "?????";
        playerScore = "?????";
        playerGold = "?????";
        playerMaxTroops = "?????";
      }
      
      return {
        name: playerName,
        position: index + 1,
        score: playerScore,
        gold: playerGold,
        maxTroops: playerMaxTroops,
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        player: player,
      };
    });

    // If it's my player and not in the list, add it
    if (
      myPlayer !== null &&
      this.players.find((p) => p.isMyPlayer) === undefined
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p === myPlayer) {
          break;
        }
      }

      // In Fog of War mode, only add my player if they are visible or if we are in global mode
      // and the player is eliminated
      const isPlayerEliminated = myPlayer !== null && !myPlayer.isAlive();
      const shouldAddMyPlayer = 
        this.game.config().gameConfig().gameMode !== GameMode.FogOfWar || 
        (this._leaderboardMode === "global" && isPlayerEliminated) || 
        this.isPlayerVisible(myPlayer);

      if (myPlayer.isAlive() && shouldAddMyPlayer) {
        const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
        this.players.pop();
        this.players.push({
          name: myPlayer.displayName(),
          position: place,
          score: formatPercentage(
            myPlayer.numTilesOwned() / this.game.numLandTiles(),
          ),
          gold: renderNumber(myPlayer.gold()),
          maxTroops: renderTroops(myPlayerMaxTroops),
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
    }

    this.requestUpdate();
  }

  private handleRowClickPlayer(player: PlayerView) {
    if (this.eventBus === null) return;
    
    // In Fog of War mode, eliminated players can view other players' vision
    if (this.game?.config().gameConfig().gameMode === GameMode.FogOfWar) {
      const myPlayer = this.game.myPlayer();
      
      // In local mode, only allow focus if the player's information is visible (not hidden)
      if (this._leaderboardMode === "local" && 
          !this.isPlayerVisible(player) && 
          !(myPlayer && player === myPlayer) && 
          !(myPlayer && myPlayer.isAlliedWith(player))) {
        // Don't allow focus when information is hidden
        return;
      }
    }
    
    // Comportamento normal para jogadores vivos - apenas foca no jogador
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.visible) {
      return html``;
    }
    
    const isFogOfWarMode = this.game?.config().gameConfig().gameMode === GameMode.FogOfWar;
    const myPlayer = this.game?.myPlayer();
    const isPlayerEliminated = myPlayer !== undefined && myPlayer !== null && !myPlayer.isAlive();
    
    return html`
      <div
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh]  ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        ${isFogOfWarMode ? html`
          <div class="bg-gray-800/70 w-full text-center py-1 text-xs">
            ${this._leaderboardMode === "local" 
              ? translateText("leaderboard.local_mode") 
              : translateText("leaderboard.global_mode")}
            ${isPlayerEliminated ? html` (${translateText("leaderboard.eliminated")})` : ""}
          </div>
        ` : ""}
        
        <div
          class="grid bg-gray-800/70 w-full text-xs md:text-xs lg:text-sm"
          style="grid-template-columns: 30px 100px 70px 55px 105px${isFogOfWarMode && isPlayerEliminated ? ' 20px' : ''};"
        >
          <div class="contents font-bold bg-gray-700/50">
            <div class="py-1 md:py-2 text-center border-b border-slate-500">
              #
            </div>
            <div class="py-1 md:py-2 text-center border-b border-slate-500">
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap"
              @click=${() => this.setSort("tiles")}
            >
              ${translateText("leaderboard.owned")}
              ${this._sortKey === "tiles"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap"
              @click=${() => this.setSort("gold")}
            >
              ${translateText("leaderboard.gold")}
              ${this._sortKey === "gold"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap"
              @click=${() => this.setSort("maxtroops")}
            >
              ${translateText("leaderboard.maxtroops")}
              ${this._sortKey === "maxtroops"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
            ${isFogOfWarMode && isPlayerEliminated ? html`
              <div class="py-1 md:py-2 text-center border-b border-slate-500">
                ${translateText("leaderboard.view")}
              </div>
            ` : ""}
          </div>

          ${repeat(
            this.players,
            (p) => p.player.id(),
            (player) => html`
              <div
                class="contents hover:bg-slate-600/60 ${player.isMyPlayer
                  ? "font-bold"
                  : ""} ${isFogOfWarMode && isPlayerEliminated ? 'cursor-pointer' : 'cursor-pointer'}"
                @click=${(e: Event) => {
                  // Only handle row click for non-eliminated players or when not in Fog of War mode
                  if (!isFogOfWarMode || !isPlayerEliminated) {
                    this.handleRowClickPlayer(player.player);
                  }
                }}
              >
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.position}
                </div>
                <div
                  class="py-1 md:py-2 text-center border-b border-slate-500 truncate cursor-pointer"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.handleRowClickPlayer(player.player);
                  }}
                >
                  ${player.name}
                </div>
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.score}
                </div>
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.gold}
                </div>
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.maxTroops}
                </div>
                ${isFogOfWarMode && isPlayerEliminated ? html`
                  <div class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer"
                       @click=${(e: Event) => {
                         e.stopPropagation();
                         if (this.eventBus) {
                           // In Fog of War mode, eliminated players can view other players' vision
                           if (this.game?.config().gameConfig().gameMode === GameMode.FogOfWar) {
                             const myPlayer = this.game.myPlayer();
                             if (myPlayer && !myPlayer.isAlive()) {
                               // Set the player whose vision we want to view
                               this.setViewingPlayerVision(player.player);
                               // Also emit event for other systems to handle
                               this.eventBus.emit(new ViewPlayerVisionEvent(player.player));
                               
                               // Focus on the player's position on the map
                               const nameLocation = player.player.nameLocation();
                               if (nameLocation) {
                                 this.eventBus.emit(new GoToPositionEvent(nameLocation.x, nameLocation.y));
                               }
                             }
                           }
                         }
                       }}>
                    👁️
                  </div>
                ` : ""}
              </div>
            `,
          )}
        </div>
      </div>

      <div class="flex justify-center gap-2 mt-1">
        <button
          class="px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white"
          @click=${() => {
            this.showTopFive = !this.showTopFive;
            this.updateLeaderboard();
          }}
        >
          ${this.showTopFive ? "+" : "-"}
        </button>
        
        ${isFogOfWarMode && isPlayerEliminated ? html`
          <button
            class="px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white"
            @click=${() => this.toggleLeaderboardMode()}
          >
            ${this._leaderboardMode === "local" 
              ? translateText("leaderboard.switch_to_global") 
              : translateText("leaderboard.switch_to_local")}
          </button>
        ` : ""}
      </div>
    `;
  }
}

function formatPercentage(value: number): string {
  const perc = value * 100;
  if (Number.isNaN(perc)) return "0%";
  return perc.toFixed(1) + "%";
}
