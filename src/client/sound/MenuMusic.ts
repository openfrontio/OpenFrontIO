import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { AudioMixer } from "./AudioMixer";

// Long enough not to sound like a cut, short enough that the lobby is not
// still playing menu music when the map appears.
const MENU_FADE_MS = 700;

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
 * The Howl is registered with the mixer, so the music slider reaches it live.
 * It used to read the volume once at creation, which was invisible while the
 * home page had no volume UI and became a real bug the moment it got one.
 */
export function startMenuMusic(mixer: AudioMixer): void {
  let theme: Howl | null = null;

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
      mixer.register(theme, "music");
      theme.play();
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
    // Unregister first: a slider move mid-fade would otherwise pull the
    // volume back up as the theme is leaving.
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
