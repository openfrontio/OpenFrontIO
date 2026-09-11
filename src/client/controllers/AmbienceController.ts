import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { Controller } from "../Controller";
import { AmbienceTrack, SetAmbienceEvent } from "../sound/Sounds";
import { TransformHandler } from "../TransformHandler";
import { GameView } from "../view";

// Only play ambience when zoomed in far enough that a single structure fills
// a meaningful part of the view (scale is pixels per tile; default is 1.8,
// clamped to [0.2, 20]).
const AMBIENCE_ZOOM_SCALE = 8;
// The structure must be this close (in tiles) to the center of the view.
const AMBIENCE_RANGE_TILES = 20;

const AMBIENCE_BY_TYPE = new Map<UnitType, AmbienceTrack>([
  [UnitType.City, "city"],
  [UnitType.Factory, "factory"],
  [UnitType.MissileSilo, "missile-silo"],
  [UnitType.SAMLauncher, "sam-silo"],
]);

const AMBIENT_STRUCTURE_TYPES: readonly UnitType[] = [
  ...AMBIENCE_BY_TYPE.keys(),
];

/**
 * Plays a structure's looping ambience when the player zooms in on it: the
 * structure closest to the view center wins, and zooming back out fades the
 * loop away (SoundManager owns the actual Howls and fading).
 */
export class AmbienceController implements Controller {
  private current: AmbienceTrack | null = null;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
  ) {}

  tick(): void {
    const next = this.desiredTrack();
    if (next === this.current) return;
    this.current = next;
    this.eventBus.emit(new SetAmbienceEvent(next));
  }

  private desiredTrack(): AmbienceTrack | null {
    if (this.transformHandler.scale < AMBIENCE_ZOOM_SCALE) return null;
    // Despite the field names, screenCenter() returns world coordinates
    // (see TransformHandler.goTo(), which compares it to a world Cell).
    const { screenX, screenY } = this.transformHandler.screenCenter();
    if (!this.game.isValidCoord(screenX, screenY)) return null;
    const tile = this.game.ref(screenX, screenY);
    let closest: { type: UnitType; distSquared: number } | null = null;
    for (const nearby of this.game.nearbyUnits(
      tile,
      AMBIENCE_RANGE_TILES,
      AMBIENT_STRUCTURE_TYPES,
    )) {
      if (closest === null || nearby.distSquared < closest.distSquared) {
        closest = {
          type: nearby.unit.type(),
          distSquared: nearby.distSquared,
        };
      }
    }
    return closest === null
      ? null
      : (AMBIENCE_BY_TYPE.get(closest.type) ?? null);
  }
}
