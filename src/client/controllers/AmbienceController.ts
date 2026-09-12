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
const MAX_VIEW_SCALE = 20;
// The sound designer's spec: -20 dB below the channel at the deepest zoom,
// fading to silence as the player pulls back out. 10^(-20/20) = 0.1.
const AMBIENCE_PEAK_GAIN = 0.1;
// Re-emitting on every sub-perceptible step would put an event on the bus
// each tick of a slow zoom; a step is roughly a quarter of a dB here.
const GAIN_EPSILON = 0.003;
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
  private currentGain = 0;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly transformHandler: TransformHandler,
  ) {}

  tick(): void {
    const next = this.desiredTrack();
    const gain = next === null ? 0 : this.zoomGain();
    if (
      next === this.current &&
      Math.abs(gain - this.currentGain) < GAIN_EPSILON
    ) {
      return;
    }
    this.current = next;
    this.currentGain = gain;
    this.eventBus.emit(new SetAmbienceEvent(next, gain));
  }

  /**
   * Zoom envelope, 0 at the threshold rising to the designer's -20 dB ceiling
   * at maximum zoom, so a structure fades up as the player leans into it
   * rather than snapping on.
   */
  private zoomGain(): number {
    const span = MAX_VIEW_SCALE - AMBIENCE_ZOOM_SCALE;
    const t = (this.transformHandler.scale - AMBIENCE_ZOOM_SCALE) / span;
    return AMBIENCE_PEAK_GAIN * Math.max(0, Math.min(1, t));
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
