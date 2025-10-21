import { simpleHash } from "../Util"

const PLURAL_NOUN = Symbol("plural!")
const NOUN = Symbol("noun!")

const names = [
    ["World Famous", NOUN],
    ["Comically Large", NOUN],
    ["Comically Small", NOUN],
    ["Clearance Aisle", PLURAL_NOUN],
    [NOUN, "For Hire"],
    ["Suspicious", NOUN],
    ["Sopping Wet", PLURAL_NOUN],
    ["Smelly", NOUN],
    ["Friendly", NOUN],
    ["Tardy", NOUN],
    ["Evil", NOUN],
    [PLURAL_NOUN, "That Bite"],
    ["Malicious", NOUN],
    ["Spiteful", NOUN],
    ["Mister", NOUN],
    ["Alternate", NOUN,"Universe"],
    [NOUN, "Island"],
    [NOUN, "Kingdom"],
    [NOUN, "Empire"],
    [NOUN, "Dynasty"],
    [NOUN, "Cartel"],
    [NOUN, "Cabal"],
    ["Not Too Fond Of", PLURAL_NOUN],
    ["Honk For", PLURAL_NOUN],
    ["Canonically Evil", NOUN],
    ["Limited Edition", NOUN],
    [NOUN, "Scientist"],
    ["Famous", NOUN, "Collection"],
    ["Supersonic", NOUN, "Spaceship"],
    ["Patent Pending", NOUN],
    ["Patented", NOUN],
    ["Space", NOUN],
    ["Secret", NOUN, "Agenda"],
    [PLURAL_NOUN, "in my walls"],
    ["The", PLURAL_NOUN, "are SPIES"],
    ["Traveling", NOUN, "Circus"]
]

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
]

function isSeedAcceptable(sanitizedSeed: number) {
    let template = names[sanitizedSeed % names.length];
    let noun = nouns[Math.floor(sanitizedSeed / names.length) % nouns.length];

    let totalLength = 
        template.map((v) => ((v as any)?.length ?? 0)).reduce((a,b) => a + b)
        + template.length
        + noun.length;

    return totalLength <= 26
}
/**
 * Generate a random username based on a numeric seed
 * @param seed - the seed to use to select a username
 * @returns a string suitable for a player username
 */
export function getRandomUsername(seed: number) : string {
    let sanitizedSeed = Math.floor((seed * 2999) % (names.length * nouns.length));
    let template = names[sanitizedSeed % names.length];
    let noun = nouns[Math.floor(sanitizedSeed / names.length) % nouns.length];
    let result: [string?] = [];

    while (!isSeedAcceptable(sanitizedSeed)) {
        sanitizedSeed += 1;
    }

    //  Convert template to some somewhat-legible word string
    for (let step of template) {
        if (step == PLURAL_NOUN) {
            result.push(`${noun}s`);
        } else if (step == NOUN) {
            result.push(noun);
        } else {
            result.push(step.toString());
        }
    }

    return result.join(" ")
}