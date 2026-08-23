import {
  Duos,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../../core/game/Game";
import { PublicGameInfo, PublicGames } from "../../core/Schemas";

/**
 * Filtering, ordering and saved-profile logic for the Detailed View lobby
 * browser. Kept free of Lit and of translation lookups so it can be unit
 * tested directly.
 */

export type LobbyModeFilter = "ffa" | "teams" | "hvn";
export type LobbySourceFilter = "public" | "hosted";

export const LOBBY_MODES: LobbyModeFilter[] = ["ffa", "teams", "hvn"];
export const LOBBY_SOURCES: LobbySourceFilter[] = ["public", "hosted"];

/**
 * Team layouts a lobby can advertise: the three named formats plus the
 * numeric team counts the lobby config allows. Named formats describe the
 * players *per team*; numeric ones describe the number of teams.
 */
export const NAMED_TEAM_CONFIGS = [Duos, Trios, Quads] as const;
export const NUMERIC_TEAM_CONFIGS = ["2", "3", "4", "5", "6", "7", "8"];
export const TEAM_CONFIGS: string[] = [
  ...NAMED_TEAM_CONFIGS,
  ...NUMERIC_TEAM_CONFIGS,
];

export interface LobbyFilters {
  /** Empty array means "no restriction" for every multi-select below. */
  modes: LobbyModeFilter[];
  sources: LobbySourceFilter[];
  teamConfigs: string[];
  hideEmpty: boolean;
  minJoined: number | null;
  maxJoined: number | null;
  minCapacity: number | null;
  maxCapacity: number | null;
  minTeamSize: number | null;
  maxTeamSize: number | null;
}

export const DEFAULT_FILTERS: LobbyFilters = {
  modes: [],
  sources: [],
  teamConfigs: [],
  hideEmpty: false,
  minJoined: null,
  maxJoined: null,
  minCapacity: null,
  maxCapacity: null,
  minTeamSize: null,
  maxTeamSize: null,
};

/** Everything the browser derives from a lobby to filter, sort and display it. */
export interface LobbyFacts {
  mode: LobbyModeFilter;
  source: LobbySourceFilter;
  joined: number;
  capacity: number | null;
  /** Named format ("Duos") or team count as a string ("5"); null for FFA/HvN. */
  teamConfig: string | null;
  teamCount: number | null;
  teamSize: number | null;
}

const NAMED_TEAM_SIZES: Record<string, number> = {
  [Duos]: 2,
  [Trios]: 3,
  [Quads]: 4,
};

export function lobbyFacts(lobby: PublicGameInfo): LobbyFacts {
  const config = lobby.gameConfig;
  const capacity = config?.maxPlayers ?? null;
  const playerTeams = config?.playerTeams;

  const source: LobbySourceFilter =
    lobby.publicGameType === "hosted" ? "hosted" : "public";
  const joined = lobby.numClients ?? 0;

  if (config?.gameMode !== GameMode.Team) {
    return {
      mode: "ffa",
      source,
      joined,
      capacity,
      teamConfig: null,
      teamCount: null,
      teamSize: null,
    };
  }

  if (playerTeams === HumansVsNations) {
    return {
      mode: "hvn",
      source,
      joined,
      capacity,
      teamConfig: null,
      teamCount: null,
      teamSize: null,
    };
  }

  let teamConfig: string | null = null;
  let teamCount: number | null = null;
  let teamSize: number | null = null;

  if (typeof playerTeams === "number") {
    teamConfig = String(playerTeams);
    teamCount = playerTeams;
    teamSize =
      capacity !== null && playerTeams > 0
        ? Math.floor(capacity / playerTeams)
        : null;
  } else if (typeof playerTeams === "string") {
    const size = NAMED_TEAM_SIZES[playerTeams];
    if (size !== undefined) {
      teamConfig = playerTeams;
      teamSize = size;
      teamCount = capacity !== null ? Math.floor(capacity / size) : null;
    }
  }

  return {
    mode: "teams",
    source,
    joined,
    capacity,
    teamConfig,
    teamCount,
    teamSize,
  };
}

/** Every lobby the server currently advertises, across all buckets. */
export function flattenLobbies(games: PublicGames["games"] | undefined) {
  if (!games) return [];
  return Object.values(games)
    .flat()
    .filter((lobby): lobby is PublicGameInfo => lobby !== undefined);
}

function withinRange(
  value: number | null,
  min: number | null,
  max: number | null,
): boolean {
  // A lobby that doesn't advertise the value can't be proven to match, so an
  // active bound excludes it rather than silently letting it through.
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function matchesFilters(
  lobby: PublicGameInfo,
  filters: LobbyFilters,
): boolean {
  const facts = lobbyFacts(lobby);

  if (filters.modes.length > 0 && !filters.modes.includes(facts.mode)) {
    return false;
  }
  if (filters.sources.length > 0 && !filters.sources.includes(facts.source)) {
    return false;
  }
  if (filters.teamConfigs.length > 0) {
    if (facts.teamConfig === null) return false;
    if (!filters.teamConfigs.includes(facts.teamConfig)) return false;
  }
  if (filters.hideEmpty && facts.joined === 0) return false;
  if (!withinRange(facts.joined, filters.minJoined, filters.maxJoined)) {
    return false;
  }
  if (!withinRange(facts.capacity, filters.minCapacity, filters.maxCapacity)) {
    return false;
  }
  if (!withinRange(facts.teamSize, filters.minTeamSize, filters.maxTeamSize)) {
    return false;
  }
  return true;
}

/**
 * Lobby order: soonest countdown first, then the lobbies still queued behind
 * it. Ties keep the order the server sent, which is the master's queue order
 * (oldest first) — Array.prototype.sort is stable, so returning 0 is enough.
 * Comparing gameIDs here would scramble the queue, since ids are random.
 */
function compare(a: PublicGameInfo, b: PublicGameInfo): number {
  // A lobby without a countdown hasn't reached the front of its queue yet
  // (or is hosted, and starts when its host says so), so it sorts last.
  if (a.startsAt === undefined && b.startsAt === undefined) return 0;
  if (a.startsAt === undefined) return 1;
  if (b.startsAt === undefined) return -1;
  return a.startsAt - b.startsAt;
}

export function filterAndSortLobbies(
  lobbies: PublicGameInfo[],
  filters: LobbyFilters,
): PublicGameInfo[] {
  return lobbies
    .filter((lobby) => matchesFilters(lobby, filters))
    .sort(compare);
}

/**
 * How far back each waiting lobby sits in its bucket's queue, 1-based, where 1
 * is the lobby directly behind the one counting down. The counting-down lobby
 * itself isn't in the map — it shows its countdown instead — and neither are
 * hosted lobbies, which aren't queued at all. Positions come from the
 * *unfiltered* list so hiding a lobby with a filter doesn't renumber the ones
 * still shown, and are counted per bucket, since each bucket has its own queue.
 */
export function queuePositions(lobbies: PublicGameInfo[]): Map<string, number> {
  const positions = new Map<string, number>();
  const buckets = new Map<string, PublicGameInfo[]>();
  for (const lobby of lobbies) {
    const type = lobby.publicGameType;
    if (type === undefined || type === "hosted") continue;
    if (lobby.startsAt !== undefined) continue;
    const bucket = buckets.get(type);
    if (bucket === undefined) buckets.set(type, [lobby]);
    else bucket.push(lobby);
  }
  for (const bucket of buckets.values()) {
    // Already in the server's queue order; compare() would treat them all as
    // ties anyway, so no sort is needed here.
    bucket.forEach((lobby, index) => positions.set(lobby.gameID, index + 1));
  }
  return positions;
}

// ---- Saved filter profiles ----

export const FILTER_PROFILES_KEY = "detailed-view-filter-profiles";
export const MAX_FILTER_PROFILES = 20;
export const MAX_PROFILE_NAME_LENGTH = 32;

function toStringArray(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string"))]
    .filter((v) => allowed.includes(v))
    .sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
}

function toBound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded < 0 ? null : rounded;
}

/**
 * Coerce untrusted input (localStorage, older builds) into a usable filter
 * set, falling back to the default for anything unrecognized.
 */
export function normalizeFilters(raw: unknown): LobbyFilters {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_FILTERS };
  const input = raw as Record<string, unknown>;
  return {
    modes: toStringArray(input.modes, LOBBY_MODES) as LobbyModeFilter[],
    sources: toStringArray(input.sources, LOBBY_SOURCES) as LobbySourceFilter[],
    teamConfigs: toStringArray(input.teamConfigs, TEAM_CONFIGS),
    hideEmpty: input.hideEmpty === true,
    minJoined: toBound(input.minJoined),
    maxJoined: toBound(input.maxJoined),
    minCapacity: toBound(input.minCapacity),
    maxCapacity: toBound(input.maxCapacity),
    minTeamSize: toBound(input.minTeamSize),
    maxTeamSize: toBound(input.maxTeamSize),
  };
}

/**
 * Profiles are keyed by a user-typed name, so the record is prototype-less:
 * on a plain object `profiles["__proto__"] = …` sets the prototype instead of
 * storing the profile, and `"toString" in profiles` is true for a name nobody
 * saved.
 */
function emptyProfiles(): Record<string, LobbyFilters> {
  return Object.create(null) as Record<string, LobbyFilters>;
}

/** Own-property check, so inherited names aren't mistaken for saved profiles. */
export function hasFilterProfile(
  profiles: Record<string, LobbyFilters>,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(profiles, name);
}

export function loadFilterProfiles(): Record<string, LobbyFilters> {
  let parsed: unknown;
  try {
    const stored = localStorage.getItem(FILTER_PROFILES_KEY);
    if (stored === null) return emptyProfiles();
    parsed = JSON.parse(stored);
  } catch (error) {
    console.warn("Failed to read saved lobby filter profiles", error);
    return emptyProfiles();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyProfiles();
  }
  const profiles = emptyProfiles();
  for (const [name, value] of Object.entries(parsed)) {
    profiles[name] = normalizeFilters(value);
  }
  return profiles;
}

function persistProfiles(profiles: Record<string, LobbyFilters>) {
  try {
    localStorage.setItem(FILTER_PROFILES_KEY, JSON.stringify(profiles));
  } catch (error) {
    console.warn("Failed to save lobby filter profiles", error);
  }
}

/**
 * Save (or overwrite) a profile. Returns the new profile set; the write is
 * ignored when the name is blank or the cap is already reached by other names.
 */
export function saveFilterProfile(
  name: string,
  filters: LobbyFilters,
): Record<string, LobbyFilters> {
  const trimmed = name.trim().slice(0, MAX_PROFILE_NAME_LENGTH);
  const profiles = loadFilterProfiles();
  if (trimmed === "") return profiles;
  if (
    !hasFilterProfile(profiles, trimmed) &&
    Object.keys(profiles).length >= MAX_FILTER_PROFILES
  ) {
    return profiles;
  }
  profiles[trimmed] = normalizeFilters(filters);
  persistProfiles(profiles);
  return profiles;
}

export function deleteFilterProfile(
  name: string,
): Record<string, LobbyFilters> {
  const profiles = loadFilterProfiles();
  if (!hasFilterProfile(profiles, name)) return profiles;
  delete profiles[name];
  persistProfiles(profiles);
  return profiles;
}
