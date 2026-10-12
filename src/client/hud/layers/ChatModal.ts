import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { GameView, PlayerView } from "../../view";

import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import quickChatData from "resources/QuickChat.json";
import { CloseViewEvent, ShowChatMenuEvent } from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import { SendQuickChatEvent } from "../../Transport";
import { hasOwnTranslation, translateText } from "../../Utils";

export type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
};

export type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

export const quickChatPhrases: QuickChatPhrases = quickChatData;

/** Opens quick chat aimed at a specific player. */
export class ShowPlayerChatEvent implements GameEvent {
  constructor(public readonly player: PlayerView) {}
}

// Where a phrase names a player; shown as a blank until one is picked.
const PLAYER_PLACEHOLDER = "[P1]";

// The phrases the chat panel shows unless "All phrases" is on.
const CORE_PHRASES = new Set([
  "help.troops",
  "help.gold",
  "help.alliance",
  "help.no_attack",
  "help.sorry_attack",
  "help.help_defend",
  "attack.attack",
  "attack.mirv",
  "attack.crown",
  "defend.defend",
  "defend.dont_attack",
  "greet.hello",
  "greet.good_luck",
  "greet.gg",
  "greet.thanks",
  "greet.oops",
  "misc.go",
  "misc.team_up",
  "warnings.betrayed",
  "warnings.mirv_ready",
]);

// Phrases the panel shows under another category than their key's. Display
// only: a phrase's key (its category included) goes over the wire and names
// its translations, so moving it for real would change both.
const SHOWN_UNDER: Record<string, string> = {
  "greet.oops": "misc",
  "misc.team_up": "attack",
};

const allPhrases = Object.entries(quickChatPhrases).flatMap(
  ([category, phrases]) => phrases.map((phrase) => ({ category, phrase })),
);

const fullKey = (category: string, phrase: QuickChatPhrase) =>
  `${category}.${phrase.key}`;

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @state() public isOpen = false;
  /** A picked phrase that names a player, waiting for that player. */
  @state() private pending: {
    category: string;
    phrase: QuickChatPhrase;
  } | null = null;
  @state() private search = "";
  /** Kept across opens: a player who wants every phrase keeps seeing them. */
  @state() private showAll = false;

  createRenderRoot() {
    return this;
  }

  private recipient: PlayerView;
  private sender: PlayerView;
  public eventBus: EventBus;

  public g: GameView;
  public transformHandler: TransformHandler;

  public categories = [
    { id: "help" },
    { id: "attack" },
    { id: "defend" },
    { id: "greet" },
    { id: "misc" },
    { id: "warnings" },
  ];

  render() {
    if (!this.isOpen) {
      return null;
    }
    return html`
      <div
        class="fixed inset-0 bg-black/15 flex items-start sm:items-center justify-center z-10002 pt-4 sm:pt-0"
        @click=${(e: MouseEvent) =>
          e.target === e.currentTarget && this.close()}
      >
        <div class="relative">
          <button
            class="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center
                    bg-zinc-700 hover:bg-red-500 text-white rounded-full shadow-sm transition-colors z-10004"
            aria-label=${translateText("common.close")}
            @click=${() => this.close()}
          >
            ✕
          </button>
          <div
            class="bg-zinc-900/95 p-3 rounded-xl shadow-2xl shadow-black/50 ring-1 ring-white/10 text-white
                   w-[min(44rem,calc(100vw-32px))] max-h-[calc(100vh-60px)] overflow-y-auto
                   flex flex-col gap-3"
            @contextmenu=${(e: MouseEvent) => e.preventDefault()}
            @wheel=${(e: WheelEvent) => e.stopPropagation()}
          >
            <div class="flex items-baseline gap-2 pe-4">
              <h2 class="font-semibold">${translateText("chat.title")}</h2>
              <span class="truncate text-sm text-zinc-400"
                >${this.recipient?.displayName()}</span
              >
              ${this.pending ? null : this.renderAllPhrasesSwitch()}
            </div>
            ${this.pending ? this.renderPlayerPicker() : this.renderSections()}
          </div>
        </div>
      </div>
    `;
  }

  private renderAllPhrasesSwitch() {
    return html`
      <button
        class="ms-auto shrink-0 flex items-center gap-2 text-sm text-zinc-300 hover:text-white cursor-pointer"
        role="switch"
        aria-checked=${this.showAll}
        @click=${() => (this.showAll = !this.showAll)}
      >
        ${translateText("chat.all_phrases")}
        <span
          class="relative inline-block w-8 h-4.5 rounded-full transition-colors ${this
            .showAll
            ? "bg-blue-500"
            : "bg-zinc-600"}"
        >
          <span
            class="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white transition-transform ${this
              .showAll
              ? "translate-x-3.5"
              : ""}"
          ></span>
        </span>
      </button>
    `;
  }

  /** One section per category: its core phrases, or all of them. */
  private renderSections() {
    return this.categories.map(({ id }) => {
      const phrases = allPhrases
        .filter(({ category, phrase }) => {
          const key = fullKey(category, phrase);
          return (
            (SHOWN_UNDER[key] ?? category) === id &&
            (this.showAll || CORE_PHRASES.has(key))
          );
        })
        // Core phrases first, so they keep their place when "All phrases"
        // is on; within each, phrases moved in from another category last.
        .sort(
          (a, b) =>
            Number(!CORE_PHRASES.has(fullKey(a.category, a.phrase))) -
              Number(!CORE_PHRASES.has(fullKey(b.category, b.phrase))) ||
            Number(a.category !== id) - Number(b.category !== id),
        );
      if (phrases.length === 0) return null;
      return html`
        <section>
          <h3
            class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
          >
            ${translateText(`chat.cat.${id}`)}
          </h3>
          <div class="flex flex-wrap gap-1">
            ${phrases.map(({ category, phrase }) => {
              const full = translateText(`chat.${category}.${phrase.key}`);
              return html`
                <button
                  class="max-w-[15rem] truncate px-2.5 py-1 rounded-md text-sm text-left
                         bg-white/5 hover:bg-white/15 active:bg-white/25 transition-colors cursor-pointer"
                  title=${full.replace(PLAYER_PLACEHOLDER, "___")}
                  @click=${() => this.pickPhrase(category, phrase)}
                >
                  ${this.renderWithBlank(
                    this.chipLabel(category, phrase.key, full),
                  )}
                </button>
              `;
            })}
          </div>
        </section>
      `;
    });
  }

  // Long phrases have a short label for their chip; the rest show in full.
  // A language without its own short label shows the full phrase, which is
  // translated, rather than the English short label.
  private chipLabel(category: string, key: string, full: string): string {
    const shortKey = `chat.short.${category}.${key}`;
    return hasOwnTranslation(shortKey) ? translateText(shortKey) : full;
  }

  private renderWithBlank(text: string) {
    const [before, ...after] = text.split(PLAYER_PLACEHOLDER);
    if (after.length === 0) {
      return text;
    }
    return html`${before}<span
        class="inline-block w-6 mx-0.5 border-b border-zinc-400 align-baseline"
      ></span
      >${after.join(PLAYER_PLACEHOLDER)}`;
  }

  private renderPlayerPicker() {
    const { category, phrase } = this.pending!;
    const players = this.targetChoices();
    return html`
      <div class="flex items-center gap-2">
        <button
          class="px-2 py-1 rounded-md bg-white/5 hover:bg-white/15 cursor-pointer"
          aria-label=${translateText("common.back")}
          @click=${() => (this.pending = null)}
        >
          ←
        </button>
        <span class="font-medium">
          ${this.renderWithBlank(
            translateText(`chat.${category}.${phrase.key}`),
          )}
        </span>
      </div>
      <input
        class="px-2 py-1.5 rounded-md bg-zinc-800 ring-1 ring-white/10 text-sm outline-none focus:ring-white/30"
        type="text"
        placeholder=${translateText("chat.search")}
        .value=${this.search}
        @input=${(e: Event) =>
          (this.search = (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          // Enter that confirms an IME composition isn't a pick.
          if (e.key === "Enter" && !e.isComposing && players.length > 0) {
            this.sendPending(players[0]);
          }
        }}
      />
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
        ${players.map(
          (player) => html`
            <button
              class="truncate px-2.5 py-1.5 rounded-md text-sm text-left border-l-4
                     bg-white/5 hover:bg-white/15 active:bg-white/25 transition-colors cursor-pointer"
              style="border-left-color: ${player.territoryColor().toHex()}"
              @click=${() => this.sendPending(player)}
            >
              ${player.displayName()}
            </button>
          `,
        )}
      </div>
    `;
  }

  // Players already fighting me or the recipient are the likely subject of
  // the message, so they come first; then the biggest.
  private targetChoices(): PlayerView[] {
    const fighting = new Set<number>();
    for (const p of [this.sender, this.recipient]) {
      for (const a of [...p.incomingAttacks(), ...p.outgoingAttacks()]) {
        fighting.add(a.attackerID);
        fighting.add(a.targetID);
      }
    }
    fighting.delete(this.sender.smallID());
    fighting.delete(this.recipient.smallID());

    const query = this.search.trim().toLowerCase();
    return this.g
      .players()
      .filter(
        (p) =>
          p.isAlive() &&
          p.type() !== PlayerType.Bot &&
          p.displayName().toLowerCase().includes(query),
      )
      .sort(
        (a, b) =>
          Number(fighting.has(b.smallID())) -
            Number(fighting.has(a.smallID())) ||
          b.numTilesOwned() - a.numTilesOwned(),
      );
  }

  protected updated() {
    // Ready to type a name as soon as the picker shows.
    if (this.pending) {
      const input = this.querySelector("input");
      if (input && document.activeElement !== input) input.focus();
    }
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, () => {
      if (this.isOpen) {
        this.close();
      }
    });
    // The quick chat key: closes the modal if it's open, otherwise opens it
    // for the player under the cursor.
    eventBus.on(ShowChatMenuEvent, (e) => {
      if (this.isOpen) {
        this.close();
        return;
      }
      const myPlayer = this.g.myPlayer();
      if (!myPlayer?.isAlive()) return;
      const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
      if (!this.g.isValidCoord(cell.x, cell.y)) return;
      const owner = this.g.owner(this.g.ref(cell.x, cell.y));
      if (!owner.isPlayer() || owner === myPlayer) return;
      this.open(myPlayer, owner as PlayerView);
    });
    eventBus.on(ShowPlayerChatEvent, (e) => {
      const myPlayer = this.g.myPlayer();
      if (myPlayer?.isAlive()) this.open(myPlayer, e.player);
    });
  }

  // A phrase without a player sends right away; one that names a player
  // asks for the player first.
  private pickPhrase(category: string, phrase: QuickChatPhrase) {
    if (phrase.requiresPlayer) {
      this.search = "";
      this.pending = { category, phrase };
      return;
    }
    this.send(`${category}.${phrase.key}`);
  }

  private sendPending(target: PlayerView) {
    const { category, phrase } = this.pending!;
    this.send(`${category}.${phrase.key}`, target);
  }

  private send(quickChatKey: string, target?: PlayerView) {
    if (this.sender && this.recipient) {
      this.eventBus.emit(
        new SendQuickChatEvent(this.recipient, quickChatKey, target?.id()),
      );
    }
    this.close();
  }

  public open(sender?: PlayerView, recipient?: PlayerView) {
    if (sender && recipient) {
      this.recipient = recipient;
      this.sender = sender;
    }
    this.pending = null;
    this.search = "";
    this.isOpen = true;
  }

  public close() {
    this.isOpen = false;
    this.pending = null;
    this.search = "";
  }

  public setRecipient(value: PlayerView) {
    this.recipient = value;
  }

  public setSender(value: PlayerView) {
    this.sender = value;
  }

  /** Opens straight to the player picker for a phrase (radial menu). */
  public openWithSelection(
    categoryId: string,
    phraseKey: string,
    sender?: PlayerView,
    recipient?: PlayerView,
  ) {
    this.open(sender, recipient);
    const phrase = quickChatPhrases[categoryId]?.find(
      (p) => p.key === phraseKey,
    );
    if (phrase) {
      this.pickPhrase(categoryId, phrase);
    }
  }
}
