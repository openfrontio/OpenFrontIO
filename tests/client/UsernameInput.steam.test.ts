import { beforeEach, describe, expect, it, vi } from "vitest";
import { steamSDK } from "../../src/client/SteamSDK";
import { UsernameInput } from "../../src/client/UsernameInput";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("UsernameInput Steam seeding", () => {
  it("seeds and persists the Steam persona when nothing is stored", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "Ada",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe("Ada");
    expect(localStorage.getItem("username")).toBe("Ada"); // usernameKey
  });

  it("keeps an already-stored username", async () => {
    localStorage.setItem("username", "MyName");
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "Ada",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe("MyName");
  });

  it("strips brackets from the Steam persona", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "[Ada]",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe("Ada");
  });

  it("keeps a valid generated name when nothing of the persona survives", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "日本語",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    // Captured synchronously, before the async getUser() seed resolves: this is
    // the generated anon name loadStoredUsername() just produced.
    const generated = el.getUsername();
    await new Promise((r) => setTimeout(r, 0));
    // The unusable persona must be rejected and the exact generated name kept
    // — not merely replaced by some other valid name.
    expect(el.getUsername()).toBe(generated);
    expect(generated.length).toBeGreaterThan(0);
    // Still ours, so a later launch or a Steam rename gets another go.
    expect(localStorage.getItem("usernameIsGenerated")).toBe("true");
  });

  // The old rule ran the persona through validateUsername() and threw the
  // whole thing away on any failure, so most real Steam personas — which
  // carry decoration — produced a guest name. This is the launch bug.
  it.each([
    ["🔥Ada🔥", "Ada"],
    ["José", "José"],
    ["Müller-42", "Müller-42"],
    ["★★ Ada Lovelace ★★", "Ada Lovelace"],
    ["日本語Ada", "Ada"],
    ["Ada Lovelace the Countess of Lovelace", "Ada Lovelace the"],
  ])("seeds %s as %s rather than a guest name", async (persona, expected) => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: persona,
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe(expected);
    expect(localStorage.getItem("username")).toBe(expected);
    // A seeded persona is the player's own identity, not ours to overwrite.
    expect(localStorage.getItem("usernameIsGenerated")).toBe("false");
    expect(el.canPlay()).toBe(true);
  });
});

describe("UsernameInput Steam reseeding", () => {
  function mountWithPersona(name: string): UsernameInput {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({ steamId: "77", name });
    const el = new UsernameInput();
    el.connectedCallback();
    return el;
  }

  // The seed used to be gated on empty localStorage, so one launch that
  // finished before getUser() resolved — or, before the sanitiser change, any
  // launch with a decorated persona — left a generated name that nothing would
  // ever replace.
  it("reseeds over a name we generated", async () => {
    localStorage.setItem("username", "AnonAnchor");
    localStorage.setItem("usernameIsGenerated", "true");

    const el = mountWithPersona("Ada");
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getUsername()).toBe("Ada");
    expect(localStorage.getItem("username")).toBe("Ada");
  });

  // Installs from before the flag existed have no key to read, so the name's
  // own shape is what un-poisons them.
  it("reseeds over a generated name stored before the flag existed", async () => {
    localStorage.setItem("username", "AnonAnchor3");

    const el = mountWithPersona("Ada");
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getUsername()).toBe("Ada");
  });

  it("never reseeds over a name the player typed", async () => {
    localStorage.setItem("username", "MyCoolName");
    localStorage.setItem("usernameIsGenerated", "false");

    const el = mountWithPersona("Ada");
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getUsername()).toBe("MyCoolName");
    expect(localStorage.getItem("username")).toBe("MyCoolName");
  });

  it("never reseeds over a pre-flag name that is not one of ours", async () => {
    localStorage.setItem("username", "MyCoolName");

    const el = mountWithPersona("Ada");
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getUsername()).toBe("MyCoolName");
  });

  // The flag has to follow the name it describes, or the next launch reseeds
  // over something the player chose.
  it("stops reseeding once the player types their own name", async () => {
    const el = mountWithPersona("Ada");
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("usernameIsGenerated")).toBe("false");

    const input = document.createElement("input");
    input.value = "MyCoolName";
    (
      el as unknown as { handleUsernameChange: (e: Event) => void }
    ).handleUsernameChange({ target: input } as unknown as Event);

    expect(localStorage.getItem("username")).toBe("MyCoolName");
    expect(localStorage.getItem("usernameIsGenerated")).toBe("false");
  });

  // The text check alone is not enough: a player can type something else and
  // then type the generated name back before getUser() resolves, leaving the
  // name looking untouched while handleUsernameChange has already marked it
  // theirs. Reseeding over that would overwrite a deliberate choice.
  it("does not reseed over a generated name the player retyped", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    let resolveUser: (u: { steamId: string; name: string }) => void = () => {};
    vi.spyOn(steamSDK, "getUser").mockReturnValue(
      new Promise((r) => {
        resolveUser = r;
      }),
    );

    const el = new UsernameInput();
    el.connectedCallback();
    const generated = el.getUsername();

    // Types something else, then puts the original text back — character for
    // character the same name, but chosen rather than generated.
    const type = (value: string) => {
      const input = document.createElement("input");
      input.value = value;
      (
        el as unknown as { handleUsernameChange: (e: Event) => void }
      ).handleUsernameChange({ target: input } as unknown as Event);
    };
    type("MyCoolName");
    type(generated);

    resolveUser({ steamId: "77", name: "Ada" });
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getUsername()).toBe(generated);
    expect(localStorage.getItem("usernameIsGenerated")).toBe("false");
  });

  it("does not reseed off Steam", async () => {
    localStorage.setItem("username", "AnonAnchor");
    localStorage.setItem("usernameIsGenerated", "true");
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(false);
    const getUser = vi.spyOn(steamSDK, "getUser");

    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));

    expect(getUser).not.toHaveBeenCalled();
    expect(el.getUsername()).toBe("AnonAnchor");
  });
});

describe("UsernameInput clan selection", () => {
  it("clears the selected clan when it matches the rejected tag", () => {
    const el = new UsernameInput();
    Object.assign(el, { baseUsername: "Player", clanTag: "ALLY" });
    localStorage.setItem("username", "Player");
    localStorage.setItem("clanTag", "ALLY");

    el.clearClanTag("ally");

    expect(el.getClanTag()).toBeNull();
    expect(localStorage.getItem("clanTag")).toBe("");
  });

  it("preserves a newer clan selection", () => {
    const el = new UsernameInput();
    Object.assign(el, { baseUsername: "Player", clanTag: "BETA" });

    el.clearClanTag("ALLY");

    expect(el.getClanTag()).toBe("BETA");
  });
});
