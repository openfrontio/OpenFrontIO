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

// Map any integer to a memorable anonymous handle: "Anon" + animal + 3 digits
// (e.g. "AnonWolf042"). 80 animals × 1000 = 80,000 distinct handles. Same hash
// derivation as the old tribe-name scheme (animal from the low part, number from
// the high part), so it's deterministic in `hash` and stays wire-valid
// (UsernameSchema, under MAX_USERNAME_LENGTH). Shared by the server-side
// anonymisation overlay (anonymousUsername) and the client fallback
// (genAnonUsername) so both read identically.
export function anonAnimalName(hash: number): string {
  const h = Math.abs(Math.trunc(hash));
  const animal = ANON_ANIMALS[h % ANON_ANIMALS.length];
  const number = Math.floor(h / ANON_ANIMALS.length) % 1000;
  return `Anon${animal}${number.toString().padStart(3, "0")}`;
}
