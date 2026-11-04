// @vitest-environment jsdom
import en from "../resources/lang/en.json";
import { CosmeticInfo } from "../src/client/components/CosmeticInfo";

// The generative-AI line in a cosmetic's info bubble, beside the artist credit.
//
// The artist answers the question on their submission; staff carry that answer over when they add
// the cosmetic. Three states reach the client, and each says what it is: the artist said yes, the
// artist said no, or nobody asked (the whole catalogue, before the question existed). "Unknown"
// only shows beside an artist credit — under a pack or a subscription it would be noise.
//
// With no language loaded, translateText returns the key it was given — so the key itself is what
// these assertions look for, and the English strings are checked once, below.
const AI_KEY = "cosmetics.ai_label";
const NO_AI_KEY = "cosmetics.ai_none_label";
const UNKNOWN_KEY = "cosmetics.ai_unknown_label";

/** Renders a `<cosmetic-info>` with the given properties and waits for its first update. */
async function renderInfo(
  props: Partial<Pick<CosmeticInfo, "artist" | "aiDisclosed" | "rarity">>,
): Promise<CosmeticInfo> {
  const el = new CosmeticInfo();
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("CosmeticInfo — generative AI", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("says so when the artist declared generative AI", async () => {
    const el = await renderInfo({ artist: "jiizk", aiDisclosed: true });
    expect(el.textContent).toContain(AI_KEY);
    expect(el.textContent).not.toContain(NO_AI_KEY);
    // Beside the credit, not instead of it.
    expect(el.textContent).toContain("jiizk");
  });

  it("says no AI was used when the artist declared none", async () => {
    const el = await renderInfo({ artist: "jiizk", aiDisclosed: false });
    expect(el.textContent).toContain(NO_AI_KEY);
    expect(el.textContent).not.toContain(UNKNOWN_KEY);
  });

  it("says unknown when nobody asked the credited artist", async () => {
    const el = await renderInfo({ artist: "jiizk" });
    expect(el.textContent).toContain(UNKNOWN_KEY);
    expect(el.textContent).not.toContain(NO_AI_KEY);
  });

  it("says nothing about AI when there is no artist and nobody asked", async () => {
    const el = await renderInfo({ rarity: "rare" });
    expect(el.textContent).not.toContain(UNKNOWN_KEY);
    expect(el.textContent).not.toContain(AI_KEY);
  });

  it("does not open a bubble for the flag alone", async () => {
    // aiDisclosed is not one of the fields that makes an otherwise-empty bubble worth rendering:
    // a "?" that opens onto a single AI line and nothing else is noise.
    const el = await renderInfo({ aiDisclosed: true });
    expect(el.textContent?.trim()).toBe("");
  });

  it("has English strings to show", () => {
    expect(en.cosmetics.ai_label).toBeTruthy();
    expect(en.cosmetics.ai_none_label).toBeTruthy();
    expect(en.cosmetics.ai_unknown_label).toBeTruthy();
  });
});
