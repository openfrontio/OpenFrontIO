export class SoundManager {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private isMuted: boolean = false;
  private volume: number = 1.0; // Placeholder for future volume control

  loadSound(name: string, path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(path);
      audio.preload = "auto";
      audio.oncanplaythrough = () => {
        this.sounds.set(name, audio);
        resolve();
      };
      audio.onerror = () => {
        console.warn(`Failed to load sound: ${path}`);
        reject(new Error(`Failed to load sound: ${path}`));
      };
    });
  }

  playSound(name: string): void {
    if (this.isMuted) return;
    const audio = this.sounds.get(name);
    if (audio) {
      audio.volume = this.volume;
      audio.currentTime = 0;
      audio
        .play()
        .catch((e) => console.warn(`Failed to play sound ${name}:`, e));
    } else {
      console.warn(`Sound ${name} not found`);
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  mute(): void {
    this.isMuted = true;
  }

  unmute(): void {
    this.isMuted = false;
  }

  isMutedState(): boolean {
    return this.isMuted;
  }

  // placeholder for future volume control
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.sounds.forEach((audio) => {
      audio.volume = this.volume;
    });
  }
}
