import type { TemplateResult } from "lit";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import {
  Cosmetics,
  Effect,
  Flag,
  isNukeExplosionEffect,
  Skin,
} from "../core/CosmeticSchemas";
import {
  CROWN_KEY,
  EFFECTS_KEY,
  FLAG_KEY,
  MAX_LOADOUTS,
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { getUserMe } from "./Api";
import { userAuth } from "./Auth";
import "./components/baseComponents/Button";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticCard";
import {
  cosmeticDisplayName,
  cosmeticSelectionLabel,
} from "./components/CosmeticPresentation";
import "./components/CosmeticPreviewModal";
import "./components/EffectsGrid";
import "./components/InventoryLoadoutBar";
import type {
  InventoryCategory,
  InventoryLoadoutEntry,
} from "./components/InventoryLoadoutBar";
import "./components/InventoryLoadoutMenu";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  groupCosmeticVariants,
  resolveCosmetics,
  ResolvedCosmetic,
  resolvedToPlayerPattern,
} from "./Cosmetics";
import { translateText } from "./Utils";

type OwnershipState = "loading" | "guest" | "loaded" | "error";

function countryFlag(name: string, code: string): Flag {
  return {
    name,
    url: assetUrl(`/flags/${code}.svg`),
    product: null,
    rarity: "common",
    affiliateCode: null,
  };
}

/**
 * The player's owned cosmetics, grouped into equip categories.
 */
@customElement("inventory-modal")
export class InventoryModal extends BaseModal {
  protected routerName = "inventory";

  @state() private search = "";
  @state() private isLoading = false;
  @state() private loadFailed = false;
  @state() private ownershipState: OwnershipState = "loading";
  @state() private previewingCosmetic: ResolvedCosmetic | null = null;

  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
  private userMeResponse: UserMeResponse | false = false;
  private catalogLoad: Promise<Cosmetics | null> | null = null;
  private inventoryLoadId = 0;
  private ownershipLoadId = 0;
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
      hideTabs: true,
      tabs: [
        { key: "skins", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
        { key: "crowns", label: translateText("store.crowns") },
        { key: "effects", label: translateText("store.effects") },
      ],
    };
  }

  private _onCosmeticSelected = () => this.updateFromSettings();

  private _onUserMe = (event: Event) => {
    void this.onUserMe((event as CustomEvent<UserMeResponse | false>).detail);
  };

  private onOpenCosmeticPreview = (event: Event) => {
    const customEvent = event as CustomEvent<ResolvedCosmetic>;
    this.previewingCosmetic = customEvent.detail;
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this._onUserMe);
    this.addEventListener("open-cosmetic-preview", this.onOpenCosmeticPreview);
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onCosmeticSelected,
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${FLAG_KEY}`,
      this._onCosmeticSelected,
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${CROWN_KEY}`,
      this._onCosmeticSelected,
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${EFFECTS_KEY}`,
      this._onCosmeticSelected,
    );
  }

  disconnectedCallback() {
    this.removeEventListener(
      "open-cosmetic-preview",
      this.onOpenCosmeticPreview,
    );
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this._onUserMe);
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onCosmeticSelected,
    );
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${FLAG_KEY}`,
      this._onCosmeticSelected,
    );
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${CROWN_KEY}`,
      this._onCosmeticSelected,
    );
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${EFFECTS_KEY}`,
      this._onCosmeticSelected,
    );
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
    const request = fetchCosmetics();
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
    this.isLoading = true;
    this.loadFailed = false;
    this.ownershipState = "loading";
    try {
      const [cosmetics] = await Promise.all([
        this.loadCatalog(),
        this.loadOwnership(userMeResponse),
      ]);
      if (loadId !== this.inventoryLoadId) return;
      this.cosmetics = cosmetics;
      this.loadFailed = cosmetics === null;
    } catch {
      if (loadId !== this.inventoryLoadId) return;
      this.cosmetics = null;
      this.loadFailed = true;
      if (this.ownershipState === "loading") this.ownershipState = "error";
    } finally {
      if (loadId === this.inventoryLoadId) {
        this.isLoading = false;
        this.updateFromSettings();
      }
    }
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    await this.loadInventory(userMeResponse);
  }

  private includedInSearch(name: string): boolean {
    const displayName = name.replace(/_/g, " ");
    return displayName.toLowerCase().includes(this.search.toLowerCase());
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private hasOwnedCatalogItem(
    types: readonly ResolvedCosmetic["type"][],
  ): boolean {
    return this.resolvedItems().some(
      (resolved) =>
        types.includes(resolved.type) &&
        resolved.cosmetic !== null &&
        resolved.relationship === "owned",
    );
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
          (item) => item.type === "skin" && item.cosmetic?.name === skinName,
        ) ?? null
      );
    }
    const pattern = this.userSettings.getSelectedPatternName(this.cosmetics);
    if (pattern === null) return null;
    return (
      items.find(
        (item) =>
          item.type === "pattern" &&
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
        (item) => item.type === "flag" && item.key === selectedFlag,
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
          item.type === "crown" && item.cosmetic?.name === selectedCrown,
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
        item.cosmetic !== null &&
        this.effectSlotFor(item) !== null &&
        selected[this.effectSlotFor(item)!] === item.cosmetic.name,
    );
  }

  private loadoutEntries(): InventoryLoadoutEntry[] {
    const effects = this.equippedEffects();
    const entries: Array<{
      category: Exclude<InventoryCategory, "effects">;
      label: string;
      item: ResolvedCosmetic | null;
    }> = [
      {
        category: "skins",
        label: translateText("store.patterns"),
        item: this.equippedSkin(),
      },
      {
        category: "flags",
        label: translateText("store.flags"),
        item: this.equippedFlag(),
      },
      {
        category: "crowns",
        label: translateText("store.crowns"),
        item: this.equippedCrown(),
      },
    ];
    return [
      ...entries.map(({ category, label, item }) => ({
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

  private renderLoadoutMenu(): TemplateResult {
    const names = this.loadoutNames();
    return html`<inventory-loadout-menu
      .names=${names}
      .active=${this.userSettings.getActiveLoadout() ?? ""}
      .canAdd=${names.length < MAX_LOADOUTS}
      .canUnequip=${this.hasEquippedCosmetic()}
      .onSelect=${(name: string) => this.applyLoadout(name)}
      .onAdd=${() => this.addLoadout()}
      .onDelete=${(name: string) => this.deleteLoadout(name)}
      .onUnequipAll=${() => this.unequipAll()}
    ></inventory-loadout-menu>`;
  }

  private applyLoadout(name: string) {
    // Re-selecting the active slot would only re-equip what's already worn.
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

  private renderEmptyState(category: "skins" | "crowns") {
    return html`<p
      data-inventory-empty=${category}
      class="px-4 pt-4 text-center text-sm font-medium text-white/60"
    >
      ${translateText(`inventory.no_owned_${category}`)}
    </p>`;
  }

  /** Combined patterns + skins grid. To the user they're the same: "skins". */
  private renderSkinGrid(): TemplateResult {
    const items = this.resolvedItems().filter(
      (r) =>
        (r.type === "pattern" || r.type === "skin") &&
        r.relationship === "owned" &&
        r.cosmetic !== null &&
        this.includedInSearch(r.cosmetic.name),
    );

    return html`
      ${this.hasOwnedCatalogItem(["pattern", "skin"])
        ? null
        : this.renderEmptyState("skins")}
      <div
        data-inventory-grid="skins"
        class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        ${groupCosmeticVariants(items).map((group) => {
          const equippedKey = this.equippedSkin()?.key;
          const equippedVariant = group.find((r) => r.key === equippedKey);
          const active = equippedVariant ?? group[0];
          return html`
            <cosmetic-card
              .resolved=${active}
              .variants=${group}
              .activeVariantKey=${active.key}
              state=${equippedVariant ? "equipped" : "idle"}
              .onActivate=${(variant: ResolvedCosmetic) =>
                this.selectCosmetic(variant)}
              .onVariantActivate=${(variant: ResolvedCosmetic) =>
                this.selectCosmetic(variant)}
            ></cosmetic-card>
          `;
        })}
      </div>
    `;
  }

  /** Owned crowns; selecting persists to UserSettings. */
  private renderCrownGrid(): TemplateResult {
    const items = this.resolvedItems().filter(
      (r) =>
        r.type === "crown" &&
        r.relationship === "owned" &&
        r.cosmetic !== null &&
        this.includedInSearch(r.cosmetic.name),
    );

    const equippedKey = this.equippedCrown()?.key;
    return html`
      ${this.hasOwnedCatalogItem(["crown"])
        ? null
        : this.renderEmptyState("crowns")}
      <div
        data-inventory-grid="crowns"
        class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        ${items.map((r) => {
          return html`
            <cosmetic-card
              .resolved=${r}
              state=${r.key === equippedKey ? "equipped" : "idle"}
              .onActivate=${() => this.selectCrown(r)}
            ></cosmetic-card>
          `;
        })}
      </div>
    `;
  }

  private renderFlagGrid(): TemplateResult {
    const equippedKey = this.equippedFlag()?.key;
    const cosmeticFlags = this.resolvedItems().filter(
      (r) =>
        r.type === "flag" &&
        r.relationship === "owned" &&
        r.cosmetic !== null &&
        this.includedInSearch(r.cosmetic.name),
    );

    const countryFlags = this.countryFlagTiles.filter(
      (resolved) =>
        this.includedInSearch(resolved.cosmetic!.name) ||
        this.includedInSearch(resolved.key.slice("country:".length)),
    );

    return html`
      <div
        data-inventory-grid="flags"
        class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        ${[...cosmeticFlags, ...countryFlags].map(
          (resolved) => html`
            <cosmetic-card
              .resolved=${resolved}
              state=${equippedKey === resolved.key ? "equipped" : "idle"}
              .onActivate=${() => this.selectFlag(resolved)}
            ></cosmetic-card>
          `,
        )}
      </div>
    `;
  }

  private renderUnequip(
    category: Exclude<InventoryCategory, "effects">,
  ): TemplateResult {
    const equipped =
      category === "skins"
        ? this.equippedSkin()
        : category === "flags"
          ? this.equippedFlag()
          : this.equippedCrown();
    return html`<div class="flex justify-end px-3 pt-3">
      <button
        type="button"
        data-inventory-unequip
        ?disabled=${equipped === null}
        class="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        @click=${() => {
          if (category === "skins") {
            this.userSettings.setSelectedPatternName(undefined);
          } else if (category === "flags") {
            this.userSettings.clearFlag(true);
          } else {
            this.userSettings.setSelectedCrownName(undefined);
          }
        }}
      >
        ${translateText("inventory.unequip")}
      </button>
    </div>`;
  }

  protected renderHeaderSlot() {
    const isLoggedIn = this.userMeResponse !== false;
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("inventory.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: html`<o-button
            data-inventory-header-action
            class="no-crazygames"
            variant=${isLoggedIn ? "primary" : "danger"}
            size="sm"
            .translationKey=${isLoggedIn
              ? "main.store"
              : "common.not_logged_in"}
            @click=${() => {
              if (isLoggedIn) {
                this.close();
                window.location.hash = "modal=store&tab=cosmetics";
              } else {
                window.showPage?.("page-account");
              }
            }}
          ></o-button>`,
        })}

        <div class="md:flex items-center gap-2 justify-center mt-4">
          <input
            class="h-12 w-full max-w-md border border-white/10 bg-black/60
              rounded-xl shadow-inner text-xl text-center focus:outline-none
              focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all"
            type="text"
            placeholder=${translateText("cosmetics.search")}
            .value=${this.search}
            @change=${this.handleSearch}
            @keyup=${this.handleSearch}
          />
        </div>
      </div>
      ${this.previewingCosmetic
        ? html`<cosmetic-preview-modal
            .resolved=${this.previewingCosmetic}
            @close-preview=${() => {
              this.previewingCosmetic = null;
            }}
          ></cosmetic-preview-modal>`
        : nothing}
    `;
  }

  protected renderBody(tab: string) {
    if (this.isLoading || this.ownershipState === "loading") {
      return html`<div data-inventory-state="loading" aria-busy="true">
        <span class="sr-only">${translateText("inventory.loading")}</span>
        <div
          data-inventory-skeleton="loadout"
          class="mx-3 my-2 h-28 animate-pulse rounded-xl bg-white/5"
        ></div>
        <div
          data-inventory-skeleton="grid"
          class="mx-3 grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          ${Array.from(
            { length: 6 },
            () =>
              html`<div
                class="aspect-square animate-pulse rounded-xl bg-white/5"
              ></div>`,
          )}
        </div>
      </div>`;
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
    let grid: TemplateResult;
    if (tab === "flags") {
      grid = html`${this.renderUnequip("flags")}${this.renderFlagGrid()}`;
    } else if (tab === "crowns") {
      grid = html`${this.renderUnequip("crowns")}${this.renderCrownGrid()}`;
    } else if (tab === "effects") {
      // effects-grid raises its own per-type empty notice below its tab bar,
      // so there is nothing to say above it here.
      grid = html`<div data-inventory-grid="effects" class="min-w-0">
        <effects-grid
          mode="select"
          tabbed
          .cosmetics=${this.cosmetics}
          .userMeResponse=${this.userMeResponse}
          .search=${this.search}
        ></effects-grid>
      </div>`;
    } else {
      grid = html`${this.renderUnequip("skins")}${this.renderSkinGrid()}`;
    }
    const category = tab as InventoryCategory;
    return html`
      ${this.renderLoadoutMenu()}
      <inventory-loadout-bar
        .entries=${this.loadoutEntries()}
        .activeCategory=${category}
        .onCategorySelect=${(selected: InventoryCategory) =>
          this.setActiveTab(selected)}
      ></inventory-loadout-bar>
      <div class="px-3 pb-3">${grid}</div>
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
    if (
      this.ownershipState === "loading" ||
      (this.cosmetics === null && !this.loadFailed)
    ) {
      await this.loadInventory();
      return;
    }
    this.updateFromSettings();
  }

  protected onClose(): void {
    this.search = "";
    this.previewingCosmetic = null;
  }

  // A query typed for skins rarely matches anything in flags, so a stale
  // search reads as an empty tab. Reset it whenever the category changes.
  protected onTabEnter(_key: string): void {
    this.search = "";
  }

  private selectCosmetic(resolved: ResolvedCosmetic) {
    if (resolved.type === "pattern") {
      this.selectPattern(resolvedToPlayerPattern(resolved), resolved);
    } else if (resolved.type === "skin") {
      this.selectSkin((resolved.cosmetic as Skin | null)?.name ?? null);
      this.showSelectedPopup(resolved);
    }
  }

  private selectSkin(skinName: string | null) {
    this.userSettings.setSelectedPatternName(
      skinName === null ? undefined : `skin:${skinName}`,
    );
  }

  private selectCrown(resolved: ResolvedCosmetic) {
    this.userSettings.setSelectedCrownName(
      resolved.cosmetic?.name ?? undefined,
    );
    this.showSelectedPopup(resolved);
  }

  private selectFlag(resolved: ResolvedCosmetic) {
    this.userSettings.setFlag(resolved.key);
    this.showSelectedPopup(resolved);
  }

  private selectPattern(
    pattern: PlayerPattern | null,
    resolved: ResolvedCosmetic,
  ) {
    if (pattern === null) {
      this.userSettings.setSelectedPatternName(undefined);
    } else {
      const name =
        pattern.colorPalette?.name === undefined
          ? pattern.name
          : `${pattern.name}:${pattern.colorPalette.name}`;
      this.userSettings.setSelectedPatternName(`pattern:${name}`);
    }
    this.showSelectedPopup(resolved);
  }

  private showSelectedPopup(resolved: ResolvedCosmetic) {
    this.showMessage(
      translateText("inventory.selected_cosmetic", {
        name: cosmeticSelectionLabel(resolved),
      }),
    );
  }

  private showMessage(message: string) {
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
