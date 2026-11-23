import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
import { defaultPlayerCardView } from "../../src/client/components/card/PlayerCardModel";
import { EndCardSection } from "../../src/client/hud/layers/EndCardSection";

if (!customElements.get("end-card-section")) {
  customElements.define("end-card-section", EndCardSection);
}

const VIEW = defaultPlayerCardView("Volt", "UN");

describe("<end-card-section>", () => {
  let el: EndCardSection;
  afterEach(() => el?.remove());

  async function render(props: Partial<EndCardSection>) {
    el = document.createElement(
      "end-card-section",
    ) as unknown as EndCardSection;
    Object.assign(el, props);
    document.body.appendChild(el as unknown as Node);
    await el.updateComplete;
  }
  const q = (sel: string) => (el as unknown as Element).querySelector(sel);

  it("no mute button: taunts are held back", async () => {
    await render({ mode: "eliminatedBy", view: VIEW });
    expect(q("[data-end-card-mute]")).toBeNull();
    expect(q("player-card")).not.toBeNull();
  });

  it("renders nothing for no card", async () => {
    await render({ mode: "none" });
    expect(q("[data-end-card]")).toBeNull();
  });

  it("eliminated by: label, then the killer's card", async () => {
    await render({ mode: "eliminatedBy", view: VIEW });
    expect(q("[data-end-card-label]")!.textContent).toContain(
      "win_modal.eliminated_by",
    );
    expect(q("player-card")).not.toBeNull();
    expect(q("[data-end-card-nemesis]")).toBeNull();
  });

  it("nemesis line shows its count", async () => {
    await render({ mode: "eliminatedBy", view: VIEW, nemesis: { count: 3 } });
    expect(q("[data-end-card-nemesis]")!.textContent).toContain(
      'win_modal.nemesis:{"n":3}',
    );
  });

  it("winner card under WINNER label", async () => {
    await render({ mode: "winner", view: VIEW });
    expect(q("[data-end-card-label]")!.textContent).toContain(
      "player_card.winner",
    );
    expect(q("player-card")).not.toBeNull();
  });

  it("the end-screen card animates", async () => {
    await render({ mode: "winner", view: VIEW });
    const card = q("player-card") as unknown as { animated: boolean };
    expect(card.animated).toBe(true);
  });

  it("edit my card link only for card owners", async () => {
    await render({ mode: "winner", view: VIEW, canEdit: false });
    expect(q("[data-end-card-edit]")).toBeNull();
    el.canEdit = true;
    await el.updateComplete;
    const link = q("[data-end-card-edit]") as HTMLButtonElement;
    expect(link).not.toBeNull();
    const seen = vi.fn();
    el.addEventListener("edit-card", seen);
    link.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("clan win shows the clan card", async () => {
    await render({
      mode: "clan",
      clan: {
        clanTag: "UN",
        members: [{ username: "Volt", badge: null, alive: true }],
        territoryPct: 61,
      },
    });
    expect(q("clan-win-card")).not.toBeNull();
    expect(q("player-card")).toBeNull();
  });
});
