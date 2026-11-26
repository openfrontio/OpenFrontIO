import { afterEach, describe, expect, it, vi } from "vitest";
import { EDIT_CARD_HREF } from "../../src/client/components/card/CardLinks";
import { modalRouter } from "../../src/client/ModalRouter";

// Every way to edit the card lands on the Inventory's Player card tab.

const opened = vi.fn();
class FakeInventory extends HTMLElement {
  open(args?: Record<string, unknown>) {
    opened(args);
  }
  close() {}
}
customElements.define("fake-card-inventory", FakeInventory);

afterEach(() => {
  opened.mockReset();
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

describe("card links", () => {
  it("Edit my card goes to the Inventory's Player card tab", () => {
    expect(EDIT_CARD_HREF).toBe("/#modal=inventory&tab=card");
  });

  it("the old Account → My Card route lands on the Inventory card tab", async () => {
    document.body.appendChild(document.createElement("fake-card-inventory"));
    modalRouter.register("inventory", { tag: "fake-card-inventory" });
    history.replaceState(null, "", "/#modal=account&tab=card");
    expect(modalRouter.routeFromHash()).toBe(true);
    expect(window.location.hash).toBe("#modal=inventory&tab=card");
    await vi.waitFor(() =>
      expect(opened).toHaveBeenCalledWith({ tab: "card" }),
    );
  });

  it("other Account tabs are left alone", () => {
    modalRouter.register("account", { tag: "fake-card-inventory" });
    history.replaceState(null, "", "/#modal=account&tab=stats");
    modalRouter.routeFromHash();
    expect(window.location.hash).toBe("#modal=account&tab=stats");
  });
});
