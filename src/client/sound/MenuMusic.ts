import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { AudioMixer } from "./AudioMixer";

// Long enough not to sound like a cut, short enough that the lobby is not
// still playing menu music when the map appears.
const MENU_FADE_MS = 700;

// An ease-in, not a swell. Long enough that the theme arrives rather than
// lands, short enough that the page is not still getting louder while the
// player reads it. Howler steps html5 fades on a timer in 0.01 increments, so
// at the default music level (~0.89) this is ~89 steps about 22ms apart --
// fine-grained enough not to audibly staircase.
const MENU_FADE_IN_MS = 2000;

/**
 * Loops the menu theme on the home page. Browsers block audio until a user
 * gesture, so the Howl is created and started inside the first
 * pointerdown/keydown. It fades out for good when a game starts
 * ("game-starting", like JoinLobbyModal's chime).
 *
 * It then re-arms on "menu-restored". "game-starting" fires at lobby PRESTART
 * (Main.ts, inside lobbyHandle.prestart.then), and a player who leaves in the
 * window between that and the game actually starting gets the home page put
 * back in place rather than reloaded (handleLeaveLobby, OPE-255). Tearing the
 * gesture listeners down for good would leave that live home page silent for
 * the rest of the session. Re-arming rather than replaying is deliberate: the
 * autoplay rule applies just as much to the second start as the first.
 *
 * Every start ramps up from silence rather than arriving at full level. The
 * Howl is registered with the mixer once that ramp lands, so the music slider
 * reaches it live from then on. It used to read the volume once at creation,
 * which was invisible while the home page had no volume UI and became a real
 * bug the moment it got one.
 */
export function startMenuMusic(mixer: AudioMixer): void {
  let theme: Howl | null = null;
  let stopFollowingFadeIn: (() => void) | null = null;

  /**
   * Hands the level back to the mixer once the ramp is done with it.
   *
   * Registering writes the channel volume straight onto the Howl, and Howler's
   * volume() setter calls _stopFade internally -- so the mixer can only take
   * this one on after the ramp, never during it. That leaves a two-second
   * window where the theme would not follow the music slider, which is why a
   * change on the channel settles it early: moving a slider is a deliberate
   * act and should take effect now, not once the fade happens to finish.
   */
  const settle = (howl: Howl) => {
    stopFollowingFadeIn?.();
    stopFollowingFadeIn = null;
    howl.off("fade");
    mixer.register(howl, "music");
  };

  const fadeIn = (howl: Howl) => {
    const target = mixer.volumeFor("music");
    // A fade whose start equals its end never completes in Howler, so the
    // settle scheduled on "fade" would never run and the theme would stay
    // unregistered for the rest of the session. On a silent channel there is
    // nothing to hear and nothing to ramp, so hand it over directly.
    if (target === 0) {
      mixer.register(howl, "music");
      return;
    }
    stopFollowingFadeIn = mixer.onChange((category) => {
      if (category === "music") settle(howl);
    });
    howl.fade(0, target, MENU_FADE_IN_MS);
    howl.once("fade", () => settle(howl));
  };

  const start = () => {
    if (theme !== null) return;
    try {
      theme = new Howl({
        src: [assetUrl("sounds/music/menu-theme.mp3")],
        loop: true,
        volume: 0,
        // Stream rather than decode 2.2 MB up front -- see the gameplay track
        // in SoundManager. This one starts on the player's first click, so the
        // wait would land right when they are trying to use the page.
        html5: true,
      });
      theme.play();
      // Every start, including the re-arm after "menu-restored" -- music
      // slamming in on the way back from a lobby is just as abrupt as it is
      // on load.
      fadeIn(theme);
    } catch (error) {
      console.warn("Failed to play menu theme", error);
    }
  };

  // Removing first keeps arm() idempotent, so a second "menu-restored" -- or
  // one arriving while the listeners are still up -- cannot stack a duplicate.
  const arm = () => {
    disarm();
    document.addEventListener("pointerdown", start, { once: true });
    document.addEventListener("keydown", start, { once: true });
  };

  // Both come off together. `once` only removes the listener that fired, so
  // after a pointerdown the keydown one is still live and would otherwise
  // start the menu theme over the top of a game.
  const disarm = () => {
    document.removeEventListener("pointerdown", start);
    document.removeEventListener("keydown", start);
  };

  arm();

  document.addEventListener("game-starting", () => {
    disarm();
    if (theme === null) return;
    const ending = theme;
    theme = null;
    // Drop the fade-in bookkeeping before anything else. Its "fade" handler is
    // still on the Howl, and the fade-out below would otherwise trigger it --
    // re-registering a theme on its way out, so the mixer would go on writing
    // volumes to an unloaded Howl and hold it alive for the session.
    stopFollowingFadeIn?.();
    stopFollowingFadeIn = null;
    ending.off("fade");
    // Unregister too: a slider move mid-fade would otherwise pull the volume
    // back up as the theme is leaving.
    mixer.unregister(ending);
    const from = ending.volume() as number;
    if (from === 0) {
      ending.stop();
      ending.unload();
      return;
    }
    ending.fade(from, 0, MENU_FADE_MS);
    ending.once("fade", () => {
      ending.stop();
      ending.unload();
    });
  });

  document.addEventListener("menu-restored", arm);
}
