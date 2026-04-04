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

export const MAX_CONCURRENT_SOUNDS = 4;

// Higher number = higher priority. When at the channel cap,
// a new sound can preempt the lowest-priority active sound.
export const SOUND_PRIORITY: Record<SoundEffect, number> = {
  [SoundEffect.HydrogenHit]: 7,
  [SoundEffect.AtomHit]: 7,
  [SoundEffect.HydrogenLaunch]: 6,
  [SoundEffect.AtomLaunch]: 6,
  [SoundEffect.MIRVLaunch]: 6,
  [SoundEffect.AllianceBroken]: 5,
  [SoundEffect.AllianceSuggested]: 5,
  [SoundEffect.Message]: 4,
  [SoundEffect.BuildCity]: 3,
  [SoundEffect.BuildPort]: 3,
  [SoundEffect.BuildDefensePost]: 3,
  [SoundEffect.BuildWarship]: 3,
  [SoundEffect.SAMBuilt]: 3,
  [SoundEffect.KaChing]: 2,
  [SoundEffect.Click]: 1,
};

export interface ISoundManager {
  playBackgroundMusic(): void;
  stopBackgroundMusic(): void;
  setBackgroundMusicVolume(volume: number): void;
  setSoundEffectsVolume(volume: number): void;
  playSoundEffect(name: SoundEffect): void;
  stopSoundEffect(name: SoundEffect): void;
}
