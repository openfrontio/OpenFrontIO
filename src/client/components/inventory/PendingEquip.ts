/**
 * "Equip now" across a purchase. A currency purchase reloads the page when it
 * succeeds (purchaseCosmetic), so the Inventory remembers which item was
 * being bought, per tab, before it starts. When the Inventory next has the
 * player's ownership (after the reload, or straight away when the purchase
 * broadcast a fresh profile instead) it takes the record back: an item now
 * owned gets the "Equip now" offer; anything else is dropped. A record from
 * another account, or older than PENDING_EQUIP_TTL_MS, is dropped too.
 */
export const PENDING_EQUIP_KEY = "openfront-pending-equip";
export const PENDING_EQUIP_TTL_MS = 10 * 60 * 1000;

interface PendingEquip {
  player: string;
  key: string;
  at: number;
}

export function rememberPendingEquip(
  player: string,
  key: string,
  now: number = Date.now(),
): void {
  try {
    sessionStorage.setItem(
      PENDING_EQUIP_KEY,
      JSON.stringify({ player, key, at: now } satisfies PendingEquip),
    );
  } catch {
    // Storage blocked: "Equip now" then only works without a reload.
  }
}

/** Reads and clears the record; the item key, if it is this player's and
 * still fresh. */
export function takePendingEquip(
  player: string,
  now: number = Date.now(),
): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_EQUIP_KEY);
    sessionStorage.removeItem(PENDING_EQUIP_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingEquip>;
    if (
      parsed.player !== player ||
      typeof parsed.key !== "string" ||
      typeof parsed.at !== "number" ||
      now - parsed.at > PENDING_EQUIP_TTL_MS
    ) {
      return null;
    }
    return parsed.key;
  } catch {
    return null;
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
