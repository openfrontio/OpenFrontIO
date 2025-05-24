export class SoundManager {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private isMuted: boolean = false;

  loadSound(name: string, path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(path);
      audio.preload = "auto";
      audio.oncanplaythrough = () => resolve();
      audio.onerror = () => reject(new Error(`Failed to load sound: ${path}`));
      this.sounds.set(name, audio);
    });
  }

  playSound(name: string): void {
    if (this.isMuted) return;
    const audio = this.sounds.get(name);
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch((e) =>
        console.warn(`Failed to play sound ${name}:`, e)
      );
    } else {
      console.warn(`Sound ${name} not found`);
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }
}
