// Card backgrounds in @openfront/cosmetic-preview: the game's own player card
// (<player-card>, <card-background>, CardFx) and still backdrops, mounted at
// each size the game shows a background, so an artist sees exactly what
// players will. Loaded with the rest of the renderer by preview.ts.

import {
  LayerAnimationSchema,
  type LayerAnimation,
} from "@openfront/shared/CardBackgroundAnimation";
import {
  checkCardBackground,
  type CardBackgroundFiles as SharedFiles,
  type CardIssue as SharedIssue,
} from "@openfront/shared/CardBackgroundChecks";
import { z } from "zod/v4";
import {
  anyCardFxStopped,
  onCardFxSessionStop,
  resetCardFxSession,
} from "../components/card/CardFx";
import "../components/card/PlayerCard";
import type { PlayerCard, PlayerCardSize } from "../components/card/PlayerCard";
import type { PlayerCardView } from "../components/card/PlayerCardModel";
import {
  stillBackdropLayers,
  stillBackdropStyle,
} from "../components/card/StillCardBackdrop";
import "../components/LevelBadge";
import { translateText } from "../Translate";
import { prefersReducedMotion } from "../utilities/ReducedMotion";
import type {
  CardBackgroundFiles,
  CardBackgroundPreviewHandle,
  CardBackgroundPreviewInput,
  CardBackgroundPreviewOptions,
  CardIssue,
  CardPreviewSize,
  CosmeticPreviewModule,
  CosmeticPreviewResult,
} from "./api";

// Compile-time: the published types (api.ts, shipped as index.d.ts) and the
// checks' own types agree. If this stops compiling, they have drifted.
const filesFit = (f: CardBackgroundFiles): SharedFiles => f;
const issueFits = (i: SharedIssue): CardIssue => i;
void filesFit;
void issueFits;

export const CARD_PREVIEW_SIZES = [
  "inventory",
  "large",
  "endScreen",
  "store",
  "lobbyTag",
  "hover",
  "panel",
] as const satisfies readonly CardPreviewSize[];

// How each size is drawn in game, and how wide it is there at most.
interface SizeSpec {
  // A <player-card> of this size, or a still backdrop behind text.
  card: PlayerCardSize | "lobbyTag" | "hover";
  // Whether the game lets it animate.
  animates: boolean;
  // The wrapper's width: the game's at most, narrower on a small screen.
  width: string;
}

const SIZES: Record<CardPreviewSize, SizeSpec> = {
  // InventoryCardTab: <player-card size="account" animated> in the tab.
  inventory: { card: "account", animates: true, width: "max-width:600px" },
  // CardItemPreview: the same in a max-w-4xl modal (896 px less padding).
  large: { card: "account", animates: true, width: "max-width:846px" },
  // EndCardSection: <player-card size="end" animated>, 652 px wide.
  endScreen: { card: "end", animates: true, width: "max-width:652px" },
  // CardStoreGrid: <player-card size="thumb">, 160 × 64, never animated.
  store: { card: "thumb", animates: false, width: "width:160px" },
  // LobbyPlayerView: the .player-tag's own background (StillCardBackdrop).
  lobbyTag: { card: "lobbyTag", animates: false, width: "" },
  // PlayerInfoOverlay: the 500 px summary row's background.
  hover: {
    card: "hover",
    animates: false,
    width: "width:500px;max-width:100%",
  },
  // PlayerPanel: <player-card size="panel"> in a max-w-100 panel, less padding.
  panel: {
    card: "panel",
    animates: false,
    width: "width:368px;max-width:100%",
  },
};

// A sample player, so the dark area under the name is real.
const SAMPLE_BADGE = { level: 42, prestige: 1, legend: false };
const SAMPLE_TRACKERS: PlayerCardView["trackers"] = [
  { stat: "wins", value: 128 },
  { stat: "games_played", value: 412 },
  { stat: "conquests", value: 1934 },
];

// The game's .player-tag (styles.css), which the package doesn't ship.
const PLAYER_TAG_STYLE =
  "display:inline-flex;align-items:center;gap:8px;background:#2a2a2a;" +
  "border:1px solid transparent;color:#fff;padding:8px 12px;margin:4px;" +
  "border-radius:16px;font-size:14px;";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// URLs the preview may load: the artist's own files (blob:, data:image) and
// served ones over https (http only from the host's own dev server).
function loadableUrl(url: string): boolean {
  if (/^blob:/i.test(url)) return true;
  if (/^data:image\/(?:png|webp|jpeg|gif)[;,]/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname))
    );
  } catch {
    return false;
  }
}

type Checked =
  | { ok: true; animation: LayerAnimation | undefined }
  | { ok: false; error: string; animation: undefined };

// The animation to play: the game's own schema decides, then the layer
// URLs must be loadable, then hidden layers are left out.
function checkAnimation(
  animation: unknown,
  hidden: readonly number[],
): Checked {
  if (animation === undefined || animation === null) {
    return { ok: true, animation: undefined };
  }
  const parsed = LayerAnimationSchema.safeParse(animation);
  if (!parsed.success) {
    return {
      ok: false,
      error: z.prettifyError(parsed.error),
      animation: undefined,
    };
  }
  const bad = parsed.data.layers.findIndex((l) => !loadableUrl(l.src));
  if (bad !== -1) {
    return {
      ok: false,
      error: `Layer ${bad + 1}: src must be an https:, blob: or data:image URL.`,
      animation: undefined,
    };
  }
  const layers = parsed.data.layers.filter((_, i) => !hidden.includes(i));
  return {
    ok: true,
    animation: layers.length > 0 ? { kind: "layers", layers } : undefined,
  };
}

// The safe area as a box over the art as drawn (cover, centred), in
// container units: the art is max(100cqw, 700cqh) wide and
// max(100cqh, 100/7 cqw) high, and the box is 1260/2800 × 290/400 of it.
function safeAreaOverlay(inset: string): HTMLElement {
  const frame = document.createElement("div");
  frame.dataset.cardSafeAreaFrame = "";
  frame.setAttribute(
    "style",
    `position:absolute;inset:${inset};overflow:hidden;pointer-events:none;` +
      "container-type:size;border-radius:inherit;",
  );
  const box = document.createElement("div");
  box.dataset.cardSafeArea = "";
  box.setAttribute(
    "style",
    "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "width:calc(max(100cqw, 700cqh) * 0.45);" +
      "height:calc(max(100cqh, 14.2857cqw) * 0.725);" +
      "outline:1px dashed rgba(255,255,255,0.85);" +
      "box-shadow:0 0 0 9999px rgba(0,0,0,0.35);",
  );
  frame.appendChild(box);
  return frame;
}

interface LivePreview {
  // Where it is: on the page, not on it yet (mounted into an element the
  // host inserts later), or gone (was on the page and left it). A host may
  // drop a preview without destroy(); restart forgets one that is gone.
  place(): "on" | "notYet" | "gone";
  remount(): void;
}
const live = new Set<LivePreview>();

/** How many previews restart looks at. For tests. */
export function livePreviewCount(): number {
  return live.size;
}

// Wrappers mark themselves the first time they are on the page.
// connectedCallback runs on every insert, so a host appended and removed
// between two restarts still counts: checking isConnected only when place()
// runs would miss it. The mark is on the element, not in this module: when
// two bundled copies of the package share a page, the wrapper is an instance
// of whichever copy registered the tag first.
const FRAME_TAG = "openfront-card-preview";
class CardPreviewFrame extends HTMLElement {
  connectedCallback(): void {
    this.dataset.everConnected = "";
  }
}
if (customElements.get(FRAME_TAG) === undefined) {
  customElements.define(FRAME_TAG, CardPreviewFrame);
}

function mountCardBackgroundPreview(
  host: HTMLElement,
  background: CardBackgroundPreviewInput,
  options: CardBackgroundPreviewOptions,
): { handle: CardBackgroundPreviewHandle; result: CosmeticPreviewResult } {
  let destroyed = false;
  let mounted = false;
  const wrapper = document.createElement(FRAME_TAG);
  wrapper.dataset.cardPreview = "";
  let current: {
    background: CardBackgroundPreviewInput;
    options: CardBackgroundPreviewOptions;
  } | null = null;
  // The size the wrapper's content was built for.
  let builtFor: CardPreviewSize | null = null;

  const build = (
    bg: CardBackgroundPreviewInput,
    opts: CardBackgroundPreviewOptions,
    animation: LayerAnimation | undefined,
  ): void => {
    const spec = SIZES[opts.size];
    const name = opts.name ?? translateText("card_preview.sample_name");
    const inline = spec.card === "lobbyTag" || spec.card === "thumb";
    wrapper.dataset.cardPreviewSize = opts.size;
    wrapper.setAttribute(
      "style",
      `position:relative;${inline ? "display:inline-block;" : "display:block;width:100%;"}${spec.width}`,
    );

    if (spec.card === "lobbyTag" || spec.card === "hover") {
      wrapper.replaceChildren(backdrop(spec.card, bg.url, name));
      builtFor = opts.size;
    } else {
      let card = wrapper.querySelector<PlayerCard>("player-card");
      if (card === null || builtFor !== opts.size) {
        card = document.createElement("player-card") as PlayerCard;
        card.className = "block w-full";
        wrapper.replaceChildren(card);
        builtFor = opts.size;
      }
      card.size = spec.card;
      card.animated = spec.animates && opts.animated;
      card.view = {
        username: name,
        clanTag: null,
        badge: spec.card === "thumb" ? null : SAMPLE_BADGE,
        background: {
          name: bg.id ?? "preview",
          url: bg.url,
          rarity: bg.rarity ?? "common",
          animation,
        },
        trackers: spec.card === "thumb" ? [] : SAMPLE_TRACKERS,
      };
    }
    wrapper.querySelector("[data-card-safe-area-frame]")?.remove();
    if (opts.safeArea) {
      const inset =
        spec.card === "lobbyTag" ? "4px" : spec.card === "hover" ? "0" : "2px";
      wrapper.appendChild(safeAreaOverlay(inset));
    }
  };

  const update = (
    bg: CardBackgroundPreviewInput,
    opts: CardBackgroundPreviewOptions,
  ): CosmeticPreviewResult => {
    if (destroyed) return { ok: false, error: "This preview was destroyed." };
    // Own keys only: "toString" is in every object.
    if (!Object.prototype.hasOwnProperty.call(SIZES, opts.size)) {
      return { ok: false, error: `Unknown size: ${String(opts.size)}` };
    }
    if (!loadableUrl(bg.url)) {
      return {
        ok: false,
        error: "url must be an https:, blob: or data:image URL.",
      };
    }
    const checked = checkAnimation(bg.animation, opts.hiddenLayers ?? []);
    current = { background: bg, options: opts };
    build(bg, opts, checked.animation);
    if (!mounted) {
      host.replaceChildren(wrapper);
      mounted = true;
      // Only now: a preview whose first size or url was refused has no
      // wrapper in its host, and would stay "notYet" for every restart.
      live.add(preview);
    }
    return checked.ok ? { ok: true } : { ok: false, error: checked.error };
  };

  const preview: LivePreview = {
    // Restart forgets a card once it has been on the page and left it.
    place: () => {
      if (wrapper.isConnected) return "on";
      return wrapper.dataset.everConnected === undefined ? "notYet" : "gone";
    },
    // A card stopped for slow frames stays still until mounted again.
    remount: () => {
      if (destroyed || current === null) return;
      builtFor = null;
      update(current.background, current.options);
    },
  };

  const handle: CardBackgroundPreviewHandle = {
    update,
    destroy: () => {
      destroyed = true;
      live.delete(preview);
      wrapper.remove();
    },
  };
  return { handle, result: update(background, options) };
}

// The still backdrops behind text that isn't a card, styled as the game
// styles them (StillCardBackdrop).
function backdrop(kind: "lobbyTag" | "hover", url: string, name: string) {
  const el = document.createElement(kind === "lobbyTag" ? "span" : "div");
  el.dataset.cardPreviewBackdrop = kind;
  const label = document.createElement("span");
  label.className =
    kind === "lobbyTag"
      ? "text-white"
      : "truncate text-lg font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]";
  label.textContent = name;
  if (kind === "lobbyTag") {
    el.setAttribute("style", PLAYER_TAG_STYLE + stillBackdropStyle(url));
    el.appendChild(label);
  } else {
    el.className = "flex items-center gap-2 p-1.5 bg-cover bg-center";
    el.setAttribute(
      "style",
      `min-height:56px;border-radius:8px;background-image:${stillBackdropLayers(url)};`,
    );
    const badge = document.createElement("level-badge") as HTMLElement & {
      level: number;
      prestige: number;
      legend: boolean;
      size: number;
    };
    Object.assign(badge, { ...SAMPLE_BADGE, size: 32 });
    el.append(badge, label);
  }
  return el;
}

export const cardPreviewModule: Omit<
  CosmeticPreviewModule,
  "mountCosmeticPreview"
> = {
  mountCardBackgroundPreview,
  onCardAnimationStopped: onCardFxSessionStop,
  cardAnimationStopped: anyCardFxStopped,
  restartCardAnimation: () => {
    resetCardFxSession();
    for (const preview of [...live]) {
      const place = preview.place();
      if (place === "on") preview.remount();
      else if (place === "gone") live.delete(preview);
    }
  },
  systemPrefersReducedMotion: () => prefersReducedMotion(),
  checkCardBackground: (files, animation) =>
    checkCardBackground(files, animation),
};
