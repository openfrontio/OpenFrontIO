/**
 * "Equip now" across a purchase. A currency purchase reloads the page when it
 * succeeds (purchaseCosmetic), so the Inventory remembers which item was
 * being bought, per tab, before it starts. Whenever the Inventory has the
 * player's ownership (after the reload, or straight away when the purchase
 * broadcast a fresh profile instead) it checks the record: once the item is
 * owned it offers "Equip now" and clears the record. A read where the item
 * isn't owned yet keeps it; it lapses after PENDING_EQUIP_TTL_MS, and one
 * from another account is dropped.
 */
export const PENDING_EQUIP_KEY = "openfront-pending-equip";
export const PENDING_EQUIP_TTL_MS = 10 * 60 * 1000;

interface PendingEquip {
  player: string;
  key: string;
  at: number;
  /** This purchase's own id: two purchases of one item are told apart. */
  id: string;
}

let lastId = 0;

/**
 * Remembers the item and returns this record's id, for
 * clearPendingEquip(id); null when storage is blocked.
 */
export function rememberPendingEquip(
  player: string,
  key: string,
  now: number = Date.now(),
): string | null {
  const id = `${now}:${++lastId}`;
  try {
    sessionStorage.setItem(
      PENDING_EQUIP_KEY,
      JSON.stringify({ player, key, at: now, id } satisfies PendingEquip),
    );
    return id;
  } catch {
    // Storage blocked: "Equip now" then only works without a reload.
    return null;
  }
}

/**
 * The remembered item's key, if the record is this player's and still fresh;
 * a stale or foreign record is dropped. The record itself stays until
 * clearPendingEquip(): a profile read before the purchase has landed (or
 * before the reload) must not lose it.
 */
export function peekPendingEquip(
  player: string,
  now: number = Date.now(),
): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_EQUIP_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingEquip>;
    if (
      parsed.player === player &&
      typeof parsed.key === "string" &&
      typeof parsed.at === "number" &&
      now - parsed.at <= PENDING_EQUIP_TTL_MS
    ) {
      return parsed.key;
    }
  } catch {
    // Unreadable: dropped below.
  }
  clearPendingEquip();
  return null;
}

/**
 * Drops the record. With `id` (from rememberPendingEquip), only that exact
 * record: one purchase ending must not drop the record a later purchase,
 * even of the same item, has written over it.
 */
export function clearPendingEquip(id?: string): void {
  try {
    if (id !== undefined && storedId() !== id) return;
    sessionStorage.removeItem(PENDING_EQUIP_KEY);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

function storedId(): string | undefined {
  const raw = sessionStorage.getItem(PENDING_EQUIP_KEY);
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingEquip>;
    return typeof parsed.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a record is waiting (without taking it). */
export function hasPendingEquip(): boolean {
  try {
    return sessionStorage.getItem(PENDING_EQUIP_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * An end-screen purchase across a Plutonium top-up. "Get Plutonium" on the
 * end screen leaves the game for the Plutonium packs, so the item being
 * bought is remembered per tab first, in the same shape as the record above
 * (player, item key, when), and under its own key. When the top-up brings the
 * player back to the site the Store opens on that item
 * (resumePendingPurchase in Cosmetics.ts). The record is dropped once the
 * item is bought, owned, or older than PENDING_PURCHASE_TTL_MS, and one from
 * another account is dropped.
 */
export const PENDING_PURCHASE_KEY = "openfront-pending-purchase";
// Longer than an equip: a top-up can mean a card form or a payment app.
export const PENDING_PURCHASE_TTL_MS = 30 * 60 * 1000;

export function rememberPendingPurchase(
  player: string,
  key: string,
  now: number = Date.now(),
): void {
  try {
    sessionStorage.setItem(
      PENDING_PURCHASE_KEY,
      JSON.stringify({ player, key, at: now } satisfies Omit<
        PendingEquip,
        "id"
      >),
    );
  } catch {
    // Storage blocked: the Store then opens on the packs only.
  }
}

/** The remembered item's key, if the record is this player's and fresh; a
 * stale or foreign record is dropped. Kept until clearPendingPurchase(). */
export function peekPendingPurchase(
  player: string,
  now: number = Date.now(),
): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_PURCHASE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingEquip>;
    if (
      parsed.player === player &&
      typeof parsed.key === "string" &&
      typeof parsed.at === "number" &&
      now >= parsed.at &&
      now - parsed.at <= PENDING_PURCHASE_TTL_MS
    ) {
      return parsed.key;
    }
  } catch {
    // Unreadable: dropped below.
  }
  clearPendingPurchase();
  return null;
}

export function clearPendingPurchase(): void {
  try {
    sessionStorage.removeItem(PENDING_PURCHASE_KEY);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

/** Whether a top-up record is waiting (without reading whose it is). */
export function hasPendingPurchase(): boolean {
  try {
    return sessionStorage.getItem(PENDING_PURCHASE_KEY) !== null;
  } catch {
    return false;
  }
}
