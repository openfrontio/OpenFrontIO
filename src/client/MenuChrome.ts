/**
 * The menu chrome that a starting game hides, and its inverse.
 *
 * These live together on purpose. Starting a game hid the ad rails, and for a
 * long time nothing put them back -- it did not need to, because every exit
 * from a STARTED game was a full `window.location.href = "/"` navigation and
 * the reload rebuilt the page. `openInvite()` (OPE-204) became the first exit
 * that leaves in place, and the missing inverse surfaced as a homepage with no
 * promos behind a frozen lobby list (OPE-255).
 *
 * The pairing here is deliberately NOT symmetrical, and it is worth being
 * honest about which halves live where:
 *
 *   - Ad slots: hidden by hideMenuChrome(), restored by restoreMenuChrome().
 *     Both halves are here.
 *   - <homepage-promos>: closed by the game-start MODAL SWEEP in Main.ts (it
 *     has a close() and so is caught by that list), reopened by
 *     restoreMenuChrome(). Only the restoring half is here. Reaching into the
 *     sweep to special-case it would be worse than documenting the split.
 *   - The public lobby socket: neither half is here. It belongs to
 *     <game-mode-selector>, which owns its own lifecycle -- see start()/stop().
 *     restoreMenuChrome() deliberately does not touch it.
 */

/**
 * Has the chrome been torn down and not yet put back?
 *
 * This is the gate for the whole restore, and it is keyed on the teardown
 * ITSELF rather than on any separate signal that happens to correlate with it.
 * That distinction is load-bearing.
 *
 * The first version read the `in-game` body class, which looked equivalent and
 * was not: the teardown runs in `prestart.then(...)`, while setInGameSignal(true)
 * runs later in `join.then(...)`. For multiplayer those are two distinct server
 * messages with a real gap between them while terrain loads -- the
 * "prestart->start window" ClientGameRunner names. A leave inside that window
 * (Back, or a hash change, both reachable because `currentUrl` is also unset
 * until join) found the chrome torn down but the class never set, so nothing
 * restored. That is the bug OPE-255 exists to fix, arriving through a narrower
 * door.
 *
 * Keying on the teardown makes the gate true for exactly as long as there is
 * something to undo, whatever the join lifecycle is doing, and removes any
 * ordering constraint on the caller.
 */
let tornDown = false;

export function menuChromeIsTornDown(): boolean {
  return tornDown;
}

/**
 * What each slot's inline `display` was before we hid it, so restore can put
 * that back rather than assuming every slot wants the stylesheet default. A
 * slot may already carry one for reasons of its own -- an ad the page decided
 * not to show -- and blanking it would reveal something deliberately hidden.
 *
 * Recorded per element on FIRST hide only. hideMenuChrome() runs twice on a
 * real join (prestart.then and join.then in Main.ts), and re-recording on the
 * second pass would capture our own "none" and restore a permanently hidden
 * slot. Keyed weakly so a removed slot does not pin a detached node.
 */
const displacedAdDisplay = new WeakMap<HTMLElement, string>();

/** Hide the menu chrome for a game that is starting. */
export function hideMenuChrome(): void {
  tornDown = true;
  document.querySelectorAll(".ad").forEach((ad) => {
    const el = ad as HTMLElement;
    // has() rather than a first-call flag: a slot added to the page between
    // the two hide passes still needs its own value recorded.
    if (!displacedAdDisplay.has(el)) {
      displacedAdDisplay.set(el, el.style.display);
    }
    el.style.display = "none";
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
 * The promos call is best-effort and must not throw. On the desktop shell --
 * the only place the in-place leave path can currently be reached -- ads never
 * load (`window.adsEnabled` is false there), so <homepage-promos> may not be
 * upgraded and may expose no show() at all, and its own close() reaches into
 * Playwire globals that are a bare stub on the app:// origin. A throw here
 * would abort handleLeaveLobby partway: not the lobby-socket restart, which
 * has already run by this point, but the joinModal.close() and the
 * `full-lobby` message that follow it -- leaving a stale modal open and the
 * player unaware of why their join failed.
 */
export function restoreMenuChrome(): void {
  tornDown = false;
  document.querySelectorAll(".ad").forEach((ad) => {
    const el = ad as HTMLElement;
    // Falls back to "" -- the stylesheet default -- for a slot we never hid.
    el.style.display = displacedAdDisplay.get(el) ?? "";
    // Drop the record so the next teardown captures the value afresh.
    displacedAdDisplay.delete(el);
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
