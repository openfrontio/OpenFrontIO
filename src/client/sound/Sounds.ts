import { assetUrl } from "../../core/AssetUrls";
import { GameEvent } from "../../core/EventBus";
import { AudioCategory } from "../../core/game/UserSettings";

export type SoundEffect =
  | "ka-ching"
  | "conquered"
  | "atom-hit"
  | "atom-launch"
  | "hydrogen-hit"
  | "hydrogen-launch"
  | "mirv-launch"
  | "alliance-suggested"
  | "alliance-broken"
  | "build-port"
  | "build-city"
  | "build-defense-post"
  | "build-warship"
  | "sam-built"
  | "silo-built"
  | "message"
  | "click"
  | "click-1"
  | "click-2"
  | "click-3"
  | "slider"
  | "alliance-accepted"
  | "alliance-declined"
  | "build-factory"
  | "build-train-station"
  | "transport-ship"
  | "nuke-warning"
  | "spawn"
  | "game-start"
  | "victory"
  | "defeat";

export const soundEffectUrls: ReadonlyMap<SoundEffect, string> = new Map([
  ["ka-ching", assetUrl("sounds/effects/ka-ching.mp3")],
  ["conquered", assetUrl("sounds/effects/conquered.mp3")],
  ["atom-hit", assetUrl("sounds/effects/atom-hit.mp3")],
  ["atom-launch", assetUrl("sounds/effects/atom-launch.mp3")],
  ["hydrogen-hit", assetUrl("sounds/effects/hydrogen-hit.mp3")],
  ["hydrogen-launch", assetUrl("sounds/effects/hydrogen-launch.mp3")],
  ["mirv-launch", assetUrl("sounds/effects/mirv-launch.mp3")],
  ["alliance-suggested", assetUrl("sounds/effects/alliance-suggested.mp3")],
  ["alliance-broken", assetUrl("sounds/effects/alliance-broken.mp3")],
  ["build-port", assetUrl("sounds/effects/build-port.mp3")],
  ["build-city", assetUrl("sounds/effects/build-city.mp3")],
  ["build-defense-post", assetUrl("sounds/effects/build-defense-post.mp3")],
  ["build-warship", assetUrl("sounds/effects/build-warship.mp3")],
  ["sam-built", assetUrl("sounds/effects/sam-built.mp3")],
  ["silo-built", assetUrl("sounds/effects/silo-built.mp3")],
  // Same morse-code cue as the alliance request, per the designer's notes.
  // One asset, two registry entries, rather than two identical files.
  ["message", assetUrl("sounds/effects/alliance-suggested.mp3")],
  ["click", assetUrl("sounds/effects/click.mp3")],
  ["click-1", assetUrl("sounds/effects/click-1.mp3")],
  ["click-2", assetUrl("sounds/effects/click-2.mp3")],
  ["click-3", assetUrl("sounds/effects/click-3.mp3")],
  ["slider", assetUrl("sounds/effects/slider.mp3")],
  ["alliance-accepted", assetUrl("sounds/effects/alliance-accepted.mp3")],
  ["alliance-declined", assetUrl("sounds/effects/alliance-declined.mp3")],
  ["build-factory", assetUrl("sounds/effects/build-factory.mp3")],
  ["build-train-station", assetUrl("sounds/effects/build-train-station.mp3")],
  ["transport-ship", assetUrl("sounds/effects/transport-ship.mp3")],
  ["nuke-warning", assetUrl("sounds/effects/nuke-warning.mp3")],
  ["spawn", assetUrl("sounds/effects/spawn.mp3")],
  ["game-start", assetUrl("sounds/effects/game-start.mp3")],
  ["victory", assetUrl("sounds/effects/victory.mp3")],
  ["defeat", assetUrl("sounds/effects/defeat.mp3")],
]);

export type AmbienceTrack = "city" | "factory" | "missile-silo" | "sam-silo";

export const ambienceUrls: ReadonlyMap<AmbienceTrack, string> = new Map([
  ["city", assetUrl("sounds/ambience/city.mp3")],
  ["factory", assetUrl("sounds/ambience/factory.mp3")],
  ["missile-silo", assetUrl("sounds/ambience/missile-silo.mp3")],
  ["sam-silo", assetUrl("sounds/ambience/sam-silo.mp3")],
]);

export class PlaySoundEffectEvent implements GameEvent {
  constructor(public readonly effect: SoundEffect) {}
}

/**
 * Mixer channel a cue plays on. "master" is the global trim and "music" is
 * owned by the two looping tracks, so neither is ever a cue's channel.
 */
export type CueCategory = Exclude<AudioCategory, "master" | "music">;

// Exhaustive by type: adding a SoundEffect without a channel fails to compile.
const CUE_CATEGORY: Record<SoundEffect, Exclude<CueCategory, "ambience">> = {
  // Interface — frequent, information-free, first thing people turn off.
  click: "interface",
  "click-1": "interface",
  "click-2": "interface",
  "click-3": "interface",
  slider: "interface",

  // Alerts — things the player needs to know, which is why they stay audible
  // when the window is unfocused unless that is turned off.
  "nuke-warning": "alerts",
  "alliance-suggested": "alerts",
  "alliance-accepted": "alerts",
  "alliance-declined": "alerts",
  "alliance-broken": "alerts",
  message: "alerts",

  // Effects — the world and the player's own actions.
  "atom-launch": "effects",
  "atom-hit": "effects",
  "hydrogen-launch": "effects",
  "hydrogen-hit": "effects",
  "mirv-launch": "effects",
  "ka-ching": "effects",
  conquered: "effects",
  "build-port": "effects",
  "build-city": "effects",
  "build-defense-post": "effects",
  "build-warship": "effects",
  "build-factory": "effects",
  "build-train-station": "effects",
  "sam-built": "effects",
  "silo-built": "effects",
  "transport-ship": "effects",
  spawn: "effects",
  "game-start": "effects",
  victory: "effects",
  defeat: "effects",
};

/** Channel of a cue. A pure function of the name — call sites never choose. */
export function categoryOf(name: SoundEffect | AmbienceTrack): CueCategory {
  return ambienceUrls.has(name as AmbienceTrack)
    ? "ambience"
    : CUE_CATEGORY[name as SoundEffect];
}

export class SetAmbienceEvent implements GameEvent {
  /**
   * @param gain 0-1 zoom envelope from AmbienceController, multiplied by the
   *   ambience channel volume. Aiden's spec is -20 dB at the deepest zoom
   *   fading to silence as the player pulls back, so this peaks at 0.1.
   */
  constructor(
    public readonly track: AmbienceTrack | null,
    public readonly gain: number = 1,
  ) {}
}
