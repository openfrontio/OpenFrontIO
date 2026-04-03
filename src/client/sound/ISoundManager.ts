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

export interface ISoundManager {
  playBackgroundMusic(): void;
  stopBackgroundMusic(): void;
  setBackgroundMusicVolume(volume: number): void;
  setSoundEffectsVolume(volume: number): void;
  playSoundEffect(name: SoundEffect): void;
  stopSoundEffect(name: SoundEffect): void;
}
