import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { ColorPalette, Cosmetics, Pattern } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { hasLinkedAccount } from "./Api";
import { BaseModal } from "./components/BaseModal";
import "./components/FlagButton";
import "./components/PatternButton";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  flagRelationship,
  getPlayerCosmetics,
  handlePurchase,
  patternRelationship,
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
        rightContent: !hasLinkedAccount(this.userMeResponse)
          ? html`<div class="flex items-center">
              ${this.renderNotLoggedInWarning()}
            </div>`
          : undefined,
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
    const buttons: TemplateResult[] = [];
    const patterns: (Pattern | null)[] = [
      null,
      ...Object.values(this.cosmetics?.patterns ?? {}),
    ];
    for (const pattern of patterns) {
      const colorPalettes = pattern
        ? [...(pattern.colorPalettes ?? []), null]
        : [null];
      for (const colorPalette of colorPalettes) {
        let rel = "owned";
        if (pattern) {
          rel = patternRelationship(
            pattern,
            colorPalette,
            this.userMeResponse,
            this.affiliateCode,
          );
        }
        if (rel === "blocked" || rel === "owned") {
          continue;
        }
        const isDefaultPattern = pattern === null;
        const isSelected =
          (isDefaultPattern && this.selectedPattern === null) ||
          (!isDefaultPattern &&
            this.selectedPattern &&
            this.selectedPattern.name === pattern?.name &&
            (this.selectedPattern.colorPalette?.name ?? null) ===
              (colorPalette?.name ?? null));
        buttons.push(html`
          <pattern-button
            .pattern=${pattern}
            .colorPalette=${this.cosmetics?.colorPalettes?.[
              colorPalette?.name ?? ""
            ] ?? null}
            .requiresPurchase=${rel === "purchasable"}
            .selected=${isSelected}
            .onSelect=${(p: PlayerPattern | null) => this.selectPattern(p)}
            .onPurchase=${(p: Pattern, cp: ColorPalette | null) =>
              handlePurchase(p.product!, cp?.name)}
          ></pattern-button>
        `);
      }
    }

    if (buttons.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_skins")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-2 justify-center items-stretch content-start"
      >
        ${buttons}
      </div>
    `;
  }

  private renderFlagGrid(): TemplateResult {
    const buttons: TemplateResult[] = [];
    const flags = Object.entries(this.cosmetics?.flags ?? {});
    for (const [key, flag] of flags) {
      const rel = flagRelationship(
        flag,
        this.userMeResponse,
        this.affiliateCode,
      );
      if (rel === "blocked" || rel === "owned") continue;
      const selectedFlag = new UserSettings().getFlag() ?? "";
      buttons.push(html`
        <flag-button
          .flag=${{
            key: `flag:${key}`,
            name: flag.name,
            url: flag.url,
            product: flag.product,
            artist: flag.artist,
          }}
          .selected=${selectedFlag === `flag:${key}`}
          .requiresPurchase=${rel === "purchasable"}
          .onPurchase=${() => handlePurchase(flag.product!)}
        ></flag-button>
      `);
    }

    if (buttons.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_flags")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-2 justify-center items-stretch content-start"
      >
        ${buttons}
      </div>
    `;
  }

  private renderNotLoggedInWarning(): TemplateResult {
    return html`<button
      class="px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
      @click=${() => {
        this.close();
        window.showPage?.("page-account");
      }}
    >
      ${translateText("territory_patterns.not_logged_in")}
    </button>`;
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
