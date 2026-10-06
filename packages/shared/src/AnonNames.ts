// Word bank for anonymous player names. Each entry is a single, memorable word that
// is username-safe on its own (matches UsernameSchema's [a-zA-Z0-9_ üÜ.]) and short
// enough that callers can still prefix or suffix it within MAX_USERNAME_LENGTH.
// Order is irrelevant — callers index into this by a random value.
//
// A player's word is the only thing identifying them under the anonymisation
// setting, so the bank is built to keep any two of them far apart. It deliberately
// spans DOMAINS — animals, plants, colours, gems, weather, sky, landforms, water,
// materials, instruments, vehicles, tools, myth, food, structures, regalia, fire,
// abstractions — because two words from different worlds are much harder to mix up
// than two from the same one. Tulip, Crimson and Zeppelin cannot be confused the
// way Leopard and Jaguar can, or Whale and Narwhal.
//
// The list was picked by measuring, not by taste, after hand-curated attempts kept
// smuggling in near-duplicates (an earlier version held Whale, Narwhal AND Dolphin).
// Candidates were scored pairwise on the depth of their deepest common ancestor in
// WordNet's noun hierarchy — deeper means more closely related — and chosen
// farthest-first, tightest threshold first, relaxing only as far as needed to fill
// the bank:
//
//   88 words are pairwise no closer than "loosely related"
//   28 more sit one step closer
//    9 more sit two steps closer (e.g. Zeppelin and Yacht, both vessels)
//
// Per-domain caps keep that from collapsing into one category: left unconstrained,
// the measure fills the bank with 24 landforms and no flowers, because WordNet
// subdivides animals deeply (so any two look "close") and landforms shallowly.
//
// Two further rules, both enforced by the test rather than by judgement:
//   SOUND — no near-homophones (Amber/Ember), no shared opening (Puffin/
//           Pufferfish), no word opening another (Seal/Seagull).
//   SAYING IT — ordinary English throughout. Axolotl and Cassowary are
//           unmistakable and still absent; nobody should have to spell their name.
//   SAFE FOR CHILDREN — nothing referencing drugs, weapons, violence or vice. This
//           is a name assigned TO a player, not chosen by them, so it has to be
//           unobjectionable to everyone. Needle, Sickle and Smoke were dropped on
//           that basis even though they measured well.
export const ANON_WORDS: readonly string[] = [
  "Amethyst",
  "Anchor",
  "Anvil",
  "Banner",
  "Bicycle",
  "Blizzard",
  "Bonfire",
  "Bridge",
  "Bronze",
  "Cactus",
  "Castle",
  "Chariot",
  "Cipher",
  "Citadel",
  "Clay",
  "Cobalt",
  "Comet",
  "Compass",
  "Crimson",
  "Dusk",
  "Eclipse",
  "Ember",
  "Fern",
  "Fjord",
  "Flame",
  "Frost",
  "Garnet",
  "Geyser",
  "Ginger",
  "Glacier",
  "Goblin",
  "Gong",
  "Harbor",
  "Harp",
  "Helmet",
  "Indigo",
  "Ivory",
  "Jellyfish",
  "Jungle",
  "Ladder",
  "Lagoon",
  "Lake",
  "Lantern",
  "Leather",
  "Lighthouse",
  "Linen",
  "Locket",
  "Lotus",
  "Magenta",
  "Mango",
  "Medallion",
  "Mermaid",
  "Meteor",
  "Mirage",
  "Mist",
  "Monsoon",
  "Moss",
  "Nebula",
  "Obelisk",
  "Obsidian",
  "Ocean",
  "Omen",
  "Onyx",
  "Opal",
  "Oracle",
  "Pearl",
  "Plow",
  "Prairie",
  "Pulley",
  "Pumpkin",
  "Pyramid",
  "Quartz",
  "Quasar",
  "Rainbow",
  "Relic",
  "Riddle",
  "River",
  "Ruby",
  "Sapphire",
  "Scarlet",
  "Scepter",
  "Shadow",
  "Shark",
  "Shield",
  "Shovel",
  "Silence",
  "Slate",
  "Sled",
  "Snail",
  "Sphinx",
  "Spider",
  "Steam",
  "Steel",
  "Sugar",
  "Talisman",
  "Temple",
  "Thistle",
  "Thunder",
  "Timber",
  "Titan",
  "Topaz",
  "Torch",
  "Tornado",
  "Toucan",
  "Truffle",
  "Tuba",
  "Tulip",
  "Tundra",
  "Turquoise",
  "Unicorn",
  "Urchin",
  "Valley",
  "Vanilla",
  "Velvet",
  "Violin",
  "Volcano",
  "Vortex",
  "Waterfall",
  "Whisper",
  "Windmill",
  "Wrench",
  "Yacht",
  "Zebra",
  "Zenith",
  "Zeppelin",
];

// A bare word plus an optional round number, from a slot index and a
// per-viewer offset (e.g. "Wolf", "Fox", … then "Wolf1" once all 125 are used).
//
// NO "Anon" prefix: this feeds the in-game anonymisation setting, where every
// player is anonymous, so the word adds nothing but noise to a crowded map and
// costs a third of the name's width. Callers that need to advertise anonymity —
// the default handle for a signed-out player — add the prefix themselves (see
// genAnonUsername).
//
// Consecutive slots map to DISTINCT handles: the 125 words fill first (round 0
// → a bare name), then the round counts up. So for a fixed offset, two different
// slots can never collide — that is what lets the anonymisation overlay guarantee
// unique names by feeding it join-order slots. The offset rotates which animal
// each slot lands on, so different viewers see a different name for the same
// player. Output is always wire-valid (letters + optional digits).
export function anonWordName(slot: number, offset = 0): string {
  const s = Math.abs(Math.trunc(slot));
  const o = Math.abs(Math.trunc(offset));
  const animal = ANON_WORDS[(s + o) % ANON_WORDS.length];
  const round = Math.floor(s / ANON_WORDS.length);
  return round === 0 ? animal : `${animal}${round}`;
}
