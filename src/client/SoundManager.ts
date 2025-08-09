import { UserSettings } from "../core/game/UserSettings";

class SoundManager {
  private static instance: SoundManager;
  private audioContext: AudioContext;
  private soundBuffers: Map<string, AudioBuffer> = new Map();
  private musicSource: AudioBufferSourceNode | null = null;
  private userSettings: UserSettings;
  private masterVolume: GainNode;
  private musicVolume: GainNode;
  private soundEffectsVolume: GainNode;
  private muted: boolean;
  private activeSources: Map<string, AudioBufferSourceNode[]> = new Map();

  private constructor() {
    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    this.userSettings = new UserSettings();
    this.masterVolume = this.audioContext.createGain();
    this.musicVolume = this.audioContext.createGain();
    this.soundEffectsVolume = this.audioContext.createGain();
    this.musicVolume.connect(this.masterVolume);
    this.soundEffectsVolume.connect(this.masterVolume);
    this.masterVolume.connect(this.audioContext.destination);
    this.muted = this.userSettings.getMuted();
    this.setMasterVolume(this.userSettings.getVolume());

    if (this.muted) {
      this.mute();
    }

    if (this.userSettings.getMuteMusic()) {
      this.muteMusic();
    }

    if (this.userSettings.getMuteSoundEffects()) {
      this.muteSoundEffects();
    }
  }

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public async loadSounds(
    sounds: { name: string; path: string }[],
  ): Promise<void> {
    const promises = sounds.map((sound) =>
      this.loadSound(sound.name, sound.path),
    );
    await Promise.all(promises);
  }

  private async loadSound(name: string, path: string): Promise<void> {
    try {
      const response = await fetch(path);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.soundBuffers.set(name, audioBuffer);
    } catch (error) {
      console.error(`Failed to load sound: ${path}`, error);
    }
  }

  public playSound(name: string, loop: boolean = false): void {
    const soundBuffer = this.soundBuffers.get(name);
    if (soundBuffer) {
      const source = this.audioContext.createBufferSource();
      source.buffer = soundBuffer;
      source.loop = loop;
      source.connect(this.soundEffectsVolume);
      source.start(0);

      if (!this.activeSources.has(name)) {
        this.activeSources.set(name, []);
      }
      this.activeSources.get(name)?.push(source);

      source.onended = () => {
        const sources = this.activeSources.get(name);
        if (sources) {
          const index = sources.indexOf(source);
          if (index > -1) {
            sources.splice(index, 1);
          }
        }
      };
    }
  }

  public stopSound(name: string): void {
    const sources = this.activeSources.get(name);
    if (sources) {
      sources.forEach((source) => source.stop());
      this.activeSources.set(name, []);
    }
  }

  public playMusic(name: string): void {
    if (this.musicSource) {
      this.musicSource.stop();
    }
    const musicBuffer = this.soundBuffers.get(name);
    if (musicBuffer) {
      this.musicSource = this.audioContext.createBufferSource();
      this.musicSource.buffer = musicBuffer;
      this.musicSource.loop = true;
      this.musicSource.connect(this.musicVolume);
      this.musicSource.start(0);
    }
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume.gain.setValueAtTime(
      volume,
      this.audioContext.currentTime,
    );
    this.userSettings.setVolume(volume);
  }

  public getMasterVolume(): number {
    return this.masterVolume.gain.value;
  }

  public mute(): void {
    this.masterVolume.gain.setValueAtTime(0, this.audioContext.currentTime);
    this.muted = true;
    this.userSettings.setMuted(true);
  }

  public unmute(): void {
    this.masterVolume.gain.setValueAtTime(
      this.userSettings.getVolume(),
      this.audioContext.currentTime,
    );
    this.muted = false;
    this.userSettings.setMuted(false);
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public muteMusic(): void {
    this.musicVolume.gain.setValueAtTime(0, this.audioContext.currentTime);
    this.userSettings.setMuteMusic(true);
  }

  public unmuteMusic(): void {
    this.musicVolume.gain.setValueAtTime(1, this.audioContext.currentTime);
    this.userSettings.setMuteMusic(false);
  }

  public muteSoundEffects(): void {
    this.soundEffectsVolume.gain.setValueAtTime(
      0,
      this.audioContext.currentTime,
    );
    this.userSettings.setMuteSoundEffects(true);
  }

  public unmuteSoundEffects(): void {
    this.soundEffectsVolume.gain.setValueAtTime(
      1,
      this.audioContext.currentTime,
    );
    this.userSettings.setMuteSoundEffects(false);
  }

  public playSpatialSound(name: string, x: number, y: number, z: number): void {
    const soundBuffer = this.soundBuffers.get(name);
    if (soundBuffer) {
      const source = this.audioContext.createBufferSource();
      source.buffer = soundBuffer;

      const panner = this.audioContext.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 10000;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 0;
      panner.coneOuterGain = 0;
      panner.setPosition(x, y, z);

      source.connect(panner);
      panner.connect(this.masterVolume);
      source.start(0);
    }
  }
}

export const soundManager = SoundManager.getInstance();
