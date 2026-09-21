import {
  html,
  LitElement,
  nothing,
  ReactiveController,
  TemplateResult,
} from "lit";
import { canObserveNear, observeNear } from "./LazyVisibility";

const PAGE_SIZE = 24;

interface ListState {
  key: string;
  limit: number;
}

interface Watched {
  element: Element;
  limit: number;
  stop: () => void;
}

/**
 * Renders long lists a page at a time. Each list shows its first page plus a
 * sentinel element, and grows by a page whenever that sentinel nears the
 * screen. `slot` names the list within the host (and must be unique among
 * nested hosts); a new `key` for the slot (tab, search) starts it over.
 */
export class ProgressiveList implements ReactiveController {
  private readonly lists = new Map<string, ListState>();
  private readonly watched = new Map<string, Watched>();

  constructor(
    private readonly host: LitElement,
    private readonly pageSize = PAGE_SIZE,
  ) {
    host.addController(this);
  }

  page<T>(
    slot: string,
    key: string,
    items: readonly T[],
  ): { items: readonly T[]; more: TemplateResult | typeof nothing } {
    if (!canObserveNear()) return { items, more: nothing };
    let state = this.lists.get(slot);
    if (state === undefined || state.key !== key) {
      state = { key, limit: this.pageSize };
      this.lists.set(slot, state);
    }
    if (items.length <= state.limit) return { items, more: nothing };
    return {
      items: items.slice(0, state.limit),
      more: html`<div
        aria-hidden="true"
        data-progressive-sentinel=${slot}
        class="col-span-full h-px"
      ></div>`,
    };
  }

  hostUpdated(): void {
    for (const slot of this.lists.keys()) {
      const element = this.host.renderRoot.querySelector(
        `[data-progressive-sentinel="${slot}"]`,
      );
      const state = this.lists.get(slot)!;
      const current = this.watched.get(slot);
      // Re-observe after every page, even on the same element: the observer
      // only reports changes, and a sentinel still near the screen after a
      // short page has nothing left to change.
      if (current?.element === element && current.limit === state.limit) {
        continue;
      }
      current?.stop();
      this.watched.delete(slot);
      if (element === null) continue;
      const limit = state.limit;
      this.watched.set(slot, {
        element,
        limit,
        stop: observeNear(element, (near) => {
          if (!near || state !== this.lists.get(slot) || state.limit !== limit)
            return;
          state.limit += this.pageSize;
          this.host.requestUpdate();
        }),
      });
    }
  }

  /** Back to the first page for every list, e.g. when the host closes. */
  reset(): void {
    this.lists.clear();
    this.stopWatching();
  }

  hostDisconnected(): void {
    this.stopWatching();
  }

  private stopWatching(): void {
    for (const watched of this.watched.values()) watched.stop();
    this.watched.clear();
  }
}
