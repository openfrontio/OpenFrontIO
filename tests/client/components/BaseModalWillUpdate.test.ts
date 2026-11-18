import { html, LitElement, type PropertyValues } from "lit";
import { customElement } from "lit/decorators.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseModal } from "../../../src/client/components/BaseModal";

@customElement("test-will-update-modal")
class TestWillUpdateModal extends BaseModal {
  step = "a";
  seen: unknown[] = [];

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    this.seen.push(changed.get("step"));
  }

  protected renderBody() {
    return html``;
  }
}

describe("BaseModal.willUpdate", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("passes Lit's changed properties on to LitElement", async () => {
    const spy = vi.spyOn(
      LitElement.prototype as unknown as {
        willUpdate(changed: PropertyValues): void;
      },
      "willUpdate",
    );
    const el = document.createElement(
      "test-will-update-modal",
    ) as TestWillUpdateModal;
    document.body.appendChild(el);
    await el.updateComplete;
    el.step = "b";
    el.requestUpdate("step", "a");
    await el.updateComplete;

    expect(el.seen[el.seen.length - 1]).toBe("a");
    // The modal's own calls (its children, like <o-modal>, call it too).
    const own = spy.mock.calls.filter((_, i) => spy.mock.contexts[i] === el);
    const changed = own[own.length - 1]?.[0];
    expect(changed).toBeInstanceOf(Map);
    expect(changed?.get("step")).toBe("a");
  });
});
