import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  Cosmetics,
  Effect,
  effectTypeForSlot,
  Flag,
  isNukeExplosionEffect,
  ownsPlayerCard,
  Skin,
} from "@openfront/shared/CosmeticSchemas";
import type { TemplateResult } from "lit";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { getUserMe } from "./Api";
import { currentPublicId, userAuth } from "./Auth";
import "./components/baseComponents/Button";
import { BaseModal } from "./components/BaseModal";
import {
  cosmeticDisplayName,
  cosmeticSelectionLabel,
} from "./components/CosmeticPresentation";
import "./components/CosmeticPreviewModal";
import "./components/inventory/InventoryBuyDialog";
import { cardChangeLine } from "./components/inventory/CardChangeText";
import { CardEditor } from "./components/inventory/CardDraft";
import "./components/inventory/CardUnsavedDialog";
import type { CardGuardChoice } from "./components/inventory/CardUnsavedDialog";
import "./components/inventory/InventoryCardTab";
import { EFFECT_SLOTS } from "./components/inventory/EffectSlots";
import "./components/inventory/InventoryEffectList";
import type { EffectRow } from "./components/inventory/InventoryEffectList";
import "./components/inventory/InventoryItemTile";
import type { InventoryItemTile } from "./components/inventory/InventoryItemTile";
import "./components/inventory/InventoryYourLook";
import type {
  YourLookEffect,
  YourLookSlot,
} from "./components/inventory/InventoryYourLook";
import {
  compareTiles,
  type ItemState,
  itemStateOf,
} from "./components/inventory/ItemState";
import {
  clearPendingEquip,
  peekPendingEquip,
  rememberPendingEquip,
} from "./components/inventory/PendingEquip";
import "./components/InventoryLoadoutBar";
import type {
  InventoryCategory,
  InventoryLoadoutEntry,
} from "./components/InventoryLoadoutBar";
import "./components/inventory/InventoryLoadoutSelect";
import { ProgressiveList } from "./components/ProgressiveList";
import { modalHeader } from "./components/ui/ModalHeader";
import { signedOutNotice } from "./components/ui/SignedOutNotice";
import {
  fetchCosmetics,
  groupCosmeticVariants,
  invalidateCosmetics,
  purchaseCosmetic,
  purchaseReloading,
  type PurchaseResult,
  refreshStaleCosmetics,
  resolveCosmetics,
  ResolvedCosmetic,
  resolvedToPlayerPattern,
} from "./Cosmetics";
import { COSMETICS_CHANGED } from "./Experiments";
import { modalRouter } from "./ModalRouter";
import { type PricedItem, saleEndsAt } from "./ShownPrice";
import {
  type CosmeticLoadout,
  CROWN_KEY,
  EFFECTS_KEY,
  FLAG_KEY,
  MAX_LOADOUTS,
  normalizedFlagKey,
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "./UserSettings";
import { translateText } from "./Utils";

type OwnershipState = "loading" | "guest" | "loaded" | "error";

/** Which items a grid lists. Owned is the default. */
type OwnershipFilter = "owned" | "all" | "notOwned";

type GridCategory = Exclude<InventoryCategory, "effects">;

/** One tile in a grid: an item (with its colour variants) and its state. */
interface GridEntry {
  resolved: ResolvedCosmetic;
  variants: ResolvedCosmetic[];
  state: ItemState;
  free: boolean;
}

const IN_GAME_TABS: readonly InventoryCategory[] = [
  "skins",
  "flags",
  "crowns",
  "effects",
];
const CARD_TAB = "card";

/** The In game category an item is listed under, for the purchase's
 * StorePlacement. */
function inventoryCategoryOf(item: ResolvedCosmetic): InventoryCategory {
  switch (item.type) {
    case "pattern":
    case "skin":
      return "skins";
    case "flag":
      return "flags";
    case "crown":
      return "crowns";
    default:
      return "effects";
  }
}

function countryFlag(name: string, code: string): Flag {
  return {
    name,
    url: assetUrl(`/flags/${code}.svg`),
    product: null,
    rarity: "common",
    affiliateCode: null,
  };
}

function sameLoadout(a: CosmeticLoadout, b: CosmeticLoadout): boolean {
  const effectsA = Object.entries(a.effects).sort();
  const effectsB = Object.entries(b.effects).sort();
  return (
    a.pattern === b.pattern &&
    // A loadout saved before the country: prefix holds a bare code that
    // getFlag has since migrated in the live look.
    (a.flag === null ? null : normalizedFlagKey(a.flag)) ===
      (b.flag === null ? null : normalizedFlagKey(b.flag)) &&
    a.crown === b.crown &&
    JSON.stringify(effectsA) === JSON.stringify(effectsB)
  );
}

/**
 * The player's Inventory, in two tabs:
 * - In game (`tab=skins|flags|crowns|effects`): "Your look" beside an item
 *   grid. Clicking an owned item equips it at once; an unowned one opens
 *   the preview-and-buy dialog.
 * - Player card (`tab=card`): <inventory-card-tab>.
 */
@customElement("inventory-modal")
export class InventoryModal extends BaseModal {
  protected routerName = "inventory";

  @state() private search = "";
  @state() private isLoading = false;
  @state() private loadFailed = false;
  @state() private ownershipState: OwnershipState = "loading";
  @state() private previewingCosmetic: ResolvedCosmetic | null = null;
  @state() private filter: OwnershipFilter = "owned";
  @state() private openEffectSlot: string | null = null;
  /** The unowned item in the preview-and-buy dialog. */
  @state() private buying: ResolvedCosmetic | null = null;
  /** The dialog's item has been bought: it offers Equip now. */
  @state() private buyingBought = false;
  /** Bumped when shown prices change (a sale ended, a fresh catalogue), so
   * tiles and the buy dialog re-read them. */
  @state() private priceEpoch = 0;
  private saleEndTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the catalogue shown was fetched. */
  private catalogFetchedAt = 0;
  /** The ended sale (its endsAt) a refetch was last made for. */
  private refetchedForSaleEnd: number | null = null;
  /** The phone status line's message ("Hex Grid equipped"). */
  @state() private statusMessage = "";
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  private cosmetics: Cosmetics | null = null;
  /** The Player card tab's changes: kept here so they outlive the tab's
   * element (the body re-renders while a fresh profile loads). */
  private readonly cardEditor = new CardEditor();
  /** The unsaved-changes guard, while it asks. */
  @state() private cardGuard: {
    resolve: (go: boolean) => void;
    saving: boolean;
  } | null = null;
  private userSettings: UserSettings = new UserSettings();
  private userMeResponse: UserMeResponse | false = false;
  private catalogLoad: Promise<Cosmetics | null> | null = null;
  private inventoryLoadId = 0;
  private ownershipLoadId = 0;
  /** The In game category to return to from the Player card tab. */
  private lastInGameTab: InventoryCategory = "skins";
  private resolvedCache:
    | {
        cosmetics: Cosmetics | null;
        userMeResponse: UserMeResponse | false;
        items: ResolvedCosmetic[];
      }
    | undefined;
  private readonly countryFlagTiles = Countries.filter(
    (country) => country.code !== "xx" && country.restricted !== true,
  ).map<ResolvedCosmetic>((country) => ({
    type: "flag",
    cosmetic: countryFlag(country.name, country.code),
    colorPalette: null,
    relationship: "owned",
    key: `country:${country.code}`,
  }));
  protected modalConfig() {
    return {
      showScrollToTop: true,
      hideTabs: true,
      tabs: [
        { key: "skins", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
        { key: "crowns", label: translateText("store.crowns") },
        { key: "effects", label: translateText("store.effects") },
        { key: CARD_TAB, label: translateText("inventory.tab_player_card") },
      ],
    };
  }

  private readonly pages = new ProgressiveList(this);

  private _onCosmeticSelected = () => this.updateFromSettings();

  private _onUserMe = (event: Event) => {
    void this.onUserMe((event as CustomEvent<UserMeResponse | false>).detail);
  };

  /** Signed out, or into another account: the card being edited isn't
   * this session's any more, so its unsaved changes (and an open guard
   * asking about them) go. A profile load already running was fetched for
   * the old session: it's discarded, and the new session's /users/@me
   * (Main broadcasts it) loads the Inventory again. */
  private onSessionChange = () => {
    this.ownershipLoadId++;
    // The profile held is the old session's: nothing reads it as the new
    // one's until that one's arrives.
    this.userMeResponse = false;
    this.ownershipState = "loading";
    if (this.cardGuard !== null) {
      this.cardGuard.resolve(false);
      this.cardGuard = null;
    }
    this.cardEditor.dropAccount();
  };

  private onOpenCosmeticPreview = (event: Event) => {
    const customEvent = event as CustomEvent<ResolvedCosmetic>;
    this.previewingCosmetic = customEvent.detail;
  };

  // Bumped on each COSMETICS_CHANGED, so a load or refresh that was out
  // across one knows its answer is older (loadInventory, refreshCatalog).
  private catalogChangeSeq = 0;
  // The last catalogue COSMETICS_CHANGED announced: what a load that was out
  // across it installs instead of its own, older answer.
  private announcedCosmetics: Cosmetics | null = null;

  /** A new catalogue is in use (a store-experiment group changed, or a
   * price_changed refusal reloaded it): show its prices, as the Store does,
   * so a retry sends the price now and doesn't loop on the 409. */
  private onCosmeticsChanged = (e: Event): void => {
    const cosmetics = (e as CustomEvent<Cosmetics | null>).detail;
    if (!cosmetics) return;
    // Counted even with no catalogue shown yet: a first load still out
    // takes this one rather than its own.
    this.catalogChangeSeq++;
    this.announcedCosmetics = cosmetics;
    if (this.cosmetics === null) return;
    this.cosmetics = cosmetics;
    this.catalogFetchedAt = Date.now();
    this.priceEpoch++;
    this.closeBuyIfGone();
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this._onUserMe);
    // Capture on window: heard before any listener on document, so a load
    // the change itself starts (Main re-broadcasts the signed-out profile
    // from its own session-cleared listener) comes after the bump below and
    // is never discarded by it.
    window.addEventListener("session-reauth", this.onSessionChange, {
      capture: true,
    });
    window.addEventListener("session-cleared", this.onSessionChange, {
      capture: true,
    });
    document.addEventListener(COSMETICS_CHANGED, this.onCosmeticsChanged);
    this.addEventListener("open-cosmetic-preview", this.onOpenCosmeticPreview);
    for (const key of [PATTERN_KEY, FLAG_KEY, CROWN_KEY, EFFECTS_KEY]) {
      window.addEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        this._onCosmeticSelected,
      );
    }
  }

  disconnectedCallback() {
    this.clearSaleEndTimer();
    this.clearStatus();
    this.removeEventListener(
      "open-cosmetic-preview",
      this.onOpenCosmeticPreview,
    );
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this._onUserMe);
    window.removeEventListener("session-reauth", this.onSessionChange, {
      capture: true,
    });
    window.removeEventListener("session-cleared", this.onSessionChange, {
      capture: true,
    });
    document.removeEventListener(COSMETICS_CHANGED, this.onCosmeticsChanged);
    for (const key of [PATTERN_KEY, FLAG_KEY, CROWN_KEY, EFFECTS_KEY]) {
      window.removeEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        this._onCosmeticSelected,
      );
    }
  }

  private updateFromSettings(): void {
    this.requestUpdate();
  }

  private async loadOwnership(
    userMeResponse?: UserMeResponse | false,
  ): Promise<void> {
    const loadId = ++this.ownershipLoadId;
    if (userMeResponse !== undefined && userMeResponse !== false) {
      this.userMeResponse = userMeResponse;
      this.ownershipState = "loaded";
      return;
    }

    try {
      const auth = await userAuth();
      if (loadId !== this.ownershipLoadId) return;
      if (auth === false) {
        this.userMeResponse = false;
        this.ownershipState = "guest";
        return;
      }

      const response = userMeResponse === false ? false : await getUserMe();
      if (loadId !== this.ownershipLoadId) return;
      if (response === false) {
        this.userMeResponse = false;
        this.ownershipState = "error";
        return;
      }

      this.userMeResponse = response;
      this.ownershipState = "loaded";
    } catch {
      if (loadId !== this.ownershipLoadId) return;
      this.userMeResponse = false;
      this.ownershipState = "error";
    }
  }

  private loadCatalog(): Promise<Cosmetics | null> {
    if (this.catalogLoad !== null) return this.catalogLoad;
    const request = Promise.resolve(fetchCosmetics());
    const guarded = request.finally(() => {
      if (this.catalogLoad === guarded) this.catalogLoad = null;
    });
    this.catalogLoad = guarded;
    return guarded;
  }

  private async loadInventory(
    userMeResponse?: UserMeResponse | false,
  ): Promise<void> {
    const loadId = ++this.inventoryLoadId;
    // A first load, or a sign-out (userMeResponse false), shows the loading
    // state: the old account's items mustn't stay live while userAuth()
    // checks. A refresh (the /users/@me a card save broadcasts) updates in
    // place: the skeleton would unmount the Player card tab and lose its
    // slot and Reset.
    const refresh = !(
      this.cosmetics === null ||
      this.ownershipState !== "loaded" ||
      userMeResponse === false
    );
    if (!refresh) {
      this.isLoading = true;
      this.ownershipState = "loading";
    }
    this.loadFailed = false;
    const seq = this.catalogChangeSeq;
    try {
      const [loaded] = await Promise.all([
        this.loadCatalog(),
        this.loadOwnership(userMeResponse),
      ]);
      if (loadId !== this.inventoryLoadId) return;
      // A catalogue announced while this load was out is newer than its
      // answer (a group's, say, over the plain one): install that instead.
      const cosmetics =
        seq !== this.catalogChangeSeq && this.announcedCosmetics !== null
          ? this.announcedCosmetics
          : loaded;
      // A refresh whose fetch failed keeps the catalogue already shown, as
      // refreshCatalog does: the error view would unmount the Player card
      // tab. A first load or a sign-out has none to keep.
      if (cosmetics === null && refresh && this.cosmetics !== null) return;
      this.cosmetics = cosmetics;
      if (cosmetics !== null) this.catalogFetchedAt = Date.now();
      this.loadFailed = cosmetics === null;
    } catch {
      if (loadId !== this.inventoryLoadId) return;
      // A refresh that threw keeps what's shown too, as the null path does.
      if (refresh && this.cosmetics !== null) return;
      this.cosmetics = null;
      this.loadFailed = true;
      if (this.ownershipState === "loading") this.ownershipState = "error";
    } finally {
      if (loadId === this.inventoryLoadId) {
        this.isLoading = false;
        this.resumePendingEquip();
        this.updateFromSettings();
      }
    }
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    // A profile of an account the session is known not to be signed in as
    // (one that answered after a switch) is never shown, in place or as a
    // load. An account unknown for now (a token refresh failed), or a
    // profile that names none, isn't another account: that profile is
    // taken as before.
    if (userMeResponse !== false) {
      const signedInAs = currentPublicId();
      const readAs = userMeResponse.player.publicId;
      if (
        signedInAs !== null &&
        readAs !== undefined &&
        readAs !== signedInAs
      ) {
        return;
      }
    }
    // A fresh profile while the Inventory shows a loaded one (a purchase made
    // in place broadcasts one): take it as it is, without the loading state,
    // so the Player card tab and its unsaved changes stay on screen.
    if (
      userMeResponse !== false &&
      this.isModalOpen &&
      !this.isLoading &&
      this.ownershipState === "loaded" &&
      this.cosmetics !== null
    ) {
      this.inventoryLoadId++;
      this.ownershipLoadId++;
      this.userMeResponse = userMeResponse;
      this.resumePendingEquip();
      this.updateFromSettings();
      return;
    }
    await this.loadInventory(userMeResponse);
  }

  /**
   * After a purchase: the item being bought (remembered across the page
   * reload a purchase does) gets the Equip now offer once it shows as owned.
   */
  private resumePendingEquip(): void {
    // Only while open: a closed Inventory is still mounted (prefetched), and
    // a dialog there would take over Tab and Escape on whatever page shows.
    // onOpen tries again.
    if (!this.isModalOpen) return;
    if (this.ownershipState !== "loaded" || this.userMeResponse === false) {
      return;
    }
    if (this.cosmetics === null) return;
    const key = peekPendingEquip(this.userMeResponse.player.publicId);
    if (key === null) return;
    const owned = this.resolvedItems().find(
      (item) => item.key === key && item.relationship === "owned",
    );
    // Not owned yet: the purchase may still be landing. Keep the record.
    if (owned === undefined) return;
    clearPendingEquip();
    this.buying = owned;
    this.buyingBought = true;
  }

  private includedInSearch(name: string): boolean {
    const displayName = name.replace(/_/g, " ");
    return displayName.toLowerCase().includes(this.search.toLowerCase());
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private resolvedItems(): ResolvedCosmetic[] {
    if (
      this.resolvedCache?.cosmetics === this.cosmetics &&
      this.resolvedCache.userMeResponse === this.userMeResponse
    ) {
      return this.resolvedCache.items;
    }
    const items = resolveCosmetics(this.cosmetics, this.userMeResponse, null);
    this.resolvedCache = {
      cosmetics: this.cosmetics,
      userMeResponse: this.userMeResponse,
      items,
    };
    return items;
  }

  private equippedSkin(): ResolvedCosmetic | null {
    const items = this.resolvedItems();
    const skinName = this.userSettings.getSelectedSkinName();
    if (skinName !== null) {
      return (
        items.find(
          (item) =>
            item.type === "skin" &&
            item.relationship === "owned" &&
            item.cosmetic?.name === skinName,
        ) ?? null
      );
    }
    const pattern = this.userSettings.getSelectedPatternName(this.cosmetics);
    if (pattern === null) return null;
    return (
      items.find(
        (item) =>
          item.type === "pattern" &&
          item.relationship === "owned" &&
          item.cosmetic?.name === pattern.name &&
          (item.colorPalette?.name ?? null) ===
            (pattern.colorPalette?.name ?? null),
      ) ?? null
    );
  }

  private equippedFlag(): ResolvedCosmetic | null {
    const selectedFlag = this.userSettings.getFlag();
    if (selectedFlag === null) return null;
    return (
      this.resolvedItems().find(
        (item) =>
          item.type === "flag" &&
          item.relationship === "owned" &&
          item.key === selectedFlag,
      ) ??
      this.countryFlagTiles.find((item) => item.key === selectedFlag) ??
      null
    );
  }

  private equippedCrown(): ResolvedCosmetic | null {
    const selectedCrown = this.userSettings.getSelectedCrownName();
    if (selectedCrown === null) return null;
    return (
      this.resolvedItems().find(
        (item) =>
          item.type === "crown" &&
          item.relationship === "owned" &&
          item.cosmetic?.name === selectedCrown,
      ) ?? null
    );
  }

  private effectSlotFor(item: ResolvedCosmetic): string | null {
    if (item.type !== "effect" || item.cosmetic === null) return null;
    const effect = item.cosmetic as Effect;
    if (isNukeExplosionEffect(effect)) return effect.attributes.nukeType;
    return item.effectType ?? null;
  }

  private equippedEffects(): ResolvedCosmetic[] {
    const selected = this.userSettings.getSelectedEffects();
    return this.resolvedItems().filter(
      (item) =>
        item.type === "effect" &&
        item.relationship === "owned" &&
        item.cosmetic !== null &&
        this.effectSlotFor(item) !== null &&
        selected[this.effectSlotFor(item)!] === item.cosmetic.name,
    );
  }

  private equippedEffectIn(slot: string): ResolvedCosmetic | null {
    return (
      this.equippedEffects().find(
        (item) => this.effectSlotFor(item) === slot,
      ) ?? null
    );
  }

  private loadoutEntries(): InventoryLoadoutEntry[] {
    const effects = this.equippedEffects();
    return [
      ...this.lookSlots().map(({ category, label, item }) => ({
        category,
        label,
        items: item ? [item] : [],
        summary: item ? cosmeticDisplayName(item) : "",
      })),
      {
        category: "effects",
        label: translateText("store.effects"),
        items: effects,
        summary: translateText("inventory.showing_effects", {
          count: effects.length,
        }),
      },
    ];
  }

  private lookSlots(): YourLookSlot[] {
    return [
      {
        category: "skins",
        label: translateText("inventory.slot_skin"),
        item:
          this.equippedSkin() ??
          this.resolvedItems().find((item) => item.key === "pattern:default") ??
          null,
      },
      {
        category: "flags",
        label: translateText("inventory.slot_flag"),
        item: this.equippedFlag(),
      },
      {
        category: "crowns",
        label: translateText("inventory.slot_crown"),
        item: this.equippedCrown(),
      },
    ];
  }

  private lookEffects(): YourLookEffect[] {
    return EFFECT_SLOTS.map((slot) => ({
      slot,
      item: this.equippedEffectIn(slot),
    }));
  }

  /** Slot buttons read as a numbered row, so keep them in slot order. */
  private loadoutNames(): string[] {
    return this.userSettings
      .getLoadouts()
      .map((loadout) => loadout.name)
      .sort();
  }

  private hasEquippedCosmetic(): boolean {
    const current = this.userSettings.captureLoadout("");
    return (
      current.pattern !== null ||
      current.flag !== null ||
      current.crown !== null ||
      Object.keys(current.effects).length > 0
    );
  }

  /** The active loadout's name when the current look differs from it. */
  private editedLoadout(): string | null {
    const active = this.userSettings.getActiveLoadout();
    if (active === null) return null;
    const saved = this.userSettings.getLoadout(active);
    if (saved === null) return null;
    return sameLoadout(saved, this.userSettings.captureLoadout(active))
      ? null
      : active;
  }

  private renderLoadoutArea(): TemplateResult {
    const names = this.loadoutNames();
    const edited = this.editedLoadout();
    return html`<section
      data-inventory-loadout-area
      class="flex flex-col gap-2"
    >
      <h3
        class="px-1 text-xs font-black uppercase tracking-wider text-white/60"
      >
        ${translateText("inventory.loadout_heading")}
        <span class="font-semibold normal-case tracking-normal text-white/40"
          >· ${translateText("inventory.loadout_on_device")}</span
        >
      </h3>
      <inventory-loadout-select
        .names=${names}
        .active=${this.userSettings.getActiveLoadout() ?? ""}
        .edited=${edited !== null}
        .canAdd=${names.length < MAX_LOADOUTS}
        .canUnequip=${this.hasEquippedCosmetic()}
        .onSelect=${(name: string) => this.applyLoadout(name)}
        .onAdd=${() => this.addLoadout()}
        .onUpdate=${(name: string) => this.updateLoadout(name)}
        .onDelete=${(name: string) => this.deleteLoadout(name)}
        .onUnequipAll=${() => this.unequipAll()}
      ></inventory-loadout-select>
    </section>`;
  }

  private applyLoadout(name: string) {
    // Equipping doesn't save into the active loadout, so applying it again
    // would throw away the unsaved ("edited") look. The native select never
    // re-picks its chosen option; this keeps any later UI from doing so.
    if (this.userSettings.getActiveLoadout() === name) return;
    if (!this.userSettings.applyLoadout(name)) return;
    this.showMessage(translateText("inventory.loadout_applied", { name }));
    this.updateFromSettings();
  }

  private addLoadout() {
    const added = this.userSettings.addLoadout();
    if (added === null) {
      this.showMessage(
        translateText("inventory.loadout_limit", { count: MAX_LOADOUTS }),
      );
      return;
    }
    this.showMessage(
      translateText("inventory.loadout_saved", { name: added.name }),
    );
    this.updateFromSettings();
  }

  private updateLoadout(name: string) {
    this.userSettings.saveLoadout(name);
    this.showMessage(translateText("inventory.loadout_saved", { name }));
    this.updateFromSettings();
  }

  private deleteLoadout(name: string) {
    this.userSettings.deleteLoadout(name);
    this.showMessage(translateText("inventory.loadout_deleted", { name }));
    this.updateFromSettings();
  }

  private unequipAll() {
    this.userSettings.unequipAll();
    this.showMessage(translateText("inventory.unequipped_all"));
    this.updateFromSettings();
  }

  // ---- Grid entries ------------------------------------------------------

  private equippedKeyFor(category: GridCategory): string | null {
    switch (category) {
      case "skins":
        return this.equippedSkin()?.key ?? "pattern:default";
      case "flags":
        return this.equippedFlag()?.key ?? null;
      case "crowns":
        return this.equippedCrown()?.key ?? null;
    }
  }

  private itemsFor(category: GridCategory | { slot: string }) {
    const items = this.resolvedItems();
    if (typeof category === "object") {
      const effectType = effectTypeForSlot(category.slot);
      return items.filter(
        (item) =>
          item.type === "effect" &&
          item.cosmetic !== null &&
          item.effectType === effectType &&
          this.effectSlotFor(item) === category.slot,
      );
    }
    switch (category) {
      case "skins":
        return items.filter(
          (item) => item.type === "pattern" || item.type === "skin",
        );
      case "flags":
        return items.filter((item) => item.type === "flag");
      case "crowns":
        return items.filter((item) => item.type === "crown");
    }
  }

  private matchesFilter(state: ItemState): boolean {
    switch (this.filter) {
      case "owned":
        return state === "equipped" || state === "owned";
      case "notOwned":
        return state === "forSale" || state === "earned";
      case "all":
        return true;
    }
  }

  private matchesSearch(item: ResolvedCosmetic): boolean {
    if (this.search === "") return true;
    if (item.cosmetic === null) return false;
    if (item.key.startsWith("country:")) {
      return (
        this.includedInSearch(item.cosmetic.name) ||
        this.includedInSearch(item.key.slice("country:".length))
      );
    }
    return (
      this.includedInSearch(item.cosmetic.name) ||
      this.includedInSearch(cosmeticDisplayName(item))
    );
  }

  /** The tiles of one grid, filtered, searched and sorted. */
  private gridEntries(category: GridCategory | { slot: string }): GridEntry[] {
    const equippedKey =
      typeof category === "object"
        ? (this.equippedEffectIn(category.slot)?.key ?? null)
        : this.equippedKeyFor(category);
    const states = new Map<ResolvedCosmetic, ItemState>();
    for (const item of this.itemsFor(category)) {
      const state = itemStateOf(item, item.key === equippedKey);
      if (state !== null) states.set(item, state);
    }
    const visible = [...states.keys()].filter(
      (item) =>
        this.matchesFilter(states.get(item)!) && this.matchesSearch(item),
    );
    // Colour variants share one tile, apart from owned and unowned ones.
    const owned = visible.filter((item) => item.relationship === "owned");
    const unowned = visible.filter((item) => item.relationship !== "owned");
    const entries: GridEntry[] = [owned, unowned].flatMap((group) =>
      groupCosmeticVariants(group).map((variants) => {
        const equipped = variants.find((item) => item.key === equippedKey);
        const resolved = equipped ?? variants[0];
        return {
          resolved,
          variants,
          state: equipped ? "equipped" : states.get(resolved)!,
          free: false,
        };
      }),
    );
    entries.sort(compareTiles);
    if (category === "flags" && this.filter !== "notOwned") {
      // Country flags are free for everyone, signed in or not; they follow
      // the catalogue's flags.
      for (const flag of this.countryFlagTiles) {
        if (!this.matchesSearch(flag)) continue;
        entries.push({
          resolved: flag,
          variants: [flag],
          state: flag.key === equippedKey ? "equipped" : "owned",
          free: true,
        });
      }
      entries.sort(compareTiles);
    }
    return entries;
  }

  /** Owned items in a grid, counted as its tiles are (a pattern's colours
   * share one tile). */
  private ownedCount(category: GridCategory | { slot: string }): number {
    return groupCosmeticVariants(
      this.itemsFor(category).filter(
        (item) => item.relationship === "owned" && item.cosmetic !== null,
      ),
    ).length;
  }

  // ---- Rendering ---------------------------------------------------------

  private categoryWord(category: InventoryCategory): string {
    return translateText(`inventory.category_word.${category}`);
  }

  private renderTile(entry: GridEntry, slot?: string): TemplateResult {
    return html`<inventory-item-tile
      .priceEpoch=${this.priceEpoch}
      .resolved=${entry.resolved}
      .variants=${entry.variants}
      .activeVariantKey=${entry.resolved.key}
      .state=${entry.state}
      .free=${entry.free}
      .onActivate=${(item: ResolvedCosmetic) =>
        this.activate(item, entry.state, slot)}
      .onVariantActivate=${(item: ResolvedCosmetic) =>
        this.activate(
          item,
          entry.state === "equipped" ? "owned" : entry.state,
          slot,
        )}
    ></inventory-item-tile>`;
  }

  private renderStoreTile(category: InventoryCategory): TemplateResult {
    return html`<button
      type="button"
      data-inventory-store-tile
      class="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 p-4 text-center text-sm font-bold text-sky-300 hover:border-white/40 hover:bg-white/5"
      @click=${() => this.openStore()}
    >
      <span
        >${translateText("inventory.store_tile", {
          category: this.categoryWord(category),
        })}</span
      >
      <span aria-hidden="true">→</span>
    </button>`;
  }

  private renderBrowseStore(): TemplateResult {
    return html`<button
      type="button"
      data-inventory-browse-store
      class="min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-bold text-white hover:bg-white/10"
      @click=${() => this.openStore()}
    >
      ${translateText("inventory.browse_store")}
    </button>`;
  }

  /** What to say above a grid with nothing (or only the default) in it. */
  private renderEmpty(
    category: InventoryCategory,
    entries: readonly GridEntry[],
    ownsAny: boolean,
  ): TemplateResult | typeof nothing {
    if (this.filter === "owned" && !ownsAny && this.search === "") {
      if (category === "skins") {
        return html`<div
          data-inventory-empty="nothing"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
        >
          <p class="text-sm text-white/70">
            ${translateText("inventory.no_owned_skins")}
          </p>
          ${this.renderBrowseStore()}
        </div>`;
      }
      return html`<div
        data-inventory-empty="filter"
        class="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 text-center"
      >
        <p class="text-sm text-white/70">
          ${translateText(`inventory.empty_owned_${category}`)}
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            data-inventory-show-all
            class="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500"
            @click=${() => this.setFilter("all")}
          >
            ${translateText(`inventory.show_all_${category}`)}
          </button>
          ${this.renderBrowseStore()}
        </div>
      </div>`;
    }
    if (entries.length > 0) return nothing;
    return html`<div
      data-inventory-empty="filter"
      class="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6 text-center"
    >
      <p class="text-sm text-white/70">
        ${translateText(
          this.search !== ""
            ? "inventory.no_search_results"
            : "inventory.empty_not_owned",
        )}
      </p>
      ${this.renderBrowseStore()}
    </div>`;
  }

  private renderGrid(
    category: InventoryCategory,
    target: GridCategory | { slot: string },
  ): TemplateResult {
    const entries = this.gridEntries(target);
    const slot = typeof target === "object" ? target.slot : undefined;
    const pageKey = `${this.search}|${this.filter}`;
    const page = this.pages.page(
      `inventory-${slot ?? category}`,
      pageKey,
      entries,
    );
    return html`
      ${this.renderEmpty(
        category,
        entries,
        // Everyone has the country flags.
        category === "flags" || this.ownedCount(target) > 0,
      )}
      <div
        data-inventory-grid=${slot ?? category}
        class="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]"
      >
        ${page.items.map((entry) => this.renderTile(entry, slot))} ${page.more}
        ${
          // An empty grid's notice already links to the Store.
          entries.length > 0 ? this.renderStoreTile(category) : nothing
        }
      </div>
    `;
  }

  private renderFilters(): TemplateResult {
    const filters: Array<[OwnershipFilter, string]> = [
      ["owned", "inventory.filter_owned"],
      ["all", "inventory.filter_all"],
      ["notOwned", "inventory.filter_not_owned"],
    ];
    return html`<div
      role="group"
      aria-label=${translateText("inventory.filter_label")}
      class="flex rounded-lg border border-white/10 bg-black/30 p-0.5"
    >
      ${filters.map(
        ([key, label]) =>
          html`<button
            type="button"
            data-inventory-filter=${key}
            aria-pressed=${this.filter === key ? "true" : "false"}
            class="min-h-11 rounded-md px-3 text-xs font-bold transition-colors ${
              this.filter === key
                ? "bg-blue-600/80 text-white"
                : "text-white/70 hover:text-white"
            }"
            @click=${() => this.setFilter(key)}
          >
            ${translateText(label)}
          </button>`,
      )}
    </div>`;
  }

  private renderSearch(): TemplateResult {
    return html`<input
      data-inventory-search
      type="search"
      class="order-last min-h-11 w-full min-w-0 basis-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white placeholder-white/40 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      placeholder=${translateText("inventory.search_owned")}
      aria-label=${translateText("inventory.search_owned")}
      .value=${this.search}
      @input=${this.handleSearch}
      @change=${this.handleSearch}
    />`;
  }

  private renderUseDefault(
    isDefault: boolean,
    onUse: () => void,
  ): TemplateResult {
    return html`<button
      type="button"
      data-inventory-use-default
      ?disabled=${isDefault}
      class="min-h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-bold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      @click=${onUse}
    >
      ${translateText("inventory.use_default")}
    </button>`;
  }

  private renderCategory(category: GridCategory): TemplateResult {
    const equipped =
      category === "skins"
        ? this.equippedSkin()
        : category === "flags"
          ? this.equippedFlag()
          : this.equippedCrown();
    return html`<div class="flex flex-col">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-black uppercase tracking-wider text-white">
          ${translateText(
            category === "skins" ? "store.patterns" : `store.${category}`,
          )}
        </h2>
        <span data-inventory-owned-count class="text-sm text-white/50"
          >${translateText("inventory.owned_count", {
            count: this.ownedCount(category),
          })}</span
        >
        ${
          equipped
            ? html`<span
                data-inventory-equipped-chip
                class="flex min-h-7 items-center gap-1 rounded-md border border-blue-400/50 bg-blue-500/15 px-2 text-xs font-bold text-white"
                ><span aria-hidden="true">✓</span>${translateText(
                  "inventory.item_equipped",
                  { name: cosmeticSelectionLabel(equipped) },
                )}</span
              >`
            : nothing
        }
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        ${this.renderFilters()} ${this.renderSearch()}
        ${this.renderUseDefault(equipped === null, () =>
          this.useDefault(category),
        )}
      </div>
      ${this.renderGrid(category, category)}
    </div>`;
  }

  private effectRows(): EffectRow[] {
    return EFFECT_SLOTS.map((slot) => ({
      slot,
      item: this.equippedEffectIn(slot),
      ownedCount: this.ownedCount({ slot }),
    }));
  }

  private renderEffects(): TemplateResult {
    return html`<div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-black uppercase tracking-wider text-white">
          ${translateText("store.effects")}
        </h2>
        <span class="text-sm text-white/50"
          >${translateText("inventory.effects_heading", {
            count: EFFECT_SLOTS.length,
          })}</span
        >
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${this.renderFilters()} ${this.renderSearch()}
      </div>
      <inventory-effect-list
        .rows=${this.effectRows()}
        .openSlot=${this.openEffectSlot}
        .onToggle=${(slot: string) => {
          this.openEffectSlot = this.openEffectSlot === slot ? null : slot;
        }}
        .renderGrid=${(slot: string) => html`
          <div class="flex justify-end pt-1">
            ${this.renderUseDefault(this.equippedEffectIn(slot) === null, () =>
              this.useDefaultEffect(slot),
            )}
          </div>
          ${this.renderGrid("effects", { slot })}
        `}
      ></inventory-effect-list>
    </div>`;
  }

  private cardThumbnail(): string | null {
    if (this.userMeResponse === false) return null;
    const player = this.userMeResponse.player;
    if (!ownsPlayerCard(player.flares ?? [])) return null;
    // What the Player card tab last saved, else what the profile says.
    const background = this.cardEditor.isSeededWith(this.userMeResponse)
      ? this.cardEditor.saved.background
      : player.card?.background;
    if (!background) return null;
    return this.cosmetics?.cardBackgrounds?.[background]?.url ?? null;
  }

  /** The in-game flag, for the card: its image path and its name. */
  private cardFlag(): { path: string | undefined; name: string | null } {
    const flag = this.equippedFlag();
    if (flag === null || flag.cosmetic === null) {
      return { path: undefined, name: null };
    }
    const path = flag.key.startsWith("country:")
      ? `/flags/${flag.key.slice("country:".length)}.svg`
      : (flag.cosmetic as Flag).url;
    return { path, name: cosmeticDisplayName(flag) };
  }

  private renderTopTabs(): TemplateResult {
    const onCard = this.activeTab === CARD_TAB;
    const tab = (key: "ingame" | "card", label: string, selected: boolean) =>
      html`<button
        type="button"
        role="tab"
        data-inventory-top-tab=${key}
        aria-selected=${selected ? "true" : "false"}
        class="-mb-px min-h-11 border-b-2 px-4 text-sm font-black uppercase tracking-wider transition-colors ${
          selected
            ? "border-sky-400 text-sky-300"
            : "border-transparent text-white/50 hover:text-white/80"
        }"
        @click=${() =>
          this.setActiveTab(key === "card" ? CARD_TAB : this.lastInGameTab)}
      >
        ${label}
      </button>`;
    return html`<div
      role="tablist"
      aria-label=${translateText("inventory.title")}
      class="mt-3 flex justify-center gap-2 border-b border-white/10"
    >
      ${tab("ingame", translateText("inventory.tab_in_game"), !onCard)}
      ${tab("card", translateText("inventory.tab_player_card"), onCard)}
    </div>`;
  }

  protected renderHeaderSlot() {
    const isLoggedIn = this.userMeResponse !== false;
    return html`
      <div class="relative flex shrink-0 flex-col">
        ${modalHeader({
          title: translateText("inventory.title"),
          onBack: () => this.leaveThen(() => this.close()),
          ariaLabel: translateText("common.back"),
          rightContent: html`<o-button
            data-inventory-header-action
            class="no-game-portal"
            variant=${isLoggedIn ? "primary" : "danger"}
            size="sm"
            .translationKey=${
              isLoggedIn ? "main.store" : "common.not_logged_in"
            }
            @click=${() => {
              if (isLoggedIn) {
                this.openStore();
              } else {
                window.showPage?.("page-account");
              }
            }}
          ></o-button>`,
        })}
        ${this.renderTopTabs()}
        <p
          data-inventory-status
          role="status"
          class="md:hidden ${
            this.statusMessage === "" ? "sr-only" : ""
          } mx-3 mt-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-center text-sm font-semibold text-white"
        >
          ${this.statusMessage}
        </p>
      </div>
      ${this.renderCardGuard()}
      ${
        this.buying && this.isModalOpen
          ? html`<inventory-buy-dialog
              .resolved=${this.currentBuying()}
              .bought=${this.buyingBought}
              .priceEpoch=${this.priceEpoch}
              .onPurchase=${(method: "hard" | "soft", shownAmount?: number) =>
                this.purchase(this.currentBuying()!, method, shownAmount)}
              .onEquip=${() => this.equipBought()}
              .onPreview=${() => {
                this.previewingCosmetic = this.buying;
              }}
              .onClose=${() => this.closeBuy()}
            ></inventory-buy-dialog>`
          : nothing
      }
      ${
        this.previewingCosmetic
          ? html`<cosmetic-preview-modal
              .resolved=${this.previewingCosmetic}
              @close-preview=${() => {
                this.previewingCosmetic = null;
              }}
            ></cosmetic-preview-modal>`
          : nothing
      }
    `;
  }

  private renderLoading(): TemplateResult {
    return html`<div
      data-inventory-state="loading"
      aria-busy="true"
      class="grid gap-4 p-3 md:grid-cols-[14rem_minmax(0,1fr)]"
    >
      <span class="sr-only">${translateText("inventory.loading")}</span>
      <div
        data-inventory-skeleton="loadout"
        class="h-28 animate-pulse rounded-xl bg-white/5 md:h-96"
      ></div>
      <div
        data-inventory-skeleton="grid"
        class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]"
      >
        ${Array.from(
          { length: 6 },
          () =>
            html`<div
              data-inventory-skeleton-tile
              class="aspect-[3/4] animate-pulse rounded-xl bg-white/5"
            ></div>`,
        )}
      </div>
    </div>`;
  }

  private renderSignIn(): TemplateResult {
    return html`<div data-inventory-sign-in>
      ${signedOutNotice(
        () => window.showPage?.("page-account"),
        translateText("inventory.sign_in_for_cosmetics"),
      )}
    </div>`;
  }

  protected renderBody(tab: string) {
    // BaseModal renders the body even while closed, and this one is always
    // mounted: skip building a grid no one can see from the main menu.
    if (!this.isModalOpen) return html``;
    if (this.isLoading || this.ownershipState === "loading") {
      return this.renderLoading();
    }
    if (this.loadFailed || this.ownershipState === "error") {
      return html`<div
        data-inventory-state="error"
        class="flex flex-col items-center gap-4 p-8 text-center text-red-300"
      >
        <p>${translateText("inventory.load_failed")}</p>
        <button
          type="button"
          data-inventory-retry
          ?disabled=${this.isLoading}
          class="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          @click=${(event: Event) => {
            if (this.isLoading) return;
            (event.currentTarget as HTMLButtonElement).disabled = true;
            void this.loadInventory();
          }}
        >
          ${translateText("inventory.retry")}
        </button>
      </div>`;
    }
    if (tab === CARD_TAB) {
      if (this.ownershipState === "guest") return this.renderSignIn();
      const flag = this.cardFlag();
      return html`<inventory-card-tab
        class="block p-3"
        .editor=${this.cardEditor}
        .userMe=${this.userMeResponse === false ? null : this.userMeResponse}
        .cosmetics=${this.cosmetics}
        .flag=${flag.path}
        .flagName=${flag.name}
        .priceEpoch=${this.priceEpoch}
        @change-flag=${() => this.setActiveTab("flags")}
        @open-store=${(event: CustomEvent<{ item?: string }>) =>
          this.openStore(event.detail.item ?? "card")}
        @top-up=${(event: CustomEvent<{ remember: () => void }>) =>
          this.topUp(event)}
        @sign-in=${() =>
          this.leaveThen(() => window.showPage?.("page-account"))}
      ></inventory-card-tab>`;
    }
    const category = (
      IN_GAME_TABS.includes(tab as InventoryCategory) ? tab : "skins"
    ) as InventoryCategory;
    const loadout = this.renderLoadoutArea();
    return html`
      ${this.ownershipState === "guest" ? this.renderSignIn() : nothing}
      <div class="md:hidden">
        <inventory-loadout-bar
          .entries=${this.loadoutEntries()}
          .activeCategory=${category}
          .onCategorySelect=${(selected: InventoryCategory) =>
            this.setActiveTab(selected)}
        ></inventory-loadout-bar>
        <div class="px-3 pb-2">${loadout}</div>
      </div>
      <div
        class="grid gap-4 p-3 md:grid-cols-[14rem_minmax(0,1fr)] md:items-start"
      >
        <div class="hidden md:block md:border-r md:border-white/10 md:pr-4">
          <inventory-your-look
            .slots=${this.lookSlots()}
            .effects=${this.lookEffects()}
            .activeCategory=${category}
            .loadout=${loadout}
            .cardThumbnail=${this.cardThumbnail()}
            .onSelect=${(selected: InventoryCategory) =>
              this.setActiveTab(selected)}
            .onOpenCard=${() => this.setActiveTab(CARD_TAB)}
          ></inventory-your-look>
        </div>
        <div class="min-w-0">
          ${
            category === "effects"
              ? this.renderEffects()
              : this.renderCategory(category)
          }
        </div>
      </div>
    `;
  }

  public open(args?: Record<string, unknown>): void {
    const tabs = this.modalConfig().tabs ?? [];
    const requestedTab =
      typeof args?.tab === "string" && tabs.some((tab) => tab.key === args.tab)
        ? args.tab
        : null;
    const tab = requestedTab ?? (this.activeTab || tabs[0]?.key);
    super.open({ ...args, ...(tab ? { tab } : {}) });
  }

  protected async onOpen(): Promise<void> {
    this.filter = "owned";
    if (
      this.ownershipState === "loading" ||
      (this.cosmetics === null && !this.loadFailed)
    ) {
      await this.loadInventory();
      return;
    }
    this.resumePendingEquip();
    this.updateFromSettings();
    // Prices change when a sale starts or ends: like the Store, refetch a
    // catalogue more than a minute old, or one still carrying an ended sale.
    const ended = this.endedSaleToRefetch();
    if (ended !== null) {
      this.refetchedForSaleEnd = ended;
      invalidateCosmetics();
    } else {
      refreshStaleCosmetics();
    }
    await this.refreshCatalog();
  }

  /** Loads the catalogue again and shows it, without the loading state. A
   * failed fetch keeps the catalogue already shown. */
  private async refreshCatalog(): Promise<void> {
    const seq = this.catalogChangeSeq;
    const fresh = await this.loadCatalog().catch(() => null);
    if (!fresh || !this.isModalOpen) return;
    // A catalogue change (onCosmeticsChanged) landed while this fetch was
    // out: its catalogue is newer than this answer, so keep it. Not the
    // cache: a request dropped by another invalidation leaves it older
    // than `fresh`.
    if (seq !== this.catalogChangeSeq) return;
    this.cosmetics = fresh;
    this.catalogFetchedAt = Date.now();
    this.priceEpoch++;
    this.closeBuyIfGone();
  }

  private salePromotions(): PricedItem[] {
    return this.resolvedItems()
      .map((item) => item.cosmetic as PricedItem | null)
      .filter((item): item is PricedItem => item?.promotion !== undefined);
  }

  /**
   * The end of a sale that has ended since the catalogue in hand was
   * fetched, so a refetch should drop it; null when there is none. A
   * catalogue fetched after the sale ended (the CDN still serving it) is not
   * refetched again, and each ended sale is refetched for once.
   */
  private endedSaleToRefetch(): number | null {
    const now = Date.now();
    let latest: number | null = null;
    for (const item of this.salePromotions()) {
      const end = saleEndsAt(item);
      if (end === null || end > now) continue;
      if (end <= this.catalogFetchedAt) continue;
      if (latest === null || end > latest) latest = end;
    }
    return latest !== null && latest !== this.refetchedForSaleEnd
      ? latest
      : null;
  }

  protected updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    this.scheduleSaleEnd();
  }

  /**
   * At the soonest sale end, re-render (tiles and the buy dialog switch to
   * list prices then) and refetch the catalogue for whatever runs next.
   * Rescheduled on every render; cleared on close.
   */
  private scheduleSaleEnd(): void {
    this.clearSaleEndTimer();
    if (!this.isModalOpen || this.cosmetics === null) return;
    const now = Date.now();
    let next = Infinity;
    for (const item of this.salePromotions()) {
      const end = saleEndsAt(item);
      if (end !== null && end > now && end < next) next = end;
    }
    // setTimeout overflows past ~24.8 days; a later render reschedules.
    if (!Number.isFinite(next) || next - now > 2 ** 31 - 1) return;
    this.saleEndTimer = setTimeout(
      () => {
        this.saleEndTimer = null;
        this.priceEpoch++;
        // This is the refetch for that sale; opening again won't repeat it.
        this.refetchedForSaleEnd = next;
        invalidateCosmetics();
        void this.refreshCatalog();
      },
      next - now + 1,
    );
  }

  private clearSaleEndTimer(): void {
    if (this.saleEndTimer !== null) clearTimeout(this.saleEndTimer);
    this.saleEndTimer = null;
  }

  protected onClose(): void {
    // Closed from elsewhere (another modal's link): the guard has no say.
    if (this.cardGuard !== null) {
      this.cardGuard.resolve(false);
      this.cardGuard = null;
    }
    this.cardEditor.settle();
    this.clearSaleEndTimer();
    this.clearStatus();
    this.search = "";
    this.previewingCosmetic = null;
    this.buying = null;
    this.buyingBought = false;
    this.openEffectSlot = null;
    this.pages.reset();
  }

  // A query typed for skins rarely matches anything in flags, so a stale
  // search reads as an empty tab. Reset it whenever the category changes.
  protected onTabEnter(key: string): void {
    this.search = "";
    if (IN_GAME_TABS.includes(key as InventoryCategory)) {
      this.lastInGameTab = key as InventoryCategory;
    }
  }

  private setFilter(filter: OwnershipFilter) {
    this.filter = filter;
  }

  /** The Store's cosmetics; `"card"` for its Card tab, or an item key
   * (`<type>:<name>`) to open on. */
  private openStore(target?: string) {
    this.leaveThen(() => {
      this.close();
      window.location.hash =
        target === undefined
          ? "modal=store&tab=cosmetics"
          : target === "card"
            ? "modal=store&tab=cosmetics&sub=card"
            : `modal=store&tab=cosmetics&item=${encodeURIComponent(target)}`;
    });
  }

  /** "Get Plutonium" from a card Buy's shortfall box leaves for the packs:
   * like the Store links, ask about unsaved card changes first, then change
   * only the hash (never a full navigation from a page path, which would
   * unload a card save still in flight). */
  private topUp(event: CustomEvent<{ remember: () => void }>) {
    event.preventDefault();
    const { remember } = event.detail;
    this.leaveThen(() => {
      remember();
      this.close();
      window.location.hash = "modal=store&tab=packs";
    });
  }

  // ---- Unsaved card changes guard -----------------------------------------

  /** True when leaving the Player card tab would drop changes. */
  private hasCardChanges(): boolean {
    return this.activeTab === CARD_TAB && this.cardEditor.changeCount() > 0;
  }

  /**
   * Whether the player may leave the Player card tab: at once without
   * changes; otherwise once they choose Save (and it saves) or Discard.
   */
  private confirmLeaveCard(): Promise<boolean> {
    if (!this.hasCardChanges()) return Promise.resolve(true);
    if (this.cardGuard !== null) return Promise.resolve(false);
    return new Promise((resolve) => {
      const saving = this.cardEditor.saveState === "saving";
      this.cardGuard = { resolve, saving };
      if (saving) void this.afterBarSave();
    });
  }

  /**
   * Left while the bar's save is in flight: the guard shows Saving, with no
   * Discard (the saved card is still the one being replaced), until it
   * lands. Then it goes when nothing is left to save, and otherwise asks
   * about what's left (an edit made meanwhile, or the changes of a save
   * that failed).
   */
  private async afterBarSave(): Promise<void> {
    const guard = this.cardGuard;
    if (guard === null) return;
    await this.cardEditor.whenSaved();
    // Answered or replaced meanwhile: not this one's to settle.
    if (this.cardGuard?.resolve !== guard.resolve) return;
    if (this.cardEditor.changeCount() === 0) {
      this.cardGuard = null;
      guard.resolve(true);
      return;
    }
    this.cardGuard = { ...guard, saving: false };
  }

  /** Runs `go` now when nothing would be lost (so tab switches and links
   * stay synchronous), otherwise after the guard allows it. */
  private leaveThen(go: () => void): void {
    if (!this.hasCardChanges()) {
      go();
      return;
    }
    void this.confirmLeaveCard().then((ok) => {
      if (ok) go();
    });
  }

  private async chooseCardGuard(choice: CardGuardChoice): Promise<void> {
    const guard = this.cardGuard;
    if (guard === null || guard.saving) return;
    if (choice === "keep") {
      this.cardGuard = null;
      guard.resolve(false);
      return;
    }
    if (choice === "discard") {
      this.cardEditor.discard();
      this.cardGuard = null;
      guard.resolve(true);
      return;
    }
    this.cardGuard = { ...guard, saving: true };
    const saved = await this.cardEditor.save();
    // A newer guard may have replaced this one meanwhile (the Inventory
    // closed and reopened): that one is still to be answered.
    if (this.cardGuard?.resolve === guard.resolve) this.cardGuard = null;
    // A failed save stays on the tab: its bar and toast offer Retry.
    guard.resolve(saved);
  }

  private renderCardGuard(): TemplateResult | typeof nothing {
    const guard = this.cardGuard;
    if (guard === null) return nothing;
    const changes = this.cardEditor.changes();
    return html`<card-unsaved-dialog
      .count=${changes.length}
      .lines=${changes.map((c) => cardChangeLine(this.cosmetics, c))}
      .canSave=${guard.saving || this.cardEditor.canSave()}
      .buyFirst=${this.cardEditor.unownedInChanges().length > 0}
      .saving=${guard.saving}
      .onChoose=${(choice: CardGuardChoice) => void this.chooseCardGuard(choice)}
    ></card-unsaved-dialog>`;
  }

  /** Escape and clicking outside close the Inventory: ask first. */
  public confirmBeforeClose(): Promise<boolean> {
    return this.confirmLeaveCard();
  }

  /** A route (browser Back, a hash edited by hand, a route to another page)
   * takes the Inventory away: ask first, as for any other close. */
  public confirmRouteLeave(): Promise<boolean> {
    if (!this.isModalOpen) return Promise.resolve(true);
    return this.confirmLeaveCard();
  }

  /** Leaving the Player card tab for In game: ask first. */
  public setActiveTab(key: string): void {
    if (key === CARD_TAB || this.activeTab !== CARD_TAB) {
      super.setActiveTab(key);
      return;
    }
    if (!this.hasCardChanges()) {
      super.setActiveTab(key);
      return;
    }
    void this.confirmLeaveCard().then((ok) => {
      if (ok) {
        super.setActiveTab(key);
      } else {
        // Keep editing: the URL (a hash naming another tab) names the card
        // tab again, as a declined route puts its hash back.
        modalRouter.syncTab(this.routerName, CARD_TAB);
      }
    });
  }

  // ---- Actions -----------------------------------------------------------

  /** A tile was clicked: equip what's owned; preview and buy the rest. */
  private activate(
    resolved: ResolvedCosmetic,
    state: ItemState,
    slot?: string,
  ) {
    if (state === "equipped" || state === "owned") {
      this.equip(resolved, slot);
      return;
    }
    if (this.ownershipState === "guest" || this.userMeResponse === false) {
      window.showPage?.("page-account");
      return;
    }
    this.buying = resolved;
    this.buyingBought = false;
  }

  private equip(resolved: ResolvedCosmetic, slot?: string) {
    switch (resolved.type) {
      case "pattern": {
        const pattern = resolvedToPlayerPattern(resolved);
        if (pattern === null) {
          this.userSettings.setSelectedPatternName(undefined);
        } else {
          const name =
            pattern.colorPalette?.name === undefined
              ? pattern.name
              : `${pattern.name}:${pattern.colorPalette.name}`;
          this.userSettings.setSelectedPatternName(`pattern:${name}`);
        }
        break;
      }
      case "skin": {
        const name = (resolved.cosmetic as Skin | null)?.name ?? null;
        this.userSettings.setSelectedPatternName(
          name === null ? undefined : `skin:${name}`,
        );
        break;
      }
      case "flag":
        this.userSettings.setFlag(resolved.key);
        break;
      case "crown":
        this.userSettings.setSelectedCrownName(
          resolved.cosmetic?.name ?? undefined,
        );
        break;
      case "effect": {
        const effectSlot = slot ?? this.effectSlotFor(resolved);
        if (effectSlot === null || resolved.cosmetic === null) return;
        this.userSettings.setSelectedEffectName(
          effectSlot,
          resolved.cosmetic.name,
        );
        break;
      }
      default:
        return;
    }
    this.showMessage(
      translateText("inventory.item_equipped", {
        name: cosmeticSelectionLabel(resolved),
      }),
    );
    this.updateFromSettings();
  }

  private useDefault(category: GridCategory) {
    if (category === "skins") {
      this.userSettings.setSelectedPatternName(undefined);
    } else if (category === "flags") {
      this.userSettings.clearFlag(true);
    } else {
      this.userSettings.setSelectedCrownName(undefined);
    }
    this.updateFromSettings();
  }

  private useDefaultEffect(slot: string) {
    this.userSettings.setSelectedEffectName(slot, undefined);
    this.updateFromSettings();
  }

  /**
   * Buys the dialog's item through the Store's purchase flow. The item is
   * remembered first: a successful purchase reloads the page, and the
   * Inventory offers Equip now when it comes back (resumePendingEquip).
   */
  private async purchase(
    resolved: ResolvedCosmetic,
    method: "hard" | "soft",
    shownAmount?: number,
  ): Promise<PurchaseResult> {
    const remembered =
      this.userMeResponse !== false
        ? rememberPendingEquip(
            this.userMeResponse.player.publicId,
            resolved.key,
          )
        : null;
    try {
      // With the price the confirm box showed: the server refuses (409) to
      // charge more than that.
      return await purchaseCosmetic(
        resolved,
        method,
        { kind: "inventory", subTab: inventoryCategoryOf(resolved) },
        shownAmount,
      );
    } finally {
      // No reload means no purchase (failed, cancelled or thrown): forget
      // the item, or a later purchase of it elsewhere (the Store) would
      // bring back this Equip now. Only this purchase's record: one
      // started since (even of the same item) may have written over it.
      if (!purchaseReloading() && remembered !== null) {
        clearPendingEquip(remembered);
      }
    }
  }

  private async equipBought() {
    const item = this.buying;
    this.closeBuy();
    if (item === null) return;
    this.equip(item);
    // Equipping re-sorts the grid equipped-first, and its tiles aren't
    // keyed, so the tile the closing dialog gave focus back to may now show
    // another item: move focus to the one just equipped.
    await this.updateComplete;
    [...this.querySelectorAll<InventoryItemTile>("inventory-item-tile")]
      .find(
        (tile) =>
          tile.resolved.key === item.key ||
          tile.variants.some((variant) => variant.key === item.key),
      )
      ?.querySelector<HTMLElement>("[data-tile-main]")
      ?.focus();
  }

  /** The dialog's item from the catalogue now shown: a refetch may have
   * changed its price or sale. */
  private currentBuying(): ResolvedCosmetic | null {
    const key = this.buying?.key;
    if (key === undefined) return null;
    return this.resolvedItems().find((item) => item.key === key) ?? this.buying;
  }

  private closeBuy() {
    this.buying = null;
    this.buyingBought = false;
  }

  /** An open buy popup re-prices from the catalogue now shown
   * (currentBuying); one whose item that catalogue no longer has closes, as
   * the Store's bundle dialog does, rather than selling from the old one.
   * Not once bought: Equip now is still on offer. */
  private closeBuyIfGone() {
    const key = this.buying?.key;
    if (key === undefined || this.buyingBought) return;
    if (!this.resolvedItems().some((item) => item.key === key)) {
      this.closeBuy();
    }
  }

  /**
   * A short confirmation ("Hex Grid equipped"). The page toast sits over
   * the Inventory's title on phones, so there it shows in the Inventory's
   * own status line under the tabs instead.
   */
  private clearStatus() {
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.statusMessage = "";
  }

  private showMessage(message: string) {
    if (window.matchMedia?.("(max-width: 767px)").matches) {
      this.statusMessage = message;
      if (this.statusTimer !== null) clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => {
        this.statusTimer = null;
        this.statusMessage = "";
      }, 2000);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 2000 },
      }),
    );
  }

  public async refresh() {
    this.requestUpdate();
  }
}
