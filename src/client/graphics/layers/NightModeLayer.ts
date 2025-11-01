import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class NightModeLayer implements Layer {
  private darkenColor: [number, number, number] = [0, 0, 0];
  private darkenAlpha: number = 0.8; // separated from darkenColor for more readable code

  private flashlightRadius: number = 125; // in-game tiles

  tick(): void {}
  redraw(): void {}

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    const userSettings = new UserSettings();
    if (userSettings.nightMode()) {
      document.documentElement.classList.add("night");
    } else {
      document.documentElement.classList.remove("night");
    }
  }
}
