import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../resources/lang/en.json";
import {
  WebGLGate,
  type WebGLGateStatus,
} from "../../../src/client/components/WebGLGate";

describe("webgl-gate", () => {
  let gate: WebGLGate | undefined;

  afterEach(() => {
    gate?.remove();
    window.openfrontDesktop = undefined;
  });

  async function mount(status: WebGLGateStatus): Promise<WebGLGate> {
    gate = new WebGLGate();
    gate.status = status;
    document.body.appendChild(gate);
    await gate.updateComplete;
    return gate;
  }

  it("shows browser instructions on the web", async () => {
    await mount("unsupported");

    expect(gate!.textContent).toContain("Google Chrome");
    expect(gate!.textContent).not.toContain("desktop_webgl_gate");
  });

  it.each<WebGLGateStatus>(["unsupported", "software"])(
    "shows Steam instructions instead of browser ones in the desktop shell (%s)",
    async (status) => {
      window.openfrontDesktop = {};
      await mount(status);

      expect(gate!.textContent).toContain(
        "desktop_webgl_gate.step_restart_steam",
      );
      expect(gate!.textContent).not.toContain("chrome://flags");
      expect(gate!.textContent).not.toContain("Safari");
    },
  );

  it("quits through the shell from the desktop gate", async () => {
    const quit = vi.fn(() => Promise.resolve());
    window.openfrontDesktop = { quit };
    await mount("unsupported");

    const button = gate!.querySelector("button");
    expect(button?.textContent?.trim()).toBe("desktop_webgl_gate.quit");
    button!.click();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("has an en.json entry for every string on the desktop gate", async () => {
    window.openfrontDesktop = { quit: () => Promise.resolve() };
    await mount("unsupported");

    const keys = [...gate!.querySelectorAll("h2, p, li, button")].map((el) =>
      el.textContent!.trim(),
    );
    expect(keys).toHaveLength(7);
    for (const key of keys) {
      const leaf = key.slice("desktop_webgl_gate.".length);
      expect(en.desktop_webgl_gate).toHaveProperty(leaf);
    }
  });

  it("omits the quit button on a shell without quit()", async () => {
    window.openfrontDesktop = {};
    await mount("unsupported");

    expect(gate!.querySelector("button")).toBeNull();
  });

  it("keeps the fingerprinting warning in the desktop shell", async () => {
    window.openfrontDesktop = {};
    await mount("limited");

    expect(gate!.textContent).toContain("Your browser is limiting WebGL");
  });
});
