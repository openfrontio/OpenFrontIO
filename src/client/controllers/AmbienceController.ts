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
/**
 * Ceiling of the zoom envelope: what the deepest zoom multiplies the ambience
 * channel by, fading to silence as the player pulls back out.
 *
 * The sound designer's spec is "-20 dB", which is a statement about where
 * ambience sits in the MIX -- under the cues, not under itself. This used to
 * be 0.1, the literal -20 dB, applied as a raw multiplier on top of a channel
 * that is already well down: perceptualGain squares the slider, so ambience at
 * its 0.4 default is 0.16, or -16 dB, before the envelope is applied at all.
 * The two stacked, and ambience peaked at 0.016 -- -36 dBFS, 30 dB under the
 * effects channel, which is inaudible under gameplay rather than quiet. That
 * is the "ambience never plays" report: it was playing.
 *
 * Staged against the effects channel instead, which is what the cues the spec
 * is relative to actually run at:
 *
 *     effects at its 0.7 default   0.7^2        = 0.49    (-6.2 dB)
 *     spec: 20 dB under that       0.49 * 0.1   = 0.049   (-26.2 dB)
 *     ambience at its 0.4 default  0.4^2        = 0.16
 *     so the envelope needs        0.049 / 0.16 = 0.3
 *
 * Master scales both channels equally, so the 20 dB relationship holds
 * wherever the player puts it. A player who pushes the ambience slider to 1.0
 * tops out at 0.3, -10.5 dB, which is as loud as background texture should
 * ever get.
 */
const AMBIENCE_PEAK_GAIN = 0.3;
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
