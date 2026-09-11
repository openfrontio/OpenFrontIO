import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { UserSettings } from "../../core/game/UserSettings";

// Same audio-taper curve as SoundManager: the linear slider position is
// squared into perceptual gain.
function perceptualGain(position: number): number {
  const clamped = Math.max(0, Math.min(1, position));
  return clamped * clamped;
}

/**
 * Loops the menu theme on the home page. Browsers block audio until a user
 * gesture, so the Howl is created and started inside the first
 * pointerdown/keydown. It stops for good when a game starts ("game-starting",
 * like JoinLobbyModal's chime); returning to the home page is a full page
 * load, which starts the theme fresh.
 */
export function startMenuMusic(userSettings: UserSettings): void {
  let theme: Howl | null = null;
  const start = () => {
    if (theme !== null) return;
    try {
      theme = new Howl({
        src: [assetUrl("sounds/music/menu-theme.mp3")],
        loop: true,
        volume: perceptualGain(userSettings.backgroundMusicVolume()),
      });
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
    theme?.stop();
    theme?.unload();
    theme = null;
  });
}
