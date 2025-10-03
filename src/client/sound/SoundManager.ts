import { Howl } from "howler";
import atomHit from "../../../proprietary/sounds/effects/Atom Hit.mp3";
import atomLaunch from "../../../proprietary/sounds/effects/Atom Launch.mp3";
import hydroHit from "../../../proprietary/sounds/effects/Hydrogen Hit.mp3";
import hydroLaunch from "../../../proprietary/sounds/effects/Hydrogen Launch.mp3";
import mirvLaunch from "../../../proprietary/sounds/effects/MIRV Launch.mp3";
import of4 from "../../../proprietary/sounds/music/of4.mp3";
import openfront from "../../../proprietary/sounds/music/openfront.mp3";
import war from "../../../proprietary/sounds/music/war.mp3";

class SoundManager {
  private backgroundMusic: Howl[] = [];
  private soundEffects: Howl[] = [];
  private currentTrack: number = 0;

  private musicVolume: number = 0;
  private effectsVolume: number = 1;

  private atomHitSound: Howl;
  private atomLaunchSound: Howl;
  private hydroHitSound: Howl;
  private hydroLaunchSound: Howl;
  private mirvLaunchSound: Howl;

  constructor() {
    if (typeof window === "undefined") {
      return;
    }

    this.backgroundMusic = [
      new Howl({
        src: [of4],
        loop: false,
        onend: this.playNext.bind(this),
        volume: this.musicVolume,
      }),
      new Howl({
        src: [openfront],
        loop: false,
        onend: this.playNext.bind(this),
        volume: this.musicVolume,
      }),
      new Howl({
        src: [war],
        loop: false,
        onend: this.playNext.bind(this),
        volume: this.musicVolume,
      }),
    ];

    this.atomHitSound = new Howl({
      src: [atomHit],
      volume: this.effectsVolume,
    });
    this.atomLaunchSound = new Howl({
      src: [atomLaunch],
      volume: this.effectsVolume,
    });
    this.hydroHitSound = new Howl({
      src: [hydroHit],
      volume: this.effectsVolume,
    });
    this.hydroLaunchSound = new Howl({
      src: [hydroLaunch],
      volume: this.effectsVolume,
    });
    this.mirvLaunchSound = new Howl({
      src: [mirvLaunch],
      volume: this.effectsVolume,
    });

    this.soundEffects.push(
      this.atomHitSound,
      this.atomLaunchSound,
      this.hydroHitSound,
      this.hydroLaunchSound,
      this.mirvLaunchSound,
    );
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
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.backgroundMusic.forEach((track) => track.volume(this.musicVolume));
  }

  public setSoundEffectsVolume(volume: number): void {
    this.effectsVolume = Math.max(0, Math.min(1, volume));
    this.soundEffects.forEach((sound) => sound.volume(this.effectsVolume));
  }

  private playNext(): void {
    this.currentTrack = (this.currentTrack + 1) % this.backgroundMusic.length;
    this.playBackgroundMusic();
  }

  public playAtomHit(): void {
    this.atomHitSound.play();
  }

  public playAtomLaunch(): void {
    this.atomLaunchSound.play();
  }

  public playHydroHit(): void {
    this.hydroHitSound.play();
  }

  public playHydroLaunch(): void {
    this.hydroLaunchSound.play();
  }

  public playMirvLaunch(): void {
    this.mirvLaunchSound.play();
  }

  public playMirvHit(): void {
    this.atomHitSound.play();
  }
}

export default new SoundManager();
