import { Howl } from "howler";
import ironHorizon from "../../../proprietary/sounds/music/iron-horizon.mp3";
import worldDivided from "../../../proprietary/sounds/music/world-divided.mp3";
import preludeToWar from "../../../proprietary/sounds/music/prelude-to-war.mp3";

class MenuSoundManager {
  private backgroundMusic: Howl[] = [];
  private currentTrack: number = 0;
  private backgroundMusicVolume: number = 0;

  constructor() {
    this.backgroundMusic = [
      new Howl({
        src: [ironHorizon],
        loop: false,
        onend: this.playNext.bind(this),
        volume: 0,
      }),
      new Howl({
        src: [worldDivided],
        loop: false,
        onend: this.playNext.bind(this),
        volume: 0,
      }),
      new Howl({
        src: [preludeToWar],
        loop: false,
        onend: this.playNext.bind(this),
        volume: 0,
      }),
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
    if (this.backgroundMusic.length > 0) {
      this.backgroundMusic[this.currentTrack].stop();
    }
  }

  public setBackgroundMusicVolume(volume: number): void {
    this.backgroundMusicVolume = Math.max(0, Math.min(1, volume));
    this.backgroundMusic.forEach((track) => {
      track.volume(this.backgroundMusicVolume);
    });
  }

  private playNext(): void {
    this.currentTrack = (this.currentTrack + 1) % this.backgroundMusic.length;
    this.playBackgroundMusic();
  }
}

export default new MenuSoundManager();
