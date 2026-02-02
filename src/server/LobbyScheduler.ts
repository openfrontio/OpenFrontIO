import { GameEnv, ServerConfig } from "../core/configuration/Config";
import {
  Duos,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { GameInfo, GameInfoSchema } from "../core/Schemas";
import { generateID, randomChoice, randomIntInclusive } from "../core/Util";
import { GameConfigOverrides, MapPlaylist, SpecialPreset } from "./MapPlaylist";

type LobbyCategory = "ffa" | "teams" | "special";

type LobbyMeta = { category: LobbyCategory; preset?: SpecialPreset };

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const LOBBY_COVERAGE: Record<LobbyCategory, number> = {
  ffa: 1,
  teams: 1,
  special: 1,
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

    const counts = this.countCurrentCoverage();
    const requests = this.determineNeededLobbies(counts);

    for (const req of requests) {
      await this.scheduleCategoryLobby(req);
    }
  }

  private countCurrentCoverage(): Record<LobbyCategory, number> {
    const counts: Record<LobbyCategory, number> = {
      ffa: 0,
      teams: 0,
      special: 0,
    };

    // Count live lobbies using tracked meta
    for (const [gameID, meta] of this.publicLobbyMeta) {
      if (this.publicLobbyIDs.has(gameID)) {
        counts[meta.category]++;
      } else {
        this.publicLobbyMeta.delete(gameID);
      }
    }

    // Count in-flight spawns so we don't double-schedule
    for (const key of this.spawnInFlight) {
      const [cat] = key.split(":");
      if (cat && cat in counts) {
        counts[cat as LobbyCategory]++;
      }
    }

    return counts;
  }

  private determineNeededLobbies(
    counts: Record<LobbyCategory, number>,
  ): LobbyMeta[] {
    const requests: LobbyMeta[] = [];

    for (const category of Object.keys(LOBBY_COVERAGE) as LobbyCategory[]) {
      if (counts[category] < LOBBY_COVERAGE[category]) {
        requests.push({ category });
      }
    }

    return requests;
  }

  private async fetchLobbies(): Promise<GameInfo[]> {
    const rawLobbies = await this.fetchLobbyData();
    const lobbyInfos = this.transformToGameInfo(rawLobbies);
    this.pruneStaleLobbies(lobbyInfos);
    return lobbyInfos;
  }

  private async fetchLobbyData(): Promise<GameInfo[]> {
    const fetchPromises = [...this.publicLobbyIDs].map((gameID) =>
      this.fetchSingleLobby(gameID),
    );

    const results = await Promise.all(fetchPromises);
    return results.filter((result): result is GameInfo => result !== null);
  }

  private async fetchSingleLobby(gameID: string): Promise<GameInfo | null> {
    const port = this.config.workerPort(gameID);
    try {
      const resp = await fetch(`http://localhost:${port}/api/game/${gameID}`, {
        headers: { [this.config.adminHeader()]: this.config.adminToken() },
        signal: AbortSignal.timeout(5000),
      });
      const json = await resp.json();
      const parsed = GameInfoSchema.safeParse(json);
      if (!parsed.success) {
        this.log.error(`Invalid game info for ${gameID}:`, parsed.error);
        this.publicLobbyIDs.delete(gameID);
        return null;
      }
      return parsed.data;
    } catch (error) {
      this.log.error(`Error fetching game ${gameID}:`, error);
      this.publicLobbyIDs.delete(gameID);
      return null;
    }
  }

  private transformToGameInfo(rawLobbies: GameInfo[]): GameInfo[] {
    return rawLobbies.map((gi) => {
      const meta = this.publicLobbyMeta.get(gi.gameID);
      return {
        gameID: gi.gameID,
        numClients: gi.clients?.length ?? 0,
        gameConfig: gi.gameConfig,
        msUntilStart: gi.msUntilStart,
        publicLobbyCategory: meta?.category,
      } as GameInfo;
    });
  }

  private pruneStaleLobbies(lobbies: GameInfo[]): void {
    for (const lobby of lobbies) {
      const isStartingSoon =
        lobby.msUntilStart !== undefined && lobby.msUntilStart <= 250;
      const isFull =
        lobby.gameConfig?.maxPlayers !== undefined &&
        lobby.numClients !== undefined &&
        lobby.gameConfig.maxPlayers <= lobby.numClients;

      if (isStartingSoon || isFull) {
        this.publicLobbyIDs.delete(lobby.gameID);
        this.publicLobbyMeta.delete(lobby.gameID);
      }
    }
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

function buildOverridesForCategory(
  config: ServerConfig,
  category: LobbyCategory,
  preset?: SpecialPreset,
): GameConfigOverrides {
  const teamsConfig = () => ({
    mode: GameMode.Team,
    playerTeams: randomChoice([
      randomIntInclusive(2, 7),
      Duos,
      Trios,
      Quads,
      HumansVsNations,
    ]),
  });

  switch (category) {
    case "ffa":
      return {
        mode: GameMode.FFA,
        lobbyStartDelayMs: envAdjustedDelay(config, 45_000),
      };
    case "teams":
      return {
        ...teamsConfig(),
        lobbyStartDelayMs: envAdjustedDelay(config, 120_000),
      };
    case "special":
    default:
      if (Math.random() < 0.5) {
        return {
          ...teamsConfig(),
          specialPreset: preset,
          ensureSpecialModifier: true,
          lobbyStartDelayMs: envAdjustedDelay(config, 120_000),
          maxPlayersScale: 0.5,
        };
      }
      return {
        mode: GameMode.FFA,
        specialPreset: preset,
        ensureSpecialModifier: true,
        lobbyStartDelayMs: envAdjustedDelay(config, 120_000),
        maxPlayersScale: 0.5,
      };
  }
}

function envAdjustedDelay(config: ServerConfig, ms: number): number {
  if (config.env() === GameEnv.Dev) {
    return Math.max(1000, Math.round(ms * 0.05));
  }
  return ms;
}
