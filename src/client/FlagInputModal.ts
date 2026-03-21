import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import Countries from "resources/countries.json" with { type: "json" };
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { getUserMe } from "./Api";
import { fetchCosmetics, flagRelationship } from "./Cosmetics";
import { translateText } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/FlagButton";
import { modalHeader } from "./components/ui/ModalHeader";

@customElement("flag-input-modal")
export class FlagInputModal extends BaseModal {
  @query("#flag-input-modal") private modalRef!: HTMLElement;

  @state() private search = "";
  @state() private cosmetics: Cosmetics | null = null;
  @state() private userMe: UserMeResponse | false = false;
  public returnTo = "";

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
  }

  private renderFlags() {
    const selectedFlag = localStorage.getItem("flag") ?? "";
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
            .flag=${{ key: `flag:${key}`, name: flag.name, url: flag.url }}
            .selected=${selectedFlag === `flag:${key}`}
            .onSelect=${onSelect}
          ></flag-button>
        `,
      );

    const countryFlags = Countries.filter(
      (country) => !country.restricted && this.includedInSearch(country),
    ).map(
      (country) => html`
        <flag-button
          .flag=${{
            key: `country:${country.code}`,
            name: country.name,
            url: `/flags/${country.code}.svg`,
          }}
          .selected=${selectedFlag === `country:${country.code}`}
          .onSelect=${onSelect}
        ></flag-button>
      `,
    );

    return html`
      <div
        class="pt-2 flex flex-wrap gap-4 justify-center items-stretch content-start"
      >
        ${cosmeticFlags} ${countryFlags}
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
          })}

          <div class="md:flex items-center gap-2 justify-center mt-4">
            <input
              class="h-12 w-full max-w-md border border-white/10 bg-black/60
              rounded-xl shadow-inner text-xl text-center focus:outline-none
              focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all"
              type="text"
              placeholder=${translateText("flag_input.search_flag")}
              @change=${this.handleSearch}
              @keyup=${this.handleSearch}
            />
          </div>
        </div>

        <div
          class="flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mr-1"
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
    localStorage.setItem("flag", flag);
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected async onOpen(): Promise<void> {
    [this.cosmetics, this.userMe] = await Promise.all([
      fetchCosmetics(),
      getUserMe().then((r) => r || (false as const)),
    ]);
  }

  protected onClose(): void {
    if (this.returnTo) {
      const returnEl = document.querySelector(this.returnTo) as any;
      if (returnEl?.open) {
        returnEl.open();
      }
      this.returnTo = "";
    }
  }
}
