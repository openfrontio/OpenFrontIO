import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
  SUBSCRIPTIONS_ENABLED,
} from "./Cosmetics";
import { translateText } from "./Utils";

type StoreTab = "patterns" | "flags" | "packs" | "subscriptions";

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
        ...(SUBSCRIPTIONS_ENABLED
          ? [
              {
                key: "subscriptions",
                label: translateText("store.subscriptions"),
              },
            ]
          : []),
        { key: "patterns", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
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

  private renderPackGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter((r) => r.type === "pack" && r.relationship === "purchasable");

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_packs")}
      </div>`;
    }

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
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
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
