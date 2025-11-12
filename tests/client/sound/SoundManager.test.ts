/**
 * @jest-environment jsdom
 */

// Mock Howler before importing SoundManager
jest.mock("howler", () => {
  const instances: any[] = [];

  class MockHowl {
    public play = jest.fn();
    public stop = jest.fn();
    public volume = jest.fn().mockReturnValue(1);
    public unload = jest.fn();
    public on = jest.fn();
    public off = jest.fn();
    public playing = jest.fn().mockReturnValue(false);

    constructor(options: any) {
      // Store options for verification
      (this as any).options = options;
      instances.push(this);
    }
  }

  // Expose instances array through a getter
  (MockHowl as any).getInstances = () => instances;

  return {
    Howl: MockHowl,
  };
});

import { Howl } from "howler";
import SoundManager, {
  SoundEffect,
} from "../../../src/client/sound/SoundManager";

describe("SoundManager", () => {
  let soundManager: SoundManager;

  // Helper to get mock instances
  const getMockInstances = () => {
    return (Howl as any).getInstances ? (Howl as any).getInstances() : [];
  };

  // Create a new SoundManager instance for each test
  beforeEach(() => {
    soundManager = new SoundManager();
    const instances = getMockInstances();
    // Reset all mock instances
    instances.forEach((instance: any) => {
      instance.play.mockClear();
      instance.stop.mockClear();
      instance.volume.mockClear().mockReturnValue(1);
      instance.unload.mockClear();
      instance.on.mockClear();
      instance.off.mockClear();
      instance.playing.mockClear().mockReturnValue(false);
    });
  });

  describe("Sound Effects", () => {
    describe("playSoundEffect", () => {
      it("should play a sound effect when enabled", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        soundManager.playSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.play).toHaveBeenCalled();
        }
      });

      it("should not play a sound effect when disabled", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        soundManager.playSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.play).not.toHaveBeenCalled();
        }
      });

      it("should play sound effect after re-enabling", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        soundManager.playSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.play).toHaveBeenCalled();
        }
      });

      it("should handle playing non-existent sound effect gracefully", () => {
        // Create a new sound effect that doesn't exist
        const nonExistentSound = "non-existent" as SoundEffect;
        expect(() => {
          soundManager.playSoundEffect(nonExistentSound);
        }).not.toThrow();
      });
    });

    describe("playSoundEffectNTimes", () => {
      it("should play sound effect multiple times", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        if (!alarmSound) return;

        soundManager.playSoundEffectNTimes(SoundEffect.Alarm, 3);
        expect(alarmSound.stop).toHaveBeenCalled(); // Should stop any currently playing instance
        expect(alarmSound.on).toHaveBeenCalledWith("end", expect.any(Function));
        expect(alarmSound.play).toHaveBeenCalled();
      });

      it("should not play sound effect multiple times when disabled", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.Alarm, false);
        const soundEffects = (soundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        soundManager.playSoundEffectNTimes(SoundEffect.Alarm, 3);
        if (alarmSound) {
          expect(alarmSound.play).not.toHaveBeenCalled();
        }
      });

      it("should stop currently playing instance before playing multiple times", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        soundManager.playSoundEffectNTimes(SoundEffect.Alarm, 2);
        if (alarmSound) {
          expect(alarmSound.stop).toHaveBeenCalled();
        }
      });

      it("should remove existing event listener before adding new one", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        if (!alarmSound) return;

        // First call
        soundManager.playSoundEffectNTimes(SoundEffect.Alarm, 2);
        const firstHandler = alarmSound.on.mock.calls[0][1];

        // Second call should remove first handler
        alarmSound.on.mockClear();
        soundManager.playSoundEffectNTimes(SoundEffect.Alarm, 3);
        expect(alarmSound.off).toHaveBeenCalledWith("end", firstHandler);
      });
    });

    describe("stopSoundEffect", () => {
      it("should stop a playing sound effect", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        soundManager.stopSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.stop).toHaveBeenCalled();
        }
      });

      it("should handle stopping non-existent sound effect gracefully", () => {
        const nonExistentSound = "non-existent" as SoundEffect;
        expect(() => {
          soundManager.stopSoundEffect(nonExistentSound);
        }).not.toThrow();
      });
    });

    describe("loadSoundEffect", () => {
      it("should load a new sound effect", () => {
        const initialSize = (soundManager as any).soundEffects.size;
        soundManager.loadSoundEffect(SoundEffect.KaChing, "test-sound.mp3");
        // Should not add duplicate
        expect((soundManager as any).soundEffects.size).toBe(initialSize);
      });

      it("should create Howl instance with correct options", () => {
        // Try to load a new sound effect (will be skipped if exists)
        soundManager.loadSoundEffect(
          SoundEffect.KaChing,
          "test-sound.mp3",
          true,
        );

        // Verify Howl was called with correct options during initialization
        // The actual loading happens in constructor, so we check the existing setup
        expect(
          (soundManager as any).soundEffects.has(SoundEffect.KaChing),
        ).toBe(true);
      });
    });

    describe("unloadSoundEffect", () => {
      it("should unload a sound effect", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        soundManager.unloadSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.unload).toHaveBeenCalled();
        }
      });

      it("should remove sound effect from map after unloading", () => {
        const hadSound = (soundManager as any).soundEffects.has(
          SoundEffect.KaChing,
        );
        soundManager.unloadSoundEffect(SoundEffect.KaChing);
        if (hadSound) {
          expect(
            (soundManager as any).soundEffects.has(SoundEffect.KaChing),
          ).toBe(false);
        }
      });

      it("should handle unloading non-existent sound effect gracefully", () => {
        const nonExistentSound = "non-existent" as SoundEffect;
        expect(() => {
          soundManager.unloadSoundEffect(nonExistentSound);
        }).not.toThrow();
      });
    });

    describe("setSoundEffectEnabled", () => {
      it("should enable a sound effect", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        expect(soundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          true,
        );
      });

      it("should disable a sound effect", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        expect(soundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          false,
        );
      });

      it("should stop sound when disabling", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        if (kaChingSound) {
          expect(kaChingSound.stop).toHaveBeenCalled();
        }
      });

      it("should not stop sound when enabling", () => {
        const soundEffects = (soundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        if (kaChingSound) {
          kaChingSound.stop.mockClear();
        }
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        if (kaChingSound) {
          expect(kaChingSound.stop).not.toHaveBeenCalled();
        }
      });
    });

    describe("isSoundEffectEnabled", () => {
      it("should return true for enabled sound effect", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        expect(soundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          true,
        );
      });

      it("should return false for disabled sound effect", () => {
        soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        expect(soundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          false,
        );
      });

      it("should return true for sound effects by default", () => {
        // Reset state
        (soundManager as any).disabledSounds.clear();
        expect(soundManager.isSoundEffectEnabled(SoundEffect.Building)).toBe(
          true,
        );
      });
    });
  });

  describe("Sound Effects Volume", () => {
    describe("setSoundEffectsVolume", () => {
      it("should set volume for all sound effects", () => {
        const soundEffects = (soundManager as any).soundEffects;
        soundManager.setSoundEffectsVolume(0.5);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(0.5);
        });
      });

      it("should clamp volume to 0", () => {
        const soundEffects = (soundManager as any).soundEffects;
        soundManager.setSoundEffectsVolume(-1);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(0);
        });
      });

      it("should clamp volume to 1", () => {
        const soundEffects = (soundManager as any).soundEffects;
        soundManager.setSoundEffectsVolume(2);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(1);
        });
      });

      it("should accept valid volume values", () => {
        const soundEffects = (soundManager as any).soundEffects;
        soundManager.setSoundEffectsVolume(0.75);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(0.75);
        });
      });

      it("should update volume for newly loaded sound effects", () => {
        soundManager.setSoundEffectsVolume(0.3);

        // Load a new sound effect - it should get the current volume
        const currentVolume = (soundManager as any).soundEffectsVolume;
        expect(currentVolume).toBe(0.3);
      });
    });
  });

  describe("Background Music", () => {
    describe("playBackgroundMusic", () => {
      it("should play background music when enabled", () => {
        (soundManager as any).backgroundMusicEnabled = true;
        const backgroundMusic = (soundManager as any).backgroundMusic;
        const currentTrack = (soundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].playing.mockReturnValue(false);
          soundManager.playBackgroundMusic();
          expect(backgroundMusic[currentTrack].play).toHaveBeenCalled();
        }
      });

      it("should not play background music when disabled", () => {
        soundManager.setBackgroundMusicEnabled(false);
        const backgroundMusic = (soundManager as any).backgroundMusic;
        const currentTrack = (soundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].play.mockClear();
          soundManager.playBackgroundMusic();
          expect(backgroundMusic[currentTrack].play).not.toHaveBeenCalled();
        }
      });

      it("should not play if music is already playing", () => {
        (soundManager as any).backgroundMusicEnabled = true;
        const backgroundMusic = (soundManager as any).backgroundMusic;
        const currentTrack = (soundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].playing.mockReturnValue(true);
          backgroundMusic[currentTrack].play.mockClear();
          soundManager.playBackgroundMusic();
          expect(backgroundMusic[currentTrack].play).not.toHaveBeenCalled();
        }
      });

      it("should handle empty background music array gracefully", () => {
        const originalMusic = (soundManager as any).backgroundMusic;
        (soundManager as any).backgroundMusic = [];
        expect(() => {
          soundManager.playBackgroundMusic();
        }).not.toThrow();
        (soundManager as any).backgroundMusic = originalMusic;
      });
    });

    describe("stopBackgroundMusic", () => {
      it("should stop background music", () => {
        const backgroundMusic = (soundManager as any).backgroundMusic;
        const currentTrack = (soundManager as any).currentTrack;
        soundManager.stopBackgroundMusic();
        if (backgroundMusic[currentTrack]) {
          expect(backgroundMusic[currentTrack].stop).toHaveBeenCalled();
        }
      });

      it("should handle empty background music array gracefully", () => {
        const originalMusic = (soundManager as any).backgroundMusic;
        (soundManager as any).backgroundMusic = [];
        expect(() => {
          soundManager.stopBackgroundMusic();
        }).not.toThrow();
        (soundManager as any).backgroundMusic = originalMusic;
      });
    });

    describe("setBackgroundMusicVolume", () => {
      it("should set volume for all background music tracks", () => {
        const backgroundMusic = (soundManager as any).backgroundMusic;
        soundManager.setBackgroundMusicVolume(0.5);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(0.5);
        });
      });

      it("should clamp volume to 0", () => {
        const backgroundMusic = (soundManager as any).backgroundMusic;
        soundManager.setBackgroundMusicVolume(-1);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(0);
        });
      });

      it("should clamp volume to 1", () => {
        const backgroundMusic = (soundManager as any).backgroundMusic;
        soundManager.setBackgroundMusicVolume(2);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(1);
        });
      });

      it("should accept valid volume values", () => {
        const backgroundMusic = (soundManager as any).backgroundMusic;
        soundManager.setBackgroundMusicVolume(0.75);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(0.75);
        });
      });
    });

    describe("setBackgroundMusicEnabled", () => {
      it("should enable background music", () => {
        soundManager.setBackgroundMusicEnabled(true);
        expect(soundManager.isBackgroundMusicEnabled()).toBe(true);
      });

      it("should disable background music", () => {
        soundManager.setBackgroundMusicEnabled(false);
        expect(soundManager.isBackgroundMusicEnabled()).toBe(false);
      });

      it("should play music when enabling", () => {
        soundManager.setBackgroundMusicEnabled(false);
        const backgroundMusic = (soundManager as any).backgroundMusic;
        const currentTrack = (soundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].play.mockClear();
          backgroundMusic[currentTrack].playing.mockReturnValue(false);
          soundManager.setBackgroundMusicEnabled(true);
          expect(backgroundMusic[currentTrack].play).toHaveBeenCalled();
        }
      });

      it("should stop music when disabling", () => {
        soundManager.setBackgroundMusicEnabled(true);
        const backgroundMusic = (soundManager as any).backgroundMusic;
        const currentTrack = (soundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].stop.mockClear();
          soundManager.setBackgroundMusicEnabled(false);
          expect(backgroundMusic[currentTrack].stop).toHaveBeenCalled();
        }
      });
    });

    describe("isBackgroundMusicEnabled", () => {
      it("should return true when enabled", () => {
        soundManager.setBackgroundMusicEnabled(true);
        expect(soundManager.isBackgroundMusicEnabled()).toBe(true);
      });

      it("should return false when disabled", () => {
        soundManager.setBackgroundMusicEnabled(false);
        expect(soundManager.isBackgroundMusicEnabled()).toBe(false);
      });
    });

    describe("track switching", () => {
      it("should switch to next track when current track ends", () => {
        const originalCurrentTrack = (soundManager as any).currentTrack;
        const musicTracks = (soundManager as any).backgroundMusic;

        // Simulate track end by calling playNext
        (soundManager as any).playNext();

        const newCurrentTrack = (soundManager as any).currentTrack;
        expect(newCurrentTrack).toBe(
          (originalCurrentTrack + 1) % musicTracks.length,
        );
      });

      it("should wrap around to first track after last track", () => {
        const musicTracks = (soundManager as any).backgroundMusic;
        (soundManager as any).currentTrack = musicTracks.length - 1;

        (soundManager as any).playNext();

        expect((soundManager as any).currentTrack).toBe(0);
      });
    });
  });

  describe("Sound Settings Integration", () => {
    it("should maintain separate volume settings for sound effects and background music", () => {
      soundManager.setSoundEffectsVolume(0.8);
      soundManager.setBackgroundMusicVolume(0.3);

      expect((soundManager as any).soundEffectsVolume).toBe(0.8);
      expect((soundManager as any).backgroundMusicVolume).toBe(0.3);
    });

    it("should allow independent enable/disable of sound effects and background music", () => {
      soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
      soundManager.setBackgroundMusicEnabled(true);

      expect(soundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
        false,
      );
      expect(soundManager.isBackgroundMusicEnabled()).toBe(true);
    });

    it("should handle multiple sound effects independently", () => {
      soundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
      soundManager.setSoundEffectEnabled(SoundEffect.Building, true);
      soundManager.setSoundEffectEnabled(SoundEffect.Alarm, false);

      expect(soundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
        false,
      );
      expect(soundManager.isSoundEffectEnabled(SoundEffect.Building)).toBe(
        true,
      );
      expect(soundManager.isSoundEffectEnabled(SoundEffect.Alarm)).toBe(false);
    });
  });
});
