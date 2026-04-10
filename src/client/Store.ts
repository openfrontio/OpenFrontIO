import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  handlePurchase,
  resolveCosmetics,
  ResolvedCosmetic,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("store-modal")
export class StoreModal extends BaseModal {
  @state() private selectedPattern: PlayerPattern | null;
  @state() private selectedColor: string | null = null;
  @state() private activeTab: "patterns" | "flags" = "patterns";

  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
  private isActive = false;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;

  private _onPatternSelected = async () => {
    await this.updateFromSettings();
    this.refresh();
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
    window.addEventListener(
      "event:user-settings-changed:pattern",
      this._onPatternSelected,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "event:user-settings-changed:pattern",
      this._onPatternSelected,
    );
  }

  private async updateFromSettings() {
    const cosmetics = await getPlayerCosmetics();
    this.selectedPattern = cosmetics.pattern ?? null;
    this.selectedColor = cosmetics.color?.color ?? null;
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    await this.updateFromSettings();
    this.refresh();
  }

  private renderHeader(): TemplateResult {
    return html`
      ${modalHeader({
        title: translateText("store.title"),
        onBack: () => this.close(),
        ariaLabel: translateText("common.back"),
        rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
      })}
      <div class="flex items-center gap-2 justify-center pt-2">
        <button
          class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
            .activeTab === "patterns"
            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
            : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
          @click=${() => (this.activeTab = "patterns")}
        >
          ${translateText("store.patterns")}
        </button>
        <button
          class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
            .activeTab === "flags"
            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
            : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
          @click=${() => (this.activeTab = "flags")}
        >
          ${translateText("store.flags")}
        </button>
      </div>
    `;
  }

  private renderPatternGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        (r.cosmetic === null || r.cosmetic.type === "pattern") &&
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
        ${items.map((r) => {
          const isSelected =
            (r.cosmetic === null && this.selectedPattern === null) ||
            (r.cosmetic !== null &&
              this.selectedPattern?.name === r.cosmetic.name &&
              (this.selectedPattern?.colorPalette?.name ?? null) ===
                (r.colorPalette?.name ?? null));
          return html`
            <cosmetic-button
              .resolved=${r}
              .selected=${isSelected}
              .onSelect=${(rc: ResolvedCosmetic) => this.selectCosmetic(rc)}
              .onPurchase=${(rc: ResolvedCosmetic) =>
                handlePurchase(rc.cosmetic!.product!, rc.colorPalette?.name)}
            ></cosmetic-button>
          `;
        })}
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
        r.cosmetic?.type === "flag" &&
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
              .onPurchase=${(rc: ResolvedCosmetic) =>
                handlePurchase(rc.cosmetic!.product!)}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  render() {
    if (!this.isActive && !this.inline) return html``;

    const content = html`
      <div class="${this.modalContainerClass}">
        ${this.renderHeader()}
        <div class="overflow-y-auto pr-2 custom-scrollbar mr-1">
          ${this.activeTab === "patterns"
            ? this.renderPatternGrid()
            : this.renderFlagGrid()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="storeModal"
        title="${translateText("store.title")}"
        ?inline=${this.inline}
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }

  public async open(options?: string | { affiliateCode?: string }) {
    if (this.isModalOpen) return;
    this.isActive = true;
    if (typeof options === "string") {
      this.affiliateCode = options;
    } else if (
      options !== null &&
      typeof options === "object" &&
      !Array.isArray(options)
    ) {
      this.affiliateCode = options.affiliateCode ?? null;
    } else {
      this.affiliateCode = null;
    }

    this.cosmetics ??= await fetchCosmetics();
    await this.refresh();
    super.open();
  }

  public close() {
    this.isActive = false;
    this.affiliateCode = null;
    super.close();
  }

  private selectCosmetic(resolved: ResolvedCosmetic) {
    const c = resolved.cosmetic;
    if (c === null) {
      this.selectPattern(null);
      return;
    }
    if (c.type === "pattern") {
      const pattern: PlayerPattern = {
        name: c.name,
        patternData: c.pattern,
        colorPalette: resolved.colorPalette ?? undefined,
      };
      this.selectPattern(pattern);
    }
  }

  private selectPattern(pattern: PlayerPattern | null) {
    this.selectedColor = null;
    this.userSettings.setSelectedColor(undefined);
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
    this.refresh();
    this.showSelectedPopup(pattern);
    this.close();
  }

  private showSelectedPopup(pattern: PlayerPattern | null) {
    let skinName = translateText("territory_patterns.pattern.default");
    if (pattern && pattern.name) {
      skinName = pattern.name
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      if (pattern.colorPalette && pattern.colorPalette.name) {
        skinName += ` (${pattern.colorPalette.name})`;
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
