import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { ColorPalette, Cosmetics, Pattern } from "../core/CosmeticSchemas";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { GameConfig } from "../core/Schemas";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticButton";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
  ResolvedCosmetic,
} from "./Cosmetics";
import { translateText } from "./Utils";

type StoreTab = "patterns" | "flags" | "packs" | "subscriptions";

// Units the player cannot build during a skin preview — keeps focus on the
// pattern itself rather than late-game mechanics.
const SKIN_TEST_DISABLED_UNITS: UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.MissileSilo,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.Warship,
];

function buildSkinTestGameConfig(): GameConfig {
  return {
    gameMap: GameMapType.Iceland,
    gameMapSize: GameMapSize.Compact,
    gameType: GameType.Singleplayer,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Easy,
    nations: "disabled",
    bots: 0,
    donateGold: false,
    donateTroops: false,
    instantBuild: false,
    randomSpawn: true,
    infiniteGold: true,
    infiniteTroops: true,
    startingTroops: 10_000_000,
    percentageTilesOwnedToWin: 99,
    disabledUnits: SKIN_TEST_DISABLED_UNITS,
  };
}

function patternDisplayName(name: string): string {
  const translation = translateText(`territory_patterns.pattern.${name}`);
  if (!translation.startsWith("territory_patterns.pattern."))
    return translation;
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

@customElement("store-modal")
export class StoreModal extends BaseModal {
  protected routerName = "store";
  private cosmetics: Cosmetics | null = null;
  private affiliateCode: string | null = null;
  private userMeResponse: UserMeResponse | false = false;

  protected modalConfig() {
    if (this.affiliateCode) {
      // Affiliate mode: hide tabs, show only items associated with the code.
      return {};
    }
    return {
      tabs: [
        { key: "packs", label: translateText("store.packs") },
        { key: "subscriptions", label: translateText("store.subscriptions") },
        { key: "patterns", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
      ],
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.refresh();
  }

  private startTestGame(resolved: ResolvedCosmetic) {
    if (!this.userMeResponse || resolved.type !== "pattern") return;
    const pattern = resolved.cosmetic as Pattern;
    const colorPalette = resolved.colorPalette as ColorPalette | null;
    const clientID = this.userMeResponse.player.publicId;
    const gameID = pattern.name;

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID,
          gameID,
          isSkinTest: true,
          source: "singleplayer",
          gameStartInfo: {
            gameID,
            players: [
              {
                clientID,
                username: patternDisplayName(pattern.name),
                cosmetics: {
                  pattern: {
                    name: pattern.name,
                    patternData: pattern.pattern,
                    colorPalette: colorPalette ?? undefined,
                  },
                },
              },
            ],
            config: buildSkinTestGameConfig(),
            lobbyCreatedAt: Date.now(),
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderHeader(): TemplateResult {
    return modalHeader({
      title: translateText("store.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
    });
  }

  private renderPatternGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "pattern" &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_skins")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
              .onTest=${this.userMeResponse !== false
                ? (resolved: ResolvedCosmetic) => this.startTestGame(resolved)
                : undefined}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderFlagGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "flag" &&
        r.relationship !== "blocked" &&
        r.relationship !== "owned",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_flags")}
      </div>`;
    }

    const selectedFlag = new UserSettings().getFlag() ?? "";
    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .selected=${selectedFlag === r.key}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderPackGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter((r) => r.type === "pack" && r.relationship === "purchasable");

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_packs")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  private renderSubscriptionGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        r.type === "subscription" &&
        (r.relationship === "purchasable" || r.relationship === "owned"),
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_subscriptions")}
      </div>`;
    }

    const userHasSubscription =
      this.userMeResponse !== false &&
      this.userMeResponse.player.subscription !== null;

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
              .userHasSubscription=${userHasSubscription}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected renderHeaderSlot() {
    return this.renderHeader();
  }

  protected renderBody(key: string): TemplateResult {
    if (this.affiliateCode) {
      return this.renderAffiliateGrid();
    }
    switch (key as StoreTab) {
      case "patterns":
        return this.renderPatternGrid();
      case "flags":
        return this.renderFlagGrid();
      case "subscriptions":
        return this.renderSubscriptionGrid();
      case "packs":
      default:
        return this.renderPackGrid();
    }
  }

  private renderAffiliateGrid(): TemplateResult {
    const items = resolveCosmetics(
      this.cosmetics,
      this.userMeResponse,
      this.affiliateCode,
    ).filter(
      (r) =>
        (r.type === "pattern" || r.type === "flag" || r.type === "pack") &&
        r.relationship === "purchasable",
    );

    if (items.length === 0) {
      return html`<div
        class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
      >
        ${translateText("store.no_skins")}
      </div>`;
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-8 justify-center items-stretch content-start"
      >
        ${items.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  protected async onOpen(args?: Record<string, unknown>) {
    const affiliate =
      typeof args?.affiliateCode === "string" ? args.affiliateCode : null;
    this.affiliateCode = affiliate;
    this.cosmetics ??= await fetchCosmetics();
    await this.refresh();
  }

  protected onClose(): void {
    this.affiliateCode = null;
  }

  public async refresh() {
    this.requestUpdate();
  }
}
