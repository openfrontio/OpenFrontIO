import { describe, expect, it } from "vitest";
import {
  accountVerifiedName,
  clampUsername,
  fallbackPlayerName,
  genAnonUsername,
  looksGenerated,
  resolvePlayerName,
  sanitizePersona,
  verifiedClaimGrace,
  verifiedNameOptIn,
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
  it("keeps the accented Latin-1 names the renderer can draw", () => {
    expect(sanitizePersona("José")).toBe("José");
    expect(sanitizePersona("Müller")).toBe("Müller");
    expect(sanitizePersona("Bjørn")).toBe("Bjørn");
    expect(sanitizePersona("Iñigo")).toBe("Iñigo");
  });

  // Above U+00FF the string path truncates mod 256 and the atlas has no real
  // glyph, so Ł would draw as "A". Stripped like any other unrenderable
  // codepoint rather than kept.
  it("strips Latin Extended-A, which the renderer cannot draw", () => {
    expect(sanitizePersona("Łukasz")).toBe("ukasz");
    expect(sanitizePersona("Łódź")).toBeNull();
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

  // Regression: when the cut lands one past a space, trim() alone already
  // produced a clean word-boundary cut. Looking for an *earlier* boundary on
  // top of that threw away a whole word that had fitted — "Ada Lovelacetheguru"
  // collapsed to "Ada".
  it("keeps a word that fits when the cut lands on a boundary", () => {
    expect(sanitizePersona("Ada Lovelacetheguru xyz")).toBe(
      "Ada Lovelacetheguru",
    );
    // The same shape with the space exactly at the cut index.
    expect(sanitizePersona("Ada Lovelacethegurus xyz")).toBe(
      "Ada Lovelacethegurus",
    );
  });

  // A partial word at the cut is still dropped — that is the case the word
  // boundary exists for.
  it("drops a word the cut lands inside", () => {
    expect(sanitizePersona("Ada Lovelacetheguruxyz")).toBe("Ada");
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

describe("verifiedClaimGrace", () => {
  const NOW = new Date("2026-09-01T00:00:00.000Z");
  const SOON = "2026-10-01T00:00:00.000Z";

  function lapsed(overrides: Record<string, unknown> = {}): UserMeResponse {
    return {
      player: {
        username: "RyanTheGreat",
        usernameBase: "RyanTheGreat",
        usernameStatus: "claimed",
        usernameClaimExpiresAt: SOON,
        ...overrides,
      },
    } as unknown as UserMeResponse;
  }

  it("reports the reserved name and the date it stops being reserved", () => {
    expect(verifiedClaimGrace(lapsed(), NOW)).toEqual({
      name: "RyanTheGreat",
      expiresAt: new Date(SOON),
      atRisk: false,
    });
  });

  it("says nothing while the subscription is still active", () => {
    // Nothing at stake: premium and indefinite holders keep the claim.
    expect(
      verifiedClaimGrace(lapsed({ usernameStatus: "premium" }), NOW),
    ).toBeNull();
    expect(
      verifiedClaimGrace(lapsed({ usernameStatus: "indefinite" }), NOW),
    ).toBeNull();
    expect(
      verifiedClaimGrace(lapsed({ usernameStatus: "unclaimed" }), NOW),
    ).toBeNull();
  });

  it("says nothing when there is no profile", () => {
    expect(verifiedClaimGrace(null, NOW)).toBeNull();
    expect(verifiedClaimGrace(false, NOW)).toBeNull();
  });

  // No date, nothing to say. This is the state a player is in when nothing
  // has set usernameClaimExpiresAt — not a hypothetical: it is every lapsed
  // player whose deadline predates infra#594.
  it("says nothing without a deadline", () => {
    expect(
      verifiedClaimGrace(lapsed({ usernameClaimExpiresAt: null }), NOW),
    ).toBeNull();
    expect(
      verifiedClaimGrace(lapsed({ usernameClaimExpiresAt: undefined }), NOW),
    ).toBeNull();
  });

  // The reservation is over — a countdown to a past date is worse than
  // silence, and the name may already belong to someone else.
  // Inverted deliberately. usernameClaimExpiresAt's schema comment says a past
  // date means "at risk", not "lost": the field stays set until the name is
  // actually taken, and resubscribing still recovers it until then. Returning
  // null here switched the warning off at the point of highest risk. What ends
  // the notice is the `claimed` guard — a name actually taken moves the player
  // out of that status.
  it("flags at-risk once the deadline has passed, rather than going silent", () => {
    expect(
      verifiedClaimGrace(lapsed(), new Date("2026-10-01T00:00:01.000Z")),
    ).toEqual({
      name: "RyanTheGreat",
      expiresAt: new Date(SOON),
      atRisk: true,
    });
    // Exactly on the deadline counts as at risk: the reservation is over.
    expect(verifiedClaimGrace(lapsed(), new Date(SOON))?.atRisk).toBe(true);
  });

  it("says nothing for a TEMPORARY#### rename", () => {
    // Already past the point this warns about; there is no name to keep.
    expect(
      verifiedClaimGrace(
        lapsed({ username: "TEMPORARY7823", usernameBase: "TEMPORARY7823" }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("verifiedNameOptIn", () => {
  it("honours an explicit choice in both directions, whatever the cohort", () => {
    expect(verifiedNameOptIn("true", false)).toBe(true);
    expect(verifiedNameOptIn("true", true)).toBe(true);
    expect(verifiedNameOptIn("false", true)).toBe(false);
    expect(verifiedNameOptIn("false", false)).toBe(false);
  });

  // The gap this closes: reading the preference as `=== "true"` treated
  // "never asked" as "declined", so a fresh profile — every Steam install —
  // never played under the name the subscription was sold on.
  it("defaults on for a profile that has expressed nothing and is new", () => {
    expect(verifiedNameOptIn(null, true)).toBe(true);
  });

  // The cohort is the whole point: an existing subscriber who looked at the
  // toggle and left it alone has no stored preference either, and flipping
  // their public identity without them touching anything is the harm the
  // default was supposed to avoid.
  it("stays off for a profile with no preference that is not new", () => {
    expect(verifiedNameOptIn(null, false)).toBe(false);
  });

  // Not an answer the player gave, so it falls through to the cohort rather
  // than being read as either choice.
  it("treats an unrecognised value as no preference", () => {
    for (const stored of ["", "False", "FALSE", "0", "no", "yes"]) {
      expect(verifiedNameOptIn(stored, true), JSON.stringify(stored)).toBe(
        true,
      );
      expect(verifiedNameOptIn(stored, false), JSON.stringify(stored)).toBe(
        false,
      );
    }
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
