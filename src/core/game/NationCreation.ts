import { PseudoRandom } from "../PseudoRandom";
import { GameStartInfo } from "../Schemas";
import {
  Cell,
  GameMapSize,
  GameMode,
  GameType,
  HumansVsNations,
  Nation,
  PlayerInfo,
  PlayerType,
} from "./Game";
import { Nation as ManifestNation } from "./TerrainMapLoader";

/**
 * Creates the nations array for a game.
 * If config.nations is a number (custom count), uses that exact count,
 * generating additional nations with random names if needed.
 * If config.nations is "disabled", returns no nations.
 * If config.nations is "default":
 *   - Public HumansVsNations: matches nation count to human player count
 *   - Public compact maps: uses 25% of manifest nations
 *   - Otherwise: uses all manifest nations
 */
export function createNationsForGame(
  gameStart: GameStartInfo,
  manifestNations: ManifestNation[],
  numHumans: number,
  random: PseudoRandom,
): Nation[] {
  const toNation = (n: ManifestNation): Nation =>
    new Nation(
      new Cell(n.coordinates[0], n.coordinates[1]),
      new PlayerInfo(n.name, PlayerType.Nation, null, random.nextID()),
    );

  const isCompactMap = gameStart.config.gameMapSize === GameMapSize.Compact;

  const isHumansVsNations =
    gameStart.config.gameMode === GameMode.Team &&
    gameStart.config.playerTeams === HumansVsNations;

  const configNations = gameStart.config.nations;
  if (configNations === "disabled") {
    return [];
  }
  // If nations count is explicitly set, use that exact count
  if (typeof configNations === "number") {
    return createRandomNations(
      configNations,
      manifestNations,
      toNation,
      random,
    );
  }

  if (gameStart.config.gameType === GameType.Public) {
    // For HvN, balance nation count to match human count
    if (isHumansVsNations) {
      return createRandomNations(numHumans, manifestNations, toNation, random);
    }

    // For compact maps, use only 25% of nations (minimum 1)
    if (isCompactMap) {
      const targetCount = getCompactMapNationCount(
        manifestNations.length,
        true,
      );
      const shuffled = random.shuffleArray(manifestNations);
      const slicedNations = shuffled.slice(0, targetCount);
      return slicedNations.map(toNation);
    }
  }

  return manifestNations.map(toNation);
}

/**
 * Creates the requested number of nations from manifest data.
 * If more nations are needed than available in the manifest, generates additional ones with random names.
 */
function createRandomNations(
  targetCount: number,
  manifestNations: ManifestNation[],
  toNation: (n: ManifestNation) => Nation,
  random: PseudoRandom,
): Nation[] {
  const shuffled = random.shuffleArray(manifestNations);
  if (targetCount <= manifestNations.length) {
    return shuffled.slice(0, targetCount).map(toNation);
  }
  // Need more nations than defined in manifest, create additional ones
  const nations: Nation[] = shuffled.map(toNation);
  const usedNames = new Set(nations.map((n) => n.playerInfo.name));
  const additionalCount = targetCount - manifestNations.length;
  for (let i = 0; i < additionalCount; i++) {
    const name = generateUniqueNationName(random, usedNames);
    usedNames.add(name);
    nations.push(
      new Nation(
        undefined,
        new PlayerInfo(name, PlayerType.Nation, null, random.nextID()),
      ),
    );
  }
  return nations;
}

// For compact maps, only 25% of nations are used (minimum 1).
export function getCompactMapNationCount(
  manifestNationCount: number,
  isCompactMap: boolean,
): number {
  if (manifestNationCount === 0) {
    return 0;
  }
  if (isCompactMap) {
    return Math.max(1, Math.floor(manifestNationCount * 0.25));
  }
  return manifestNationCount;
}

function generateUniqueNationName(
  random: PseudoRandom,
  usedNames: Set<string>,
): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = generateNationName(random);
    if (!usedNames.has(name)) {
      return name;
    }
  }
  // Fallback if we can't generate unique name (extremely unlikely)
  // Append a number to ensure uniqueness
  let counter = 1;
  const baseName = generateNationName(random);
  while (usedNames.has(`${baseName} ${counter}`)) {
    counter++;
  }
  return `${baseName} ${counter}`;
}

function generateNationName(random: PseudoRandom): string {
  const template = NAME_TEMPLATES[random.nextInt(0, NAME_TEMPLATES.length)];
  const noun = NOUNS[random.nextInt(0, NOUNS.length)];

  const result: string[] = [];

  for (const part of template) {
    if (part === PLURAL_NOUN) {
      result.push(pluralize(noun));
    } else if (part === NOUN) {
      result.push(noun);
    } else {
      result.push(part);
    }
  }

  return result.join(" ");
}

const PLURAL_NOUN = Symbol("plural!");
const NOUN = Symbol("noun!");

type NameTemplate = (string | typeof PLURAL_NOUN | typeof NOUN)[];

const NAME_TEMPLATES: NameTemplate[] = [
  ["World Famous", NOUN],
  ["Famous", PLURAL_NOUN],
  ["Comically Large", NOUN],
  ["Comically Small", NOUN],
  ["Massive", PLURAL_NOUN],
  ["Friendly", NOUN],
  ["Evil", NOUN],
  ["Malicious", NOUN],
  ["Spiteful", NOUN],
  ["Suspicious", NOUN],
  ["Canonically Evil", NOUN],
  ["Limited Edition", NOUN],
  ["Patent Pending", NOUN],
  ["Patented", NOUN],
  ["Space", NOUN],
  ["Defend The", PLURAL_NOUN],
  ["Anarchist", NOUN],
  ["Republic of", PLURAL_NOUN],
  ["Slippery", NOUN],
  ["Wealthy", PLURAL_NOUN],
  ["Certified", NOUN],
  ["Dr", NOUN],
  ["Runaway", NOUN],
  ["Chrome", NOUN],
  ["All New", NOUN],
  ["Top Shelf", PLURAL_NOUN],
  ["Invading", PLURAL_NOUN],
  ["Loyal To", PLURAL_NOUN],
  ["United States of", NOUN],
  ["United States of", PLURAL_NOUN],
  ["Flowing Rivers of", NOUN],
  ["House of", PLURAL_NOUN],
  ["Certified Organic", NOUN],
  ["Unregulated", NOUN],
  ["Slightly Damp", NOUN],
  ["Suspiciously Quiet", PLURAL_NOUN],
  ["Weaponized", NOUN],
  ["Accidentally Evil", NOUN],
  ["Extremely Loud", PLURAL_NOUN],
  ["Bootleg", NOUN],
  ["Questionable", NOUN],
  ["Off-Brand", NOUN],
  ["Counterfeit", PLURAL_NOUN],
  ["Sentient", PLURAL_NOUN],
  ["Feral", PLURAL_NOUN],
  ["Aggressively Friendly", PLURAL_NOUN],
  ["Mildly Threatening", NOUN],
  ["Dangerously Cute", PLURAL_NOUN],
  ["Legally Distinct", NOUN],
  ["Deeply Confused", PLURAL_NOUN],
  ["Order of the", NOUN],
  ["Knights of the", NOUN],
  ["Cult of the", NOUN],
  ["League of", PLURAL_NOUN],
  ["Band of", PLURAL_NOUN],
  ["Council of", PLURAL_NOUN],
  ["Assembly of", PLURAL_NOUN],
  ["Haunted", NOUN],
  ["Cursed", NOUN],
  ["Blessed", NOUN],
  ["Radioactive", PLURAL_NOUN],
  ["Deep Fried", NOUN],
  ["Gluten Free", PLURAL_NOUN],
  ["Turbocharged", NOUN],
  ["Nomadic", PLURAL_NOUN],
  ["Vengeful", PLURAL_NOUN],
  ["Legendary", PLURAL_NOUN],
  ["Outlaw", PLURAL_NOUN],
  ["AFK", NOUN],
  ["Noob", NOUN],
  ["Pro", NOUN],
  ["Tryhard", PLURAL_NOUN],
  ["Sweaty", PLURAL_NOUN],
  ["Griefing", PLURAL_NOUN],
  ["Speedrunning", PLURAL_NOUN],
  ["Nerfed", PLURAL_NOUN],
  ["Buffed", PLURAL_NOUN],
  ["OP", NOUN],
  ["Overpowered", NOUN],
  ["Underpowered", PLURAL_NOUN],
  ["Modded", PLURAL_NOUN],
  ["Prestige", NOUN],
  ["Hardcore", PLURAL_NOUN],
  ["Clutch", NOUN],
  ["Cracked", NOUN],
  ["Unranked", PLURAL_NOUN],
  ["Max Level", NOUN],
  ["Ironman", NOUN],

  [NOUN, "For Hire"],
  [PLURAL_NOUN, "That Bite"],
  [PLURAL_NOUN, "Are Opps"],
  [NOUN, "Hotel"],
  [PLURAL_NOUN, "The Movie"],
  [NOUN, "Corporation"],
  [PLURAL_NOUN, "Inc"],
  [NOUN, "Democracy"],
  [NOUN, "Network"],
  [NOUN, "Railway"],
  [NOUN, "Congress"],
  [NOUN, "Alliance"],
  [NOUN, "Island"],
  [NOUN, "Kingdom"],
  [NOUN, "Empire"],
  [NOUN, "Dynasty"],
  [NOUN, "Cartel"],
  [NOUN, "Cabal"],
  [NOUN, "Land"],
  [NOUN, "Oligarchy"],
  [NOUN, "Nationalist"],
  [NOUN, "State"],
  [NOUN, "Duchy"],
  [NOUN, "Ocean"],
  [NOUN, "Syndicate"],
  [NOUN, "Republic"],
  [NOUN, "Province"],
  [NOUN, "Dominion"],
  [NOUN, "Commune"],
  [NOUN, "Federation"],
  [NOUN, "Parliament"],
  [NOUN, "Tribunal"],
  [NOUN, "Armada"],
  [NOUN, "Rebellion"],
  [NOUN, "Resistance"],
  [NOUN, "Expedition"],
  [NOUN, "Preservation Society"],
  [NOUN, "Defense League"],
  [NOUN, "Thunderdome"],
  [NOUN, "Uprising"],
  [NOUN, "Enthusiasts"],
  [NOUN, "Appreciation Society"],
  [NOUN, "Fan Club"],
  [NOUN, "Simulation"],
  [PLURAL_NOUN, "Anonymous"],
  [PLURAL_NOUN, "With Attitude"],
  [PLURAL_NOUN, "Gone Wrong"],
  [PLURAL_NOUN, "on Vacation"],
  [PLURAL_NOUN, "in Disguise"],
  [PLURAL_NOUN, "With Hats"],
  [PLURAL_NOUN, "on Ice"],
  [PLURAL_NOUN, "United"],
  [PLURAL_NOUN, "Unhinged"],
  [PLURAL_NOUN, "Unleashed"],
  [PLURAL_NOUN, "Reloaded"],
  [PLURAL_NOUN, "After Dark"],
  [PLURAL_NOUN, "From Space"],
  [PLURAL_NOUN, "of Doom"],
  [PLURAL_NOUN, "Without Borders"],
  [NOUN, "Meta"],
  [PLURAL_NOUN, "OP Please Nerf"],

  ["Alternate", NOUN, "Universe"],
  ["Famous", NOUN, "Collection"],
  ["Supersonic", NOUN, "Spaceship"],
  ["Secret", NOUN, "Agenda"],
  ["Ballistic", NOUN, "Missile"],
  ["The", PLURAL_NOUN, "are SPIES"],
  ["Traveling", NOUN, "Circus"],
  ["The", PLURAL_NOUN, "Lied"],
  ["Sacred", NOUN, "Knowledge"],
  ["Quantum", NOUN, "Computer"],
  ["Hadron", NOUN, "Collider"],
  ["Large", NOUN, "Obliterator"],
  ["Interstellar", NOUN, "Pirates"],
  ["Alien", NOUN, "Clan"],
  ["Grand", NOUN, "Alliance"],
  ["Royal", NOUN, "Army"],
  ["Holy", NOUN, "Empire"],
  ["Eternal", NOUN, "Cabal"],
  ["Invading", NOUN, "Empire"],
  ["Immortal", NOUN, "Pirates"],
  ["Shadow", NOUN, "Cabal"],
  ["Secret", NOUN, "Dynasty"],
  ["The Great", NOUN, "Army"],
  ["The", NOUN, "Matrix"],
  ["Tax-Free", NOUN, "Paradise"],
  ["Self-Proclaimed", NOUN, "Experts"],
  ["Forbidden", NOUN, "Zone"],
  ["Reluctant", NOUN, "Monarchy"],
  ["Chaotic", NOUN, "Collective"],
  ["Unsanctioned", NOUN, "Olympics"],
  ["The", NOUN, "Conspiracy"],
  ["The", NOUN, "Incident"],
  ["The", NOUN, "Situation"],
  ["Premium", NOUN, "Subscription"],
  ["Clearance", NOUN, "Warehouse"],
  ["Budget", NOUN, "Emporium"],
  ["Overnight", NOUN, "Delivery"],
  ["National", NOUN, "Reserve"],
  ["The", NOUN, "Dimension"],
  ["The", NOUN, "Prophecy"],
  ["The", NOUN, "Awakening"],
  ["The", NOUN, "Inquisition"],
  ["Legendary", NOUN, "Drop"],
  ["Elite", NOUN, "Squad"],
  ["The", NOUN, "Saga"],
];

const NOUNS = [
  "Snail",
  "Cow",
  "Giraffe",
  "Donkey",
  "Horse",
  "Mushroom",
  "Salad",
  "Kitten",
  "Fork",
  "Apple",
  "Pancake",
  "Tree",
  "Fern",
  "Seashell",
  "Turtle",
  "Casserole",
  "Gnome",
  "Frog",
  "Cheese",
  "Mold",
  "Clown",
  "Boat",
  "Robot",
  "Millionaire",
  "Billionaire",
  "Pigeon",
  "Fish",
  "Bumblebee",
  "Jelly",
  "Wizard",
  "Worm",
  "Rat",
  "Pumpkin",
  "Zombie",
  "Grass",
  "Bear",
  "Skunk",
  "Sandwich",
  "Butter",
  "Soda",
  "Pickle",
  "Potato",
  "Book",
  "Friend",
  "Feather",
  "Flower",
  "Oil",
  "Train",
  "Fan",
  "Salmon",
  "Cod",
  "Sink",
  "Villain",
  "Bug",
  "Car",
  "Soup",
  "Puppy",
  "Rock",
  "Stick",
  "Succulent",
  "Nerd",
  "Mercenary",
  "Ninja",
  "Burger",
  "Tomato",
  "Penguin",
  "Waffle",
  "Toaster",
  "Hamster",
  "Pretzel",
  "Walrus",
  "Raccoon",
  "Llama",
  "Noodle",
  "Goblin",
  "Muffin",
  "Coconut",
  "Biscuit",
  "Cactus",
  "Moose",
  "Platypus",
  "Yeti",
  "Sponge",
  "Spatula",
  "Trampoline",
  "Dolphin",
  "Taco",
  "Chainsaw",
  "Spoon",
  "Doorknob",
  "Bathrobe",
  "Lampshade",
  "Crowbar",
  "Shoelace",
  "Wheelbarrow",
  "Barnacle",
  "Armadillo",
  "Cabbage",
  "Wig",
  "Plunger",
  "Kazoo",
  "Napkin",
  "Pelican",
  "Turnip",
  "Canoe",
  "Igloo",
  "Stapler",
  "Ferret",
  "Anchovy",
  "Dumpling",
  "Mattress",
  "Parsnip",
  "Gargoyle",
  "Crayon",
  "Corgi",
  "Macaroni",
  "Blender",
  "Ukulele",
  "Flamingo",
  "Nugget",
  "Porcupine",
  "Tadpole",
  "Papaya",
  "Chinchilla",
  "Teapot",
  "Baguette",
  "Squid",
  "Otter",
  "Badger",
  "Hedgehog",
  "Mantis",
  "Scorpion",
  "Vulture",
  "Falcon",
  "Jackal",
  "Hyena",
  "Panther",
  "Stingray",
  "Octopus",
  "Basilisk",
  "Dragon",
  "Sphinx",
  "Phoenix",
  "Kraken",
  "Leviathan",
  "Mammoth",
  "Chimera",
  "Griffin",
  "Minotaur",
  "Cyclops",
  "Brick",
  "Anvil",
  "Torpedo",
  "Lantern",
  "Compass",
  "Telescope",
  "Pendulum",
  "Furnace",
  "Cauldron",
  "Beacon",
  "Anchor",
  "Dagger",
  "Gauntlet",
  "Helmet",
  "Shield",
  "Banner",
  "Trumpet",
  "Bagpipe",
  "Tambourine",
  "Accordion",
  "Xylophone",
  "Avocado",
  "Broccoli",
  "Radish",
  "Artichoke",
  "Kumquat",
  "Pomegranate",
  "Mango",
  "Truffle",
  "Croissant",
  "Lasagna",
  "Soufflé",
  "Spaghetti",
  "Tsunami",
  "Tornado",
  "Avalanche",
  "Volcano",
  "Glacier",
  "Comet",
  "Meteor",
  "Nebula",
  "Supernova",
  "Quasar",
  "Abyss",
  "Labyrinth",
  "Caterpillar",
  "Chameleon",
  "Narwhal",
  "Capybara",
  "Pangolin",
  "Axolotl",
  "Sloth",
  "Lemur",
  "Alpaca",
  "Tapir",
  "Wombat",
  "Ocelot",
  "Manatee",
  "Ibis",
  "Kiwi",
  "Creeper",
  "Enderman",
  "Skeleton",
  "Necromancer",
  "Paladin",
  "Warlock",
  "Ranger",
  "Boss",
  "NPC",
  "Assassin",
  "Viking",
  "Samurai",
  "Pirate",
  "Champion",
  "Gladiator",
  "Demon",
  "Angel",

  "Fullsender",
  "Fullsender",
  "Fullsender",
  "Mito",
  "Mito",
  "Mito",
  "Mitochondria",
  "Mitochondria",
  "Mitochondria",
];

// Words from NOUNS that need irregular "-oes" plural
const O_TO_OES = new Set(["Potato", "Tomato", "Volcano", "Torpedo"]);

// Words from NOUNS that need special plural forms
const SPECIAL_PLURALS = new Map([
  ["Cactus", "Cacti"],
  ["Platypus", "Platypuses"],
  ["Moose", "Moose"],
  ["Octopus", "Octopi"],
  ["Cyclops", "Cyclopes"],
  ["Samurai", "Samurai"],
  ["Fish", "Fish"],
  ["Salmon", "Salmon"],
  ["Cod", "Cod"],
  ["Enderman", "Endermen"],
  ["Mitochondria", "Mitochondria"],
]);

function pluralize(noun: string): string {
  if (SPECIAL_PLURALS.has(noun)) {
    return SPECIAL_PLURALS.get(noun)!;
  }
  if (
    noun.endsWith("s") ||
    noun.endsWith("ch") ||
    noun.endsWith("sh") ||
    noun.endsWith("x") ||
    noun.endsWith("z")
  ) {
    return `${noun}es`;
  }
  if (noun.endsWith("y") && !"aeiou".includes(noun[noun.length - 2])) {
    return `${noun.slice(0, -1)}ies`;
  }
  if (O_TO_OES.has(noun)) {
    return `${noun}es`;
  }
  return `${noun}s`;
}
