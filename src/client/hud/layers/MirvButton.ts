import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  Gold,
  MAX_MISSILE_BARRAGE_ROCKETS,
  MISSILE_BARRAGE_STRUCTURE_TYPES,
  MissileBarrageStructureType,
  MissileBarrageTargetMode,
  PlayerID,
  UnitType,
} from "../../../core/game/Game";
import { OModal } from "../../components/baseComponents/Modal";
import { Controller } from "../../Controller";
import {
  CancelMissileBarrageTargetingEvent,
  MissileBarrageTargetSelectedEvent,
  OpenMissileBarrageEvent,
} from "../../InputHandler";
import { SendMissileBarrageIntentEvent } from "../../Transport";
import { renderNumber } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import {
  cityIcon,
  defensePostIcon,
  factoryIcon,
  goldCoinIcon,
  mirvIcon,
  missileSiloIcon,
  portIcon,
  researchFacilityIcon,
  samLauncherIcon,
} from "../HotbarIcons";

const structureIcons: Record<MissileBarrageStructureType, string> = {
  [UnitType.City]: cityIcon,
  [UnitType.Port]: portIcon,
  [UnitType.Factory]: factoryIcon,
  [UnitType.DefensePost]: defensePostIcon,
  [UnitType.SAMLauncher]: samLauncherIcon,
  [UnitType.MissileSilo]: missileSiloIcon,
  [UnitType.ResearchFacility]: researchFacilityIcon,
};

@customElement("mirv-button")
export class MirvButton extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  private atomBuildable: BuildableUnit | null = null;
  @query("o-modal") private modal?: OModal;
  @state() private awaitingTarget = false;
  @state() private targetID = "";
  @state() private amount = 1;
  @state() private mode: MissileBarrageTargetMode = "all_buildings";
  @state() private targetTypes: MissileBarrageStructureType[] = [];

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(OpenMissileBarrageEvent, () =>
      this.beginTargetSelection(),
    );
    this.eventBus.on(MissileBarrageTargetSelectedEvent, (event) =>
      this.selectTarget(event.targetID),
    );
    this.eventBus.on(CancelMissileBarrageTargetingEvent, () => {
      this.awaitingTarget = false;
    });
    this.requestUpdate();
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, [UnitType.AtomBomb]).then((buildables) => {
      this.atomBuildable = buildables[0] ?? null;
      const max = this.maxLaunchCount();
      if (this.amount > max) this.amount = Math.max(1, max);
      this.requestUpdate();
    });
  }

  private cost(): Gold {
    return this.atomBuildable?.cost ?? 0n;
  }

  private opponents(): PlayerView[] {
    const me = this.game?.myPlayer();
    if (!me) return [];
    return this.game
      .players()
      .filter(
        (player) =>
          player !== me && player.isAlive() && !me.isOnSameTeam(player),
      )
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
  }

  private target(): PlayerView | null {
    return (
      this.opponents().find((player) => player.id() === this.targetID) ?? null
    );
  }

  private maxLaunchCount(): number {
    const player = this.game?.myPlayer();
    if (!player || !this.atomBuildable) return 0;
    const cost = this.cost();
    const affordable =
      cost === 0n ? MAX_MISSILE_BARRAGE_ROCKETS : Number(player.gold() / cost);
    return Math.min(
      player.readyMissileCount(),
      affordable,
      MAX_MISSILE_BARRAGE_ROCKETS,
    );
  }

  private canOpen(): boolean {
    return (
      !this.game.config().isUnitDisabled(UnitType.MIRV) &&
      !this.game.config().isUnitDisabled(UnitType.AtomBomb) &&
      this.maxLaunchCount() > 0 &&
      this.opponents().length > 0
    );
  }

  private beginTargetSelection() {
    if (!this.canOpen()) return;
    this.targetID = "";
    this.awaitingTarget = true;
    this.modal?.close();
    this.requestUpdate();
  }

  private selectTarget(targetID: PlayerID) {
    if (!this.awaitingTarget) return;
    const target = this.opponents().find((player) => player.id() === targetID);
    if (!target) return;
    this.awaitingTarget = false;
    this.targetID = target.id();
    this.mode = "all_buildings";
    this.targetTypes = [];
    this.amount = Math.max(1, Math.floor(this.maxLaunchCount() / 2));
    this.requestUpdate();
    void this.updateComplete.then(() => this.modal?.open());
  }

  private closeModal() {
    this.modal?.close();
  }

  private eligibleTargets(): number {
    const target = this.target();
    if (!target) return 0;
    if (this.mode === "territory") return target.numTilesOwned();
    const types =
      this.mode === "all_buildings"
        ? MISSILE_BARRAGE_STRUCTURE_TYPES
        : this.targetTypes;
    return target.units(...types).filter((unit) => unit.isActive()).length;
  }

  private toggleTargetType(type: MissileBarrageStructureType) {
    if (this.mode !== "selected_types") {
      this.mode = "selected_types";
      this.targetTypes = [type];
      return;
    }
    this.targetTypes = this.targetTypes.includes(type)
      ? this.targetTypes.filter((current) => current !== type)
      : [...this.targetTypes, type];
  }

  private confirm() {
    const amount = Math.min(
      this.maxLaunchCount(),
      Math.max(1, Math.floor(this.amount)),
    );
    if (
      !this.targetID ||
      amount < 1 ||
      this.eligibleTargets() < 1 ||
      (this.mode === "selected_types" && this.targetTypes.length === 0)
    ) {
      return;
    }
    this.eventBus.emit(
      new SendMissileBarrageIntentEvent(
        this.targetID,
        amount,
        this.mode,
        this.targetTypes,
      ),
    );
    this.closeModal();
  }

  private modeIcon(mode: "all_buildings" | "territory") {
    switch (mode) {
      case "all_buildings":
        return html`<svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 21V9l5-3v3l5-3v4l8-4v15h-7v-6h-4v6H3Zm3-3h2v-3H6v3Zm0-5h2v-2H6v2Zm7 0h2v-2h-2v2Zm4 0h2v-2h-2v2Zm0 5h2v-3h-2v3Z"
          />
        </svg>`;
      case "territory":
        return html`<svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="m3 5 6-3 6 3 6-3v17l-6 3-6-3-6 3V5Zm7-.3v12.55l4 2V6.75l-4-2Zm-5 1.54v12.52l3-1.5V4.74l-3 1.5Zm11 .5v12.52l3-1.5V5.24l-3 1.5Z"
          />
        </svg>`;
    }
  }

  private renderMode(mode: "all_buildings" | "territory", label: string) {
    const selected = this.mode === mode;
    return html`<button
      class="flex size-11 items-center justify-center rounded-lg border p-2.5 ${selected
        ? "border-red-300 bg-red-700 text-white"
        : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}"
      aria-label=${label}
      aria-pressed=${selected}
      title=${label}
      @click=${() => (this.mode = mode)}
    >
      ${this.modeIcon(mode)}
    </button>`;
  }

  render() {
    const player = this.game?.myPlayer();
    if (
      !this.game ||
      !player ||
      this.game.inSpawnPhase() ||
      !player.isAlive() ||
      this.game.config().isUnitDisabled(UnitType.MIRV)
    ) {
      return null;
    }
    const max = this.maxLaunchCount();
    const totalCost = this.cost() * BigInt(Math.min(this.amount, max));
    const confirmDisabled =
      !this.targetID ||
      max === 0 ||
      this.eligibleTargets() === 0 ||
      (this.mode === "selected_types" && this.targetTypes.length === 0);

    return html`
      <button
        class="${this.canOpen()
          ? "cursor-pointer hover:scale-105 hover:brightness-110"
          : "cursor-not-allowed opacity-40 grayscale"} relative flex size-20 items-center justify-center rounded-full border-2 border-red-200 bg-gradient-to-br from-red-500 via-red-700 to-red-950 shadow-[0_0_24px_rgba(239,68,68,0.75)] transition-all"
        aria-label="Missile Barrage"
        title="Missile Barrage"
        ?disabled=${!this.canOpen()}
        @click=${() => this.eventBus.emit(new OpenMissileBarrageEvent())}
      >
        <span
          class="absolute inset-2 rounded-full border border-red-300/40"
        ></span>
        <img
          src=${mirvIcon}
          alt=""
          class="relative z-10 size-12 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]"
        />
      </button>

      ${this.awaitingTarget
        ? html`<div
            class="absolute bottom-1 left-24 w-max rounded-lg border border-red-400/60 bg-zinc-950/95 px-3 py-2 text-sm font-semibold text-white shadow-lg"
          >
            Select an enemy country <span class="text-zinc-400">(Esc)</span>
          </div>`
        : null}

      <o-modal title="Missile Barrage" maxWidth="460px">
        <div class="space-y-3 p-4 text-zinc-100">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-zinc-400">Target country</span>
            <strong class="truncate text-red-300"
              >${this.target()?.name() ?? "-"}</strong
            >
          </div>

          <div>
            <div class="mb-2 text-sm font-semibold">Targets</div>
            <div class="flex flex-wrap justify-center gap-1.5">
              ${this.renderMode("all_buildings", "All Buildings")}
              ${MISSILE_BARRAGE_STRUCTURE_TYPES.map((type) => {
                const selected =
                  this.mode === "selected_types" &&
                  this.targetTypes.includes(type);
                return html`<button
                  class="flex size-11 items-center justify-center rounded-lg border p-2.5 ${selected
                    ? "border-red-300 bg-red-800"
                    : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"}"
                  aria-label=${type}
                  aria-pressed=${selected}
                  title=${type}
                  @click=${() => this.toggleTargetType(type)}
                >
                  <img
                    class="size-6 object-contain"
                    src=${structureIcons[type]}
                    alt=""
                  />
                </button>`;
              })}
              ${this.renderMode("territory", "Any Territory")}
            </div>
          </div>

          <div class="rounded-lg bg-zinc-900/70 p-3">
            <div class="mb-2 flex justify-between text-sm">
              <span>Rockets: <b>${Math.min(this.amount, max)}</b></span>
              <span>Ready and affordable: <b>${max}</b></span>
            </div>
            <input
              class="w-full accent-red-600"
              type="range"
              min="1"
              .max=${Math.max(1, max).toString()}
              .value=${Math.min(this.amount, Math.max(1, max)).toString()}
              @input=${(event: Event) => {
                this.amount = Number((event.target as HTMLInputElement).value);
              }}
            />
            <div class="mt-2 flex justify-between text-xs text-zinc-400">
              <span>${player.readyMissileCount()} ready silo slots</span>
              <span>${this.eligibleTargets()} eligible targets</span>
            </div>
          </div>

          <div class="flex items-center justify-between px-1 text-sm">
            <span>Total cost</span>
            <span class="flex items-center gap-2 font-semibold text-yellow-300">
              <img src=${goldCoinIcon} width="16" height="16" />
              ${renderNumber(totalCost)}
            </span>
          </div>

          <div class="flex justify-end gap-2">
            <button
              class="rounded-lg bg-zinc-700 px-4 py-2"
              @click=${this.closeModal}
            >
              Cancel
            </button>
            <button
              class="rounded-lg bg-red-700 px-5 py-2 font-bold text-white enabled:hover:bg-red-600 disabled:opacity-40"
              ?disabled=${confirmDisabled}
              @click=${this.confirm}
            >
              Launch Barrage
            </button>
          </div>
        </div>
      </o-modal>
    `;
  }
}
