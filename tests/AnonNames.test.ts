import { ANON_WORDS, anonWordName } from "../src/core/AnonNames";
import { UsernameSchema } from "../src/core/Schemas";
import { MAX_USERNAME_LENGTH } from "../src/core/validations/username";

describe("ANON_WORDS", () => {
  it("has 125 unique, single-word entries", () => {
    expect(ANON_WORDS.length).toBe(125);
    expect(new Set(ANON_WORDS).size).toBe(ANON_WORDS.length);
    for (const w of ANON_WORDS) expect(w).toMatch(/^[A-Z][a-z]+$/);
  });

  it("spans domains, with none dominating", () => {
    // Two words from different worlds are much harder to mix up than two from the
    // same one, which is the whole reason the bank is not all animals. The cap
    // matters as much as the breadth: left to the semantic measure alone the list
    // fills with 24 landforms and no flowers, because WordNet subdivides animals
    // deeply (any two look "close") and landforms shallowly.
    const domains: Record<string, string[]> = {
      animals: [
        "Shark",
        "Spider",
        "Snail",
        "Toucan",
        "Zebra",
        "Jellyfish",
        "Urchin",
      ],
      plants: ["Cactus", "Fern", "Moss", "Lotus", "Thistle", "Tulip"],
      colours: [
        "Cobalt",
        "Crimson",
        "Indigo",
        "Ivory",
        "Magenta",
        "Scarlet",
        "Turquoise",
      ],
      gems: [
        "Amethyst",
        "Garnet",
        "Onyx",
        "Opal",
        "Pearl",
        "Quartz",
        "Ruby",
        "Sapphire",
        "Topaz",
      ],
      weather: [
        "Blizzard",
        "Frost",
        "Mist",
        "Monsoon",
        "Rainbow",
        "Thunder",
        "Tornado",
      ],
      sky: ["Comet", "Dusk", "Eclipse", "Meteor", "Nebula", "Quasar"],
      landforms: [
        "Fjord",
        "Geyser",
        "Glacier",
        "Jungle",
        "Prairie",
        "Tundra",
        "Valley",
        "Volcano",
      ],
      water: ["Harbor", "Lagoon", "Lake", "Ocean", "River", "Waterfall"],
      materials: [
        "Bronze",
        "Clay",
        "Leather",
        "Linen",
        "Obsidian",
        "Slate",
        "Steel",
        "Timber",
        "Velvet",
      ],
      instruments: ["Gong", "Harp", "Tuba", "Violin"],
      vehicles: ["Bicycle", "Chariot", "Sled", "Yacht", "Zeppelin"],
      tools: [
        "Anchor",
        "Anvil",
        "Compass",
        "Ladder",
        "Lantern",
        "Plow",
        "Pulley",
        "Shovel",
        "Wrench",
      ],
      myth: ["Goblin", "Mermaid", "Oracle", "Sphinx", "Titan", "Unicorn"],
      food: ["Ginger", "Mango", "Pumpkin", "Sugar", "Truffle", "Vanilla"],
      structures: [
        "Bridge",
        "Castle",
        "Citadel",
        "Lighthouse",
        "Obelisk",
        "Pyramid",
        "Temple",
        "Windmill",
      ],
      regalia: [
        "Banner",
        "Helmet",
        "Locket",
        "Medallion",
        "Relic",
        "Scepter",
        "Shield",
        "Talisman",
      ],
      fire: ["Bonfire", "Ember", "Flame", "Steam", "Torch"],
      abstract: [
        "Cipher",
        "Mirage",
        "Omen",
        "Riddle",
        "Shadow",
        "Silence",
        "Vortex",
        "Whisper",
        "Zenith",
      ],
    };
    for (const [domain, words] of Object.entries(domains)) {
      for (const w of words) {
        expect(ANON_WORDS, `${domain}: ${w}`).toContain(w);
      }
      // No domain may run away with the bank.
      expect(words.length, `${domain} is too large`).toBeLessThanOrEqual(9);
    }
    // Exact, not a floor: the number of domains is part of the design, and a
    // drifting count is how one category quietly swallows the bank.
    expect(Object.keys(domains).length).toBe(18);
    // Every word is accounted for, so a future addition has to declare its domain
    // and face the cap rather than quietly swelling one of them.
    const tagged = new Set(Object.values(domains).flat());
    expect([...ANON_WORDS].filter((w) => !tagged.has(w))).toEqual([]);
  });

  it("has no two entries that SOUND alike", () => {
    // A player's word is the only thing identifying them under the setting, so
    // names have to survive being said out loud in voice chat as well as read.
    // Three mechanical traps, all real: near-homophones (Amber/Ember), a shared
    // opening (Puffin/Pufferfish), and one word opening another (Seal/Seagull).
    // Loose rhymes are fine — "Lion" and "Scorpion" are never confused.
    const editDistance = (a: string, b: string) => {
      const s1 = a.toLowerCase();
      const s2 = b.toLowerCase();
      let prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
      for (let i = 1; i <= s1.length; i++) {
        const row = [i];
        for (let j = 1; j <= s2.length; j++) {
          row[j] = Math.min(
            prev[j] + 1,
            row[j - 1] + 1,
            prev[j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1),
          );
        }
        prev = row;
      }
      return prev[s2.length];
    };

    const conflicts: string[] = [];
    for (let i = 0; i < ANON_WORDS.length; i++) {
      for (let j = i + 1; j < ANON_WORDS.length; j++) {
        const a = ANON_WORDS[i].toLowerCase();
        const b = ANON_WORDS[j].toLowerCase();
        const pair = `${ANON_WORDS[i]}/${ANON_WORDS[j]}`;
        if (editDistance(a, b) <= 1) conflicts.push(`${pair}: near-homophone`);
        else if (a.slice(0, 4) === b.slice(0, 4))
          conflicts.push(`${pair}: same opening`);
        else if (a.startsWith(b) || b.startsWith(a))
          conflicts.push(`${pair}: one opens the other`);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it("has no two entries that sound alike when SPOKEN, not just when spelt", () => {
    // Comparing spellings misses homophones: Right and Write are three edits apart
    // on paper and identical out loud. So each word is reduced to a rough sound key
    // (a cut-down Metaphone: silent letters dropped, digraphs folded, all vowels
    // treated as one) and the keys must be unique.
    const soundKey = (word: string) => {
      let s = word.toLowerCase();
      s = s.replace(/^(kn|gn|pn|wr)/, (m) => (m === "wr" ? "r" : "n"));
      if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1); // silent trailing e
      s = s
        .replace(/ph/g, "f")
        .replace(/ck/g, "k")
        .replace(/qu/g, "kw")
        .replace(/x/g, "ks")
        .replace(/sh/g, "S")
        .replace(/ch/g, "S")
        .replace(/th/g, "T")
        .replace(/gh/g, "");
      s = s.replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
      s = s.replace(/g(?=[eiy])/g, "j");
      s = s.replace(/[zvwyh]/g, (c) =>
        c === "z" ? "s" : c === "v" ? "f" : "",
      );
      s = s.replace(/[aeiou]+/g, "a"); // any vowel run reads as one sound
      s = s.replace(/(.)\1+/g, "$1"); // doubled letters are one sound
      return s;
    };

    // The reduction has to actually catch homophones, or the assertion below is
    // vacuous. These pairs are not in the bank; they are here to prove the key works.
    for (const [a, b] of [
      ["Right", "Write"],
      ["Steel", "Steal"],
      ["Plain", "Plane"],
      ["Knight", "Night"],
      ["Bare", "Bear"],
      ["Sail", "Sale"],
    ]) {
      expect(soundKey(a), `${a}/${b} must collide`).toBe(soundKey(b));
    }

    const byKey = new Map<string, string[]>();
    for (const w of ANON_WORDS) {
      const k = soundKey(w);
      byKey.set(k, [...(byKey.get(k) ?? []), w]);
    }
    const collisions = [...byKey.values()].filter((ws) => ws.length > 1);
    expect(collisions).toEqual([]);
  });

  it("is safe for children — nothing about drugs, weapons or vice", () => {
    // The name is assigned TO a player rather than chosen by them, so it has to be
    // unobjectionable to everyone who might be handed it. Needle, Sickle and Smoke
    // were all dropped on this basis despite measuring well on distinctness.
    const banned = [
      // drugs and drink
      "Needle",
      "Syringe",
      "Pipe",
      "Bong",
      "Joint",
      "Powder",
      "Pill",
      "Dose",
      "Whiskey",
      "Vodka",
      "Brandy",
      "Absinthe",
      "Tobacco",
      "Cigar",
      // weapons and violence
      "Sickle",
      "Dagger",
      "Cleaver",
      "Machete",
      "Musket",
      "Rifle",
      "Pistol",
      "Bullet",
      "Grenade",
      "Bayonet",
      "Noose",
      "Gallows",
      "Guillotine",
      // death and harm
      "Corpse",
      "Coffin",
      "Casket",
      "Tombstone",
      "Autopsy",
      "Plague",
      "Venom",
      // vice
      "Smoke",
      "Gamble",
      "Casino",
      "Brothel",
    ];
    for (const w of banned) expect(ANON_WORDS).not.toContain(w);

    // And nothing hiding a slur or profanity as a whole word.
    for (const w of ANON_WORDS) {
      expect(w).toMatch(/^[A-Z][a-z]+$/);
      expect(w.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("is plain English that nobody has to spell out", () => {
    // Distinctive is not enough on its own — a player has to be able to say their
    // own name. Axolotl and Cassowary are both unmistakable and both excluded.
    for (const w of ANON_WORDS) {
      expect(w.length).toBeLessThanOrEqual(11);
      expect(w).not.toMatch(/[^A-Za-z]/);
    }
    for (const hard of [
      "Axolotl",
      "Cassowary",
      "Chrysanthemum",
      "Bougainvillea",
    ]) {
      expect(ANON_WORDS).not.toContain(hard);
    }
  });

  it("leaves room for a caller's prefix and round number", () => {
    // genAnonUsername prefixes "Anon" and anonWordName can append a round, so
    // the bank has to stay well inside the username limit on its own.
    for (const a of ANON_WORDS) {
      expect(`Anon${a}99`.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
    }
  });
});

describe("anonWordName", () => {
  it("is deterministic in (slot, offset)", () => {
    expect(anonWordName(5, 3)).toBe(anonWordName(5, 3));
  });

  it("returns a BARE word — the in-game setting adds no 'Anon'", () => {
    // Under the anonymise-names setting every player is anonymous, so the word
    // only eats name width on a crowded map. The prefix belongs to the signed-out
    // default handle instead (genAnonUsername).
    for (let slot = 0; slot < ANON_WORDS.length * 3; slot++) {
      expect(anonWordName(slot, 41)).not.toMatch(/^Anon/);
    }
    expect(anonWordName(0, 0)).toBe(ANON_WORDS[0]);
  });

  it("names the first 125 slots bare, then counts the round up", () => {
    expect(anonWordName(0, 0)).toBe(ANON_WORDS[0]);
    expect(anonWordName(124, 0)).toBe(ANON_WORDS[124]);
    expect(anonWordName(125, 0)).toBe(`${ANON_WORDS[0]}1`);
    expect(anonWordName(250, 0)).toBe(`${ANON_WORDS[0]}2`);
  });

  it("NEVER collides for distinct slots at a fixed offset (the guarantee)", () => {
    for (const offset of [0, 7, 12345]) {
      const names = new Set<string>();
      for (let slot = 0; slot < 400; slot++)
        names.add(anonWordName(slot, offset));
      expect(names.size).toBe(400); // 400 distinct players → 400 distinct names
    }
  });

  it("varies by offset (per-viewer): same slot, different viewers → different name", () => {
    const slot = 3;
    const names = new Set(
      Array.from({ length: 25 }, (_, v) => anonWordName(slot, v * 101)),
    );
    expect(names.size).toBeGreaterThan(1);
  });

  it("always produces a wire-valid handle within length limits", () => {
    for (let slot = 0; slot < ANON_WORDS.length * 3; slot++) {
      const name = anonWordName(slot, 999);
      expect(name).toMatch(/^[A-Z][a-z]+\d*$/);
      expect(name.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
      expect(UsernameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("stays wire-valid once a caller prefixes it", () => {
    // genAnonUsername's output must survive the same validation.
    for (let slot = 0; slot < ANON_WORDS.length * 3; slot++) {
      const handle = `Anon${anonWordName(slot)}`;
      expect(handle.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
      expect(UsernameSchema.safeParse(handle).success).toBe(true);
    }
  });
});
