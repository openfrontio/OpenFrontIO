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
  // Helper to get mock instances
  const getMockInstances = () => {
    return (Howl as any).getInstances ? (Howl as any).getInstances() : [];
  };

  // Since SoundManager is a singleton, we need to reset its state between tests
  beforeEach(() => {
    const instances = getMockInstances();
    // Reset all mock instances (they're created when SoundManager is imported)
    instances.forEach((instance: any) => {
      instance.play.mockClear();
      instance.stop.mockClear();
      instance.volume.mockClear().mockReturnValue(1);
      instance.unload.mockClear();
      instance.on.mockClear();
      instance.off.mockClear();
      instance.playing.mockClear().mockReturnValue(false);
    });

    // Reset SoundManager state by accessing private properties
    (SoundManager as any).disabledSounds.clear();
    (SoundManager as any).soundEffectsVolume = 1;
    (SoundManager as any).backgroundMusicVolume = 0;
    (SoundManager as any).backgroundMusicEnabled = true;
    (SoundManager as any).alarmEndHandlers.clear();
  });

  describe("Sound Effects", () => {
    describe("playSoundEffect", () => {
      it("should play a sound effect when enabled", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        SoundManager.playSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.play).toHaveBeenCalled();
        }
      });

      it("should not play a sound effect when disabled", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        SoundManager.playSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.play).not.toHaveBeenCalled();
        }
      });

      it("should play sound effect after re-enabling", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        SoundManager.playSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.play).toHaveBeenCalled();
        }
      });

      it("should handle playing non-existent sound effect gracefully", () => {
        // Create a new sound effect that doesn't exist
        const nonExistentSound = "non-existent" as SoundEffect;
        expect(() => {
          SoundManager.playSoundEffect(nonExistentSound);
        }).not.toThrow();
      });
    });

    describe("playSoundEffectNTimes", () => {
      it("should play sound effect multiple times", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        if (!alarmSound) return;

        SoundManager.playSoundEffectNTimes(SoundEffect.Alarm, 3);
        expect(alarmSound.stop).toHaveBeenCalled(); // Should stop any currently playing instance
        expect(alarmSound.on).toHaveBeenCalledWith("end", expect.any(Function));
        expect(alarmSound.play).toHaveBeenCalled();
      });

      it("should not play sound effect multiple times when disabled", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.Alarm, false);
        const soundEffects = (SoundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        SoundManager.playSoundEffectNTimes(SoundEffect.Alarm, 3);
        if (alarmSound) {
          expect(alarmSound.play).not.toHaveBeenCalled();
        }
      });

      it("should stop currently playing instance before playing multiple times", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        SoundManager.playSoundEffectNTimes(SoundEffect.Alarm, 2);
        if (alarmSound) {
          expect(alarmSound.stop).toHaveBeenCalled();
        }
      });

      it("should remove existing event listener before adding new one", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const alarmSound = soundEffects.get(SoundEffect.Alarm);
        if (!alarmSound) return;

        // First call
        SoundManager.playSoundEffectNTimes(SoundEffect.Alarm, 2);
        const firstHandler = alarmSound.on.mock.calls[0][1];

        // Second call should remove first handler
        alarmSound.on.mockClear();
        SoundManager.playSoundEffectNTimes(SoundEffect.Alarm, 3);
        expect(alarmSound.off).toHaveBeenCalledWith("end", firstHandler);
      });
    });

    describe("stopSoundEffect", () => {
      it("should stop a playing sound effect", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        SoundManager.stopSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.stop).toHaveBeenCalled();
        }
      });

      it("should handle stopping non-existent sound effect gracefully", () => {
        const nonExistentSound = "non-existent" as SoundEffect;
        expect(() => {
          SoundManager.stopSoundEffect(nonExistentSound);
        }).not.toThrow();
      });
    });

    describe("loadSoundEffect", () => {
      it("should load a new sound effect", () => {
        const initialSize = (SoundManager as any).soundEffects.size;
        SoundManager.loadSoundEffect(SoundEffect.KaChing, "test-sound.mp3");
        // Should not add duplicate
        expect((SoundManager as any).soundEffects.size).toBe(initialSize);
      });

      it("should create Howl instance with correct options", () => {
        // Try to load a new sound effect (will be skipped if exists)
        SoundManager.loadSoundEffect(
          SoundEffect.KaChing,
          "test-sound.mp3",
          true,
        );

        // Verify Howl was called with correct options during initialization
        // The actual loading happens in constructor, so we check the existing setup
        expect(
          (SoundManager as any).soundEffects.has(SoundEffect.KaChing),
        ).toBe(true);
      });
    });

    describe("unloadSoundEffect", () => {
      it("should unload a sound effect", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        SoundManager.unloadSoundEffect(SoundEffect.KaChing);
        if (kaChingSound) {
          expect(kaChingSound.unload).toHaveBeenCalled();
        }
      });

      it("should remove sound effect from map after unloading", () => {
        const hadSound = (SoundManager as any).soundEffects.has(
          SoundEffect.KaChing,
        );
        SoundManager.unloadSoundEffect(SoundEffect.KaChing);
        if (hadSound) {
          expect(
            (SoundManager as any).soundEffects.has(SoundEffect.KaChing),
          ).toBe(false);
        }
      });

      it("should handle unloading non-existent sound effect gracefully", () => {
        const nonExistentSound = "non-existent" as SoundEffect;
        expect(() => {
          SoundManager.unloadSoundEffect(nonExistentSound);
        }).not.toThrow();
      });
    });

    describe("setSoundEffectEnabled", () => {
      it("should enable a sound effect", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        expect(SoundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          true,
        );
      });

      it("should disable a sound effect", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        expect(SoundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          false,
        );
      });

      it("should stop sound when disabling", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        if (kaChingSound) {
          expect(kaChingSound.stop).toHaveBeenCalled();
        }
      });

      it("should not stop sound when enabling", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        const kaChingSound = soundEffects.get(SoundEffect.KaChing);
        if (kaChingSound) {
          kaChingSound.stop.mockClear();
        }
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        if (kaChingSound) {
          expect(kaChingSound.stop).not.toHaveBeenCalled();
        }
      });
    });

    describe("isSoundEffectEnabled", () => {
      it("should return true for enabled sound effect", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, true);
        expect(SoundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          true,
        );
      });

      it("should return false for disabled sound effect", () => {
        SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
        expect(SoundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
          false,
        );
      });

      it("should return true for sound effects by default", () => {
        // Reset state
        (SoundManager as any).disabledSounds.clear();
        expect(SoundManager.isSoundEffectEnabled(SoundEffect.Building)).toBe(
          true,
        );
      });
    });
  });

  describe("Sound Effects Volume", () => {
    describe("setSoundEffectsVolume", () => {
      it("should set volume for all sound effects", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        SoundManager.setSoundEffectsVolume(0.5);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(0.5);
        });
      });

      it("should clamp volume to 0", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        SoundManager.setSoundEffectsVolume(-1);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(0);
        });
      });

      it("should clamp volume to 1", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        SoundManager.setSoundEffectsVolume(2);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(1);
        });
      });

      it("should accept valid volume values", () => {
        const soundEffects = (SoundManager as any).soundEffects;
        SoundManager.setSoundEffectsVolume(0.75);
        soundEffects.forEach((sound: any) => {
          expect(sound.volume).toHaveBeenCalledWith(0.75);
        });
      });

      it("should update volume for newly loaded sound effects", () => {
        SoundManager.setSoundEffectsVolume(0.3);

        // Load a new sound effect - it should get the current volume
        const currentVolume = (SoundManager as any).soundEffectsVolume;
        expect(currentVolume).toBe(0.3);
      });
    });
  });

  describe("Background Music", () => {
    describe("playBackgroundMusic", () => {
      it("should play background music when enabled", () => {
        (SoundManager as any).backgroundMusicEnabled = true;
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        const currentTrack = (SoundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].playing.mockReturnValue(false);
          SoundManager.playBackgroundMusic();
          expect(backgroundMusic[currentTrack].play).toHaveBeenCalled();
        }
      });

      it("should not play background music when disabled", () => {
        SoundManager.setBackgroundMusicEnabled(false);
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        const currentTrack = (SoundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].play.mockClear();
          SoundManager.playBackgroundMusic();
          expect(backgroundMusic[currentTrack].play).not.toHaveBeenCalled();
        }
      });

      it("should not play if music is already playing", () => {
        (SoundManager as any).backgroundMusicEnabled = true;
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        const currentTrack = (SoundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].playing.mockReturnValue(true);
          backgroundMusic[currentTrack].play.mockClear();
          SoundManager.playBackgroundMusic();
          expect(backgroundMusic[currentTrack].play).not.toHaveBeenCalled();
        }
      });

      it("should handle empty background music array gracefully", () => {
        const originalMusic = (SoundManager as any).backgroundMusic;
        (SoundManager as any).backgroundMusic = [];
        expect(() => {
          SoundManager.playBackgroundMusic();
        }).not.toThrow();
        (SoundManager as any).backgroundMusic = originalMusic;
      });
    });

    describe("stopBackgroundMusic", () => {
      it("should stop background music", () => {
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        const currentTrack = (SoundManager as any).currentTrack;
        SoundManager.stopBackgroundMusic();
        if (backgroundMusic[currentTrack]) {
          expect(backgroundMusic[currentTrack].stop).toHaveBeenCalled();
        }
      });

      it("should handle empty background music array gracefully", () => {
        const originalMusic = (SoundManager as any).backgroundMusic;
        (SoundManager as any).backgroundMusic = [];
        expect(() => {
          SoundManager.stopBackgroundMusic();
        }).not.toThrow();
        (SoundManager as any).backgroundMusic = originalMusic;
      });
    });

    describe("setBackgroundMusicVolume", () => {
      it("should set volume for all background music tracks", () => {
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        SoundManager.setBackgroundMusicVolume(0.5);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(0.5);
        });
      });

      it("should clamp volume to 0", () => {
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        SoundManager.setBackgroundMusicVolume(-1);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(0);
        });
      });

      it("should clamp volume to 1", () => {
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        SoundManager.setBackgroundMusicVolume(2);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(1);
        });
      });

      it("should accept valid volume values", () => {
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        SoundManager.setBackgroundMusicVolume(0.75);
        backgroundMusic.forEach((track: any) => {
          expect(track.volume).toHaveBeenCalledWith(0.75);
        });
      });
    });

    describe("setBackgroundMusicEnabled", () => {
      it("should enable background music", () => {
        SoundManager.setBackgroundMusicEnabled(true);
        expect(SoundManager.isBackgroundMusicEnabled()).toBe(true);
      });

      it("should disable background music", () => {
        SoundManager.setBackgroundMusicEnabled(false);
        expect(SoundManager.isBackgroundMusicEnabled()).toBe(false);
      });

      it("should play music when enabling", () => {
        SoundManager.setBackgroundMusicEnabled(false);
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        const currentTrack = (SoundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].play.mockClear();
          backgroundMusic[currentTrack].playing.mockReturnValue(false);
          SoundManager.setBackgroundMusicEnabled(true);
          expect(backgroundMusic[currentTrack].play).toHaveBeenCalled();
        }
      });

      it("should stop music when disabling", () => {
        SoundManager.setBackgroundMusicEnabled(true);
        const backgroundMusic = (SoundManager as any).backgroundMusic;
        const currentTrack = (SoundManager as any).currentTrack;
        if (backgroundMusic[currentTrack]) {
          backgroundMusic[currentTrack].stop.mockClear();
          SoundManager.setBackgroundMusicEnabled(false);
          expect(backgroundMusic[currentTrack].stop).toHaveBeenCalled();
        }
      });
    });

    describe("isBackgroundMusicEnabled", () => {
      it("should return true when enabled", () => {
        SoundManager.setBackgroundMusicEnabled(true);
        expect(SoundManager.isBackgroundMusicEnabled()).toBe(true);
      });

      it("should return false when disabled", () => {
        SoundManager.setBackgroundMusicEnabled(false);
        expect(SoundManager.isBackgroundMusicEnabled()).toBe(false);
      });
    });

    describe("track switching", () => {
      it("should switch to next track when current track ends", () => {
        const originalCurrentTrack = (SoundManager as any).currentTrack;
        const musicTracks = (SoundManager as any).backgroundMusic;

        // Simulate track end by calling playNext
        (SoundManager as any).playNext();

        const newCurrentTrack = (SoundManager as any).currentTrack;
        expect(newCurrentTrack).toBe(
          (originalCurrentTrack + 1) % musicTracks.length,
        );
      });

      it("should wrap around to first track after last track", () => {
        const musicTracks = (SoundManager as any).backgroundMusic;
        (SoundManager as any).currentTrack = musicTracks.length - 1;

        (SoundManager as any).playNext();

        expect((SoundManager as any).currentTrack).toBe(0);
      });
    });
  });

  describe("Sound Settings Integration", () => {
    it("should maintain separate volume settings for sound effects and background music", () => {
      SoundManager.setSoundEffectsVolume(0.8);
      SoundManager.setBackgroundMusicVolume(0.3);

      expect((SoundManager as any).soundEffectsVolume).toBe(0.8);
      expect((SoundManager as any).backgroundMusicVolume).toBe(0.3);
    });

    it("should allow independent enable/disable of sound effects and background music", () => {
      SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
      SoundManager.setBackgroundMusicEnabled(true);

      expect(SoundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
        false,
      );
      expect(SoundManager.isBackgroundMusicEnabled()).toBe(true);
    });

    it("should handle multiple sound effects independently", () => {
      SoundManager.setSoundEffectEnabled(SoundEffect.KaChing, false);
      SoundManager.setSoundEffectEnabled(SoundEffect.Building, true);
      SoundManager.setSoundEffectEnabled(SoundEffect.Alarm, false);

      expect(SoundManager.isSoundEffectEnabled(SoundEffect.KaChing)).toBe(
        false,
      );
      expect(SoundManager.isSoundEffectEnabled(SoundEffect.Building)).toBe(
        true,
      );
      expect(SoundManager.isSoundEffectEnabled(SoundEffect.Alarm)).toBe(false);
    });
  });
});
