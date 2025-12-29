import { EventBus } from "../../../core/EventBus";
import { PlayerActions, PlayerID } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { PlayerView } from "../../../core/game/GameView";
import {
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDeleteUnitIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendSpawnIntentEvent,
  SendSurrenderIntentEvent,
  SendTargetPlayerIntentEvent,
  SendForceVassalIntentEvent,
} from "../../Transport";
import { UIState } from "../UIState";
import { translateText } from "../../Utils";

export class PlayerActionHandler {
  constructor(
    private eventBus: EventBus,
    private uiState: UIState,
  ) {}

  private showInlineConfirm(opts: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  }) {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";
    overlay.style.backdropFilter = "blur(2px)";
    overlay.style.fontFamily = "'Inter', system-ui, -apple-system, sans-serif";

    const panel = document.createElement("div");
    panel.style.background = "rgba(22,27,34,0.95)"; // matches radial dark
    panel.style.color = "white";
    panel.style.padding = "18px 20px";
    panel.style.borderRadius = "12px";
    panel.style.minWidth = "260px";
    panel.style.maxWidth = "360px";
    panel.style.boxShadow = "0 12px 36px rgba(0,0,0,0.45)";
    panel.style.border = "1px solid rgba(255,255,255,0.06)";
    panel.style.letterSpacing = "0.01em";
    panel.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px;">${opts.title}</div>
      <div style="font-size:14px; line-height:1.4; margin-bottom:12px;">
        ${opts.message}
      </div>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button data-role="cancel" style="padding:7px 12px; border:none; border-radius:10px; background:#4b5563; color:white; cursor:pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);">
          ${opts.cancelText ?? "Cancel"}
        </button>
        <button data-role="confirm" style="padding:7px 12px; border:none; border-radius:10px; background:linear-gradient(135deg,#22c55e,#16a34a); color:white; cursor:pointer; box-shadow: 0 6px 16px rgba(22,163,74,0.35);">
          ${opts.confirmText ?? "Confirm"}
        </button>
      </div>
    `;
    overlay.appendChild(panel);

    const cleanup = () => overlay.remove();
    panel.querySelector('[data-role="cancel"]')?.addEventListener("click", cleanup);
    panel.querySelector('[data-role="confirm"]')?.addEventListener("click", () => {
      cleanup();
      opts.onConfirm();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cleanup();
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup();
        opts.onConfirm();
      }
    };
    document.addEventListener("keydown", onKey, { once: true });

    document.body.appendChild(overlay);
  }

  async getPlayerActions(
    player: PlayerView,
    tile: TileRef,
  ): Promise<PlayerActions> {
    return await player.actions(tile);
  }

  handleAttack(player: PlayerView, targetId: string | null) {
    const availableTroops =
      player.effectiveTroops?.() ?? player.troops();
    this.eventBus.emit(
      new SendAttackIntentEvent(
        targetId,
        this.uiState.attackRatio * availableTroops,
      ),
    );
  }

  handleBoatAttack(
    player: PlayerView,
    targetId: PlayerID | null,
    targetTile: TileRef,
    spawnTile: TileRef | null,
  ) {
    const availableTroops =
      player.effectiveTroops?.() ?? player.troops();
    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        targetId,
        targetTile,
        this.uiState.attackRatio * availableTroops,
        spawnTile,
      ),
    );
  }

  async findBestTransportShipSpawn(
    player: PlayerView,
    tile: TileRef,
  ): Promise<TileRef | false> {
    return await player.bestTransportShipSpawn(tile);
  }

  handleSpawn(tile: TileRef) {
    this.eventBus.emit(new SendSpawnIntentEvent(tile));
  }

  handleAllianceRequest(player: PlayerView, recipient: PlayerView) {
    this.eventBus.emit(new SendAllianceRequestIntentEvent(player, recipient));
  }

  handleBreakAlliance(player: PlayerView, recipient: PlayerView) {
    this.eventBus.emit(new SendBreakAllianceIntentEvent(player, recipient));
  }

  handleSurrender(
    player: PlayerView,
    recipient: PlayerView,
    goldRatio?: number,
    troopRatio?: number,
  ) {
    if (!player.config().vassalsEnabled()) return;
    this.showInlineConfirm({
      title: translateText("vassal_confirm.title"),
      message:
        translateText("vassal_confirm.message"),
      confirmText: translateText("vassal_confirm.confirm"),
      cancelText: translateText("common.cancel"),
      onConfirm: () =>
        this.eventBus.emit(
          new SendSurrenderIntentEvent(player, recipient, goldRatio, troopRatio),
        ),
    });
  }

  handleTargetPlayer(targetId: string | null) {
    if (!targetId) return;

    this.eventBus.emit(new SendTargetPlayerIntentEvent(targetId));
  }

  handleDonateGold(recipient: PlayerView) {
    this.eventBus.emit(new SendDonateGoldIntentEvent(recipient, null));
  }

  handleDonateTroops(recipient: PlayerView, troops?: number) {
    const amount = troops ?? null;
    if (amount !== null && amount <= 0) {
      return;
    }
    this.eventBus.emit(new SendDonateTroopsIntentEvent(recipient, amount));
  }

  handleEmbargo(recipient: PlayerView, action: "start" | "stop") {
    this.eventBus.emit(new SendEmbargoIntentEvent(recipient, action));
  }

  handleEmoji(targetPlayer: PlayerView | "AllPlayers", emojiIndex: number) {
    this.eventBus.emit(new SendEmojiIntentEvent(targetPlayer, emojiIndex));
  }

  handleDeleteUnit(unitId: number) {
    this.eventBus.emit(new SendDeleteUnitIntentEvent(unitId));
  }

  handleForceVassal(recipient: PlayerView) {
    this.eventBus.emit(new SendForceVassalIntentEvent(recipient));
  }
}
