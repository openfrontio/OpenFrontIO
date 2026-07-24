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

describe("usernameText", () => {
  it("renders the base in blue and the suffix as a muted #", () => {
    const host = renderToHost("player.1234");
    const spans = host.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe("player");
    expect(spans[0].className).toContain("text-blue-300");
    expect(spans[1].textContent).toBe("#1234");
    expect(spans[1].className).toContain("text-white/40");
  });

  it("spaces the suffix with a margin rather than a text space", () => {
    const host = renderToHost("player.1234");
    const suffix = host.querySelectorAll("span")[1];
    expect(suffix.className).toContain("ml-1");
    expect(host.textContent).toBe("player#1234");
  });

  it("renders a bare name as the base alone", () => {
    const host = renderToHost("player");
    const spans = host.querySelectorAll("span");
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe("player");
  });

  it("honors a caller-supplied base class", () => {
    const host = document.createElement("div");
    render(usernameText("player.1234", "font-bold truncate"), host);
    const spans = host.querySelectorAll("span");
    expect(spans[0].className).toBe("font-bold truncate");
  });

  it("lets the base inherit color when given an empty base class", () => {
    const host = document.createElement("div");
    render(usernameText("player.1234", ""), host);
    const spans = host.querySelectorAll("span");
    expect(spans[0].className).toBe("");
    expect(spans[1].textContent).toBe("#1234");
  });
});
