import { CosmeticPreviewModal } from "../../src/client/components/CosmeticPreviewModal";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";

// The generative-AI line in the preview modal's header, beside the artist credit. It follows the
// same rule as the card's info bubble (tests/CosmeticInfoAiDisclosure.test.ts), so a cosmetic
// can't say one thing on its card and another here.
//
// With no language loaded, translateText returns the key it was given, so the keys are what these
// assertions look for.
const AI_KEY = "cosmetics.ai_label";
const NO_AI_KEY = "cosmetics.ai_none_label";
const UNKNOWN_KEY = "cosmetics.ai_unknown_label";

/** Opens a `<cosmetic-preview-modal>` on a flag with the given credits and returns its header. */
async function renderHeader(credits: {
  artist?: string;
  aiDisclosed?: boolean;
}): Promise<string> {
  const el = new CosmeticPreviewModal();
  document.body.appendChild(el);
  el.resolved = {
    type: "flag",
    cosmetic: {
      name: "sample_flag",
      url: "/flags/gb.svg",
      rarity: "rare",
      product: null,
      ...credits,
    },
    colorPalette: null,
    relationship: "purchasable",
    key: "flag:sample_flag",
  } as ResolvedCosmetic;
  await el.updateComplete;
  const header = el.querySelector("[data-cosmetic-preview-modal] h2")
    ?.parentElement?.parentElement;
  return header?.textContent ?? "";
}

describe("CosmeticPreviewModal — generative AI", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("says so when the artist declared generative AI", async () => {
    const header = await renderHeader({ artist: "jiizk", aiDisclosed: true });
    expect(header).toContain(AI_KEY);
    expect(header).toContain("jiizk");
  });

  it("says no AI was used when the artist declared none", async () => {
    const header = await renderHeader({ artist: "jiizk", aiDisclosed: false });
    expect(header).toContain(NO_AI_KEY);
    expect(header).not.toContain(UNKNOWN_KEY);
  });

  it("says unknown when nobody asked the credited artist", async () => {
    const header = await renderHeader({ artist: "jiizk" });
    expect(header).toContain(UNKNOWN_KEY);
    expect(header).not.toContain(NO_AI_KEY);
  });

  it("says nothing about AI when there is no artist and nobody asked", async () => {
    const header = await renderHeader({});
    expect(header).not.toContain(UNKNOWN_KEY);
    expect(header).not.toContain(AI_KEY);
    expect(header).not.toContain(NO_AI_KEY);
  });
});
