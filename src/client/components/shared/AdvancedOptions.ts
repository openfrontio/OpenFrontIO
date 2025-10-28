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

@customElement("advanced-options")
export class AdvancedOptions extends LitElement {
  @property({ type: Object }) rules!: Rules;
  @property({ type: Array }) disabledUnits: UnitType[] = [];

  createRenderRoot() {
    return this;
  }

  private renderRule(
    key: "donateGold" | "donateTroops",
    checked: boolean,
    translationKey: string,
  ) {
    const cardBase =
      "group w-full cursor-pointer select-none rounded-xl border p-2 flex items-center justify-between gap-3 transition-colors";
    const cardClasses = checked
      ? "border-emerald-400/40 bg-transparent text-zinc-100"
      : "border-white/15 bg-transparent text-zinc-200 hover:border-white/25 hover:bg-white/5";
    const chipBase =
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
    const chipClasses = checked
      ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100"
      : "border-rose-400/30 bg-rose-400/20 text-rose-100";

    const labelText = translateText(translationKey);

    return html`<label class="${cardBase} ${cardClasses}" title="${labelText}">
      <div class="flex items-center gap-3">
        <input
          type="checkbox"
          class="h-4 w-4 accent-blue-400"
          .checked=${checked}
          @change=${(e: Event) =>
            this.dispatchEvent(
              new CustomEvent("toggle-rule", {
                detail: {
                  key,
                  checked: (e.target as HTMLInputElement).checked,
                },
                bubbles: true,
                composed: true,
              }),
            )}
          aria-label=${labelText}
        />
        <span class="font-medium leading-6">${labelText}</span>
      </div>
      <span class="${chipBase} ${chipClasses}" aria-hidden="true"
        >${checked ? "On" : "Off"}</span
      >
    </label>`;
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
              ? this.renderRule(
                  "donateGold",
                  this.rules.donateGold as boolean,
                  "game_options.donate_gold",
                )
              : null}
            ${"donateTroops" in this.rules
              ? this.renderRule(
                  "donateTroops",
                  this.rules.donateTroops as boolean,
                  "game_options.donate_troops",
                )
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
