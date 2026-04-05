import { GameEvent } from "../../core/EventBus";

export enum SoundEffect {
  KaChing = "ka-ching",
  AtomHit = "atom-hit",
  AtomLaunch = "atom-launch",
  HydrogenHit = "hydrogen-hit",
  HydrogenLaunch = "hydrogen-launch",
  MIRVLaunch = "mirv-launch",
  AllianceSuggested = "alliance-suggested",
  AllianceBroken = "alliance-broken",
  BuildPort = "build-port",
  BuildCity = "build-city",
  BuildDefensePost = "build-defense-post",
  BuildWarship = "build-warship",
  SAMBuilt = "sam-built",
  Message = "message",
  Click = "click",
}

export class PlaySoundEffectEvent implements GameEvent {
  constructor(public readonly effect: SoundEffect) {}
}

export class SetSoundEffectsVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}

export class SetBackgroundMusicVolumeEvent implements GameEvent {
  constructor(public readonly volume: number) {}
}
