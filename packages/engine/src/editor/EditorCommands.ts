import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerID,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../game/Game";

/**
 * Applies one scenario editor command (docs/ScenarioEditor.md) through the
 * same game methods play uses, so it makes the usual updates. Checks the
 * whole command first and throws, having changed nothing, if it can't apply.
 */
export function applyEditorCommand(
  game: Game,
  // GameRunner handles export and finalize, which need more than the game.
  command: Exclude<EditorCommand, { type: "export_terrain" | "finalize" }>,
): void {
  switch (command.type) {
    case "add_nation": {
      if (game.hasPlayer(command.id)) {
        throw new Error(`player ${command.id} already exists`);
      }
      const info = new PlayerInfo(
        command.name,
        PlayerType.Nation,
        null,
        command.id,
        false,
        null,
        [],
        null,
        command.flag,
      );
      // Removed nations keep their player (see removeNation). Adding the id
      // again brings that player back, as the editor's undo does, so a view
      // sees the same player return and never a new one under an old id.
      if (game.allPlayers().some((p) => p.id() === command.id)) {
        game.restoreNation(info);
        return;
      }
      // Small ids start at 1 and are never reused (removed nations keep
      // theirs), and a tile stores its owner's in 12 bits.
      if (game.allPlayers().length >= MAX_SMALL_ID) {
        throw new Error(`no player ids left (the limit is ${MAX_SMALL_ID})`);
      }
      game.addNation(info);
      return;
    }
    case "remove_nation":
      game.removeNation(nation(game, command.id));
      return;
    case "set_nation": {
      const n = nation(game, command.id);
      if (command.name !== undefined || command.flag !== undefined) {
        const info = n.info();
        game.setNationInfo(
          n,
          new PlayerInfo(
            command.name ?? info.name,
            info.playerType,
            info.clientID,
            info.id,
            info.isLobbyCreator,
            info.clanTag,
            info.friends,
            info.teamIndex,
            command.flag !== undefined ? command.flag : info.nationFlag,
          ),
        );
      }
      if (command.troops !== undefined) n.setTroops(command.troops);
      if (command.gold !== undefined) n.setGold(BigInt(command.gold));
      if (command.playable !== undefined) n.setPlayable(command.playable);
      return;
    }
    case "set_owner": {
      const owner = command.owner === null ? null : nation(game, command.owner);
      for (const tile of command.tiles) {
        checkTile(game, tile);
        if (owner !== null && (!game.isLand(tile) || game.isImpassable(tile))) {
          throw new Error(`tile ${tile} can't be owned`);
        }
      }
      for (const tile of command.tiles) {
        const previous = game.owner(tile);
        if (previous === (owner ?? game.terraNullius())) continue;
        if (owner !== null) owner.conquer(tile);
        else (previous as Player).relinquish(tile);
      }
      // A structure stands only on its nation's land, as it would in play.
      for (const unit of game.units(Structures.types)) {
        if (game.owner(unit.tile()) !== unit.owner()) unit.delete(false);
      }
      return;
    }
    case "place_structure": {
      const n = nation(game, command.nation);
      checkTile(game, command.tile);
      if (game.owner(command.tile) !== n) {
        throw new Error(`tile ${command.tile} is not ${command.nation}'s`);
      }
      if (command.unit === UnitType.Port && !game.isShore(command.tile)) {
        throw new Error(`a port needs a shore tile, ${command.tile} is not`);
      }
      if (game.config().isUnitDisabled(command.unit)) {
        throw new Error(`${command.unit} is disabled in this game`);
      }
      if (command.level > 1 && !game.unitInfo(command.unit).upgradable) {
        throw new Error(`${command.unit} has no levels`);
      }
      if (structureAt(game, command.tile) !== undefined) {
        throw new Error(`tile ${command.tile} already has a structure`);
      }
      // Built as play builds it, but free: the author sets gold separately.
      const gold = n.gold();
      const unit = n.buildUnit(command.unit, command.tile, {});
      // Each level counts as a construction, as upgrading does in play, so
      // the nation's later builds of this type cost what they would have.
      for (let level = 1; level < command.level; level++) n.upgradeUnit(unit);
      // But it's placed finished: loaded, and a SAM at its full range.
      if (command.level > 1) unit.placeAtLevel(command.level);
      n.setGold(gold);
      return;
    }
    case "remove_structure": {
      checkTile(game, command.tile);
      const unit = structureAt(game, command.tile);
      if (unit === undefined) {
        throw new Error(`tile ${command.tile} has no structure`);
      }
      unit.delete(false);
      return;
    }
    case "place_warship": {
      const n = nation(game, command.nation);
      checkTile(game, command.tile);
      if (!game.isWater(command.tile)) {
        throw new Error(`a warship needs water, tile ${command.tile} is not`);
      }
      if (game.config().isUnitDisabled(UnitType.Warship)) {
        throw new Error(`${UnitType.Warship} is disabled in this game`);
      }
      if (warshipAt(game, command.tile) !== undefined) {
        throw new Error(`tile ${command.tile} already has a warship`);
      }
      // Built as play builds it, but free, and on its tile rather than at a
      // port: it patrols around where the author put it.
      const gold = n.gold();
      n.buildUnit(UnitType.Warship, command.tile, { patrolTile: command.tile });
      n.setGold(gold);
      return;
    }
    case "remove_warship": {
      checkTile(game, command.tile);
      const unit = warshipAt(game, command.tile);
      if (unit === undefined) {
        throw new Error(`tile ${command.tile} has no warship`);
      }
      unit.delete(false);
      return;
    }
    case "add_alliance": {
      const [a, b] = command.nations.map((id) => nation(game, id));
      if (a === b) throw new Error(`${a.id()} can't ally with itself`);
      if (game.config().disableAlliances()) {
        throw new Error("alliances are disabled in this game");
      }
      if (a.isAlliedWith(b)) {
        throw new Error(`${a.id()} and ${b.id()} are already allies`);
      }
      game.createAlliance(a, b);
      return;
    }
    case "remove_alliance": {
      const [a, b] = command.nations.map((id) => nation(game, id));
      const alliance = a.allianceWith(b);
      if (alliance === null) {
        throw new Error(`${a.id()} and ${b.id()} are not allies`);
      }
      game.removeAlliance(alliance);
      return;
    }
    case "set_terrain": {
      if (command.terrain.length !== command.tiles.length) {
        throw new Error(
          `${command.tiles.length} tiles but ${command.terrain.length} terrain values`,
        );
      }
      // The last value given for a tile wins.
      const terrain = new Map<TileRef, number>();
      command.tiles.forEach((tile, i) => {
        checkTile(game, tile);
        terrain.set(tile, command.terrain[i]);
      });
      // What stands on a tile stands on its kind of terrain: a tile that
      // changes between water, land and impassable loses its units (a
      // structure on land, a warship on water) and its owner.
      const kindChanged = new Set<TileRef>();
      for (const [tile, value] of terrain) {
        if (tileKind(game, tile) !== authoredKind(value)) kindChanged.add(tile);
      }
      for (const unit of game.units()) {
        if (kindChanged.has(unit.tile())) unit.delete(false);
      }
      for (const tile of kindChanged) {
        const owner = game.owner(tile);
        if (owner.isPlayer()) owner.relinquish(tile);
      }
      game.setTerrain([...terrain.keys()], [...terrain.values()]);
      // A port needs a shore, which an edit beside it can take away.
      for (const port of game.units(UnitType.Port)) {
        if (!game.isShore(port.tile())) port.delete(false);
      }
      return;
    }
    case "end_terrain_edit":
      game.endTerrainEdit();
      return;
  }
}

type TerrainKind = "water" | "land" | "impassable";

function tileKind(game: Game, tile: TileRef): TerrainKind {
  if (!game.isLand(tile)) return "water";
  return game.isImpassable(tile) ? "impassable" : "land";
}

// See SetTerrainCommandSchema.
function authoredKind(value: number): TerrainKind {
  if (value === 0) return "water";
  return value === 0x9f ? "impassable" : "land";
}

// GameMapImpl's PLAYER_ID_MASK: the largest owner id a tile can store.
const MAX_SMALL_ID = 0xfff;

function nation(game: Game, id: PlayerID): Player {
  const player = game.hasPlayer(id) ? game.player(id) : undefined;
  if (player?.type() !== PlayerType.Nation) {
    throw new Error(`no nation ${id}`);
  }
  return player;
}

function checkTile(game: Game, tile: TileRef): void {
  if (!game.isValidRef(tile)) {
    throw new Error(`tile ${tile} is not on the map`);
  }
}

function structureAt(game: Game, tile: TileRef): Unit | undefined {
  return game.nearbyUnits(tile, 0, Structures.types, undefined, true)[0]?.unit;
}

function warshipAt(game: Game, tile: TileRef): Unit | undefined {
  return game.units(UnitType.Warship).find((u) => u.tile() === tile);
}
