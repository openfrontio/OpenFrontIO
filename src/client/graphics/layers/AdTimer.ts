import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

const AD_SHOW_TICKS = 2 * 60 * 10; // 2 minute

export class AdTimer implements Layer {
  private isHidden: boolean = false;

  constructor(private g: GameView) {}

  init() {}

  public async tick() {
    if (this.isHidden) {
      return;
    }

    const gameTicks = this.g.ticks() - this.g.config().numSpawnPhaseTurns();
    if (gameTicks > AD_SHOW_TICKS) {
      console.log("destroying sticky ads");
      window.fusetag?.que?.push(() => {
        window.fusetag?.destroySticky?.();
      });
      this.isHidden = true;
      return;
    }
  }
}
