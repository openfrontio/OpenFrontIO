/**
 * ModalRouter — two-way sync between `#modal=<name>&tab=<key>&...` and modals.
 *
 * URL → modal: parse hash, find registered modal, call `modal.open(args)`.
 * Modal → URL: when a router-managed modal opens, closes, or switches tabs,
 * update the URL via `history.replaceState` (no history entries).
 *
 * Lobby modals (join/host) and matchmaking are intentionally not registered:
 * they have their own URL state (path-based) or none at all.
 *
 * A modal can also be opened by a path link (`/player/<id>`, see
 * registerPath). While it stays open the URL keeps that path, with tab
 * changes written to `?tab=`; closing it returns the URL to the home page, so
 * a reload doesn't reopen it. Opening another modal, in-app or from the hash,
 * hands the URL to the hash and leaves the path the same way.
 */

import { EDIT_CARD_HASH } from "./components/card/CardLinks";
import { loadModal } from "./LazyModals";
import { pagePin } from "./PagePin";

/** Parses a page location into a modal's open() args, or null if it isn't one. */
export type PathRouteParser = (location: {
  pathname: string;
  search: string;
}) => Record<string, unknown> | null;

interface RegistryEntry {
  /** Custom element tag, e.g. "store-modal". */
  tag: string;
  /**
   * Optional page-content element id (e.g. "page-item-store"). When set, the
   * router calls `window.showPage(pageId)` for inline modals so the page-content
   * container becomes visible. For popup-style modals, omit.
   */
  pageId?: string;
}

/** Modals that the router can drive via the URL. */
interface RoutableModal extends HTMLElement {
  open(args?: Record<string, unknown>): void;
  close(args?: Record<string, unknown>): void;
  /**
   * Asked before a route (browser Back, a hash edited by hand, a route to
   * another page) takes this modal away. False keeps it open, and the URL
   * names it again. A modal without one closes at once, as before.
   */
  confirmRouteLeave?(): boolean | Promise<boolean>;
}

class ModalRouter {
  private registry = new Map<string, RegistryEntry>();
  /** Name of the modal currently reflected in the URL, if any. */
  private currentName: string | null = null;
  /** The hash that named currentName, to put back when it stays open. */
  private currentHash = "";
  /**
   * The page (a modal with a pageId) the router last opened that is still
   * open, and the hash that named it. A popup opened over it leaves it open
   * underneath: a route that replaces it still asks it first, and once the
   * popup closes the URL names it again.
   */
  private page: string | null = null;
  private pageHash = "";
  /**
   * A route the open modal is still being asked about (confirmRouteLeave).
   * Main routes one Back or typed hash twice (popstate, then hashchange):
   * the repeat must not ask again, since a second ask would be answered
   * "no" at once and undo the first's URL while its prompt is showing.
   */
  private pendingAsk: Promise<void> | null = null;
  /** True while we're routing from the URL (suppress modal→URL sync). */
  private routingFromUrl = false;
  private pathRoutes = new Map<string, PathRouteParser>();
  /** Name of the modal the URL's path (not its hash) reflects, if any. */
  private pathRoutedName: string | null = null;

  register(name: string, entry: RegistryEntry): void {
    this.registry.set(name, entry);
  }

  /** Let a registered modal be opened by a path link as well as the hash. */
  registerPath(name: string, parse: PathRouteParser): void {
    this.pathRoutes.set(name, parse);
  }

  /**
   * Open the modal the current path names, if one does. Returns true when it
   * did (the open itself is asynchronous, as for routeFromHash).
   */
  routeFromPath(): boolean {
    for (const [name, parse] of this.pathRoutes) {
      const entry = this.registry.get(name);
      if (entry === undefined) continue;
      const args = parse(window.location);
      if (args === null) continue;
      this.pathRoutedName = name;
      void this.openRegistered(name, entry, args);
      return true;
    }
    return false;
  }

  /** True while the named modal is open from a path link. */
  isPathRouted(name: string): boolean {
    return this.pathRoutedName === name;
  }

  // The path link has had its say: put the URL back to the home page. The
  // home page keeps the page's version pin when it has one (see
  // currentPagePath in Utils, which this mirrors without its imports). A
  // `#modal=` hash stays: it's another modal's, and that modal is still open.
  private leavePath(): void {
    if (this.pathRoutedName === null) return;
    this.pathRoutedName = null;
    const commit = pagePin();
    history.replaceState(
      history.state,
      "",
      (commit === null ? "/" : `/v/${commit}/`) +
        (this.isHashRouted() ? window.location.hash : ""),
    );
  }

  /**
   * Parse `window.location.hash` for `#modal=<name>&...`. If present and
   * registered, open the modal with the remaining keys as args. Returns true
   * if the hash was a recognized modal route (the caller can skip other
   * hash handlers). The open itself happens asynchronously after the custom
   * element is upgraded.
   */
  routeFromHash(): boolean {
    const hash = window.location.hash;
    if (!hash.startsWith("#")) return false;
    let params = new URLSearchParams(hash.slice(1));
    // The Account page's My Card tab moved to the Inventory: old links
    // (bookmarks, an older build's end screen) land on its Player card tab.
    if (params.get("modal") === "account" && params.get("tab") === "card") {
      this.replaceHash(`#${EDIT_CARD_HASH}`);
      params = new URLSearchParams(EDIT_CARD_HASH);
    }
    const name = params.get("modal");
    if (!name) return false;

    const entry = this.registry.get(name);
    if (!entry) {
      // Unknown modal — strip the hash silently.
      this.replaceHash("");
      return true;
    }

    params.delete("modal");
    const args: Record<string, unknown> = {};
    params.forEach((value, key) => {
      args[key] = value;
    });

    // Already asking about a route: this is its repeat (or one made while
    // the prompt shows), and the answer to that ask decides.
    if (this.pendingAsk !== null) return true;
    // Another page replaces the one shown: its modal may ask first.
    const leaving = this.currentName !== name && entry.pageId !== undefined;
    // The modal the URL names asks; under a popup (which has no guard), so
    // does the page it covers, which this route replaces too.
    const guarded = leaving
      ? (this.guardOf(this.currentName) ??
        (this.page !== this.currentName && this.page !== name
          ? this.guardOf(this.page)
          : null))
      : null;
    if (guarded !== null) {
      // The route asked about is this URL (path, query and hash): approved,
      // it opens with it, even if the URL moved on while the prompt was up
      // (a route made meanwhile is left to this one's answer).
      const target = currentUrl();
      void this.askThen(guarded, () => {
        this.replaceUrl(target);
        this.routeTo(name, entry, args);
      });
    } else {
      this.routeTo(name, entry, args);
    }
    return true;
  }

  private routeTo(
    name: string,
    entry: RegistryEntry,
    args: Record<string, unknown>,
  ): void {
    // The hash names the modal now, as when one opens in-app (syncOpened).
    // Left on, the path would outlive the modal it names: the router stops
    // tracking that modal, so its close wouldn't clear the path, and the next
    // reload would open it again.
    this.leavePath();
    this.setCurrent(name);
    this.currentHash = window.location.hash;
    if (this.page === name) this.pageHash = this.currentHash;
    void this.openRegistered(name, entry, args);
  }

  /** The URL names `name` now; a page is also the one under any popup. */
  private setCurrent(name: string): void {
    this.currentName = name;
    if (this.registry.get(name)?.pageId !== undefined && this.page !== name) {
      this.page = name;
      // Named by its hash once one is written; one opened from a path has
      // none (its path is left once a popup's hash takes over).
      this.pageHash = "";
    }
  }

  /** A page route that never opened (its load failed, or the URL moved on
   * first) isn't a page under anything: a popup's close never names it. */
  private forgetUnopenedPage(name: string, entry: RegistryEntry): void {
    if (this.page !== name) return;
    if (isOpenModal(document.querySelector(entry.tag))) return;
    this.page = null;
  }

  /** A popup closed: a page still open under it is the one the router
   * tracks again. */
  private backToPage(closed: string): void {
    if (closed === this.page) {
      this.page = null;
    } else if (this.page !== null) {
      this.currentName = this.page;
      this.currentHash = this.pageHash;
    }
  }

  /** The named open modal, when it asks before a route takes it away
   * (confirmRouteLeave). */
  private guardOf(name: string | null): RoutableModal | null {
    if (name === null) return null;
    const entry = this.registry.get(name);
    if (entry === undefined) return null;
    const el = document.querySelector(entry.tag) as RoutableModal | null;
    return typeof el?.confirmRouteLeave === "function" ? el : null;
  }

  /**
   * Asks `el` before a route takes it away. Yes: `proceed`. No: it stays
   * open and the URL names it again (Back has already moved the URL on, and
   * an open modal the URL doesn't name would close nothing on the next one).
   */
  private askThen(el: RoutableModal, proceed: () => void): Promise<void> {
    const ask = this.ask(el, proceed).finally(() => {
      if (this.pendingAsk === ask) this.pendingAsk = null;
    });
    this.pendingAsk = ask;
    return ask;
  }

  private async ask(el: RoutableModal, proceed: () => void): Promise<void> {
    const name = this.currentName;
    const hash = this.currentHash;
    const ok = await el.confirmRouteLeave!();
    if (ok) {
      proceed();
      return;
    }
    // Something else moved the router on meanwhile: not this ask's to undo.
    if (this.currentName !== name) return;
    this.replaceHash(hash);
  }

  private async openRegistered(
    name: string,
    entry: RegistryEntry,
    args: Record<string, unknown>,
  ): Promise<void> {
    // The custom element may not be upgraded yet (e.g. routed on initial load
    // before its module has finished evaluating, or a modal loaded on demand;
    // see LazyModals). Wait so el.open is defined.
    try {
      await loadModal(entry.tag);
    } catch (err) {
      console.error(`${entry.tag} failed to load:`, err);
      if (this.currentName === name) {
        this.currentName = null;
      }
      this.forgetUnopenedPage(name, entry);
      return;
    }
    await customElements.whenDefined(entry.tag);
    // A slow load can land after the URL has moved on to another modal. The
    // URL names this one by its hash, or by its path while path-routed.
    if (
      this.currentHashParams().get("modal") !== name &&
      this.pathRoutedName !== name
    ) {
      if (this.currentName === name) {
        this.currentName = null;
      }
      this.forgetUnopenedPage(name, entry);
      return;
    }

    this.routingFromUrl = true;
    try {
      this.setCurrent(name);
      const el = document.querySelector(entry.tag) as RoutableModal | null;
      if (entry.pageId && !isOpenModal(el)) {
        // Inline modal: showPage reveals the page-content container and calls
        // .open() on the inline modal element automatically. We then call
        // .open(args) so the args reach onOpen. Not when it's already the
        // open page: showPage closes the page shown first, so it would close
        // and reopen it (losing what it holds, e.g. unsaved card changes).
        // open(args) alone takes a tab change, through setActiveTab.
        window.showPage?.(entry.pageId);
      }
      el?.open(args);
    } finally {
      this.routingFromUrl = false;
    }
  }

  /** Called by BaseModal.open() when a router-managed modal opens. */
  syncOpened(name: string, args?: Record<string, unknown>): void {
    if (this.routingFromUrl) return; // we're driving the modal from the URL; don't loop
    if (!this.registry.has(name)) return;
    // Another modal (or this one again) opened in-app: the hash takes over.
    this.leavePath();
    this.setCurrent(name);
    this.writeHash(name, args);
  }

  /** Called by BaseModal.close() when a router-managed modal closes. */
  syncClosed(name: string): void {
    if (this.routingFromUrl) return;
    // The path names this modal whichever modal the router last recorded, so
    // its close always leaves the path.
    if (this.pathRoutedName === name) {
      if (this.currentName === name) this.currentName = null;
      this.leavePath();
      return;
    }
    if (this.currentName !== name) {
      // Not the active routed modal; a page closing under a popup isn't
      // underneath it any more.
      if (this.page === name) this.page = null;
      return;
    }
    this.currentName = null;
    this.backToPage(name);
    // The URL names the page still open under it, else nothing.
    this.replaceHash(this.currentName === null ? "" : this.pageHash);
  }

  /**
   * Close the currently active router-managed modal, if any.
   * Returns true if a modal was active and closed.
   */
  closeCurrent(): boolean {
    if (this.currentName === null) return false;
    // Already asking about a route: its answer decides.
    if (this.pendingAsk !== null) return true;
    const guarded = this.guardOf(this.currentName);
    if (guarded !== null) {
      const name = this.currentName;
      // The URL this close was asked about (Back's, path, query and hash):
      // approved, it's the URL again, even if a route typed meanwhile moved
      // it on.
      const target = currentUrl();
      void this.askThen(guarded, () => {
        if (this.currentName !== name) return;
        this.replaceUrl(target);
        this.closeNow();
      });
      return true;
    }
    this.closeNow();
    return true;
  }

  private closeNow(): void {
    if (this.currentName === null) return;
    const name = this.currentName;
    this.currentName = null;
    if (this.pathRoutedName === name) {
      this.leavePath();
    }
    const entry = this.registry.get(name);
    if (entry) {
      this.routingFromUrl = true;
      try {
        const el = document.querySelector(entry.tag) as RoutableModal | null;
        if (typeof el?.close === "function") {
          el.close();
        }
      } finally {
        this.routingFromUrl = false;
      }
    }
    this.backToPage(name);
  }

  /** Called by BaseModal.setActiveTab() when a router-managed modal switches tabs. */
  syncTab(name: string, tab: string): void {
    if (this.routingFromUrl) return;
    if (this.currentName !== name) return;
    if (this.pathRoutedName === name) {
      // Opened from a path: the path stays, and the tab rides as `?tab=`.
      const search = new URLSearchParams(window.location.search);
      if (tab) {
        search.set("tab", tab);
      } else {
        search.delete("tab");
      }
      const query = search.toString();
      history.replaceState(
        history.state,
        "",
        window.location.pathname +
          (query ? `?${query}` : "") +
          window.location.hash,
      );
      return;
    }
    const params = this.currentHashParams();
    params.set("modal", name);
    if (tab) {
      params.set("tab", tab);
    } else {
      params.delete("tab");
    }
    this.replaceHash("#" + params.toString());
  }

  /** Called when a router-managed modal changes non-tab route state. */
  syncArgs(name: string, args: Record<string, unknown>): void {
    if (this.routingFromUrl) return;
    if (this.currentName !== name) return;
    // The path is the state of a path-routed modal; don't add a hash to it.
    if (this.pathRoutedName === name) return;
    const params = this.currentHashParams();
    params.set("modal", name);
    for (const [key, value] of Object.entries(args)) {
      if (key === "modal") continue;
      if (value === undefined || value === null || value === "") {
        params.delete(key);
        continue;
      }
      if (typeof value === "object") continue;
      params.set(key, String(value));
    }
    this.replaceHash("#" + params.toString());
  }

  /** True if the current hash is `#modal=...`. */
  isHashRouted(): boolean {
    const hash = window.location.hash;
    if (!hash.startsWith("#")) return false;
    return new URLSearchParams(hash.slice(1)).has("modal");
  }

  private currentHashParams(): URLSearchParams {
    const hash = window.location.hash;
    if (!hash.startsWith("#")) return new URLSearchParams();
    return new URLSearchParams(hash.slice(1));
  }

  private writeHash(name: string, args?: Record<string, unknown>): void {
    const params = new URLSearchParams();
    params.set("modal", name);
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        if (key === "modal") continue;
        if (value === undefined || value === null || value === "") continue;
        if (typeof value === "object") continue;
        params.set(key, String(value));
      }
    }
    this.replaceHash("#" + params.toString());
  }

  private replaceHash(hash: string): void {
    this.replaceUrl(window.location.pathname + window.location.search + hash);
  }

  /** Puts `url` (path, query and hash) in place of the current entry. */
  private replaceUrl(url: string): void {
    const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    if (
      this.currentName !== null &&
      new URLSearchParams(hash.slice(1)).get("modal") === this.currentName
    ) {
      this.currentHash = hash;
    }
    if (
      this.page !== null &&
      new URLSearchParams(hash.slice(1)).get("modal") === this.page
    ) {
      this.pageHash = hash;
    }
    history.replaceState(history.state, "", url);
  }
}

/** An open modal (BaseModal's isOpen), so routing to it again only passes
 * its args. */
function isOpenModal(el: HTMLElement | null): boolean {
  const modal = el as (HTMLElement & { isOpen?: () => boolean }) | null;
  return typeof modal?.isOpen === "function" && modal.isOpen();
}

/** The page's URL now: path, query and hash. */
function currentUrl(): string {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

export const modalRouter = new ModalRouter();
