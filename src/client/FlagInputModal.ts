import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { UserMeResponse } from "src/core/ApiSchemas";
import { assetUrl } from "src/core/AssetUrls";
import { Cosmetics } from "src/core/CosmeticSchemas";
import { UserSettings } from "src/core/game/UserSettings";
import { getUserMe } from "./Api";
import { fetchCosmetics, flagRelationship } from "./Cosmetics";
import { translateText } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/FlagButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";

@customElement("flag-input-modal")
export class FlagInputModal extends BaseModal {
  @state() private search = "";
  @state() private cosmetics: Cosmetics | null = null;
  @state() private userMe: UserMeResponse | false = false;
  public returnTo = "";

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
  }

  private renderFlags() {
    const userSettings = new UserSettings();
    const selectedFlag = userSettings.getFlag() ?? "";
    const onSelect = (flagKey: string) => {
      this.setFlag(flagKey);
      this.close();
    };

    const cosmeticFlags = Object.entries(this.cosmetics?.flags ?? {})
      .filter(([, flag]) => {
        if (!this.includedInSearch({ name: flag.name, code: flag.name }))
          return false;
        return flagRelationship(flag, this.userMe, null) === "owned";
      })
      .map(
        ([key, flag]) => html`
          <flag-button
            .flag=${{ ...flag, key: `flag:${key}` }}
            .selected=${selectedFlag === `flag:${key}`}
            .onSelect=${onSelect}
          ></flag-button>
        `,
      );

    const noFlag = this.search
      ? null
      : html`
          <flag-button
            .flag=${{
              key: "country:xx",
              name: "None",
              url: assetUrl("/flags/xx.svg"),
            }}
            .selected=${selectedFlag === "" || selectedFlag === "country:xx"}
            .onSelect=${onSelect}
          ></flag-button>
        `;

    const countryFlags = Countries.filter(
      (country) =>
        country.code !== "xx" &&
        !country.restricted &&
        this.includedInSearch(country),
    ).map(
      (country) => html`
        <flag-button
          .flag=${{
            key: `country:${country.code}`,
            name: country.name,
            url: assetUrl(`/flags/${country.code}.svg`),
          }}
          .selected=${selectedFlag === `country:${country.code}`}
          .onSelect=${onSelect}
        ></flag-button>
      `,
    );

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${noFlag} ${cosmeticFlags} ${countryFlags}
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
            title: translateText("flag_input.title"),
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
              placeholder=${translateText("flag_input.search_flag")}
              .value=${this.search}
              @change=${this.handleSearch}
              @keyup=${this.handleSearch}
            />
          </div>
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
          ${this.renderFlags()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="flag-input-modal"
        title=${translateText("flag_input.title")}
        ?inline=${this.inline}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }

  private includedInSearch(country: { name: string; code: string }): boolean {
    return (
      country.name.toLowerCase().includes(this.search.toLowerCase()) ||
      country.code.toLowerCase().includes(this.search.toLowerCase())
    );
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private setFlag(flag: string) {
    new UserSettings().setFlag(flag);
  }

  protected async onOpen(): Promise<void> {
    [this.cosmetics, this.userMe] = await Promise.all([
      fetchCosmetics(),
      getUserMe().then((r) => r || (false as const)),
    ]);
  }

  protected onClose(): void {
    this.search = "";
    if (this.returnTo) {
      const returnEl = document.querySelector(this.returnTo) as any;
      if (returnEl?.open) {
        returnEl.open();
      }
      this.returnTo = "";
    }
  }
}
