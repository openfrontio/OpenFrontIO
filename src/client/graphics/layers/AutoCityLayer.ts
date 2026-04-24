import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { BuildUnitIntentEvent } from "../../Transport";
import { Layer } from "./Layer";

export class AutoCityLayer implements Layer {
  private inFlight = false;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly userSettings: UserSettings,
  ) {}

  getTickIntervalMs(): number {
    return 2000;
  }

  tick(): void {
    if (!this.userSettings.autoCityEnabled()) return;
    if (this.inFlight) return;
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) return;

    this.inFlight = true;
    void this.tryPlaceCity().finally(() => {
      this.inFlight = false;
    });
  }

  private async tryPlaceCity(): Promise<void> {
    const me = this.game.myPlayer();
    if (me === null) return;

    const buffer =
      (me.gold() * BigInt(this.game.config().autoCityGoldBuffer())) / 100n;
    const minAffordable = me.gold() - buffer;
    if (minAffordable <= 0n) return;

    const borders = await me.borderTiles();
    const tiles = borders?.borderTiles;
    if (!tiles || tiles.size === 0) return;

    const tileArray = Array.from(tiles);
    const sampleCount = Math.min(tileArray.length, 12);
    for (let i = 0; i < sampleCount; i++) {
      const tile = tileArray[Math.floor(Math.random() * tileArray.length)];
      const buildables = await me.buildables(tile, [UnitType.City]);
      const city = buildables.find((b) => b.type === UnitType.City);
      if (city && city.canBuild !== false && city.cost <= minAffordable) {
        this.eventBus.emit(
          new BuildUnitIntentEvent(UnitType.City, city.canBuild),
        );
        return;
      }
    }
  }
}
