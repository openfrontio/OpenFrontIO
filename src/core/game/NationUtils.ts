import { PseudoRandom } from "../PseudoRandom";
import { GameStartInfo } from "../Schemas";
import {
  Cell,
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

  const isHumansVsNations =
    gameStart.config.gameMode === GameMode.Team &&
    gameStart.config.playerTeams === HumansVsNations;

  // For non-HumansVsNations modes, simply use the manifest nations
  if (!isHumansVsNations) {
    return manifestNations.map(toNation);
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
  const additionalCount = targetNationCount - manifestNations.length;
  for (let i = 0; i < additionalCount; i++) {
    const name = generateNationName(random);
    nations.push(
      new Nation(
        undefined,
        new PlayerInfo(name, PlayerType.Nation, null, random.nextID()),
      ),
    );
  }

  return nations;
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
