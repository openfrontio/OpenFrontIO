import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { Cosmetics, Crown, Flag, Skin } from "../core/CosmeticSchemas";
import {
  CROWN_KEY,
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { BaseModal } from "./components/BaseModal";
import { getUserMe } from "./Api";
import "./components/CosmeticButton";
import "./components/EffectsGrid";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  groupCosmeticVariants,
  resolveCosmetics,
  ResolvedCosmetic,
  resolvedToPlayerPattern,
} from "./Cosmetics";
import { translateText } from "./Utils";

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

  @state() private selectedPattern: PlayerPattern | null = null;
  @state() private selectedColor: string | null = null;
  @state() private selectedSkinName: string | null = null;
  @state() private search = "";
  @state() private isLoading = true;
  @state() private loadFailed = false;

  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
  private userMeResponse: UserMeResponse | false = false;

  protected modalConfig() {
    return {
      tabs: [
        { key: "skins", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
        { key: "crowns", label: translateText("store.crowns") },
        { key: "effects", label: translateText("store.effects") },
      ],
    };
  }

  private _onCosmeticSelected = async () => {
    await this.updateFromSettings();
    this.refresh();
  };

  private _onUserMe = (event: Event) => {
    void this.onUserMe(
      (event as CustomEvent<UserMeResponse | false>).detail,
    );
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this._onUserMe);
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onCosmeticSelected,
    );
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${CROWN_KEY}`,
      this._onCosmeticSelected,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this._onUserMe);
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onCosmeticSelected,
    );
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${CROWN_KEY}`,
      this._onCosmeticSelected,
    );
  }

  private async updateFromSettings() {
    const cosmetics = await getPlayerCosmetics();
    this.selectedPattern = cosmetics.pattern ?? null;
    this.selectedColor = cosmetics.color?.color ?? null;
    this.selectedSkinName = cosmetics.skin?.name ?? null;
  }

  private async loadCatalog(): Promise<void> {
    this.isLoading = true;
    this.loadFailed = false;
    this.cosmetics = await fetchCosmetics();
    this.loadFailed = this.cosmetics === null;
    this.isLoading = false;
    await this.updateFromSettings();
    this.refresh();
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    await this.loadCatalog();
  }

  private includedInSearch(name: string): boolean {
    const displayName = name.replace(/_/g, " ");
    return displayName.toLowerCase().includes(this.search.toLowerCase());
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  /** Combined patterns + skins grid. To the user they're the same: "skins". */
  private renderSkinGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      null,
    ).filter(
      (r) =>
        (r.type === "pattern" || r.type === "skin") &&
        r.relationship === "owned" &&
        (r.cosmetic === null
          ? !this.search
          : this.includedInSearch(r.cosmetic.name)),
    );

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${groupCosmeticVariants(items).map((group) => {
          const selectedVariant = group.find((r) =>
            r.type === "pattern"
              ? r.cosmetic !== null &&
                this.selectedPattern?.name === r.cosmetic.name &&
                (this.selectedPattern?.colorPalette?.name ?? null) ===
                  (r.colorPalette?.name ?? null)
              : (r.cosmetic as Skin | null)?.name === this.selectedSkinName,
          );
          const isSelected =
            selectedVariant !== undefined ||
            (group[0].cosmetic === null &&
              this.selectedPattern === null &&
              this.selectedSkinName === null);
          return html`
            <cosmetic-button
              .resolved=${selectedVariant ?? group[0]}
              .variants=${group}
              .selected=${isSelected}
              .onSelect=${(rc: ResolvedCosmetic) => this.selectCosmetic(rc)}
            ></cosmetic-button>
          `;
        })}
      </div>
    `;
  }

  /** Owned crowns + a Default (none) tile; selecting persists to UserSettings. */
  private renderCrownGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      null,
    ).filter(
      (r) =>
        r.type === "crown" &&
        r.relationship === "owned" &&
        r.cosmetic !== null &&
        this.includedInSearch(r.cosmetic.name),
    );

    // The Default tile has no name to match — hide it while searching.
    const noneTile: ResolvedCosmetic = {
      type: "crown",
      cosmetic: null,
      colorPalette: null,
      relationship: "owned",
      key: "crown:none",
    };
    const tiles = this.search ? items : [noneTile, ...items];

    const selectedCrown = this.userSettings.getSelectedCrownName();
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${tiles.map((r) => {
          const name = (r.cosmetic as Crown | null)?.name ?? null;
          const isSelected =
            (name === null && selectedCrown === null) ||
            (name !== null && selectedCrown === name);
          return html`
            <cosmetic-button
              .resolved=${r}
              .selected=${isSelected}
              .onSelect=${() => this.selectCrown(name)}
            ></cosmetic-button>
          `;
        })}
      </div>
    `;
  }

  private renderFlagGrid(): TemplateResult {
    const selectedFlag = this.userSettings.getFlag() ?? "";
    const cosmeticFlags = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      null,
    ).filter(
      (r) =>
        r.type === "flag" &&
        r.relationship === "owned" &&
        r.cosmetic !== null &&
        this.includedInSearch(r.cosmetic.name),
    );

    const noFlag: ResolvedCosmetic | null = this.search
      ? null
      : {
          type: "flag",
          cosmetic: countryFlag("None", "xx"),
          colorPalette: null,
          relationship: "owned",
          key: "country:xx",
        };
    const countryFlags = Countries.filter(
      (country) =>
        country.code !== "xx" &&
        country.restricted !== true &&
        (this.includedInSearch(country.name) ||
          this.includedInSearch(country.code)),
    ).map<ResolvedCosmetic>((country) => ({
      type: "flag",
      cosmetic: countryFlag(country.name, country.code),
      colorPalette: null,
      relationship: "owned",
      key: `country:${country.code}`,
    }));

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${[...(noFlag ? [noFlag] : []), ...cosmeticFlags, ...countryFlags].map(
          (resolved) => html`
            <cosmetic-button
              .resolved=${resolved}
              .selected=${selectedFlag === resolved.key ||
              (resolved.key === "country:xx" && selectedFlag === "")}
              .onSelect=${() => this.selectFlag(resolved.key)}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected renderHeaderSlot() {
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("inventory.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
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
    `;
  }

  protected renderBody(tab: string) {
    if (this.isLoading) {
      return html`<div
        data-inventory-state="loading"
        class="p-8 text-center text-white/60"
      >
        ${translateText("inventory.loading")}
      </div>`;
    }
    if (this.loadFailed) {
      return html`<div
        data-inventory-state="error"
        class="p-8 text-center text-red-300"
      >
        ${translateText("inventory.load_failed")}
      </div>`;
    }
    let grid: TemplateResult;
    if (tab === "flags") {
      grid = this.renderFlagGrid();
    } else if (tab === "crowns") {
      grid = this.renderCrownGrid();
    } else if (tab === "effects") {
      grid = html`<effects-grid
        mode="select"
        tabbed
        .cosmetics=${this.cosmetics}
        .userMeResponse=${this.userMeResponse}
        .search=${this.search}
      ></effects-grid>`;
    } else {
      grid = this.renderSkinGrid();
    }
    return html`
      <div class="flex justify-center py-3 shrink-0">
        <o-button
          class="no-crazygames"
          variant="primary"
          size="sm"
          translationKey="main.store"
          @click=${() => {
            this.close();
            window.showPage?.("page-item-store");
          }}
        ></o-button>
      </div>
      <div class="px-3 pb-3">${grid}</div>
    `;
  }

  protected async onOpen(): Promise<void> {
    if (this.userMeResponse === false) {
      this.userMeResponse = await getUserMe();
    }
    if (this.cosmetics === null && !this.loadFailed) {
      await this.loadCatalog();
      return;
    }
    await this.updateFromSettings();
    this.refresh();
  }

  protected onClose(): void {
    this.search = "";
  }

  private selectCosmetic(resolved: ResolvedCosmetic) {
    if (resolved.type === "pattern") {
      this.selectPattern(resolvedToPlayerPattern(resolved));
    } else if (resolved.type === "skin") {
      this.selectSkin((resolved.cosmetic as Skin | null)?.name ?? null);
    }
  }

  private selectSkin(skinName: string | null) {
    this.userSettings.setSelectedPatternName(
      skinName === null ? undefined : `skin:${skinName}`,
    );
    this.selectedSkinName = skinName;
    this.selectedPattern = null;
    // Stay open — the tile highlight moves to the new selection.
    this.refresh();
  }

  private selectCrown(crownName: string | null) {
    this.userSettings.setSelectedCrownName(crownName ?? undefined);
    // Stay open — the tile highlight moves to the new selection.
    this.refresh();
  }

  private selectFlag(flag: string) {
    this.userSettings.setFlag(flag);
    this.refresh();
  }

  private selectPattern(pattern: PlayerPattern | null) {
    this.selectedColor = null;
    if (pattern === null) {
      this.userSettings.setSelectedPatternName(undefined);
    } else {
      const name =
        pattern.colorPalette?.name === undefined
          ? pattern.name
          : `${pattern.name}:${pattern.colorPalette.name}`;
      this.userSettings.setSelectedPatternName(`pattern:${name}`);
    }
    this.selectedPattern = pattern;
    this.selectedSkinName = null;
    // Stay open — the tile highlight moves to the new selection.
    this.refresh();
    this.showSkinSelectedPopup();
  }

  private showSkinSelectedPopup() {
    let skinName = translateText("territory_patterns.pattern.default");
    if (this.selectedPattern && this.selectedPattern.name) {
      skinName = this.selectedPattern.name
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      if (
        this.selectedPattern.colorPalette &&
        this.selectedPattern.colorPalette.name
      ) {
        skinName += ` (${this.selectedPattern.colorPalette.name})`;
      }
    }
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: `${skinName} ${translateText("territory_patterns.selected")}`,
          duration: 2000,
        },
      }),
    );
  }

  public async refresh() {
    this.requestUpdate();
  }
}
