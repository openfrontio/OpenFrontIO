export interface SoundConfig {
  loop?: boolean;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface AudioSource {
  buffer: AudioBuffer;
  source?: AudioBufferSourceNode;
  gainNode?: GainNode;
  isPlaying: boolean;
  config: SoundConfig;
}

export class SoundManager {
  private audioContext: AudioContext | null = null;
  private audioSources: Map<string, AudioSource> = new Map();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.isInitialized = true;
      console.log('SoundManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize SoundManager:', error);
    }
  }

  async loadSound(id: string, url: string, config: SoundConfig = {}): Promise<void> {
    if (!this.audioContext) {
      await this.initialize();
    }

    if (!this.audioContext) {
      console.error('AudioContext not available');
      return;
    }

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      this.audioSources.set(id, {
        buffer: audioBuffer,
        isPlaying: false,
        config: { loop: false, volume: 0.8, ...config }
      });

      console.log(`Sound '${id}' loaded successfully`);
    } catch (error) {
      console.error(`Failed to load sound '${id}':`, error);
    }
  }

  async playSound(id: string): Promise<void> {
    const audioSource = this.audioSources.get(id);
    if (!audioSource || !this.audioContext) {
      console.warn(`Sound '${id}' not found or AudioContext not available`);
      return;
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('Failed to resume AudioContext:', error);
        return;
      }
    }

    if (audioSource.isPlaying) {
      this.stopSound(id);
    }

    try {
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();
      source.buffer = audioSource.buffer;
      source.loop = audioSource.config.loop || false;
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      gainNode.gain.value = audioSource.config.volume || 0.8;

      if (audioSource.config.fadeIn) {
        gainNode.gain.value = 0;
        gainNode.gain.linearRampToValueAtTime(
          audioSource.config.volume || 0.8,
          this.audioContext.currentTime + audioSource.config.fadeIn
        );
      }

      source.onended = () => {
        audioSource.isPlaying = false;
        audioSource.source = undefined;
        audioSource.gainNode = undefined;
      };

      audioSource.source = source;
      audioSource.gainNode = gainNode;
      audioSource.isPlaying = true;

      source.start();
      console.log(`Playing sound '${id}'`);
    } catch (error) {
      console.error(`Failed to play sound '${id}':`, error);
    }
  }

  stopSound(id: string): void {
    const audioSource = this.audioSources.get(id);
    if (!audioSource || !audioSource.isPlaying || !audioSource.source) {
      return;
    }

    try {
      if (audioSource.config.fadeOut && audioSource.gainNode && this.audioContext) {
        audioSource.gainNode.gain.linearRampToValueAtTime(
          0,
          this.audioContext.currentTime + audioSource.config.fadeOut
        );
        setTimeout(() => {
          if (audioSource.source) {
            audioSource.source.stop();
          }
        }, audioSource.config.fadeOut * 1000);
      } else {
        audioSource.source.stop();
      }

      console.log(`Stopped sound '${id}'`);
    } catch (error) {
      console.error(`Failed to stop sound '${id}':`, error);
    }
  }

  stopAllSounds(): void {
    for (const [id, audioSource] of this.audioSources) {
      if (audioSource.isPlaying) {
        this.stopSound(id);
      }
    }
  }

  async preloadGameSounds(): Promise<void> {
    const soundsToLoad = [
      { id: 'mainMenu', url: '/non-commercial/sounds/music/main-menu.mp3', config: { loop: true, volume: 0.8, fadeIn: 2.0 } },
    ];

    const loadPromises = soundsToLoad.map(sound =>
      this.loadSound(sound.id, sound.url, sound.config)
        .catch(error => console.warn(`Failed to preload sound '${sound.id}':`, error))
    );

    await Promise.all(loadPromises);
    console.log('Game sounds preloading completed');
  }

  async startMainMenuMusic(): Promise<void> {
    if (!this.audioSources.has('mainMenu')) {
      console.warn('Main menu music not loaded');
      return;
    }
    await this.playSound('mainMenu');
  }

  stopMainMenuMusic(): void {
    this.stopSound('mainMenu');
  }

  dispose(): void {
    this.stopAllSounds();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioSources.clear();
    this.isInitialized = false;
    console.log('SoundManager disposed');
  }
}

export const soundManager = new SoundManager();
