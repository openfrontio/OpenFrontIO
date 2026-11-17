import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../src/client/utilities/ReducedMotion", () => ({
  prefersReducedMotion: () => motion.reduced,
}));

import { PlayerCard } from "../../src/client/components/card/PlayerCard";
import {
  defaultPlayerCardView,
  type PlayerCardView,
} from "../../src/client/components/card/PlayerCardModel";

if (!customElements.get("player-card")) {
  customElements.define("player-card", PlayerCard);
}

const withTaunt = (
  name: string,
  tauntKind: "icon" | "card",
): PlayerCardView => ({
  ...defaultPlayerCardView("Volt", "UN"),
  taunt: { name, tauntKind, preset: name },
});

describe("<player-card> taunts", () => {
  let card: PlayerCard;
  beforeEach(() => {
    motion.reduced = false;
  });
  afterEach(() => card?.remove());

  async function render(view: PlayerCardView, props: Partial<PlayerCard>) {
    card = document.createElement("player-card") as PlayerCard;
    card.view = view;
    Object.assign(card, props);
    document.body.appendChild(card);
    await card.updateComplete;
  }
  const icon = () => card.querySelector("[data-card-taunt-icon]");
  const overlay = () => card.querySelector("[data-card-taunt-overlay]");

  it("an icon taunt plays once per showKey", async () => {
    await render(withTaunt("salute", "icon"), { showKey: "g1:end" });
    expect(icon()!.classList.contains("taunt-salute")).toBe(true);
    icon()!.dispatchEvent(new Event("animationend", { bubbles: true }));
    await card.updateComplete;
    expect(icon()!.classList.contains("taunt-salute")).toBe(false);
    // Rendered again for the same showing: no replay.
    card.requestUpdate();
    await card.updateComplete;
    expect(icon()!.classList.contains("taunt-salute")).toBe(false);
    // A new showing plays it again.
    card.showKey = "g2:end";
    await card.updateComplete;
    expect(icon()!.classList.contains("taunt-salute")).toBe(true);
  });

  it("emits card-taunt-played when it starts", async () => {
    const seen = vi.fn();
    document.addEventListener("card-taunt-played", seen);
    await render(withTaunt("salute", "icon"), { showKey: "g1:end" });
    document.removeEventListener("card-taunt-played", seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("no showKey: the icon rests", async () => {
    await render(withTaunt("salute", "icon"), {});
    expect(icon()).not.toBeNull();
    expect(icon()!.classList.contains("taunt-salute")).toBe(false);
  });

  it("card-kind taunt adds strip class then removes it on animationend", async () => {
    await render(withTaunt("nuke_flash", "card"), { showKey: "g1:end" });
    expect(overlay()!.classList.contains("taunt-nuke_flash")).toBe(true);
    overlay()!.dispatchEvent(new Event("animationend", { bubbles: true }));
    await card.updateComplete;
    expect(overlay()).toBeNull();
  });

  it("mute stops both kinds", async () => {
    await render(withTaunt("salute", "icon"), {
      showKey: "g1:end",
      tauntsMuted: true,
    });
    expect(icon()).toBeNull();
    card.remove();
    await render(withTaunt("nuke_flash", "card"), {
      showKey: "g1:end",
      tauntsMuted: true,
    });
    expect(overlay()).toBeNull();
  });

  it("reduced motion shows resting icon and no card animation", async () => {
    motion.reduced = true;
    await render(withTaunt("salute", "icon"), { showKey: "g1:end" });
    expect(icon()).not.toBeNull();
    expect(icon()!.classList.contains("taunt-salute")).toBe(false);
    card.remove();
    await render(withTaunt("nuke_flash", "card"), { showKey: "g1:end" });
    expect(overlay()).toBeNull();
  });

  it("an unknown preset shows nothing", async () => {
    await render(withTaunt("not_a_preset", "icon"), { showKey: "g1:end" });
    expect(icon()).toBeNull();
  });
});
