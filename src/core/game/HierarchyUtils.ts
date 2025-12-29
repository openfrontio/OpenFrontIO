import { Player } from "./Game";

// Directional relationship within the vassal hierarchy.
export type HierarchyRelation =
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

export function hierarchyRelation(a: Player, b: Player): HierarchyRelation {
  if (isAncestorOf(a, b)) return "Ancestor";
  if (isAncestorOf(b, a)) return "Descendant";
  if (rootOf(a) === rootOf(b)) return "Sibling";
  return "Unrelated";
}

// Players share a hierarchy if they have any of the directional relations.
export function sharesHierarchy(a: Player, b: Player): boolean {
  return hierarchyRelation(a, b) !== "Unrelated";
}
