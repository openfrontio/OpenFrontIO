import { EventBus } from "../core/EventBus";
import { Cell, UnitType } from "../core/game/Game";
import { GameView, PlayerView } from "../core/game/GameView";
import { flattenedEmojiTable } from "../core/Util";
import { TransformHandler } from "./graphics/TransformHandler";
import {
  BuildUnitIntentEvent,
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  MoveWarshipIntentEvent,
  SendAllianceReplyIntentEvent,
  SendAllianceRequestIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendQuickChatEvent,
  SendSetTargetTroopRatioEvent,
  SendSpawnIntentEvent,
  SendTargetPlayerIntentEvent,
} from "./Transport";

declare global {
  interface Window {
    SendAllianceRequestIntentEvent: typeof SendAllianceRequestIntentEvent;
    SendBreakAllianceIntentEvent: typeof SendBreakAllianceIntentEvent;
    SendAllianceReplyIntentEvent: typeof SendAllianceReplyIntentEvent;
    SendSpawnIntentEvent: typeof SendSpawnIntentEvent;
    SendAttackIntentEvent: typeof SendAttackIntentEvent;
    SendBoatAttackIntentEvent: typeof SendBoatAttackIntentEvent;
    BuildUnitIntentEvent: typeof BuildUnitIntentEvent;
    SendTargetPlayerIntentEvent: typeof SendTargetPlayerIntentEvent;
    SendEmojiIntentEvent: typeof SendEmojiIntentEvent;
    SendDonateGoldIntentEvent: typeof SendDonateGoldIntentEvent;
    SendDonateTroopsIntentEvent: typeof SendDonateTroopsIntentEvent;
    SendQuickChatEvent: typeof SendQuickChatEvent;
    SendEmbargoIntentEvent: typeof SendEmbargoIntentEvent;
    SendSetTargetTroopRatioEvent: typeof SendSetTargetTroopRatioEvent;
    CancelAttackIntentEvent: typeof CancelAttackIntentEvent;
    CancelBoatIntentEvent: typeof CancelBoatIntentEvent;
    MoveWarshipIntentEvent: typeof MoveWarshipIntentEvent;

    EventBus: typeof EventBus;
    PlayerView: typeof PlayerView;
    GameView: typeof GameView;
    TransformHandler: typeof TransformHandler;
    UnitType: typeof UnitType;
    Cell: typeof Cell;

    flattenedEmojiTable: typeof flattenedEmojiTable;
  }
}

export function exposeBrowserGlobals(): void {
  if (typeof window === "undefined") {
    console.warn("exposeBrowserGlobals() called in non-browser environment");
    return;
  }

  window.SendAllianceRequestIntentEvent = SendAllianceRequestIntentEvent;
  window.SendBreakAllianceIntentEvent = SendBreakAllianceIntentEvent;
  window.SendAllianceReplyIntentEvent = SendAllianceReplyIntentEvent;
  window.SendSpawnIntentEvent = SendSpawnIntentEvent;
  window.SendAttackIntentEvent = SendAttackIntentEvent;
  window.SendBoatAttackIntentEvent = SendBoatAttackIntentEvent;
  window.BuildUnitIntentEvent = BuildUnitIntentEvent;
  window.SendTargetPlayerIntentEvent = SendTargetPlayerIntentEvent;
  window.SendEmojiIntentEvent = SendEmojiIntentEvent;
  window.SendDonateGoldIntentEvent = SendDonateGoldIntentEvent;
  window.SendDonateTroopsIntentEvent = SendDonateTroopsIntentEvent;
  window.SendQuickChatEvent = SendQuickChatEvent;
  window.SendEmbargoIntentEvent = SendEmbargoIntentEvent;
  window.SendSetTargetTroopRatioEvent = SendSetTargetTroopRatioEvent;
  window.CancelAttackIntentEvent = CancelAttackIntentEvent;
  window.CancelBoatIntentEvent = CancelBoatIntentEvent;
  window.MoveWarshipIntentEvent = MoveWarshipIntentEvent;

  window.EventBus = EventBus;
  window.PlayerView = PlayerView;
  window.GameView = GameView;
  window.TransformHandler = TransformHandler;
  window.UnitType = UnitType;
  window.Cell = Cell;

  window.flattenedEmojiTable = flattenedEmojiTable;
}
