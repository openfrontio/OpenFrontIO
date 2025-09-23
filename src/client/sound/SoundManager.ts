import { Howl } from "howler";
import Evan from "../../../resources/sounds/music/background music/Evan.mp3";
import Openfront from "../../../resources/sounds/music/background music/Openfront.mp3";
import WAR from "../../../resources/sounds/music/background music/WAR.mp3";

class SoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;

  constructor() {
    this.backgroundMusic = [
      new Howl({ src: [Evan], loop: false, onend: this.playNext.bind(this) }),
      new Howl({
        src: [Openfront],
        loop: false,
        onend: this.playNext.bind(this),
      }),
      new Howl({ src: [WAR], loop: false, onend: this.playNext.bind(this) }),
    ];
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
    if (
      this.backgroundMusic.length > 0 &&
      this.backgroundMusic[this.currentTrack].playing()
    ) {
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
