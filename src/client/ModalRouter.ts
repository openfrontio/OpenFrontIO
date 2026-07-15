/**
 * ModalRouter — two-way sync between `#modal=<name>&tab=<key>&...` and modals.
 *
 * URL → modal: parse hash, find registered modal, call `modal.open(args)`.
 * Modal → URL: when a router-managed modal opens, closes, or switches tabs,
 * update the URL via `history.replaceState` (no history entries).
 *
 * Lobby modals (join/host) and matchmaking are intentionally not registered:
 * they have their own URL state (path-based) or none at all.
 */

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
}

class ModalRouter {
  private registry = new Map<string, RegistryEntry>();
  /** Name of the modal currently reflected in the URL, if any. */
  private currentName: string | null = null;
  /** True while we're routing from the URL (suppress modal→URL sync). */
  private routingFromUrl = false;

  register(name: string, entry: RegistryEntry): void {
    this.registry.set(name, entry);
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
    const params = new URLSearchParams(hash.slice(1));
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

    void this.openRegistered(name, entry, args);
    return true;
  }

  private async openRegistered(
    name: string,
    entry: RegistryEntry,
    args: Record<string, unknown>,
  ): Promise<void> {
    // The custom element may not be upgraded yet (e.g. routed on initial load
    // before its module has finished evaluating). Wait so el.open is defined.
    await customElements.whenDefined(entry.tag);

    this.routingFromUrl = true;
    try {
      this.currentName = name;
      if (entry.pageId) {
        // Inline modal: showPage reveals the page-content container and calls
        // .open() on the inline modal element automatically. We then call
        // .open(args) so the args reach onOpen.
        window.showPage?.(entry.pageId);
      }
      const el = document.querySelector(entry.tag) as RoutableModal | null;
      el?.open(args);
    } finally {
      this.routingFromUrl = false;
    }
  }

  /** Called by BaseModal.open() when a router-managed modal opens. */
  syncOpened(name: string, args?: Record<string, unknown>): void {
    if (this.routingFromUrl) return; // we're driving the modal from the URL; don't loop
    if (!this.registry.has(name)) return;
    this.currentName = name;
    this.writeHash(name, args);
  }

  /** Called by BaseModal.close() when a router-managed modal closes. */
  syncClosed(name: string): void {
    if (this.routingFromUrl) return;
    if (this.currentName !== name) return; // not the active routed modal
    this.currentName = null;
    this.replaceHash("");
  }

  /** Called by BaseModal.setActiveTab() when a router-managed modal switches tabs. */
  syncTab(name: string, tab: string): void {
    if (this.routingFromUrl) return;
    if (this.currentName !== name) return;
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
    const url = window.location.pathname + window.location.search + hash;
    history.replaceState(history.state, "", url);
  }
}

export const modalRouter = new ModalRouter();
