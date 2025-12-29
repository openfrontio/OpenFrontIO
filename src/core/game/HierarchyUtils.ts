import { Game, Player, Team } from "./Game";
import { TileRef } from "./GameMap";

// Directional relationship within the vassal hierarchy.
export type HierarchyPosition =
  | "Ancestor" // a is ancestor (overlord chain) of b
  | "Descendant" // a is descendant (vassal chain) of b
  | "Sibling" // share same root but neither ancestor of other
  | "Unrelated";

// Returns the highest ancestor (root) in the vassal tree for a player.
export function rootOf(player: Player): Player {
  let curr: Player = player;
  while (curr.overlord && curr.overlord()) {
    curr = curr.overlord() as Player;
  }
  return curr;
}

// True if `maybeAncestor` is an overlord (direct or indirect) of `target`.
export function isAncestorOf(maybeAncestor: Player, target: Player): boolean {
  let curr: Player | null = target.overlord();
  while (curr) {
    if (curr === maybeAncestor) return true;
    curr = curr.overlord();
  }
  return false;
}

// True if `maybeDescendant` is a vassal (direct or indirect) of `root`.
export function isDescendantOf(
  maybeDescendant: Player,
  root: Player,
): boolean {
  return isAncestorOf(root, maybeDescendant);
}

export function hierarchyPosition(a: Player, b: Player): HierarchyPosition {
  if (isAncestorOf(a, b)) return "Ancestor";
  if (isAncestorOf(b, a)) return "Descendant";
  if (rootOf(a) === rootOf(b)) return "Sibling";
  return "Unrelated";
}

// Players share a hierarchy if they have any of the directional relations.
export function sharesHierarchy(a: Player, b: Player): boolean {
  return hierarchyPosition(a, b) !== "Unrelated";
}

// Count a player's owned tiles plus all of their vassals recursively.
export function hierarchyTiles(player: Player): number {
  let total = player.numTilesOwned();
  const vassals =
    typeof (player as any).vassals === "function" ? player.vassals() : [];
  for (const vassal of vassals ?? []) {
    total += hierarchyTiles(vassal);
  }
  return total;
}

// Only consider root players (no overlord) when attributing vassal territory.
export function rootPlayers(game: Game): Player[] {
  return game
    .players()
    .filter((p) =>
      typeof (p as any).overlord === "function" ? p.overlord() === null : true,
    );
}

// Attribute vassal land to the root overlord's team to avoid double counting.
export function teamHierarchyTiles(game: Game): Map<Team, number> {
  const teamToTiles = new Map<Team, number>();
  for (const root of rootPlayers(game)) {
    const team = root.team();
    if (team === null) continue;
    const tiles = hierarchyTiles(root);
    teamToTiles.set(team, (teamToTiles.get(team) ?? 0) + tiles);
  }
  return teamToTiles;
}

export function hierarchyPlayers(game: Game, player: Player): Player[] {
  return game.players().filter((p) => sharesHierarchy(player, p));
}

export function hierarchyShoreTiles(game: Game, player: Player): TileRef[] {
  const tiles: TileRef[] = [];
  for (const p of hierarchyPlayers(game, player)) {
    for (const t of p.borderTiles()) {
      if (game.isShore(t)) tiles.push(t);
    }
  }
  return tiles;
}
