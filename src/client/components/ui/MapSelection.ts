import { TemplateResult, html } from "lit";
import {
  Difficulty,
  GameMapType,
  mapCategories,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import {
  MAP_CARD_CLASS_BASE,
  MAP_CARD_CLASS_IDLE,
  MAP_CARD_CLASS_SELECTED,
  MAP_CARD_IMAGE_CLASS_BASE,
  MAP_CARD_IMAGE_WRAPPER_CLASS,
  MAP_CARD_LABEL_CLASS,
} from "../Maps";
import { renderSectionHeader } from "./LobbyModalShell";
import randomMap from "/images/RandomMap.webp?url";

export interface MapSelectionProps {
  selectedMap: GameMapType;
  useRandomMap: boolean;
  onSelectMap: (map: GameMapType) => void;
  onSelectRandomMap: () => void;
  showMedals?: boolean;
  winsByMap?: Map<GameMapType, Set<Difficulty>>;
  specialSectionClassName?: string;
}

const DEFAULT_SPECIAL_SECTION_CLASS = "w-full";
const CATEGORY_TITLE_CLASS =
  "text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2";
const MAP_GRID_CLASS = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";
const MAP_IMAGE_WRAPPER_CLASS = MAP_CARD_IMAGE_WRAPPER_CLASS;
const MAP_TITLE_CLASS = MAP_CARD_LABEL_CLASS;
const MAP_IMAGE_CLASS_BASE = MAP_CARD_IMAGE_CLASS_BASE;

export const renderMapSelection = ({
  selectedMap,
  useRandomMap,
  onSelectMap,
  onSelectRandomMap,
  showMedals,
  winsByMap,
  specialSectionClassName,
}: MapSelectionProps): TemplateResult => {
  const specialSectionClass =
    specialSectionClassName ?? DEFAULT_SPECIAL_SECTION_CLASS;
  const showMedalsValue = showMedals ?? false;
  const emptyWins = new Set<Difficulty>();
  const randomLabel = translateText("map.random");

  const getMapKey = (mapValue: GameMapType) =>
    Object.entries(GameMapType).find(([, value]) => value === mapValue)?.[0];

  const renderMapCard = (mapValue: GameMapType) => {
    const mapKey = getMapKey(mapValue);
    return html`
      <map-display
        @click=${() => onSelectMap(mapValue)}
        .mapKey=${mapKey}
        .selected=${!useRandomMap && selectedMap === mapValue}
        .showMedals=${showMedalsValue}
        .wins=${winsByMap?.get(mapValue) ?? emptyWins}
        .translation=${translateText(`map.${mapKey?.toLowerCase()}`)}
      ></map-display>
    `;
  };

  const renderCategorySection = (
    categoryKey: string,
    maps: GameMapType[],
  ) => html`
    <div class="w-full">
      <h4 class="${CATEGORY_TITLE_CLASS}">
        ${translateText(`map_categories.${categoryKey}`)}
      </h4>
      <div class="${MAP_GRID_CLASS}">${maps.map(renderMapCard)}</div>
    </div>
  `;

  const renderRandomMapCard = () => html`
    <button
      type="button"
      aria-pressed=${useRandomMap}
      aria-label=${randomLabel}
      class="${MAP_CARD_CLASS_BASE} ${useRandomMap
        ? MAP_CARD_CLASS_SELECTED
        : MAP_CARD_CLASS_IDLE}"
      @click=${onSelectRandomMap}
    >
      <div class="${MAP_IMAGE_WRAPPER_CLASS}">
        <img
          src=${randomMap}
          alt=${randomLabel}
          class="${MAP_IMAGE_CLASS_BASE} ${useRandomMap
            ? "opacity-100"
            : "opacity-80"}"
        />
      </div>
      <div class="${MAP_TITLE_CLASS}">${randomLabel}</div>
    </button>
  `;

  return html`
    <div class="space-y-6">
      ${renderSectionHeader({
        titleKey: "map.map",
        iconClassName: "bg-blue-500/20 text-blue-400",
        icon: html`
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
        `,
      })}

      <div class="space-y-8">
        ${Object.entries(mapCategories).map(([categoryKey, maps]) =>
          renderCategorySection(categoryKey, maps),
        )}

        <div class="${specialSectionClass}">
          <h4 class="${CATEGORY_TITLE_CLASS}">
            ${translateText("map_categories.special")}
          </h4>
          <div class="${MAP_GRID_CLASS}">${renderRandomMapCard()}</div>
        </div>
      </div>
    </div>
  `;
};
