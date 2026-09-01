import { describe, expect, it } from "vitest";
import {
  accountVerifiedName,
  clampUsername,
  fallbackPlayerName,
  genAnonUsername,
  resolvePlayerName,
  sanitizePersona,
  type PlayerNameInputs,
} from "../../src/client/PlayerName";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import { UsernameSchema } from "../../src/core/Schemas";
import { MAX_USERNAME_LENGTH } from "../../src/core/validations/username";

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

  it("uses the generated name when the persona is unusable", () => {
    expect(resolvePlayerName(inputs({ persona: "x".repeat(100) }))).toEqual({
      name: "AnonBadger",
      source: "generated",
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
  it("strips the bracket decoration Steam personas carry", () => {
    expect(sanitizePersona("[Ada]")).toBe("Ada");
    expect(sanitizePersona("  Ada  ")).toBe("Ada");
  });

  it("returns null for nothing to sanitise", () => {
    expect(sanitizePersona(null)).toBeNull();
    expect(sanitizePersona(undefined)).toBeNull();
    expect(sanitizePersona("")).toBeNull();
    expect(sanitizePersona("   ")).toBeNull();
    expect(sanitizePersona("[]")).toBeNull();
  });

  // Today's rule is reject-wholesale: anything the free-form charset does not
  // already allow falls through to a generated name. These fixtures pin that
  // behaviour so OPE-221 — which replaces it with strip-and-keep and widens
  // the charset to the MSDF atlas range — has to change them deliberately.
  it("rejects personas outside the free-form charset (OPE-221 will keep them)", () => {
    expect(sanitizePersona("José")).toBeNull();
    expect(sanitizePersona("Müller-42")).toBeNull();
    expect(sanitizePersona("🔥Ada🔥")).toBeNull();
    expect(sanitizePersona("日本語")).toBeNull();
    expect(sanitizePersona("Пётр")).toBeNull();
  });

  it("rejects an over-length persona rather than truncating it to a stub", () => {
    expect(sanitizePersona("x".repeat(100))).toBeNull();
  });

  it("rejects residue shorter than the minimum", () => {
    expect(sanitizePersona("[ab]")).toBeNull();
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
