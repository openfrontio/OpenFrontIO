import { beforeEach, describe, expect, it, vi } from "vitest";
import { gamePortal, type GamePortalName } from "../../src/client/GamePortal";
import { UsernameInput } from "../../src/client/UsernameInput";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function mountOnPortal(
  name: GamePortalName,
  accountName: string | null | Promise<string | null>,
): UsernameInput {
  vi.spyOn(gamePortal, "isOnGamePortal").mockReturnValue(true);
  vi.spyOn(gamePortal, "name").mockReturnValue(name);
  vi.spyOn(gamePortal, "getUsername").mockReturnValue(
    Promise.resolve(accountName),
  );
  vi.spyOn(gamePortal, "addAuthListener").mockResolvedValue();
  const el = new UsernameInput();
  el.connectedCallback();
  return el;
}

function type(el: UsernameInput, value: string) {
  const input = document.createElement("input");
  input.value = value;
  (
    el as unknown as { handleUsernameChange(e: Event): void }
  ).handleUsernameChange({ target: input } as unknown as Event);
}

describe("UsernameInput on VIVERSE", () => {
  it("starts from the VIVERSE name when nothing is stored", async () => {
    const el = mountOnPortal("viverse", "Ada");
    await flush();
    expect(el.getUsername()).toBe("Ada");
    expect(localStorage.getItem("username")).toBe("Ada");
    // Ours, not the player's: another account here gets its own name.
    expect(localStorage.getItem("usernameIsGenerated")).toBe("true");
  });

  // The bug: every page load started from a guest name and then applied the
  // account name, so a name the player typed was gone by the next session.
  it("keeps a name the player typed across page loads", async () => {
    const first = mountOnPortal("viverse", "Ada");
    await flush();
    type(first, "Countess");
    expect(localStorage.getItem("username")).toBe("Countess");

    vi.restoreAllMocks();
    const next = mountOnPortal("viverse", "Ada");
    await flush();
    expect(next.getUsername()).toBe("Countess");
  });

  it("doesn't overwrite a name typed while the VIVERSE name loads", async () => {
    let resolve!: (name: string) => void;
    const el = mountOnPortal("viverse", new Promise((r) => (resolve = r)));
    type(el, "Countess");
    resolve("Ada");
    await flush();
    expect(el.getUsername()).toBe("Countess");
  });

  it("gives another VIVERSE account its own name", async () => {
    mountOnPortal("viverse", "Ada");
    await flush();

    vi.restoreAllMocks();
    const next = mountOnPortal("viverse", "Grace");
    await flush();
    expect(next.getUsername()).toBe("Grace");
  });

  it("doesn't pass an account's name to a player without one", async () => {
    mountOnPortal("viverse", "Ada");
    await flush();

    vi.restoreAllMocks();
    const next = mountOnPortal("viverse", null);
    await flush();
    expect(next.getUsername()).toMatch(/^Anon/);
    expect(localStorage.getItem("username")).toBe(next.getUsername());
  });

  it("doesn't join under an earlier account's name before this one's arrives", async () => {
    mountOnPortal("viverse", "Ada");
    await flush();

    vi.restoreAllMocks();
    let resolve!: (name: string) => void;
    const next = mountOnPortal("viverse", new Promise((r) => (resolve = r)));
    const seeded = next.whenSeeded().then(() => next.getUsername());
    resolve("Grace");
    expect(await seeded).toBe("Grace");
  });

  it("keeps a typed name when the VIVERSE name is unavailable", async () => {
    type(mountOnPortal("viverse", null), "Countess");

    vi.restoreAllMocks();
    const next = mountOnPortal("viverse", null);
    await flush();
    expect(next.getUsername()).toBe("Countess");
  });
});

describe("UsernameInput on Poki", () => {
  it("still applies the account name without storing it", async () => {
    localStorage.setItem("username", "Countess");
    const el = mountOnPortal("poki", "Ada");
    await flush();
    expect(el.getUsername()).toBe("Ada");
    expect(localStorage.getItem("username")).toBe("Countess");
  });
});
