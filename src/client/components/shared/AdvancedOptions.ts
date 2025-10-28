import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { renderRulesOptions } from "../../../client/utilities/RenderRulesOptions";
import { renderUnitTypeOptions } from "../../../client/utilities/RenderUnitTypeOptions";
import { translateText } from "../../../client/Utils";
import { UnitType } from "../../../core/game/Game";

type Rules = {
  disableNPCs: boolean;
  instantBuild: boolean;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  compactMap: boolean;
  donateGold?: boolean;
  donateTroops?: boolean;
};

@customElement("of-advanced-options")
export class AdvancedOptions extends LitElement {
  @property({ type: Object }) rules!: Rules;
  @property({ type: Array }) disabledUnits: UnitType[] = [];

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <details class="rounded-xl border border-white/15 ">
        <summary
          class="cursor-pointer px-3 py-3 font-semibold hover:bg-white/5 transition-colors text-zinc-100"
        >
          ${translateText("game_options.advanced_options")}
        </summary>
        <div class="border-t border-white/15 p-3 flex flex-col min-h-0">
          <div class="mb-2 text-center text-sm font-semibold text-zinc-200">
            ${translateText("game_options.rules")}
          </div>
          <div
            class="grid grid-cols-2 gap-2 max-h-72 sm:max-h-80 overflow-auto pr-1 [scrollbar-gutter:stable]"
          >
            ${renderRulesOptions({
              values: this.rules,
              toggleRule: (key: string, checked: boolean) =>
                this.dispatchEvent(
                  new CustomEvent("toggle-rule", {
                    detail: { key, checked },
                    bubbles: true,
                    composed: true,
                  }),
                ),
            })}
            ${"donateGold" in this.rules
              ? html`<label
                  class="group w-full cursor-pointer select-none rounded-xl border p-2 flex items-center justify-between gap-3 transition-colors ${this
                    .rules.donateGold
                    ? "border-emerald-400/40 bg-transparent text-zinc-100"
                    : "border-white/15 bg-transparent text-zinc-200 hover:border-white/25 hover:bg-white/5"}"
                  title="${translateText("common.donate_gold")}"
                >
                  <div class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      class="h-4 w-4 accent-blue-400"
                      .checked=${this.rules.donateGold}
                      @change=${(e: Event) =>
                        this.dispatchEvent(
                          new CustomEvent("toggle-rule", {
                            detail: {
                              key: "donateGold",
                              checked: (e.target as HTMLInputElement).checked,
                            },
                            bubbles: true,
                            composed: true,
                          }),
                        )}
                      aria-label=${translateText("game_options.donate_gold")}
                    />
                    <span class="font-medium leading-6">
                      ${translateText("game_options.donate_gold")}
                    </span>
                  </div>
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${this
                      .rules.donateGold
                      ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100"
                      : "border-rose-400/30 bg-rose-400/20 text-rose-100"}"
                    aria-hidden="true"
                    >${this.rules.donateGold ? "On" : "Off"}</span
                  >
                </label>`
              : null}
            ${"donateTroops" in this.rules
              ? html`<label
                  class="group w-full cursor-pointer select-none rounded-xl border p-2 flex items-center justify-between gap-3 transition-colors ${this
                    .rules.donateTroops
                    ? "border-emerald-400/40 bg-transparent text-zinc-100"
                    : "border-white/15 bg-transparent text-zinc-200 hover:border-white/25 hover:bg-white/5"}"
                  title="${translateText("common.donate_troops")}"
                >
                  <div class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      class="h-4 w-4 accent-blue-400"
                      .checked=${this.rules.donateTroops}
                      @change=${(e: Event) =>
                        this.dispatchEvent(
                          new CustomEvent("toggle-rule", {
                            detail: {
                              key: "donateTroops",
                              checked: (e.target as HTMLInputElement).checked,
                            },
                            bubbles: true,
                            composed: true,
                          }),
                        )}
                      aria-label=${translateText("game_options.donate_troops")}
                    />
                    <span class="font-medium leading-6">
                      ${translateText("game_options.donate_troops")}
                    </span>
                  </div>
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${this
                      .rules.donateTroops
                      ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100"
                      : "border-rose-400/30 bg-rose-400/20 text-rose-100"}"
                    aria-hidden="true"
                    >${this.rules.donateTroops ? "On" : "Off"}</span
                  >
                </label>`
              : null}
          </div>

          <div class="my-2 h-px bg-white/15"></div>

          <div class="mb-2 text-center text-sm font-semibold text-zinc-200">
            ${translateText("game_options.units_and_buildings")}
          </div>
          <div
            class="grid grid-cols-2 gap-2 max-h-72 sm:max-h-80 overflow-auto pr-1 [scrollbar-gutter:stable]"
          >
            ${renderUnitTypeOptions({
              disabledUnits: this.disabledUnits,
              toggleUnit: (unit: UnitType, checked: boolean) =>
                this.dispatchEvent(
                  new CustomEvent("toggle-unit", {
                    detail: { unit, checked },
                    bubbles: true,
                    composed: true,
                  }),
                ),
            })}
          </div>
        </div>
      </details>
    `;
  }
}
