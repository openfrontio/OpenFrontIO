import retreatIcon from "../../../../resources/images/BackIconWhite.svg";
import pingIcon from "../../../../resources/images/PingIcon.svg";
import watchOutIcon from "../../../../resources/images/QuestionMarkIcon.svg";
import defendIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { PingType } from "../../../core/game/Ping";
import { PingSelectedEvent } from "../../InputHandler";
import { COLORS, MenuElement, MenuElementParams } from "./RadialMenuElements";

export const PING_ICON = pingIcon;

export const PING_COLORS = {
  [PingType.Attack]: "#ff0000",
  [PingType.Retreat]: "#ffa600",
  [PingType.Defend]: "#0000ff",
  [PingType.WatchOut]: "#ffff00",
};

function createPingElement(
  id: string,
  name: string,
  icon: string,
  pingType: PingType,
  eventBus: EventBus,
): MenuElement {
  return {
    id,
    name,
    icon,
    color: PING_COLORS[pingType],
    disabled: () => false,
    action: (params?: MenuElementParams) => {
      eventBus.emit(new PingSelectedEvent(pingType));
      if (params) {
        params.closeMenu();
      }
    },
  };
}

export function createPingMenu(eventBus: EventBus): MenuElement {
  const pingAttackElement = createPingElement(
    "ping_attack",
    "Attack",
    swordIcon,
    PingType.Attack,
    eventBus,
  );
  const pingRetreatElement = createPingElement(
    "ping_retreat",
    "Retreat",
    retreatIcon,
    PingType.Retreat,
    eventBus,
  );
  const pingDefendElement = createPingElement(
    "ping_defend",
    "Defend",
    defendIcon,
    PingType.Defend,
    eventBus,
  );
  const pingWatchOutElement = createPingElement(
    "ping_watch_out",
    "Watch out",
    watchOutIcon,
    PingType.WatchOut,
    eventBus,
  );

  return {
    id: "ping",
    name: "Pings",
    icon: PING_ICON,
    color: COLORS.ally,
    disabled: () => false,
    subMenu: () => [
      pingAttackElement,
      pingRetreatElement,
      pingDefendElement,
      pingWatchOutElement,
    ],
  };
}
