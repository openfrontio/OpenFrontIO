import {
  Duos,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../../core/game/Game";
import { PublicGameInfo, PublicGames } from "../../core/Schemas";

/**
 * Filtering, sorting and saved-profile logic for the "More Games" lobby
 * browser. Kept free of Lit and of translation lookups so it can be unit
 * tested directly; the component passes in a map-name resolver for the
 * alphabetical sort.
 */

export type LobbyModeFilter = "ffa" | "teams" | "hvn";
export type LobbySourceFilter = "public" | "hosted";

export type SortKey =
  | "starts_soonest"
  | "players_desc"
  | "players_asc"
  | "capacity_desc"
  | "capacity_asc"
  | "map_asc";

export const SORT_KEYS: SortKey[] = [
  "starts_soonest",
  "players_desc",
  "players_asc",
  "capacity_desc",
  "capacity_asc",
  "map_asc",
];

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
  sort: SortKey;
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
  sort: "starts_soonest",
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

/** Sort comparator. `mapName` resolves the display name for the map sort. */
function compare(
  a: PublicGameInfo,
  b: PublicGameInfo,
  sort: SortKey,
  mapName: (lobby: PublicGameInfo) => string,
): number {
  const factsA = lobbyFacts(a);
  const factsB = lobbyFacts(b);

  switch (sort) {
    case "starts_soonest": {
      // Lobbies without a countdown (hosted, or the next one queued behind the
      // active lobby) sort last — they have no known start time.
      if (a.startsAt === undefined && b.startsAt === undefined) break;
      if (a.startsAt === undefined) return 1;
      if (b.startsAt === undefined) return -1;
      if (a.startsAt !== b.startsAt) return a.startsAt - b.startsAt;
      break;
    }
    case "players_desc":
      if (factsA.joined !== factsB.joined) return factsB.joined - factsA.joined;
      break;
    case "players_asc":
      if (factsA.joined !== factsB.joined) return factsA.joined - factsB.joined;
      break;
    case "capacity_desc":
    case "capacity_asc": {
      const capA = factsA.capacity;
      const capB = factsB.capacity;
      if (capA === null && capB === null) break;
      if (capA === null) return 1;
      if (capB === null) return -1;
      if (capA !== capB) {
        return sort === "capacity_desc" ? capB - capA : capA - capB;
      }
      break;
    }
    case "map_asc": {
      const cmp = mapName(a).localeCompare(mapName(b));
      if (cmp !== 0) return cmp;
      break;
    }
  }
  // Stable tie-break so rows don't shuffle between socket updates.
  return a.gameID < b.gameID ? -1 : a.gameID > b.gameID ? 1 : 0;
}

export function filterAndSortLobbies(
  lobbies: PublicGameInfo[],
  filters: LobbyFilters,
  mapName: (lobby: PublicGameInfo) => string = () => "",
): PublicGameInfo[] {
  return lobbies
    .filter((lobby) => matchesFilters(lobby, filters))
    .sort((a, b) => compare(a, b, filters.sort, mapName));
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
  const sort = SORT_KEYS.includes(input.sort as SortKey)
    ? (input.sort as SortKey)
    : DEFAULT_FILTERS.sort;
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
    sort,
  };
}

export function loadFilterProfiles(): Record<string, LobbyFilters> {
  let parsed: unknown;
  try {
    const stored = localStorage.getItem(FILTER_PROFILES_KEY);
    if (stored === null) return {};
    parsed = JSON.parse(stored);
  } catch (error) {
    console.warn("Failed to read saved lobby filter profiles", error);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const profiles: Record<string, LobbyFilters> = {};
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
    !(trimmed in profiles) &&
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
  if (!(name in profiles)) return profiles;
  delete profiles[name];
  persistProfiles(profiles);
  return profiles;
}
