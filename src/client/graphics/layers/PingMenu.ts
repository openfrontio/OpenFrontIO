import retreatIcon from "../../../../resources/images/BackIconWhite.svg";
import pingIcon from "../../../../resources/images/PingIcon.svg";
import watchOutIcon from "../../../../resources/images/QuestionMarkIcon.svg";
import defendIcon from "../../../../resources/images/ShieldIconWhite.svg";
import swordIcon from "../../../../resources/images/SwordIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { PingType } from "../../../core/game/Ping";
import { PingSelectedEvent } from "../../InputHandler";
import { COLORS, MenuElement, MenuElementParams } from "./RadialMenuElements";

export const PING_ICON = pingIcon;

export const PING_COLORS: Record<PingType, string> = {
  attack: "#ff0000",
  retreat: "#ffa600",
  defend: "#0000ff",
  watchOut: "#ffff00",
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
      if (params && params.closeMenu) {
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
    "attack",
    eventBus,
  );
  const pingRetreatElement = createPingElement(
    "ping_retreat",
    "Retreat",
    retreatIcon,
    "retreat",
    eventBus,
  );
  const pingDefendElement = createPingElement(
    "ping_defend",
    "Defend",
    defendIcon,
    "defend",
    eventBus,
  );
  const pingWatchOutElement = createPingElement(
    "ping_watch_out",
    "Watch out",
    watchOutIcon,
    "watchOut",
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
