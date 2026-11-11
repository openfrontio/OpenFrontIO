import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

interface IconFile {
  file: string;
  /** Drawn as an <img> to keep its colours; other icons take currentColor. */
  multicolor?: boolean;
  /** The file is 100×125 with the artist's credit in the bottom 25 units. */
  crop?: boolean;
}

export const OF_ICONS = {
  close: { file: "XIcon.svg", crop: true },
  back: { file: "BackIconWhite.svg" },
  check: { file: "CheckIconWhite.svg" },
  "chevron-right": { file: "ChevronRightIconWhite.svg" },
  plus: { file: "PlusIconWhite.svg" },
  hourglass: { file: "HourglassIconWhite.svg" },
  settings: { file: "SettingIconWhite.svg" },
  graphics: { file: "MonitorIconWhite.svg" },
  terrain: { file: "TreeIconWhite.svg" },
  debug: { file: "BugIconWhite.svg" },
  save: { file: "SaveIconWhite.svg" },
  exit: { file: "ExitIconWhite.svg" },
  share: { file: "ShareIconWhite.svg" },
  land: { file: "ClaimIcon.svg" },
  leaderboard: { file: "LeaderboardIconSolidWhite.svg" },
  team: { file: "TeamIconSolidWhite.svg" },
  gold: { file: "GoldCoinIcon.svg", multicolor: true },
  troops: { file: "SoldierIcon.svg" },
  traitor: { file: "TraitorIcon.svg" },
  trade: { file: "TradingIconWhite.svg" },
  embargo: { file: "StopIconWhite.svg" },
  alliance: { file: "AllianceIconWhite.svg" },
  "break-alliance": { file: "TraitorIconWhite.svg" },
  chat: { file: "ChatIconWhite.svg" },
  emoji: { file: "EmojiIconWhite.svg" },
  target: { file: "TargetIconWhite.svg" },
  "donate-troops": { file: "DonateTroopIconWhite.svg" },
  "donate-gold": { file: "DonateGoldIconWhite.svg" },
  report: { file: "SirenIconWhite.svg" },
  shield: { file: "ShieldIconWhite.svg" },
  nation: { file: "CityIconWhite.svg" },
  tribe: { file: "SwordIconWhite.svg" },
  swap: { file: "SwapIconWhite.svg" },
} as const satisfies Record<string, IconFile>;

export type OfIconName = keyof typeof OF_ICONS;

/**
 * One of the game's icons, painted in the current text colour. Decorative
 * only: the control around it carries the accessible name.
 */
@customElement("of-icon")
export class OfIcon extends LitElement {
  @property()
  name!: OfIconName;

  @property({ type: Number })
  size: number = 16;

  createRenderRoot() {
    return this;
  }

  render() {
    const icon: IconFile | undefined = OF_ICONS[this.name];
    if (icon === undefined) {
      return html``;
    }
    const src = assetUrl(`images/${icon.file}`);
    if (icon.multicolor) {
      return html`<img
        src=${src}
        width=${this.size}
        height=${this.size}
        alt=""
        aria-hidden="true"
        draggable="false"
        class="block"
      />`;
    }
    // The mask uses the file's alpha, so its fill colour does not matter. A
    // cropped file is sized to the box's width and the credit falls below it.
    const mask = `url('${src}') ${icon.crop ? "top / 100% 125%" : "center / contain"} no-repeat`;
    return html`<span
      aria-hidden="true"
      class="block bg-current"
      style="width:${this.size}px; height:${this.size}px; mask:${mask}; -webkit-mask:${mask};"
    ></span>`;
  }
}
