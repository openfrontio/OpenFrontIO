const PLURAL_NOUN = Symbol("plural!");
const NOUN = Symbol("noun!");

const names = [
  ["World Famous", NOUN],
  ["Famous", PLURAL_NOUN],
  ["Comically Large", NOUN],
  ["Comically Small", NOUN],
  ["Clearance Aisle", PLURAL_NOUN],
  ["Massive", PLURAL_NOUN],
  ["Smelly", NOUN],
  ["Friendly", NOUN],
  ["Tardy", NOUN],
  ["Evil", NOUN],
  ["Rude", NOUN],
  ["Malicious", NOUN],
  ["Spiteful", NOUN],
  ["Mister", NOUN],
  ["Suspicious", NOUN],
  ["Sopping Wet", PLURAL_NOUN],
  ["Not Too Fond Of", PLURAL_NOUN],
  ["Honk For", PLURAL_NOUN],
  ["Canonically Evil", NOUN],
  ["Limited Edition", NOUN],
  ["Patent Pending", NOUN],
  ["Patented", NOUN],
  ["Space", NOUN],
  ["Defend The", PLURAL_NOUN],
  ["Crime", PLURAL_NOUN],
  ["Anarchist", NOUN],
  ["Garbage", NOUN],
  ["Farting", PLURAL_NOUN],
  ["Suspiciously Textured", NOUN],
  ["Army Of Laser", PLURAL_NOUN],
  ["Republic of", PLURAL_NOUN],
  ["Slippery", NOUN],
  ["Wealthy", PLURAL_NOUN],
  ["Politically Correct", NOUN],
  ["Mall", NOUN],
  ["Certified", NOUN],
  ["Dr", NOUN],
  ["Runaway", NOUN],
  ["Chrome", NOUN],
  ["All New", NOUN],
  ["Top Shelf", PLURAL_NOUN],
  ["Prosumer", NOUN],
  ["Freshly Squeezed", NOUN],
  ["Vine Ripened", NOUN],
  ["Invading", PLURAL_NOUN],
  ["Eau De", NOUN],
  ["Freshly Showered", NOUN],
  ["Loyal To", PLURAL_NOUN],
  ["United States of", NOUN],
  ["United States of", PLURAL_NOUN],
  ["Flowing Rivers of", NOUN],
  ["House of", PLURAL_NOUN],
  ["Suspiciously Shaped", NOUN],
  ["Fishy", NOUN],
  ["Certified Organic", NOUN],
  ["Unregulated", NOUN],

  [NOUN, "For Hire"],
  [PLURAL_NOUN, "That Bite"],
  [PLURAL_NOUN, "in my walls"],
  [PLURAL_NOUN, "Are Opps"],
  [NOUN, "Hotel"],
  [PLURAL_NOUN, "The Movie"],
  [NOUN, "Scholar"],
  [NOUN, "Merchandise"],
  [NOUN, "Connoisseur"],
  [NOUN, "Kardashian"],
  [NOUN, "Consequences"],
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
  [NOUN, "Scientist"],
  [NOUN, "Seeking Missile"],
  [NOUN, "Post Office"],
  [NOUN, "Nationalist"],
  [NOUN, "State"],
  [NOUN, "Duchy"],
  [NOUN, "Ocean"],

  ["Alternate", NOUN, "Universe"],
  ["Let That", NOUN, "In"],
  ["Famous", NOUN, "Collection"],
  ["Supersonic", NOUN, "Spaceship"],
  ["Secret", NOUN, "Agenda"],
  ["Ballistic", NOUN, "Missile"],
  ["The", PLURAL_NOUN, "are SPIES"],
  ["Traveling", NOUN, "Circus"],
  ["The", PLURAL_NOUN, "Lied"],
  ["Casual", NOUN, "Enthusiast"],
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

const nouns = [
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
  "Moron",
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
  "Hater",
  "Opp",
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
];

function isSeedAcceptable(sanitizedSeed: number) {
  const template = names[sanitizedSeed % names.length];
  const noun = nouns[Math.floor(sanitizedSeed / names.length) % nouns.length];

  const totalLength =
    template.map((v) => (v as any)?.length ?? 0).reduce((a, b) => a + b) +
    template.length +
    noun.length;

  return totalLength <= 26;
}
/**
 * Generate a random username based on a numeric seed
 * @param seed - the seed to use to select a username
 * @returns a string suitable for a player username
 */
export function getRandomUsername(seed: number): string {
  //  note: ONLY use prime numbers here
  let sanitizedSeed = Math.floor(
    (seed * 19991) % (names.length * nouns.length),
  );

  while (!isSeedAcceptable(sanitizedSeed)) {
    sanitizedSeed += 1;
  }

  const template = names[sanitizedSeed % names.length];
  const noun = nouns[Math.floor(sanitizedSeed / names.length) % nouns.length];
  const result: [string?] = [];

  //  Convert template to some somewhat-legible word string
  for (const step of template) {
    if (step === PLURAL_NOUN) {
      if (noun.endsWith("s")) result.push(`${noun}es`);
      else {
        result.push(`${noun}s`);
      }
    } else if (step === NOUN) {
      result.push(noun);
    } else {
      result.push(step.toString());
    }
  }

  return result.join(" ");
}
