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
 * Creates the nations array for a game, handling HumansVsNations mode specially.
 * In HumansVsNations mode, the number of nations matches the number of human players to ensure fair gameplay.
 * For compact maps, only 25% of the nations are used.
 */
export function createNationsForGame(
  gameStart: GameStartInfo,
  manifestNations: ManifestNation[],
  numHumans: number,
  random: PseudoRandom,
): Nation[] {
  if (gameStart.config.disableNations) {
    return [];
  }

  const toNation = (n: ManifestNation): Nation =>
    new Nation(
      new Cell(n.coordinates[0], n.coordinates[1]),
      new PlayerInfo(n.name, PlayerType.Nation, null, random.nextID()),
    );

  const isCompactMap = gameStart.config.gameMapSize === GameMapSize.Compact;

  const isHumansVsNations =
    gameStart.config.gameMode === GameMode.Team &&
    gameStart.config.playerTeams === HumansVsNations;

  // For compact maps, use only 25% of nations (minimum 1)
  let effectiveNations = manifestNations;
  if (isCompactMap && !isHumansVsNations) {
    const targetCount = getCompactMapNationCount(manifestNations.length, true);
    const shuffled = random.shuffleArray(manifestNations);
    effectiveNations = shuffled.slice(0, targetCount);
  }

  // For non-HumansVsNations modes, simply use the effective nations
  if (!isHumansVsNations) {
    // TEST: Generate extra nations to test alliance request panel overflow (30 total)
    const baseNations = effectiveNations.map(toNation);
    const targetNationCount = 30;
    if (baseNations.length < targetNationCount) {
      const usedNames = new Set(baseNations.map((n) => n.playerInfo.name));
      const additionalCount = targetNationCount - baseNations.length;
      for (let i = 0; i < additionalCount; i++) {
        const name = generateUniqueNationName(random, usedNames);
        usedNames.add(name);
        baseNations.push(
          new Nation(
            undefined,
            new PlayerInfo(name, PlayerType.Nation, null, random.nextID()),
          ),
        );
      }
    }
    return baseNations;
  }

  // HumansVsNations mode: balance nation count to match human count
  const isSingleplayer = gameStart.config.gameType === GameType.Singleplayer;
  const targetNationCount = isSingleplayer ? 1 : numHumans;

  if (targetNationCount === 0) {
    return [];
  }

  // If we have enough manifest nations, use a subset
  if (manifestNations.length >= targetNationCount) {
    // Shuffle manifest nations to add variety
    const shuffled = random.shuffleArray(manifestNations);
    return shuffled.slice(0, targetNationCount).map(toNation);
  }

  // If we need more nations than defined in manifest, create additional ones
  const nations: Nation[] = manifestNations.map(toNation);
  const usedNames = new Set(nations.map((n) => n.playerInfo.name));
  const additionalCount = targetNationCount - manifestNations.length;
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
  ["Interstellar", NOUN, "Cabal"],
  ["Interstellar", NOUN, "Army"],
  ["Interstellar", NOUN, "Pirates"],
  ["Interstellar", NOUN, "Dynasty"],
  ["Interstellar", NOUN, "Clan"],
  ["Galactic", NOUN, "Smugglers"],
  ["Galactic", NOUN, "Cabal"],
  ["Galactic", NOUN, "Alliance"],
  ["Galactic", NOUN, "Empire"],
  ["Galactic", NOUN, "Army"],
  ["Galactic", NOUN, "Crown"],
  ["Galactic", NOUN, "Pirates"],
  ["Galactic", NOUN, "Dynasty"],
  ["Galactic", NOUN, "Clan"],
  ["Alien", NOUN, "Army"],
  ["Alien", NOUN, "Cabal"],
  ["Alien", NOUN, "Alliance"],
  ["Alien", NOUN, "Empire"],
  ["Alien", NOUN, "Pirates"],
  ["Alien", NOUN, "Clan"],
  ["Grand", NOUN, "Empire"],
  ["Grand", NOUN, "Dynasty"],
  ["Grand", NOUN, "Army"],
  ["Grand", NOUN, "Cabal"],
  ["Grand", NOUN, "Alliance"],
  ["Royal", NOUN, "Army"],
  ["Royal", NOUN, "Cabal"],
  ["Royal", NOUN, "Empire"],
  ["Royal", NOUN, "Dynasty"],
  ["Holy", NOUN, "Dynasty"],
  ["Holy", NOUN, "Empire"],
  ["Holy", NOUN, "Alliance"],
  ["Eternal", NOUN, "Empire"],
  ["Eternal", NOUN, "Cabal"],
  ["Eternal", NOUN, "Alliance"],
  ["Eternal", NOUN, "Dynasty"],
  ["Invading", NOUN, "Cabal"],
  ["Invading", NOUN, "Empire"],
  ["Invading", NOUN, "Alliance"],
  ["Immortal", NOUN, "Pirates"],
  ["Shadow", NOUN, "Cabal"],
  ["Secret", NOUN, "Dynasty"],
  ["The Great", NOUN, "Army"],
  ["The", NOUN, "Matrix"],
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
];

// Words from NOUNS that need irregular "-oes" plural
const O_TO_OES = new Set(["Potato", "Tomato"]);

function pluralize(noun: string): string {
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
