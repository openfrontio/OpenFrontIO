import { EventBus } from "../../core/EventBus";
import { DarkModeChangedEvent } from "../../core/game/UserSettings";

export function registerDarkModeHandler(eventBus: EventBus) {
  eventBus.on(DarkModeChangedEvent, (event) => {
    if (event.value) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  });
}
