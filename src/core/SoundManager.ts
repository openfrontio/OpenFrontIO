export class SoundManager {
  private audioContext: AudioContext;
  private sounds: Map<string, AudioBuffer> = new Map();
  private isMuted: boolean = false;
  private gainNode: GainNode;
  private volume: number = 1.0;

  constructor() {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
  }

  async loadSound(name: string, path: string): Promise<void> {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Failed to fetch sound: ${path}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.sounds.set(name, audioBuffer);
    } catch (error) {
      console.warn(`Failed to load sound ${name}:`, error);
      throw new Error(`Failed to load sound: ${path}`);
    }
  }

  playSound(name: string): void {
    if (this.isMuted || !this.sounds.has(name)) {
      if (!this.sounds.has(name)) {
        console.warn(`Sound ${name} not found`);
      }
      return;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = this.sounds.get(name)!;
    source.connect(this.gainNode);
    source.start(0); 

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.gainNode.gain.setValueAtTime(
      muted ? 0 : this.volume,
      this.audioContext.currentTime
    );
  }

  mute(): void {
    this.setMuted(true);
  }

  unmute(): void {
    this.setMuted(false);
  }

  isMutedState(): boolean {
    return this.isMuted;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (!this.isMuted) {
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
    }
  }

 
  async resume(): Promise<void> {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }
}
