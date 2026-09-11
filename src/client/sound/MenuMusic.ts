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
 * ("game-starting", like JoinLobbyModal's chime); returning to the home page
 * is a full page load, which starts the theme fresh.
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
      });
      mixer.register(theme, "music");
      theme.play();
    } catch (error) {
      console.warn("Failed to play menu theme", error);
    }
  };

  document.addEventListener("pointerdown", start, { once: true });
  document.addEventListener("keydown", start, { once: true });
  document.addEventListener("game-starting", () => {
    document.removeEventListener("pointerdown", start);
    document.removeEventListener("keydown", start);
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
}
