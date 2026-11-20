import {
  checkInPlacePurchase,
  type InsufficientCurrency,
  type PurchasePreflight,
  type PurchaseResult,
  purchaseCosmeticInPlace,
  type ResolvedCosmetic,
} from "../../Cosmetics";
import { showInGameAlert } from "../../InGameModal";
import { translateText } from "../../Utils";
import type { CardItem, CardItemType } from "../card/CardItems";

// Buying card items from the Player card tab (the card itself, and items
// in the Save bar). It uses the end screen's in-place purchase: no page
// reload, so the tab and its unsaved changes stay as they are, and the
// fresh profile it broadcasts marks the item owned. The confirm box (with
// the balance after) and the shortfall box come from <purchase-button>.

export function cardResolved(
  type: CardItemType,
  item: CardItem,
  owned = false,
): ResolvedCosmetic {
  return {
    type,
    cosmetic: item,
    colorPalette: null,
    relationship: owned ? "owned" : "purchasable",
    key: `${type}:${item.name}`,
  };
}

// The in-place shortfall warns that a top-up leaves the game; the Inventory
// isn't one, so it gets the plain box. That box still remembers the item
// (it has `itemKey` and `player`), so the Store opens on it once the top-up
// lands, and its `top-up` event lets the Inventory run its unsaved card
// guard before leaving.
function outsideGame(info: InsufficientCurrency): InsufficientCurrency {
  return { ...info, leavesGame: false };
}

/** Signed out: the Account page, unless the caller routes it (the
 * Inventory asks about unsaved card changes first). */
const toAccount = () => window.showPage?.("page-account");

/** The tap check behind the confirm box. A profile that can't be read is
 * never a dead tap. */
export async function checkCardPurchase(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  signIn: () => void = toAccount,
): Promise<PurchasePreflight> {
  const result = await checkInPlacePurchase(resolved, method);
  if (result.ok) return result;
  if (result.reason === "signed_out") {
    signIn();
  } else if (result.reason === "unreachable") {
    void showInGameAlert(translateText("inventory_card.server_unreachable"));
  }
  return result.info ? { ok: false, info: outsideGame(result.info) } : result;
}

/** Buys from the confirm box. Owned: the broadcast profile shows it. */
export async function buyCardItem(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  signIn: () => void = toAccount,
): Promise<PurchaseResult> {
  const outcome = await purchaseCosmeticInPlace(resolved, method, undefined);
  switch (outcome.kind) {
    case "owned":
      if (outcome.notice) await showInGameAlert(outcome.notice);
      return;
    case "insufficient":
      return outsideGame(outcome.info);
    case "signed_out":
      signIn();
      return;
    case "unconfirmed":
      await showInGameAlert(
        translateText("inventory_card.purchase_unconfirmed"),
      );
      return;
    case "failed":
      await showInGameAlert(translateText("inventory_card.purchase_failed"));
      return;
    default:
      return;
  }
}
