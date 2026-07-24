import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  splitAccountUsername,
  usernameText,
} from "../../../src/client/components/ui/UsernameText";

function renderToHost(username: string): HTMLElement {
  const host = document.createElement("div");
  render(usernameText(username), host);
  return host;
}

describe("splitAccountUsername", () => {
  it("splits a display username into base and 4-digit discriminator", () => {
    expect(splitAccountUsername("player.1234")).toEqual({
      base: "player",
      discriminator: "1234",
    });
  });

  it("keeps leading zeros in the discriminator", () => {
    expect(splitAccountUsername("player.0042")).toEqual({
      base: "player",
      discriminator: "0042",
    });
  });

  it("leaves a bare (verified) name untouched", () => {
    expect(splitAccountUsername("player")).toEqual({
      base: "player",
      discriminator: null,
    });
  });

  it("does not treat a non-4-digit suffix as a discriminator", () => {
    expect(splitAccountUsername("player.12")).toEqual({
      base: "player.12",
      discriminator: null,
    });
    expect(splitAccountUsername("player.12345")).toEqual({
      base: "player.12345",
      discriminator: null,
    });
    expect(splitAccountUsername("player.abcd")).toEqual({
      base: "player.abcd",
      discriminator: null,
    });
  });
});

// The name renders inside one wrapper span; these are its parts.
function partsOf(host: HTMLElement): HTMLElement[] {
  return [...host.firstElementChild!.children] as HTMLElement[];
}

describe("usernameText", () => {
  it("renders the base in blue and the suffix as a muted #", () => {
    const parts = partsOf(renderToHost("player.1234"));
    expect(parts).toHaveLength(2);
    expect(parts[0].textContent).toBe("player");
    expect(parts[0].className).toContain("text-blue-300");
    expect(parts[1].textContent).toBe("#1234");
    expect(parts[1].className).toContain("text-white/40");
  });

  // A flex parent turns every child \u2014 including a bare separator text node \u2014
  // into its own flex item, so the profile-modal title's gap-2 landed on both
  // sides of the space. One wrapper keeps the name a single item.
  it("renders as a single element so a flex parent can't split it", () => {
    const host = renderToHost("player.1234");
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild!.tagName).toBe("SPAN");
    expect(
      [...host.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE),
    ).toHaveLength(0);
  });

  // The separator must be real text, not padding/margin: a caller's
  // hover:underline is painted per text run, so a box gap splits the
  // underline in two. Non-breaking so the suffix can't wrap away.
  it("separates the suffix with a non-breaking space, not a box gap", () => {
    const host = renderToHost("player.1234");
    const suffix = partsOf(host)[1];
    expect(host.textContent).toBe("player\u00a0#1234");
    expect(suffix.className).not.toContain("pl-");
    expect(suffix.className).not.toContain("ml-");
  });

  it("renders a bare name as the base alone", () => {
    const parts = partsOf(renderToHost("player"));
    expect(parts).toHaveLength(1);
    expect(parts[0].textContent).toBe("player");
  });

  it("honors a caller-supplied base class", () => {
    const host = document.createElement("div");
    render(usernameText("player.1234", "font-bold truncate"), host);
    expect(partsOf(host)[0].className).toBe("font-bold truncate");
  });

  it("lets the base inherit color when given an empty base class", () => {
    const host = document.createElement("div");
    render(usernameText("player.1234", ""), host);
    const parts = partsOf(host);
    expect(parts[0].className).toBe("");
    expect(parts[1].textContent).toBe("#1234");
  });
});
