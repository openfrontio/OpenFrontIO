import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/CustomCurrencyCard";
import "./components/EffectsGrid";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  groupCosmeticVariants,
  purchaseCosmetic,
  resolveCosmetics,
} from "./Cosmetics";
import { translateText } from "./Utils";

type StoreTab = "patterns" | "flags" | "effects" | "packs" | "subscriptions";

@customElement("store-modal")
export class StoreModal extends BaseModal {
  protected routerName = "store";
  private cosmetics: Cosmetics | null = null;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;

  protected modalConfig() {
    if (this.affiliateCode) {
      // Affiliate mode: hide tabs, show only items associated with the code.
      return {};
    }
    return {
      tabs: [
        { key: "packs", label: translateText("store.packs") },
        { key: "subscriptions", label: translateText("store.subscriptions") },
        { key: "patterns", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
        { key: "effects", label: translateText("store.effects") },
      ],
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.refresh();
  }

  private renderHeader(): TemplateResult {
    return modalHeader({
      title: translateText("store.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
    });
  }

  private renderPatternGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        (r.type === "pattern" || r.type === "skin") &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_skins")}
      </div>`;
    }

    // Collapse colour-palette variants of the same pattern into one tile; the
    // variants become clickable colour swatches on the cosmetic-button.
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${groupCosmeticVariants(items).map(
          (group) => html`
            <cosmetic-button
              .resolved=${group[0]}
              .variants=${group}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderFlagGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "flag" &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_flags")}
      </div>`;
    }

    const selectedFlag = new UserSettings().getFlag() ?? "";
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .selected=${selectedFlag === r.key}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderEffectGrid(): TemplateResult {
    // A sub-tab per effectType (Boat Trail / Nuke Trail); each tab opens that
    // type's grid. Tabs are always present, even when a type has nothing to buy.
    return html`<effects-grid
      mode="purchase"
      tabbed
      .cosmetics=${this.cosmetics}
      .userMeResponse=${this.userMeResponse}
      .affiliateCode=${this.affiliateCode}
    ></effects-grid>`;
  }

  private renderPackGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter((r) => r.type === "pack" && r.relationship === "purchasable");

    // The custom-amount card is always purchasable (priced inline server-side,
    // no catalog entry), and follows the fixed packs at the end of the grid.
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
        <custom-currency-card></custom-currency-card>
      </div>
    `;
  }

  private renderSubscriptionGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "subscription" &&
        (r.relationship === "purchasable" || r.relationship === "owned"),
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_subscriptions")}
      </div>`;
    }

    const userHasSubscription =
      this.userMeResponse !== false &&
      this.userMeResponse.player.subscription !== null;

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
              .userHasSubscription=${userHasSubscription}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected renderHeaderSlot() {
    return this.renderHeader();
  }

  protected renderBody(key: string): TemplateResult {
    if (this.affiliateCode) {
      return this.renderAffiliateGrid();
    }
    switch (key as StoreTab) {
      case "patterns":
        return this.renderPatternGrid();
      case "flags":
        return this.renderFlagGrid();
      case "effects":
        return this.renderEffectGrid();
      case "subscriptions":
        return this.renderSubscriptionGrid();
      case "packs":
      default:
        return this.renderPackGrid();
    }
  }

  private renderAffiliateGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        (r.type === "pattern" ||
          r.type === "skin" ||
          r.type === "flag" ||
          r.type === "effect" ||
          r.type === "pack") &&
        r.relationship === "purchasable",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_skins")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${groupCosmeticVariants(items).map(
          (group) => html`
            <cosmetic-button
              .resolved=${group[0]}
              .variants=${group}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected async onOpen(args?: Record<string, unknown>) {
    const affiliate =
      typeof args?.affiliateCode === "string" ? args.affiliateCode : null;
    this.affiliateCode = affiliate;
    this.cosmetics ??= await fetchCosmetics();
    await this.refresh();
  }

  protected onClose(): void {
    this.affiliateCode = null;
  }

  public async refresh() {
    this.requestUpdate();
  }
}
