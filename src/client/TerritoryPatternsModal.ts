import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics, Pattern } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { BaseModal } from "./components/BaseModal";
import "./components/NotLoggedInWarning";
import "./components/PatternButton";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  patternRelationship,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends BaseModal {
  public previewButton: HTMLElement | null = null;

  @state() private selectedPattern: PlayerPattern | null;
  @state() private selectedColor: string | null = null;

  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
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
            null,
          );
        }
        if (rel !== "owned") {
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
            .requiresPurchase=${false}
            .selected=${isSelected}
            .onSelect=${(p: PlayerPattern | null) => this.selectPattern(p)}
          ></pattern-button>
        `);
      }
    }

    return html`
      <div class="flex flex-col">
        <div
          class="flex flex-wrap gap-4 p-2 justify-center items-stretch content-start"
        >
          ${buttons}
        </div>
      </div>
    `;
  }

  render() {
    const content = html`
      <div class="${this.modalContainerClass}">
        <div
          class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
        >
          ${modalHeader({
            title: translateText("territory_patterns.title"),
            onBack: () => this.close(),
            ariaLabel: translateText("common.back"),
            rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
          })}
        </div>
        <div class="flex justify-center py-3 shrink-0">
          <button
            class="px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors"
            @click=${() => {
              this.close();
              window.showPage?.("page-item-store");
            }}
          >
            ${translateText("main.store")}
          </button>
        </div>
        <div
          class="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mr-1"
        >
          ${this.renderPatternGrid()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="territoryPatternsModal"
        title="${translateText("territory_patterns.title")}"
        ?inline=${this.inline}
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }

  protected async onOpen(): Promise<void> {
    await this.refresh();
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
    this.showSkinSelectedPopup();
    this.close();
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
