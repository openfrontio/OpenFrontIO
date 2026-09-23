import en from "../resources/lang/en.json";
import { CosmeticInfo } from "../src/client/components/CosmeticInfo";

// The generative-AI line in a cosmetic's info bubble, beside the artist credit.
//
// The artist answers the question on their submission; staff carry that answer over when they add
// the cosmetic. Three states reach the client and only one of them shows: a cosmetic nobody was
// asked about (the whole catalogue, before the question existed) must look exactly as it did, and
// "the artist said no" is not something the shop announces either.
//
// With no language loaded, translateText returns the key it was given — so the key itself is what
// these assertions look for, and the English string is checked once, below.
const AI_KEY = "cosmetics.ai_label";

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
    // Beside the credit, not instead of it.
    expect(el.textContent).toContain("jiizk");
  });

  it("says nothing when the artist declared no generative AI", async () => {
    const el = await renderInfo({ artist: "jiizk", aiDisclosed: false });
    expect(el.textContent).not.toContain(AI_KEY);
  });

  it("says nothing when nobody was asked", async () => {
    const el = await renderInfo({ artist: "jiizk" });
    expect(el.textContent).not.toContain(AI_KEY);
  });

  it("does not open a bubble for the flag alone", async () => {
    // aiDisclosed is not one of the fields that makes an otherwise-empty bubble worth rendering:
    // a "?" that opens onto a single AI line and nothing else is noise.
    const el = await renderInfo({ aiDisclosed: true });
    expect(el.textContent?.trim()).toBe("");
  });

  it("has an English string to show", () => {
    expect(en.cosmetics.ai_label).toBeTruthy();
  });
});
