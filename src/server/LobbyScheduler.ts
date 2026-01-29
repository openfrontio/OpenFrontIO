import { GameEnv, ServerConfig } from "../core/configuration/Config";
import {
  Duos,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import { GameConfigOverrides, MapPlaylist, SpecialPreset } from "./MapPlaylist";

type LobbyCategory = "ffa" | "teams" | "hvn" | "special";

type LobbyMeta = { category: LobbyCategory; preset?: SpecialPreset };

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export class LobbyScheduler {
  private publicLobbyIDs: Set<string> = new Set();
  private publicLobbyMeta: Map<string, LobbyMeta> = new Map();
  private spawnInFlight: Set<string> = new Set();

  constructor(
    private config: ServerConfig,
    private playlist: MapPlaylist,
    private log: Logger,
    private onLobbiesUpdate: (lobbies: GameInfo[]) => void,
  ) {}

  async ensureCategoryCoverage(): Promise<void> {
    const lobbyInfos = await this.fetchLobbies();
    this.onLobbiesUpdate(lobbyInfos);

    const desired = {
      ffa: 1,
      teams: 1,
      hvn: 1,
    };

    const specialPresets = getDesiredSpecialPresets();

    const counts = initialCoverageCounts();

    // Count live lobbies using tracked meta (more reliable than categorising)
    this.publicLobbyMeta.forEach((meta, gameID) => {
      if (this.publicLobbyIDs.has(gameID)) {
        incrementCoverage(counts, meta);
      } else {
        this.publicLobbyMeta.delete(gameID);
      }
    });

    // Count in-flight spawns so we don't double-schedule
    this.spawnInFlight.forEach((key) => {
      const [cat, preset] = key.split(":");
      incrementCoverage(
        counts,
        cat
          ? { category: cat as LobbyCategory, preset: preset as SpecialPreset }
          : null,
      );
    });

    const requests: LobbyMeta[] = [];

    if (counts.ffa < desired.ffa) requests.push({ category: "ffa" });
    if (counts.teams < desired.teams) requests.push({ category: "teams" });
    if (counts.hvn < desired.hvn) requests.push({ category: "hvn" });

    if (specialPresets.length > 0) {
      specialPresets.forEach((preset) => {
        if ((counts.specialByPreset[preset] ?? 0) < 1) {
          requests.push({ category: "special", preset });
        }
      });
    } else if (counts.special < 1) {
      requests.push({ category: "special" });
    }

    for (const req of requests) {
      await this.scheduleCategoryLobby(req);
    }
  }

  private async fetchLobbies(): Promise<GameInfo[]> {
    const fetchPromises: Promise<GameInfo | null>[] = [];

    for (const gameID of new Set(this.publicLobbyIDs)) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000); // 5 second timeout
      const port = this.config.workerPort(gameID);
      const promise = fetch(`http://localhost:${port}/api/game/${gameID}`, {
        headers: { [this.config.adminHeader()]: this.config.adminToken() },
        signal: controller.signal,
      })
        .then((resp) => resp.json())
        .then((json) => {
          return json as GameInfo;
        })
        .catch((error) => {
          this.log.error(`Error fetching game ${gameID}:`, error);
          // Return null or a placeholder if fetch fails
          this.publicLobbyIDs.delete(gameID);
          return null;
        });

      fetchPromises.push(promise);
    }

    // Wait for all promises to resolve
    const results = await Promise.all(fetchPromises);

    // Filter out any null results from failed fetches
    const lobbyInfos: GameInfo[] = results
      .filter((result) => result !== null)
      .map((gi: GameInfo) => {
        return {
          gameID: gi.gameID,
          numClients: gi?.clients?.length ?? 0,
          gameConfig: gi.gameConfig,
          msUntilStart: gi.msUntilStart,
        } as GameInfo;
      });

    lobbyInfos.forEach((l) => {
      if (
        "msUntilStart" in l &&
        l.msUntilStart !== undefined &&
        l.msUntilStart <= 250
      ) {
        this.publicLobbyIDs.delete(l.gameID);
        this.publicLobbyMeta.delete(l.gameID);
        return;
      }

      if (
        "gameConfig" in l &&
        l.gameConfig !== undefined &&
        "maxPlayers" in l.gameConfig &&
        l.gameConfig.maxPlayers !== undefined &&
        "numClients" in l &&
        l.numClients !== undefined &&
        l.gameConfig.maxPlayers <= l.numClients
      ) {
        this.publicLobbyIDs.delete(l.gameID);
        this.publicLobbyMeta.delete(l.gameID);
        return;
      }
    });

    return lobbyInfos;
  }

  private async scheduleCategoryLobby(request: LobbyMeta) {
    const key = `${request.category}:${request.preset ?? "any"}`;
    if (this.spawnInFlight.has(key)) return;

    this.spawnInFlight.add(key);
    try {
      const overrides = buildOverridesForCategory(
        this.config,
        request.category,
        request.preset,
      );
      const gameID = await this.schedulePublicGame(overrides);
      this.publicLobbyMeta.set(gameID, {
        category: request.category,
        preset: request.preset,
      });
    } catch (error) {
      this.log.error(`Error scheduling lobby for ${key}:`, error);
    } finally {
      this.spawnInFlight.delete(key);
    }
  }

  private async schedulePublicGame(
    overrides?: GameConfigOverrides,
  ): Promise<string> {
    const gameID = generateID();
    this.publicLobbyIDs.add(gameID);

    try {
      const response = await fetch(
        `http://localhost:${this.config.workerPort(gameID)}/api/create_game/${gameID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [this.config.adminHeader()]: this.config.adminToken(),
          },
          body: JSON.stringify(await this.playlist.gameConfig(overrides)),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to schedule public game: ${response.statusText}`,
        );
      }
      return gameID;
    } catch (error) {
      this.log.error(
        `Failed to schedule public game on worker ${this.config.workerPath(gameID)}:`,
        error,
      );
      throw error;
    }
  }
}

function initialCoverageCounts() {
  return {
    ffa: 0,
    teams: 0,
    hvn: 0,
    special: 0,
    specialByPreset: {
      compact: 0,
      startingGold: 0,
      randomSpawn: 0,
      crowded: 0,
    } as Record<SpecialPreset, number>,
  };
}

function incrementCoverage(
  counts: ReturnType<typeof initialCoverageCounts>,
  category: LobbyMeta | null,
) {
  if (!category) return;
  switch (category.category) {
    case "ffa":
      counts.ffa += 1;
      return;
    case "teams":
      counts.teams += 1;
      return;
    case "hvn":
      counts.hvn += 1;
      return;
    case "special":
      counts.special += 1;
      if (category.preset) {
        counts.specialByPreset[category.preset] =
          (counts.specialByPreset[category.preset] ?? 0) + 1;
      }
      return;
    default:
      return;
  }
}

function buildOverridesForCategory(
  config: ServerConfig,
  category: LobbyCategory,
  preset?: SpecialPreset,
): GameConfigOverrides {
  switch (category) {
    case "ffa":
      return {
        mode: GameMode.FFA,
        lobbyStartDelayMs: envAdjustedDelay(config, 45_000),
      };
    case "teams":
      return {
        mode: GameMode.Team,
        playerTeams: randomChoice([
          randomIntInclusive(2, 7),
          Duos,
          Trios,
          Quads,
        ]),
        lobbyStartDelayMs: envAdjustedDelay(config, 120_000),
      };
    case "hvn":
      return {
        mode: GameMode.Team,
        playerTeams: HumansVsNations,
        disableSpecialModifiers: true,
        lobbyStartDelayMs: envAdjustedDelay(config, 120_000),
      };
    case "special":
    default:
      return {
        specialPreset: preset,
        ensureSpecialModifier: true,
        lobbyStartDelayMs: envAdjustedDelay(config, 120_000),
      };
  }
}

function getDesiredSpecialPresets(): SpecialPreset[] {
  const raw = process.env.SPECIAL_PRESET_VARIANTS;
  if (!raw) {
    return ["compact"];
  }

  if (raw.toLowerCase().trim() === "none") return [];

  const presets = new Set<SpecialPreset>();
  raw.split(",").forEach((item) => {
    const normalized = normaliseSpecialPreset(item);
    if (normalized) presets.add(normalized);
  });

  return Array.from(presets);
}

function normaliseSpecialPreset(value: string): SpecialPreset | null {
  const trimmed = value.trim().toLowerCase();
  switch (trimmed) {
    case "compact":
    case "compact_map":
      return "compact";
    case "startinggold":
    case "starting_gold":
    case "gold":
      return "startingGold";
    case "random":
    case "randomspawn":
    case "random_spawn":
      return "randomSpawn";
    case "crowded":
      return "crowded";
    default:
      return null;
  }
}

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function envAdjustedDelay(config: ServerConfig, ms: number): number {
  if (config.env() === GameEnv.Dev) {
    return Math.max(1000, Math.round(ms * 0.1));
  }
  return ms;
}
