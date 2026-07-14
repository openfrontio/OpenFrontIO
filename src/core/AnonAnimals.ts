// Word bank for anonymous usernames (see genAnonUsername). Each entry is a
// single, memorable animal word that is username-safe on its own (matches
// UsernameSchema's [a-zA-Z0-9_ üÜ.] and, prefixed with "Anon" plus one digit,
// stays under MAX_USERNAME_LENGTH). Kept as recognisable animals with a matching
// emoji so a future cosmetic pass can pair each name with its animal badge.
// Order is irrelevant — genAnonUsername indexes into this by a random value.
export const ANON_ANIMALS: readonly string[] = [
  "Wolf",
  "Fox",
  "Bear",
  "Panda",
  "Koala",
  "Tiger",
  "Lion",
  "Leopard",
  "Cheetah",
  "Jaguar",
  "Otter",
  "Seal",
  "Sloth",
  "Raccoon",
  "Badger",
  "Skunk",
  "Hedgehog",
  "Squirrel",
  "Hamster",
  "Rabbit",
  "Boar",
  "Horse",
  "Zebra",
  "Deer",
  "Moose",
  "Bison",
  "Ram",
  "Goat",
  "Camel",
  "Llama",
  "Giraffe",
  "Elephant",
  "Rhino",
  "Hippo",
  "Gorilla",
  "Orangutan",
  "Monkey",
  "Kangaroo",
  "Bat",
  "Falcon",
  "Eagle",
  "Hawk",
  "Owl",
  "Raven",
  "Swan",
  "Goose",
  "Duck",
  "Chicken",
  "Rooster",
  "Penguin",
  "Flamingo",
  "Peacock",
  "Parrot",
  "Turkey",
  "Dove",
  "Shark",
  "Whale",
  "Dolphin",
  "Orca",
  "Octopus",
  "Squid",
  "Crab",
  "Lobster",
  "Shrimp",
  "Pufferfish",
  "Turtle",
  "Crocodile",
  "Snake",
  "Cobra",
  "Lizard",
  "Gecko",
  "Frog",
  "Bee",
  "Butterfly",
  "Beetle",
  "Ant",
  "Spider",
  "Scorpion",
  "Snail",
  "Ladybug",
];

// "Anon" + animal + optional round number, from a slot index and a per-viewer
// offset (e.g. "AnonWolf", "AnonFox", … then "AnonWolf1" once all 80 are used).
// Consecutive slots map to DISTINCT handles: the 80 animals fill first (round 0
// → a bare name), then the round counts up. So for a fixed offset, two different
// slots can never collide — that is what lets the anonymisation overlay
// guarantee unique names by feeding it join-order slots. The offset rotates
// which animal each slot lands on, so different viewers see a different name for
// the same player. Output is always wire-valid (letters + optional digits).
export function anonAnimalName(slot: number, offset = 0): string {
  const s = Math.abs(Math.trunc(slot));
  const o = Math.abs(Math.trunc(offset));
  const animal = ANON_ANIMALS[(s + o) % ANON_ANIMALS.length];
  const round = Math.floor(s / ANON_ANIMALS.length);
  return round === 0 ? `Anon${animal}` : `Anon${animal}${round}`;
}
