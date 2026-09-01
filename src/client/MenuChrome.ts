/**
 * The menu chrome that a starting game hides, and its inverse.
 *
 * These two functions live together on purpose. Starting a game hid the ad
 * rails and closed the promos, and for a long time nothing put them back --
 * it did not need to, because every exit from a STARTED game was a full
 * `window.location.href = "/"` navigation and the reload rebuilt the page.
 * `openInvite()` (OPE-204) became the first exit that leaves in place, and the
 * missing inverse surfaced as a homepage with no promos behind a frozen lobby
 * list (OPE-255). Keeping the hide and the restore in one module is what stops
 * them drifting apart again.
 *
 * Note what is NOT here: the public lobby socket. That belongs to
 * <game-mode-selector>, which owns its lifecycle -- see its start()/stop().
 */

/**
 * Whether a started game's teardown is what we are leaving, and therefore
 * whether there is anything to put back.
 *
 * The `in-game` body class is set only once the join resolves (setInGameSignal
 * in Main.ts), so it is the record of a game having actually STARTED rather
 * than merely being joined. That distinction is the whole gate: a pre-start
 * leave never hid the chrome and never stopped the lobby socket, so restoring
 * there would reconnect a live socket and throw away its snapshot for nothing.
 *
 * Callers must read this BEFORE clearing the signal.
 */
export function inStartedGame(): boolean {
  return document.body.classList.contains("in-game");
}

/** Hide the menu chrome for a game that is starting. */
export function hideMenuChrome(): void {
  document.querySelectorAll(".ad").forEach((ad) => {
    (ad as HTMLElement).style.display = "none";
  });
}

/**
 * Put back what hideMenuChrome took away, plus the promos section that the
 * game-start modal sweep closes.
 *
 * Clears the inline display rather than forcing "block": these slots take
 * their real layout from the stylesheet, and a slot the page had its own
 * reason to hide must not be forced visible by us.
 *
 * Everything here is best-effort and must not throw. On the desktop shell --
 * the only place the in-place leave path can currently be reached -- ads never
 * load (`window.adsEnabled` is false there), so <homepage-promos> may not be
 * upgraded and may expose no show() at all. A throw here would take down the
 * lobby-socket restart that runs beside it, which is the part players actually
 * see.
 */
export function restoreMenuChrome(): void {
  document.querySelectorAll(".ad").forEach((ad) => {
    (ad as HTMLElement).style.display = "";
  });
  const promos = document.querySelector("homepage-promos") as
    | (HTMLElement & { show?: () => void })
    | null;
  try {
    promos?.show?.();
  } catch (e) {
    console.warn("failed to restore homepage promos", e);
  }
}
