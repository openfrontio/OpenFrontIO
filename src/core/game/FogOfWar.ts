import { Game, Player, UnitType } from "./Game";
import { GameMap, TileRef } from "./GameMap";

/**
 * Classe responsável por gerenciar o sistema de Fog of War (nevoeiro de guerra)
 * no jogo. Controla quais tiles são visíveis para cada jogador.
 */
/**
 * Gerencia o sistema de Fog of War (nevoeiro de guerra) no jogo.
 * Controla quais tiles são visíveis para cada jogador no modo Fog of War.
 */
export class FogOfWarManager {
  private exploredTiles: Map<string, Set<TileRef>> = new Map(); // playerId -> explored tiles
  
  constructor(private game: Game) {}

  /**
   * Inicializa o sistema de Fog of War para todos os jogadores
   */
  public initialize(): void {
    // Para cada jogador, cria um conjunto vazio de tiles explorados
    for (const player of this.game.players()) {
      this.exploredTiles.set(player.id(), new Set<TileRef>());
    }
  }

  /**
   * Marca tiles como explorados para um jogador específico
   * @param player O jogador que explorou os tiles
   * @param tiles Os tiles que foram explorados
   */
  public markAsExplored(player: Player, tiles: Set<TileRef> | TileRef[]): void {
    const playerId = player.id();
    const exploredSet = this.exploredTiles.get(playerId);
    
    if (!exploredSet) {
      console.warn(`No explored tiles set found for player ${playerId}`);
      return;
    }

    // Adiciona todos os tiles ao conjunto de explorados
    for (const tile of tiles) {
      exploredSet.add(tile);
      
      // Also marks the tile as explored on the map (for persistence)
      const gameMap = this.game.map() as GameMap & { 
        setExplored?: (ref: TileRef, value: boolean) => void 
      };
      if (gameMap.setExplored) {
        gameMap.setExplored(tile, true);
      }
    }
  }

  /**
   * Verifica se um tile é visível para um jogador
   * @param player O jogador que está tentando ver o tile
   * @param tile O tile a ser verificado
   * @returns true se o tile é visível, false caso contrário
   */
  public isVisible(player: Player, tile: TileRef): boolean {
    const playerId = player.id();
    const exploredSet = this.exploredTiles.get(playerId);
    
    if (!exploredSet) {
      return false;
    }

    // Verifica se o tile foi explorado
    if (exploredSet.has(tile)) {
      return true;
    }

    // Tiles adjacent to explored tiles are also visible
    const neighbors = this.game.map().neighbors(tile);
    for (const neighbor of neighbors) {
      if (exploredSet.has(neighbor)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Obtém todos os tiles visíveis para um jogador
   * @param player O jogador
   * @returns Conjunto de tiles visíveis
   */
  public getVisibleTiles(player: Player): Set<TileRef> {
    const visibleTiles = new Set<TileRef>();
    const playerId = player.id();
    const exploredSet = this.exploredTiles.get(playerId);
    
    if (!exploredSet) {
      return visibleTiles;
    }

    // Adiciona todos os tiles explorados
    for (const tile of exploredSet) {
      visibleTiles.add(tile);
    }

    // Adiciona tiles adjacentes aos explorados
    const tempSet = new Set<TileRef>();
    for (const tile of exploredSet) {
      const neighbors = this.game.map().neighbors(tile);
      for (const neighbor of neighbors) {
        if (!exploredSet.has(neighbor)) {
          tempSet.add(neighbor);
        }
      }
    }
    
    for (const tile of tempSet) {
      visibleTiles.add(tile);
    }

    return visibleTiles;
  }

  /**
   * Atualiza a visibilidade baseada nas unidades do jogador
   * Deve ser chamado a cada turno
   * @param player O jogador
   */
  public updateVisibility(player: Player): void {
    const visibleTiles = new Set<TileRef>();
    
    // Adds tiles visible by the player's units
    const units = player.units();
    for (const unit of units) {
      const unitTile = unit.tile();
      visibleTiles.add(unitTile);
      
      // Adds adjacent tiles (basic vision range)
      const neighbors = this.game.map().neighbors(unitTile);
      for (const neighbor of neighbors) {
        visibleTiles.add(neighbor);
      }
      
      // Para unidades especiais como navios, pode ter range maior
      if (unit.type() === "Warship" || unit.type() === "Transport") {
        const extendedView = this.game.map().circleSearch(unitTile, 3);
        for (const tile of extendedView) {
          visibleTiles.add(tile);
        }
      }
    }
    
    // Adiciona tiles das cidades do jogador
    const cities = player.units(UnitType.City);
    for (const city of cities) {
      const cityTile = city.tile();
      visibleTiles.add(cityTile);
      
      // Cities have greater vision
      const cityView = this.game.map().circleSearch(cityTile, 2);
      for (const tile of cityView) {
        visibleTiles.add(tile);
      }
    }
    
    // Marca os tiles como explorados
    this.markAsExplored(player, visibleTiles);
  }

  /**
   * Verifica se dois jogadores podem ver tiles uns dos outros
   * @param player1 Primeiro jogador
   * @param player2 Segundo jogador  
   * @returns true se algum tile de um jogador é visível para o outro
   */
  public canSeeEachOther(player1: Player, player2: Player): boolean {
    // Checks if any tile of player2 is visible to player1
    const player2Tiles = player2.tiles();
    for (const tile of player2Tiles) {
      if (this.isVisible(player1, tile)) {
        return true;
      }
    }
    
    // Checks if any tile of player1 is visible to player2
    const player1Tiles = player1.tiles();
    for (const tile of player1Tiles) {
      if (this.isVisible(player2, tile)) {
        return true;
      }
    }
    
    return false;
  }
}