import { allowPageAssetUrls } from "@openfront/shared/AssetPaths";
import { afterAll, beforeAll, expect, test } from "vitest";

// Two bundled copies of the package on one page share the custom-element
// tag: whichever loads first registers it, and the other's wrappers are
// instances of the first copy's class. Restart must still see that a
// wrapper was on the page, so the mark lives on the element itself.
beforeAll(() => allowPageAssetUrls());
afterAll(() => allowPageAssetUrls(false));

test("restart forgets a dropped preview when another copy registered the tag", async () => {
  class OtherCopyFrame extends HTMLElement {
    connectedCallback(): void {
      this.dataset.everConnected = "";
    }
  }
  customElements.define("openfront-card-preview", OtherCopyFrame);
  const { cardPreviewModule } =
    await import("../../src/client/cosmetic-preview/card");
  const { mountCardBackgroundPreview, restartCardAnimation } =
    cardPreviewModule;
  const BLOB =
    "blob:https://dashboard.example/0b7c4d1e-1111-4222-8333-944455556666";

  const brief = document.createElement("div");
  mountCardBackgroundPreview(
    brief,
    { url: BLOB },
    { size: "large", animated: true },
  );
  expect(brief.firstElementChild).toBeInstanceOf(OtherCopyFrame);
  const before = brief.querySelector("player-card");
  document.body.append(brief);
  brief.remove();
  restartCardAnimation();
  // Forgotten: put back, it is not remounted.
  document.body.append(brief);
  restartCardAnimation();
  expect(brief.querySelector("player-card")).toBe(before);
});
