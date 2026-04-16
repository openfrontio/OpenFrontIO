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
  | "message"
  | "click";

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
  ["message", assetUrl("sounds/effects/message.mp3")],
  ["click", assetUrl("sounds/effects/click.mp3")],
]);

export class PlaySoundEffectEvent implements GameEvent {
  constructor(public readonly effect: SoundEffect) {}
}

export class SetSoundEffectsVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}

export class SetBackgroundMusicVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}
