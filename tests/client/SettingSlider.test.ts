import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/components/baseComponents/setting/SettingSlider";
import type { SettingSlider } from "../../src/client/components/baseComponents/setting/SettingSlider";

type TestSlider = SettingSlider & { updateComplete: Promise<unknown> };

async function mountSlider(): Promise<TestSlider> {
  const el = document.createElement("setting-slider") as TestSlider;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("setting-slider change events", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The slider renders into light DOM, so the inner <input>'s native
  // `change` (fired on release) used to bubble to the parent's @change
  // listener, which reads `detail.value` and threw on the missing detail.
  it("only lets its own CustomEvent reach a parent @change listener", async () => {
    const el = await mountSlider();
    const seen: Event[] = [];
    el.addEventListener("change", (e) => seen.push(e));

    const input = el.querySelector("input[type=range]") as HTMLInputElement;
    input.value = "42";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(CustomEvent);
    expect((seen[0] as CustomEvent<{ value: number }>).detail.value).toBe(42);
  });
});
