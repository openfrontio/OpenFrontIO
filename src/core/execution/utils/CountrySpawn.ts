/**
 * Country-start mode helpers: taking (or returning) an entire country during
 * the spawn phase. Used by SpawnExecution (humans) and NationExecution
 * (country nations).
 */
import { Game, Player, PlayerType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PlayerExecution } from "../PlayerExecution";

/**
 * Transfer every ownable tile of the country to `player` through the normal
 * conquer() path (deterministic tile order), register its PlayerExecution on
 * first spawn, set its spawn tile and reset its troops to the country-spawn
 * amount. Safe to call for a country partially (or fully) owned by `player`
 * already — self-owned tiles are skipped.
 */
export function conquerCountry(
  mg: Game,
  player: Player,
  countryId: number,
  center: TileRef,
): void {
  const rm = mg.regionMap();
  if (rm === null || !rm.hasCountries()) {
    throw new Error("conquerCountry requires a region map with country data");
  }
  rm.forEachCountryTile(countryId, (tile) => {
    // CSR lists exclude non-ownable tiles at generation time, but land can
    // turn to water later (water nukes) — keep the guard.
    if (!mg.isLand(tile) || mg.isImpassable(tile)) return;
    if (mg.owner(tile) === player) return;
    player.conquer(tile);
  });
  if (!player.hasSpawned()) {
    mg.addExecution(new PlayerExecution(player));
  }
  player.setSpawnTile(center);
  player.setTroops(mg.config().countrySpawnTroops(player));
  // Humans "become" the country they claim: their displayed name turns into
  // the country name for the rest of the game. Nations keep their own name
  // (NationCreation already names them after their country).
  if (player.type() === PlayerType.Human) {
    player.setSpawnCountry(countryId);
  }
}
