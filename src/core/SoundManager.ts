export class SoundManager {
  private audioContext: AudioContext;
  private soundBuffers: Map<string, AudioBuffer> = new Map();
  private isInitialized: boolean = false;
  private basePath: string = '/non-commercial/Sound-Effects/';
  private isMuted: boolean = false; 

 
  private soundFiles: { [key: string]: string } = {
    'Alliance broken': 'Alliance broken.mp3',
    'Alliance suggested': 'alliance_suggested.mp3',
    'Atom Hit': 'atom_hit.mp3',
    'Atom Launch': 'atom_launch.mp3',
    'Build City': 'build_city.mp3',
    'Build Defense Post': 'build_defense_post.mp3',
    'Build Port': 'build_port.mp3',
    'Build Warship': 'build_warship.mp3',
    'Click': 'click.mp3',
    'Hydrogen Hit': 'hydrogen_hit.mp3',
    'Hydrogen Launch': 'hydrogen_launch.mp3',
    'message': 'message.mp3',
    'MIRV Launch': 'mirv_launch.mp3',
    'SAM Built': 'sam_built.mp3',
    'SAM hit': 'sam_hit.mp3',
    'SAM Shoot': 'sam_shoot.mp3',
    'SILO Built': 'silo_built.mp3',
    'Warship Lost': 'warship_lost.mp3',
    'Warship Shot': 'warship_shot.mp3',
  };

  constructor() {
    
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      await this.loadAllSounds();
      this.isInitialized = true;
      console.log('SoundManager initialized successfully');
    } catch (error) {
      console.error('SoundManager initialization failed:', error);
      throw error;
    }
  }

 
  private async loadAllSounds(): Promise<void> {
    const loadPromises = Object.entries(this.soundFiles).map(([name, fileName]) =>
      this.loadSound(name, `${this.basePath}${fileName}`)
    );
    await Promise.all(loadPromises);
  }

 
  private async loadSound(name: string, path: string): Promise<void> {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Failed to load sound: ${path}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.soundBuffers.set(name, audioBuffer);
    } catch (error) {
      console.error(`Error loading sound ${name} from ${path}:`, error);
      
      const silentBuffer = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate);
      this.soundBuffers.set(name, silentBuffer);
    }
  }

  
  play(soundName: string, volume: number = 1.0, pan: number = 0): void {
    if (!this.isInitialized) {
      console.warn('SoundManager not initialized. Call initialize() first.');
      return;
    }

    if (this.isMuted) {
      return; 
    }

    const buffer = this.soundBuffers.get(soundName);
    if (!buffer) {
      console.warn(`Sound ${soundName} not found`);
      return;
    }

    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;

      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = Math.max(0, Math.min(1, volume));

      
      const pannerNode = this.audioContext.createStereoPanner();
      pannerNode.pan.value = Math.max(-1, Math.min(1, pan));

     
      source.connect(pannerNode);
      pannerNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

     
      source.start(0);
    } catch (error) {
      console.error(`Error playing sound ${soundName}:`, error);
    }
  }

 
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    console.log(`SoundManager mute state set to: ${muted}`);
  }


  isSoundMuted(): boolean {
    return this.isMuted;
  }


  setVolume(soundName: string, volume: number): void {
    console.warn(`setVolume not applicable for one-shot sounds like ${soundName}`);
  }


  stopAll(): void {
    this.audioContext.close().then(() => {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.isInitialized = false; 
    });
  }


  resumeContext(): void {
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log('AudioContext resumed');
      });
    }
  }
}