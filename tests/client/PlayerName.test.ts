import { describe, expect, it } from "vitest";
import {
  accountVerifiedName,
  clampUsername,
  fallbackPlayerName,
  genAnonUsername,
  looksGenerated,
  resolvePlayerName,
  sanitizePersona,
  type PlayerNameInputs,
} from "../../src/client/PlayerName";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import { UsernameSchema } from "../../src/core/Schemas";
import {
  MAX_USERNAME_LENGTH,
  validateUsername,
} from "../../src/core/validations/username";

// The resolver takes plain values, so every case below is expressed as a full
// set of inputs rather than by mounting the component.
function inputs(overrides: Partial<PlayerNameInputs> = {}): PlayerNameInputs {
  return {
    verifiedName: null,
    verifiedOptIn: false,
    storedName: null,
    persona: null,
    generatedName: "AnonBadger",
    ...overrides,
  };
}

function player(
  overrides: Partial<{
    username: string | null;
    usernameBase: string | null;
    usernameStatus: string;
  }> = {},
): UserMeResponse {
  return {
    player: {
      username: "RyanTheGreat",
      usernameBase: "RyanTheGreat",
      usernameStatus: "premium",
      ...overrides,
    },
  } as unknown as UserMeResponse;
}

describe("resolvePlayerName precedence", () => {
  // Eligible x opted-in x what else is available. The verified name wins over
  // everything, and nothing else can displace it.
  it("returns the verified name over a stored name", () => {
    expect(
      resolvePlayerName(
        inputs({
          verifiedName: "RyanTheGreat",
          verifiedOptIn: true,
          storedName: "MyCoolName",
          persona: "Ada",
        }),
      ),
    ).toEqual({ name: "RyanTheGreat", source: "verified", verified: true });
  });

  it("returns the verified name when nothing else is available", () => {
    expect(
      resolvePlayerName(
        inputs({ verifiedName: "RyanTheGreat", verifiedOptIn: true }),
      ),
    ).toEqual({ name: "RyanTheGreat", source: "verified", verified: true });
  });

  // Opted out: eligibility alone must never put a player under their account
  // name. Deliberate — an eligible player may want to play anonymously.
  it("falls to the stored name when eligible but opted out", () => {
    expect(
      resolvePlayerName(
        inputs({
          verifiedName: "RyanTheGreat",
          verifiedOptIn: false,
          storedName: "MyCoolName",
        }),
      ),
    ).toEqual({ name: "MyCoolName", source: "stored", verified: false });
  });

  // Opted in but ineligible (signed out, lapsed sub, TEMPORARY#### rename).
  it("falls to the stored name when opted in but ineligible", () => {
    expect(
      resolvePlayerName(
        inputs({
          verifiedName: null,
          verifiedOptIn: true,
          storedName: "MyCoolName",
        }),
      ),
    ).toEqual({ name: "MyCoolName", source: "stored", verified: false });
  });

  it("prefers the stored name over the persona", () => {
    expect(
      resolvePlayerName(inputs({ storedName: "MyCoolName", persona: "Ada" })),
    ).toEqual({ name: "MyCoolName", source: "stored", verified: false });
  });

  it("uses the persona when nothing is stored", () => {
    expect(resolvePlayerName(inputs({ persona: "Ada" }))).toEqual({
      name: "Ada",
      source: "persona",
      verified: false,
    });
  });

  it("uses the generated name when nothing is stored and there is no persona", () => {
    expect(resolvePlayerName(inputs())).toEqual({
      name: "AnonBadger",
      source: "generated",
      verified: false,
    });
  });

  it("uses the generated name when nothing of the persona survives", () => {
    expect(resolvePlayerName(inputs({ persona: "日本語" }))).toEqual({
      name: "AnonBadger",
      source: "generated",
      verified: false,
    });
  });

  it("uses the persona once its decoration is stripped", () => {
    expect(resolvePlayerName(inputs({ persona: "🔥José🔥" }))).toEqual({
      name: "José",
      source: "persona",
      verified: false,
    });
  });

  // A blank or whitespace-only stored name is not a name — it is the player
  // having cleared the field, which the component reports as invalid. The
  // resolver must not hand the join an empty string.
  it("treats a blank stored name as absent", () => {
    expect(resolvePlayerName(inputs({ storedName: "   " })).source).toBe(
      "generated",
    );
    expect(resolvePlayerName(inputs({ storedName: "" })).source).toBe(
      "generated",
    );
  });

  it("trims and clamps a stored name rather than rejecting it", () => {
    const long = "a".repeat(MAX_USERNAME_LENGTH + 7);
    expect(resolvePlayerName(inputs({ storedName: long })).name).toBe(
      "a".repeat(MAX_USERNAME_LENGTH),
    );
    expect(resolvePlayerName(inputs({ storedName: "  Spaced  " })).name).toBe(
      "Spaced",
    );
  });

  // The player typed it; resolution reports it as-is so the component can show
  // its own validation error, rather than silently swapping in another name.
  it("keeps an invalid stored name instead of falling through", () => {
    expect(
      resolvePlayerName(inputs({ storedName: "ab", persona: "Ada" })),
    ).toEqual({ name: "ab", source: "stored", verified: false });
  });
});

describe("resolvePlayerName wire-schema invariant", () => {
  // Every branch the resolver picks for itself must be representable on the
  // wire, or the join socket closes with 1002 and the Play button stays lit.
  // Branch 2 is excluded: that is the player's own live edit buffer, which the
  // component validates and blocks play on.
  it("returns a wire-valid name for the verified, persona and generated branches", () => {
    const cases: PlayerNameInputs[] = [
      inputs({ verifiedName: "Ryan-The-Great", verifiedOptIn: true }),
      inputs({ verifiedName: "Ryan The Great", verifiedOptIn: true }),
      inputs({ verifiedName: "a".repeat(20), verifiedOptIn: true }),
      inputs({ persona: "[Ada]" }),
      inputs({ persona: "Ada Lovelace" }),
      inputs({ persona: "x".repeat(100) }),
      inputs({ persona: "🔥José🔥" }),
      inputs({ persona: "Ada🔥Lovelace the Countess of Lovelace" }),
      inputs({ persona: "日本語" }),
      inputs({ persona: "..." }),
      inputs(),
    ];
    for (const c of cases) {
      const resolved = resolvePlayerName(c);
      expect(
        UsernameSchema.safeParse(resolved.name).success,
        `${resolved.source}: ${resolved.name}`,
      ).toBe(true);
    }
  });

  it("keeps a wire-valid stored name unchanged", () => {
    expect(
      UsernameSchema.safeParse(
        resolvePlayerName(inputs({ storedName: "MyCoolName" })).name,
      ).success,
    ).toBe(true);
  });
});

describe("sanitizePersona", () => {
  it("keeps a persona that is already clean", () => {
    expect(sanitizePersona("Ada")).toBe("Ada");
    expect(sanitizePersona("Ada Lovelace")).toBe("Ada Lovelace");
    expect(sanitizePersona("  Ada  ")).toBe("Ada");
  });

  // The whole point of the change: these all used to be discarded wholesale,
  // dropping the player to a generated AnonWombat3.
  it("keeps accented and Latin Extended-A names the renderer can draw", () => {
    expect(sanitizePersona("José")).toBe("José");
    expect(sanitizePersona("Müller")).toBe("Müller");
    expect(sanitizePersona("Łukasz")).toBe("Łukasz");
    expect(sanitizePersona("Bjørn")).toBe("Bjørn");
  });

  it("keeps hyphens, underscores and periods", () => {
    expect(sanitizePersona("Müller-42")).toBe("Müller-42");
    expect(sanitizePersona("ada_lovelace")).toBe("ada_lovelace");
    expect(sanitizePersona("Ada.L")).toBe("Ada.L");
  });

  it("strips decoration rather than rejecting the whole persona", () => {
    expect(sanitizePersona("🔥Ada🔥")).toBe("Ada");
    expect(sanitizePersona("[Ada]")).toBe("Ada");
    expect(sanitizePersona("★★ Ada ★★")).toBe("Ada");
    expect(sanitizePersona("xX_Ada_Xx")).toBe("xX_Ada_Xx");
  });

  it("keeps the Latin part of a mixed-script persona", () => {
    expect(sanitizePersona("日本語Ada")).toBe("Ada");
    expect(sanitizePersona("Пётр Ada")).toBe("Ada");
  });

  // A dropped codepoint becomes a space, so words either side of a decorative
  // separator stay separate words rather than running together.
  it("keeps word boundaries where the decoration was", () => {
    expect(sanitizePersona("Ada🔥Lovelace")).toBe("Ada Lovelace");
    expect(sanitizePersona("Ada   Lovelace")).toBe("Ada Lovelace");
  });

  it("truncates to the free-form cap instead of rejecting", () => {
    // Previously this returned null and the player got a generated name.
    const long = sanitizePersona("Ada Lovelace the Countess of Lovelace");
    expect(long).toBe("Ada Lovelace the");
    expect(long!.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
    expect(sanitizePersona("x".repeat(100))).toBe("x".repeat(20));
  });

  it("does not leave a trailing space after truncating", () => {
    const name = sanitizePersona("abcdefghijklmnopqrs tuv");
    expect(name).toBe("abcdefghijklmnopqrs");
  });

  it("returns null for nothing to sanitise", () => {
    expect(sanitizePersona(null)).toBeNull();
    expect(sanitizePersona(undefined)).toBeNull();
    expect(sanitizePersona("")).toBeNull();
    expect(sanitizePersona("   ")).toBeNull();
    expect(sanitizePersona("[]")).toBeNull();
  });

  it("returns null when nothing renderable survives", () => {
    expect(sanitizePersona("日本語")).toBeNull();
    expect(sanitizePersona("Пётр")).toBeNull();
    expect(sanitizePersona("🔥🔥🔥")).toBeNull();
    expect(sanitizePersona("ｄａｒｋ")).toBeNull();
  });

  it("returns null for residue shorter than the minimum", () => {
    expect(sanitizePersona("[ab]")).toBeNull();
    expect(sanitizePersona("🔥a🔥")).toBeNull();
  });

  // "..." passes the charset and the length bound but is not a name; a
  // placeholder that reads as one is better than punctuation.
  it("returns null for punctuation with no letters or digits", () => {
    expect(sanitizePersona("...")).toBeNull();
    expect(sanitizePersona("___")).toBeNull();
    expect(sanitizePersona("★★★★")).toBeNull();
    expect(sanitizePersona("- . _ -")).toBeNull();
  });

  it("returns something the form and the wire both accept", () => {
    const personas = [
      "🔥José🔥",
      "Ada🔥Lovelace",
      "[Müller-42]",
      "Ada Lovelace the Countess of Lovelace",
      "x".repeat(100),
      "日本語Ada Lovelace",
      "Łukasz",
    ];
    for (const p of personas) {
      const name = sanitizePersona(p);
      expect(name, p).not.toBeNull();
      // Seeded straight into the field, so it has to survive the form rule...
      expect(validateUsername(name!).isValid, `${p} -> ${name}`).toBe(true);
      // ...and reach the server without closing the socket.
      expect(UsernameSchema.safeParse(name!).success, `${p} -> ${name}`).toBe(
        true,
      );
    }
  });
});

describe("looksGenerated", () => {
  it("recognises what genAnonUsername produces", () => {
    for (let i = 0; i < 200; i++) {
      const name = genAnonUsername();
      expect(looksGenerated(name), name).toBe(true);
    }
  });

  it("does not claim an ordinary name", () => {
    for (const name of [
      "Ada",
      "AnonymousCoward",
      "Anonymous",
      "Anon",
      "AnonBadger42",
      "NotAnonBadger",
      "anonbadger",
      "José",
    ]) {
      expect(looksGenerated(name), name).toBe(false);
    }
  });
});

describe("accountVerifiedName", () => {
  it("returns the bare name for a subscriber who has claimed one", () => {
    expect(accountVerifiedName(player())).toBe("RyanTheGreat");
    expect(accountVerifiedName(player({ usernameStatus: "indefinite" }))).toBe(
      "RyanTheGreat",
    );
  });

  it("returns null when there is no profile", () => {
    expect(accountVerifiedName(null)).toBeNull();
    expect(accountVerifiedName(false)).toBeNull();
  });

  it("returns null for a lapsed or absent subscription", () => {
    expect(
      accountVerifiedName(player({ usernameStatus: "claimed" })),
    ).toBeNull();
    expect(accountVerifiedName(player({ usernameStatus: "none" }))).toBeNull();
  });

  it("returns null when no name has been claimed", () => {
    expect(
      accountVerifiedName(player({ username: null, usernameBase: null })),
    ).toBeNull();
  });

  it("returns null for a TEMPORARY#### server rename", () => {
    expect(
      accountVerifiedName(
        player({ username: "TEMPORARY7823", usernameBase: "TEMPORARY7823" }),
      ),
    ).toBeNull();
  });
});

describe("clampUsername", () => {
  it("trims a name that predates the cap rather than rejecting it", () => {
    expect(clampUsername("a".repeat(MAX_USERNAME_LENGTH + 7))).toBe(
      "a".repeat(MAX_USERNAME_LENGTH),
    );
  });

  it("leaves a name within the cap alone", () => {
    expect(clampUsername("MyCoolName")).toBe("MyCoolName");
  });
});

describe("fallbackPlayerName", () => {
  // The join path's last resort when the component is missing entirely.
  it("is a wire-valid generated name", () => {
    const resolved = fallbackPlayerName();
    expect(resolved.source).toBe("generated");
    expect(resolved.verified).toBe(false);
    expect(UsernameSchema.safeParse(resolved.name).success).toBe(true);
  });
});

describe("genAnonUsername", () => {
  it("produces wire-valid names", () => {
    for (let i = 0; i < 200; i++) {
      const name = genAnonUsername();
      expect(name.startsWith("Anon")).toBe(true);
      expect(UsernameSchema.safeParse(name).success, name).toBe(true);
    }
  });
});
