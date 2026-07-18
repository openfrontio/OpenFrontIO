import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { FriendsListResponse } from "../../core/ApiSchemas";
import { fetchFriends } from "../FriendsApi";
import { translateText } from "../Utils";
import { BaseModal, ModalConfig } from "./BaseModal";

const FRIENDS_PAGE_SIZE = 50;

/** Modal list of the player's friends; resolves a pick via `onSelect`. */
@customElement("gift-friend-picker")
export class GiftFriendPicker extends BaseModal {
  @state() private friends: FriendsListResponse["results"] = [];
  @state() private loading = false;
  @state() private loadError = false;

  private loadGeneration = 0;

  public onSelect: (publicId: string) => void = () => {};

  protected modalConfig(): ModalConfig {
    return {
      title: translateText("store.gift_pick_friend"),
      hideHeader: false,
      hideCloseButton: false,
    };
  }

  public async open(args?: Record<string, unknown>): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.loadError = false;
    this.friends = [];

    // A newly-created picker is opened immediately after appendChild(). Wait
    // for BaseModal's o-modal shell before attempting to open it.
    await this.updateComplete;
    if (generation !== this.loadGeneration) return;
    super.open(args);

    const friends: FriendsListResponse["results"] = [];
    let page = 1;
    try {
      while (true) {
        const response = await fetchFriends(page, FRIENDS_PAGE_SIZE);
        if (generation !== this.loadGeneration || !this.isOpen()) return;
        if (response === false) {
          this.loadError = true;
          return;
        }

        friends.push(...response.results);
        if (
          friends.length >= response.total ||
          response.results.length < FRIENDS_PAGE_SIZE
        ) {
          this.friends = friends;
          return;
        }
        page += 1;
      }
    } finally {
      if (generation === this.loadGeneration) this.loading = false;
    }
  }

  public close(args?: Record<string, unknown>): void {
    this.loadGeneration += 1;
    super.close(args);
  }

  protected renderBody(): TemplateResult {
    if (this.loading) {
      return html`<div class="p-4 text-center text-white/60">…</div>`;
    }
    if (this.loadError) {
      return html`<div class="p-4 text-center text-white/60">
        ${translateText("store.gift_load_error")}
      </div>`;
    }
    if (this.friends.length === 0) {
      return html`<div class="p-4 text-center text-white/60">
        ${translateText("store.gift_no_friends")}
      </div>`;
    }
    return html`${this.friends.map(
      (friend) => html`
        <div
          data-friend-public-id=${friend.publicId}
          class="flex items-center justify-between gap-2 p-2 border-b border-white/10"
        >
          <span class="truncate">${friend.publicId}</span>
          <button
            type="button"
            aria-label=${translateText("store.gift_to_friend", {
              friend: friend.publicId,
            })}
            class="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-sm"
            @click=${() => {
              const onSelect = this.onSelect;
              this.close();
              onSelect(friend.publicId);
            }}
          >
            🎁 ${translateText("store.gift")}
          </button>
        </div>
      `,
    )}`;
  }
}
