import { maskProfanity } from "@openfront/shared/ProfanityFilter";
import { UserSettings } from "./UserSettings";

// The viewer-side half of the profanity filter (see ProfanityFilter.ts). The
// game server already masks hate terms for everyone; general profanity
// arrives as typed and is masked here, at display time, unless the viewer has
// turned the filter off in settings.
//
// Display time only: names that feed the simulation (the start info the
// worker runs on) stay exactly as the server sent them, so every client
// simulates the same names whatever its filter setting.

const userSettings = new UserSettings();

// Names are read on every render; the same few dozen repeat for a whole game.
const cache = new Map<string, string>();
const CACHE_LIMIT = 2000;

function masked(name: string): string {
  let out = cache.get(name);
  if (out === undefined) {
    out = maskProfanity(name);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(name, out);
  }
  return out;
}

/** `name` as this viewer should see it. */
export function filterName(name: string): string;
export function filterName(name: string | null): string | null;
export function filterName(name: string | null): string | null {
  if (name === null || name === "") return name;
  if (!userSettings.profanityFilter()) return name;
  return masked(name);
}
