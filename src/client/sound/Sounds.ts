import { assetUrl } from "../../core/AssetUrls";
import { GameEvent } from "../../core/EventBus";
import { GameUpdateViewData } from "../../core/game/GameUpdates";

export enum SoundEffect {
  KaChing = "ka-ching",
  AtomHit = "atom-hit",
  AtomLaunch = "atom-launch",
  HydrogenHit = "hydrogen-hit",
  HydrogenLaunch = "hydrogen-launch",
  MirvLaunch = "mirv-launch",
  AllianceSuggested = "alliance-suggested",
  AllianceBroken = "alliance-broken",
  BuildPort = "build-port",
  BuildCity = "build-city",
  BuildDefensePost = "build-defense-post",
  BuildWarship = "build-warship",
  SamBuilt = "sam-built",
  SiloBuilt = "silo-built",
  Message = "message",
  Click = "click",
}

export const soundEffectUrls: ReadonlyMap<SoundEffect, string> = new Map([
  [SoundEffect.KaChing, assetUrl("sounds/effects/ka-ching.mp3")],
  [SoundEffect.AtomHit, assetUrl("sounds/effects/atom-hit.mp3")],
  [SoundEffect.AtomLaunch, assetUrl("sounds/effects/atom-launch.mp3")],
  [SoundEffect.HydrogenHit, assetUrl("sounds/effects/hydrogen-hit.mp3")],
  [SoundEffect.HydrogenLaunch, assetUrl("sounds/effects/hydrogen-launch.mp3")],
  [SoundEffect.MirvLaunch, assetUrl("sounds/effects/mirv-launch.mp3")],
  [
    SoundEffect.AllianceSuggested,
    assetUrl("sounds/effects/alliance-suggested.mp3"),
  ],
  [SoundEffect.AllianceBroken, assetUrl("sounds/effects/alliance-broken.mp3")],
  [SoundEffect.BuildPort, assetUrl("sounds/effects/build-port.mp3")],
  [SoundEffect.BuildCity, assetUrl("sounds/effects/build-city.mp3")],
  [
    SoundEffect.BuildDefensePost,
    assetUrl("sounds/effects/build-defense-post.mp3"),
  ],
  [SoundEffect.BuildWarship, assetUrl("sounds/effects/build-warship.mp3")],
  [SoundEffect.SamBuilt, assetUrl("sounds/effects/sam-built.mp3")],
  [SoundEffect.SiloBuilt, assetUrl("sounds/effects/silo-built.mp3")],
  [SoundEffect.Message, assetUrl("sounds/effects/message.mp3")],
  [SoundEffect.Click, assetUrl("sounds/effects/click.mp3")],
]);

export class PlaySoundEffectEvent implements GameEvent {
  constructor(public readonly effect: SoundEffect) {}
}

export class SoundUpdateEvent implements GameEvent {
  constructor(public readonly gu: GameUpdateViewData) {}
}

export class SetSoundEffectsVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}

export class SetBackgroundMusicVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}
