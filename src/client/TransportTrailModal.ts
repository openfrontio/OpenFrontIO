import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics, TransportTrail } from "../core/CosmeticSchemas";
import {
  TRANSPORT_TRAIL_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  resolveCosmetics,
  ResolvedCosmetic,
} from "./Cosmetics";
import { translateText } from "./Utils";

// "Default" tile — selecting it clears the trail back to the player color.
const DEFAULT_TRAIL: ResolvedCosmetic = {
  type: "transportTrail",
  cosmetic: null,
  colorPalette: null,
  relationship: "owned",
  key: "transportTrail:default",
};

@customElement("transport-trail-modal")
export class TransportTrailModal extends BaseModal {
  protected routerName = "transport-trail";

  @state() private selectedTrailName: string | null = null;
  @state() private search = "";

  private cosmetics: Cosmetics | null = null;
  private userSettings: UserSettings = new UserSettings();
  private userMeResponse: UserMeResponse | false = false;

  private _onTrailSelected = async () => {
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
      `${USER_SETTINGS_CHANGED_EVENT}:${TRANSPORT_TRAIL_KEY}`,
      this._onTrailSelected,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${TRANSPORT_TRAIL_KEY}`,
      this._onTrailSelected,
    );
  }

  private async updateFromSettings() {
    const cosmetics = await getPlayerCosmetics();
    this.selectedTrailName = cosmetics.transportTrail?.name ?? null;
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    await this.updateFromSettings();
    this.refresh();
  }

  private includedInSearch(name: string): boolean {
    const displayName = name.replace(/_/g, " ");
    return displayName.toLowerCase().includes(this.search.toLowerCase());
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private renderGrid(): TemplateResult {
    const owned = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      null,
    ).filter(
      (r) =>
        r.type === "transportTrail" &&
        r.relationship === "owned" &&
        this.includedInSearch(r.cosmetic?.name ?? ""),
    );
    // The default (clear) tile always shows; the search filter only narrows
    // the owned cosmetics.
    const items = this.search ? owned : [DEFAULT_TRAIL, ...owned];

    return html`
      <div class="flex flex-col">
        <div
          class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
        >
          ${items.map((r) => {
            const name = (r.cosmetic as TransportTrail | null)?.name ?? null;
            const isSelected =
              (name === null && this.selectedTrailName === null) ||
              (name !== null && this.selectedTrailName === name);
            return html`
              <cosmetic-button
                .resolved=${r}
                .selected=${isSelected}
                .onSelect=${(rc: ResolvedCosmetic) => this.selectTrail(rc)}
              ></cosmetic-button>
            `;
          })}
        </div>
      </div>
    `;
  }

  protected renderHeaderSlot() {
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("transport_trails.title"),
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
            placeholder=${translateText("transport_trails.search")}
            .value=${this.search}
            @change=${this.handleSearch}
            @keyup=${this.handleSearch}
          />
        </div>
      </div>
    `;
  }

  protected renderBody() {
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
      <div class="px-3 pb-3">${this.renderGrid()}</div>
    `;
  }

  protected async onOpen(): Promise<void> {
    await this.refresh();
  }

  protected onClose(): void {
    this.search = "";
  }

  private selectTrail(resolved: ResolvedCosmetic) {
    const name = (resolved.cosmetic as TransportTrail | null)?.name ?? null;
    this.userSettings.setSelectedTransportTrailName(name ?? undefined);
    this.selectedTrailName = name;
    this.refresh();
    this.close();
  }

  public async refresh() {
    this.requestUpdate();
  }
}
