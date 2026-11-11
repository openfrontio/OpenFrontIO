import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { OF_ICONS, type OfIcon } from "../../../src/client/components/OfIcon";

const IMAGES_DIR = path.join(__dirname, "../../../resources/images");

async function mount(name: string, size?: number): Promise<OfIcon> {
  const el = document.createElement("of-icon") as OfIcon;
  el.setAttribute("name", name);
  if (size !== undefined) el.size = size;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("of-icon", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("points every icon at a file in resources/images", () => {
    const files = new Set(fs.readdirSync(IMAGES_DIR));
    for (const [name, icon] of Object.entries(OF_ICONS)) {
      expect(files.has(icon.file), `${name}: ${icon.file}`).toBe(true);
    }
  });

  it("paints a single-colour icon from its file, hidden from screen readers", async () => {
    const el = await mount("swap", 20);
    expect(el.children).toHaveLength(1);
    const node = el.firstElementChild as HTMLElement;
    expect(node.getAttribute("aria-hidden")).toBe("true");
    expect(node.style.width).toBe("20px");
    expect(node.style.height).toBe("20px");
    expect(node.getAttribute("style")).toContain("images/SwapIconWhite.svg");
  });

  it("defaults to 16px", async () => {
    const el = await mount("close");
    const node = el.firstElementChild as HTMLElement;
    expect(node.style.width).toBe("16px");
    expect(node.style.height).toBe("16px");
  });

  it("keeps the colours of multi-colour art in an image with no alt text", async () => {
    const el = await mount("gold", 16);
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("");
    expect(img!.getAttribute("src")).toContain("images/GoldCoinIcon.svg");
    expect(img!.getAttribute("width")).toBe("16");
  });

  it("renders nothing for an unknown name", async () => {
    const el = await mount("no-such-icon");
    expect(el.children).toHaveLength(0);
    expect(el.textContent!.trim()).toBe("");
  });

  it("follows a change of name", async () => {
    const el = await mount("plus");
    el.name = "check";
    await el.updateComplete;
    const style = el.firstElementChild!.getAttribute("style");
    expect(style).toContain("images/CheckIconWhite.svg");
    expect(style).not.toContain("images/PlusIconWhite.svg");
  });
});
