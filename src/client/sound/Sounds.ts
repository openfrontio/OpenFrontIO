import { assetUrl } from "../../core/AssetUrls";
import { GameEvent } from "../../core/EventBus";

export type SoundEffect =
  | "ka-ching"
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
  ["message", assetUrl("sounds/effects/message.mp3")],
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

export class SetAmbienceEvent implements GameEvent {
  constructor(public readonly track: AmbienceTrack | null) {}
}

export class SetSoundEffectsVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}

export class SetBackgroundMusicVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}
