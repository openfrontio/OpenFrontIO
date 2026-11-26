import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import { currentPublicId } from "../../Auth";
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

/** Where these purchases come from, for the Store's attribution. */
const CARD_TAB_PLACEMENT: StorePlacement = {
  kind: "inventory",
  subTab: "card",
};

/** Signed out: the Account page, unless the caller routes it (the
 * Inventory asks about unsaved card changes first). */
const toAccount = () => window.showPage?.("page-account");

// The account whose balance each item's confirm box showed (by item key),
// so the buy is only sent as that account: a sign-in in another tab can
// change the session while the box is open, and purchaseCosmeticInPlace
// then answers signed_out with nothing sent.
const confirmedAs = new Map<string, string | null>();

/** The tap check behind the confirm box. A profile that can't be read is
 * never a dead tap. */
export async function checkCardPurchase(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  signIn: () => void = toAccount,
): Promise<PurchasePreflight> {
  let result = await checkInPlacePurchase(resolved, method);
  // The balance read is another account's than the session's (a profile
  // that answered after a switch): read once more, as the session's.
  if (result.ok && readAsOther(result)) {
    result = await checkInPlacePurchase(resolved, method);
  }
  if (result.ok && readAsOther(result)) {
    confirmedAs.delete(resolved.key);
    void showInGameAlert(translateText("inventory_card.server_unreachable"));
    return { ok: false };
  }
  if (result.ok) {
    // The account the balance is read from; the session's when the
    // session's is unknown for now (a refresh that failed).
    confirmedAs.set(resolved.key, result.publicId ?? currentPublicId());
    return result;
  }
  if (result.reason === "signed_out") {
    signIn();
  } else if (result.reason === "unreachable") {
    void showInGameAlert(translateText("inventory_card.server_unreachable"));
  }
  return result.info ? { ok: false, info: outsideGame(result.info) } : result;
}

/** A balance read from a profile of an account the session is known not to
 * be signed in as. Unknown for now isn't another account. */
function readAsOther(result: { publicId?: string }): boolean {
  const signedInAs = currentPublicId();
  return (
    signedInAs !== null &&
    result.publicId !== undefined &&
    result.publicId !== signedInAs
  );
}

/** Buys from the confirm box. Owned: the broadcast profile shows it.
 * `shownAmount` is the price the box showed: it's sent as the expected
 * amount, so a price raised since is refused (price_changed, with the
 * catalogue reloaded) rather than charged. */
export async function buyCardItem(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  signIn: () => void = toAccount,
  shownAmount?: number,
): Promise<PurchaseResult> {
  // No confirm box (no tap check ran): the account signed in now.
  const signedInAs = confirmedAs.has(resolved.key)
    ? confirmedAs.get(resolved.key)!
    : currentPublicId();
  confirmedAs.delete(resolved.key);
  const outcome = await purchaseCosmeticInPlace(
    resolved,
    method,
    CARD_TAB_PLACEMENT,
    undefined,
    signedInAs,
    shownAmount,
  );
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
    case "unreachable":
      // Signed in, but the profile couldn't be read: nothing was sent.
      await showInGameAlert(translateText("inventory_card.server_unreachable"));
      return;
    case "handled":
      // Already explained with its own message (a wallet in debt).
      return;
    default: {
      // Every outcome has its branch: a new one fails the type check here.
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
