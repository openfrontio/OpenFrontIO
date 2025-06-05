import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerActions, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { PlayerView } from "../../../core/game/GameView";
import {
  BuildUnitIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendQuickChatEvent,
  SendSpawnIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { UIState } from "../UIState";

export class PlayerActionHandler {
  constructor(
    private eventBus: EventBus,
    private uiState: UIState,
  ) {}

  async getPlayerActions(
    player: PlayerView,
    tile: TileRef,
  ): Promise<PlayerActions> {
    return await player.actions(tile);
  }

  handleAttack(player: PlayerView, targetId: string | null) {
    this.eventBus.emit(
      new SendAttackIntentEvent(
        targetId,
        this.uiState.attackRatio * player.troops(),
      ),
    );
  }

  handleBoatAttack(
    player: PlayerView,
    targetId: string,
    targetCell: Cell,
    spawnTile: Cell | null,
  ) {
    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        targetId,
        targetCell,
        this.uiState.attackRatio * player.troops(),
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

  handleBuildUnit(unitType: UnitType, cellX: number, cellY: number) {
    this.eventBus.emit(
      new BuildUnitIntentEvent(unitType, new Cell(cellX, cellY)),
    );
  }

  handleSpawn(spawnCell: Cell) {
    this.eventBus.emit(new SendSpawnIntentEvent(spawnCell));
  }

  handleAllianceRequest(player: PlayerView, recipient: PlayerView) {
    this.eventBus.emit(new SendAllianceRequestIntentEvent(player, recipient));
  }

  handleBreakAlliance(player: PlayerView, recipient: PlayerView) {
    this.eventBus.emit(new SendBreakAllianceIntentEvent(player, recipient));
  }

  handleTargetPlayer(targetId: string | null) {
    if (!targetId) return;

    this.eventBus.emit(new SendTargetPlayerIntentEvent(targetId));
  }

  handleDonateGold(recipient: PlayerView) {
    this.eventBus.emit(new SendDonateGoldIntentEvent(recipient, null));
  }

  handleDonateTroops(recipient: PlayerView) {
    this.eventBus.emit(new SendDonateTroopsIntentEvent(recipient, null));
  }

  handleEmbargo(recipient: PlayerView, action: "start" | "stop") {
    this.eventBus.emit(new SendEmbargoIntentEvent(recipient, action));
  }

  handleEmoji(targetPlayer: PlayerView | "AllPlayers", emojiIndex: number) {
    this.eventBus.emit(new SendEmojiIntentEvent(targetPlayer, emojiIndex));
  }

  handleQuickChat(recipient: PlayerView, chatKey: string, params: any = {}) {
    this.eventBus.emit(new SendQuickChatEvent(recipient, chatKey, params));
  }
}
