import { TemplateResult, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import type { UserMeResponse } from "../core/ApiSchemas";
import { GameMapType, mapCategories } from "../core/game/Game";
import { publicLobbyMaps } from "../core/game/PublicLobbyMaps";
import { hasLinkedAccount } from "./Api";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/Maps";
import { modalHeader } from "./components/ui/ModalHeader";
import { loadStoredMapVotes, saveStoredMapVotes } from "./MapVoteStorage";

@customElement("map-vote-modal")
export class MapVoteModal extends BaseModal {
  @property({ type: Boolean }) loggedIn = false;
  @state() private selectedMaps = new Set<GameMapType>();

  private readonly availableMaps = new Set(publicLobbyMaps);
  private handleUserMeResponse = (event: Event) => {
    const customEvent = event as CustomEvent<UserMeResponse | false>;
    this.loggedIn = hasLinkedAccount(customEvent.detail);
  };

  constructor() {
    super();
    this.id = "map-vote-modal";
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.handleUserMeResponse);
  }

  disconnectedCallback() {
    document.removeEventListener("userMeResponse", this.handleUserMeResponse);
    super.disconnectedCallback();
  }

  protected onOpen(): void {
    this.selectedMaps = new Set(loadStoredMapVotes());
  }

  private toggleMapSelection(map: GameMapType) {
    const next = new Set(this.selectedMaps);
    if (next.has(map)) {
      next.delete(map);
    } else {
      next.add(map);
    }
    this.selectedMaps = next;
    saveStoredMapVotes(Array.from(next));
    this.dispatchEvent(
      new CustomEvent("map-vote-change", {
        detail: { maps: Array.from(next) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleVoteSubmit = () => {
    const maps = Array.from(this.selectedMaps);
    saveStoredMapVotes(maps);
    this.dispatchEvent(
      new CustomEvent("map-vote-submit", {
        detail: { maps },
        bubbles: true,
        composed: true,
      }),
    );
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: this.loggedIn
            ? translateText("public_lobby.vote_toast_submitted")
            : translateText("public_lobby.vote_saved"),
          color: "green",
          duration: 2500,
        },
      }),
    );
    this.close();
  };

  private renderCategory(
    categoryKey: string,
    maps: GameMapType[],
  ): TemplateResult {
    if (maps.length === 0) return html``;
    return html`
      <div class="w-full">
        <h4
          class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
        >
          ${translateText(`map_categories.${categoryKey}`)}
        </h4>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          ${maps.map((mapValue) => {
            const mapKey = Object.entries(GameMapType).find(
              ([, v]) => v === mapValue,
            )?.[0];
            return html`
              <div
                @click=${() => this.toggleMapSelection(mapValue)}
                class="cursor-pointer transition-transform duration-200 active:scale-95"
              >
                <map-display
                  .mapKey=${mapKey}
                  .selected=${this.selectedMaps.has(mapValue)}
                  .translation=${translateText(`map.${mapKey?.toLowerCase()}`)}
                ></map-display>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  render() {
    const categoryEntries = Object.entries(mapCategories) as Array<
      [string, GameMapType[]]
    >;
    const categories: Array<[string, GameMapType[]]> = categoryEntries
      .map(
        ([categoryKey, maps]) =>
          [categoryKey, maps.filter((map) => this.availableMaps.has(map))] as [
            string,
            GameMapType[],
          ],
      )
      .filter(([, maps]) => maps.length > 0);
    const loginBanner = this.loggedIn
      ? undefined
      : html`<div
          class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0"
        >
          ${translateText("public_lobby.vote_login_required")}
        </div>`;

    const content = html`
      <div class="h-full flex flex-col overflow-hidden select-none">
        ${modalHeader({
          title: translateText("public_lobby.vote_title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: loginBanner,
        })}

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6 mr-1">
          <div class="max-w-5xl mx-auto space-y-6 pt-4">
            <div class="space-y-6">
              <div
                class="flex items-center gap-4 pb-2 border-b border-white/10"
              >
                <div
                  class="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="w-5 h-5"
                  >
                    <path
                      d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z"
                    />
                  </svg>
                </div>
                <h3
                  class="text-lg font-bold text-white uppercase tracking-wider"
                >
                  ${translateText("map.map")}
                </h3>
              </div>

              <div class="space-y-2 text-sm text-white/70">
                <p>${translateText("public_lobby.vote_description")}</p>
                <p class="text-white/50">
                  ${translateText("public_lobby.vote_saved")}
                </p>
              </div>

              <div class="space-y-8">
                ${categories.map(([categoryKey, maps]) =>
                  this.renderCategory(categoryKey, maps),
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          class="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10"
        >
          <button
            class="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-lg bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-colors"
            type="button"
            @click=${() => this.close()}
          >
            ${translateText("common.cancel")}
          </button>
          <button
            class="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            type="button"
            @click=${this.handleVoteSubmit}
          >
            ${translateText("public_lobby.vote_submit")}
          </button>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }
}
