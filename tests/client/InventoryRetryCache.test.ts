import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  userAuth: vi.fn(async () => false),
}));

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getApiBase: vi.fn(() => "/api"),
}));

describe("Inventory catalog retry", () => {
  let modal: InventoryModal | undefined;

  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    vi.unstubAllGlobals();
  });

  it("re-requests the real cosmetics cache after the first catalog response fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ patterns: {}, flags: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    modal.open();

    await vi.waitFor(() =>
      expect(
        modal!.querySelector('[data-inventory-state="error"]'),
      ).toBeTruthy(),
    );

    modal.querySelector<HTMLButtonElement>("[data-inventory-retry]")!.click();

    await vi.waitFor(() =>
      expect(modal!.querySelector("inventory-loadout-bar")).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
