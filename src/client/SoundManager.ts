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
  private masterGainNode: GainNode | null = null;
  private audioSources: Map<string, AudioSource> = new Map();
  private isInitialized = false;
  private masterVolume = 0.7;


  private musicGainNode: GainNode | null = null;
  private sfxGainNode: GainNode | null = null;

  constructor() {
    this.loadVolumeSettings();
  }

  private loadVolumeSettings(): void {
    const savedVolume = localStorage.getItem('settings.masterVolume');
    if (savedVolume) {
      this.masterVolume = parseFloat(savedVolume);
    }
  }

  private saveVolumeSettings(): void {
    localStorage.setItem('settings.masterVolume', this.masterVolume.toString());
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
    
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
    
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.connect(this.audioContext.destination);
      this.masterGainNode.gain.value = this.masterVolume;

      
      this.musicGainNode = this.audioContext.createGain();
      this.musicGainNode.connect(this.masterGainNode);
      this.musicGainNode.gain.value = 0.6; 

      this.sfxGainNode = this.audioContext.createGain();
      this.sfxGainNode.connect(this.masterGainNode);
      this.sfxGainNode.gain.value = 0.8; 

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
        config: { loop: false, volume: 1.0, ...config }
      });

      console.log(`Sound '${id}' loaded successfully`);
    } catch (error) {
      console.error(`Failed to load sound '${id}':`, error);
    }
  }

  async playSound(id: string, category: 'music' | 'sfx' = 'sfx'): Promise<void> {
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
      const categoryGain = category === 'music' ? this.musicGainNode : this.sfxGainNode;
      gainNode.connect(categoryGain!);

  
      gainNode.gain.value = audioSource.config.volume || 1.0;

    
      if (audioSource.config.fadeIn) {
        gainNode.gain.value = 0;
        gainNode.gain.linearRampToValueAtTime(
          audioSource.config.volume || 1.0,
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
      console.log(`Playing sound '${id}' in category '${category}'`);
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

  isPlaying(id: string): boolean {
    const audioSource = this.audioSources.get(id);
    return audioSource ? audioSource.isPlaying : false;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = this.masterVolume;
    }
    this.saveVolumeSettings();
    console.log(`Master volume set to ${(this.masterVolume * 100).toFixed(0)}%`);
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setCategoryVolume(category: 'music' | 'sfx', volume: number): void {
    const normalizedVolume = Math.max(0, Math.min(1, volume));
    const gainNode = category === 'music' ? this.musicGainNode : this.sfxGainNode;
    
    if (gainNode) {
      gainNode.gain.value = normalizedVolume;
      console.log(`${category} volume set to ${(normalizedVolume * 100).toFixed(0)}%`);
    }
  }

  getCategoryVolume(category: 'music' | 'sfx'): number {
    const gainNode = category === 'music' ? this.musicGainNode : this.sfxGainNode;
    return gainNode ? gainNode.gain.value : 0;
  }

 
  async preloadGameSounds(): Promise<void> {
    const soundsToLoad = [
      
      { id: 'mainMenu', url: '/non-commercial/sounds/music/main-menu.mp3', config: { loop: true, volume: 0.8, fadeIn: 2.0 } },
      

     // { id: 'Click', url: '/audio/button-click.wav', config: { volume: 0.6 } },
     // { id: 'attack', url: '/audio/attack.wav', config: { volume: 0.7 } },
     // { id: 'victory', url: '/audio/victory.mp3', config: { volume: 0.9, fadeIn: 1.0 } },
     // { id: 'alliancerequest', url: '/audio/arequest.mp3', config: { volume: 0.8 } },
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

    await this.playSound('mainMenu', 'music');
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

// UserSettings extension for sound management
declare module "../game/UserSettings" {
  interface UserSettings {
    masterVolume(): number;
    setMasterVolume(volume: number): void;
    soundEnabled(): boolean;
    setSoundEnabled(enabled: boolean): void;
  }
}
