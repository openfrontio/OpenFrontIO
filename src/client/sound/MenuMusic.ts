import { Howl } from "howler";
import { assetUrl } from "../../core/AssetUrls";
import { AudioMixer } from "./AudioMixer";

// Long enough not to sound like a cut, short enough that the lobby is not
// still playing menu music when the map appears.
const MENU_FADE_MS = 700;

// An ease-in, not a swell. Long enough that the theme arrives rather than
// lands, short enough that the page is not still getting louder while the
// player reads it.
const MENU_FADE_IN_MS = 2000;

/**
 * Where the ramp starts, in dB below its target.
 *
 * This is driven here rather than through Howler's fade() because fade() is
 * linear in AMPLITUDE, and loudness is roughly linear in dB -- so a linear
 * ramp is heavily front-loaded and does not sound like a fade at all. At the
 * real defaults (music slider 0.5, squared by perceptualGain, times the -1 dB
 * trim, so a target of 0.2225) Howler's 0.01 quantisation gives 22 steps, and
 * the first two of them cover the bottom 21 dB:
 *
 *     90ms  0.01  -26.9 dB      989ms  0.11   -6.1 dB
 *    180ms  0.02  -20.9 dB     1438ms  0.16   -2.9 dB
 *    449ms  0.05  -13.0 dB     1978ms  0.22   -0.1 dB
 *
 * Within 6 dB of final at one second and 3 dB at 1.4s: the last 600ms are
 * inaudible and the track has perceptually arrived in about 300ms. Stepping
 * linearly in dB instead spends equal time on equal perceived change.
 *
 * -48 dB is low enough to start from true silence to the ear without wasting
 * the front of the ramp somewhere nothing is audible.
 */
const MENU_FADE_IN_FLOOR_DB = -48;

// ~0.6 dB a step across the ramp: continuous to the ear, and cheap. Writing
// the volume directly also dodges the 0.01 quantisation Howler's own fade
// applies, which at this target would be 6 dB on the very first step.
const MENU_FADE_IN_STEP_MS = 25;

/** Gain `t` of the way through the ramp, linear in dB from the floor to 0. */
function rampGain(target: number, t: number): number {
  return target * 10 ** ((MENU_FADE_IN_FLOOR_DB * (1 - t)) / 20);
}

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
 * Every start ramps up from silence rather than arriving at full level, in
 * even dB steps rather than Howler's linear-amplitude fade(). The ramp reads
 * the music channel on every step, so the slider and the focus duck both
 * reach the theme while it is still coming up; the Howl is handed to the
 * mixer when the ramp lands, which is the only place it is registered.
 *
 * The 700ms fade-OUT is left on Howler's own fade(): it is short, it happens
 * under a scene change, and a linear fade-out errs by dropping away late
 * rather than by arriving instantly, which is far less noticeable than the
 * same curve going the other way.
 */
export function startMenuMusic(mixer: AudioMixer): void {
  let theme: Howl | null = null;
  let teardownFadeIn: (() => void) | null = null;

  /**
   * Stops the ramp wherever it is, leaving the volume untouched.
   *
   * This has to cover the ramp that has not started yet as well as one in
   * flight: while the stream is still loading all that exists is a pending
   * "play" handler, and a departing theme that starts ramping after it has
   * been unregistered would write over its own fade-out.
   */
  const cancelFadeIn = () => {
    teardownFadeIn?.();
    teardownFadeIn = null;
  };

  /**
   * Hands the level back to the mixer once the ramp is done with it.
   *
   * Registering writes the channel volume straight onto the Howl, so it also
   * lands the ramp exactly on target. The mixer cannot take this one on
   * during the ramp, or its writes and the ramp's would fight; the ramp reads
   * the channel itself in the meantime, so nothing is lost by waiting.
   */
  const settle = (howl: Howl) => {
    cancelFadeIn();
    mixer.register(howl, "music");
  };

  /**
   * Arms the ramp. Must be called before play(), and the ramp itself does not
   * start until the Howl says playback actually began.
   *
   * play() on a Howl that has not loaded yet queues itself and returns at
   * once, so the call tells us nothing about when the first sample lands. For
   * an html5 stream the gap is a network fetch: a few hundred ms warm, and on
   * a slow connection longer than the whole ramp -- in which case timing from
   * the call meant the theme arrived at full level with no fade at all, on
   * exactly the connections least likely to be tested. Howler emits "play"
   * when the media element's own play() promise resolves, which is playback
   * actually starting, and it releases _playLock before that emit, so the
   * event is the right signal whether the play was deferred or immediate.
   */
  const fadeIn = (howl: Howl) => {
    let rampTimer: ReturnType<typeof setInterval> | null = null;

    const beginRamp = () => {
      // Nothing to hear and nothing to ramp on a channel that is already
      // silent, so hand it over rather than run an interval writing zero
      // eighty times. Registered, the mixer brings it up if music comes back.
      if (mixer.volumeFor("music") === 0) {
        settle(howl);
        return;
      }
      const startedAt = performance.now();
      howl.volume(rampGain(mixer.volumeFor("music"), 0));
      rampTimer = setInterval(() => {
        // Driven off elapsed time rather than a tick count: a backgrounded tab
        // throttles timers hard, and the ramp should still finish on schedule
        // with coarser steps rather than stretch out to minutes.
        const t = Math.min(
          1,
          (performance.now() - startedAt) / MENU_FADE_IN_MS,
        );
        if (t >= 1) {
          settle(howl);
          return;
        }
        // The target is read every tick, so `t` is only ever the ramp's own
        // position in dB and the level it scales is always the current one.
        // A mute lands within a tick; the focus duck takes the theme to
        // silence and gives it back at the position the ramp has meanwhile
        // reached rather than at full; a slider tracks continuously. None of
        // them restarts the ramp or moves its clock, so there is no lag
        // behind the handle, and no need to tell a deliberate change apart
        // from an incidental one.
        howl.volume(rampGain(mixer.volumeFor("music"), t));
      }, MENU_FADE_IN_STEP_MS);
    };

    const onPlay = () => beginRamp();
    // Playback never started, so there is nothing to ramp. Hand it over
    // anyway, rather than leave a Howl that nothing owns.
    const onPlayError = () => settle(howl);

    teardownFadeIn = () => {
      if (rampTimer !== null) {
        clearInterval(rampTimer);
        rampTimer = null;
      }
      howl.off("play", onPlay);
      howl.off("playerror", onPlayError);
    };

    // Hold the floor before anything can be heard, so no sample can escape
    // above it however the load and the first write interleave.
    howl.volume(rampGain(mixer.volumeFor("music"), 0));
    howl.once("play", onPlay);
    howl.once("playerror", onPlayError);
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
      // Armed before play(), so the "play" handler is on the Howl no matter
      // how quickly playback starts. Every start, including the re-arm after
      // "menu-restored" -- music slamming in on the way back from a lobby is
      // just as abrupt as it is on load.
      fadeIn(theme);
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
    // Stop the ramp before anything else: it would otherwise keep writing
    // volumes over the fade-out below, and its settle would hand a theme on
    // its way out back to the mixer, which would then go on writing to an
    // unloaded Howl and hold it alive for the session.
    cancelFadeIn();
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
