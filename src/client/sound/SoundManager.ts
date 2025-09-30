import { Howl, Howler } from "howler";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";
class SoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;

  constructor() {
    this.backgroundMusic = [
      new Howl({ src: [of4], loop: false, onend: this.playNext.bind(this) }),
      new Howl({
        src: [openfront],
        loop: false,
        onend: this.playNext.bind(this),
      }),
      new Howl({ src: [war], loop: false, onend: this.playNext.bind(this) }),
    ];
    this.setBackgroundMusicVolume(0);
  }

  public playBackgroundMusic(): void {
    if (
      this.backgroundMusic.length > 0 &&
      !this.backgroundMusic[this.currentTrack].playing()
    ) {
      this.backgroundMusic[this.currentTrack].play();
    }
  }

  public stopBackgroundMusic(): void {
    if (this.backgroundMusic.length > 0) {
      this.backgroundMusic[this.currentTrack].stop();
    }
  }

  public setBackgroundMusicVolume(volume: number): void {
    const newVolume = Math.max(0, Math.min(1, volume));
    Howler.volume(newVolume);
  }

  private playNext(): void {
    this.currentTrack = (this.currentTrack + 1) % this.backgroundMusic.length;
    this.playBackgroundMusic();
  }
}

export default new SoundManager();
