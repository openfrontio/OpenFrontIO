import { html, TemplateResult } from "lit";
import { translateText } from "../Utils";

export type RuleKey =
  | "disableNPCs"
  | "instantBuild"
  | "infiniteGold"
  | "infiniteTroops"
  | "compactMap";

export interface RulesRenderContext {
  values: Record<RuleKey, boolean>;
  toggleRule: (key: RuleKey, checked: boolean) => void;
}

const rulesOptions: { key: RuleKey; translationKey: string; hint?: string }[] =
  [
    { key: "disableNPCs", translationKey: "game_options.disable_nations" },
    { key: "instantBuild", translationKey: "game_options.instant_build" },
    { key: "infiniteGold", translationKey: "game_options.infinite_gold" },
    { key: "infiniteTroops", translationKey: "game_options.infinite_troops" },
    { key: "compactMap", translationKey: "game_options.compact_map" },
  ];

export function renderRulesOptions({
  values,
  toggleRule,
}: RulesRenderContext): TemplateResult[] {
  return rulesOptions.map(({ key, translationKey, hint }) => {
    const isOn = !!values[key];

    const cardClasses = [
      "group",
      "w-full",
      "cursor-pointer",
      "select-none",
      "rounded-xl",
      "border",
      "p-2",
      "flex",
      "items-center",
      "justify-between",
      "gap-3",
      "transition-colors",
      isOn
        ? "border-emerald-400/40 bg-transparent text-zinc-100"
        : "border-white/15 bg-transparent text-zinc-200 hover:border-white/25 hover:bg-white/5",
    ].join(" ");

    const chipClasses = [
      "inline-flex",
      "items-center",
      "rounded-full",
      "border",
      "px-2",
      "py-0.5",
      "text-xs",
      "font-semibold",
      isOn
        ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100"
        : "border-rose-400/30 bg-rose-400/20 text-rose-100",
    ].join(" ");

    return html`
      <label class="${cardClasses}" title="${translateText(translationKey)}">
        <div class="flex items-center gap-3">
          <input
            type="checkbox"
            class="h-4 w-4 accent-blue-400"
            .checked=${isOn}
            @change=${(e: Event) =>
              toggleRule(key, (e.target as HTMLInputElement).checked)}
            aria-label=${translateText(translationKey)}
          />
          <div class="flex flex-col">
            <span class="font-medium leading-6">
              ${translateText(translationKey)}
            </span>
            ${hint
              ? html`<span class="text-xs text-zinc-400">${hint}</span>`
              : null}
          </div>
        </div>

        <span class="${chipClasses}" aria-hidden="true">
          ${isOn ? translateText("common.on") : translateText("common.off")}
        </span>
      </label>
    `;
  });
}
