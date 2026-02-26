import { z } from "zod";
import { GameInfo } from "../core/Schemas";
import { GameMode } from "../core/game/Game";

export const PlayerInfoSchema = z.object({
  clientID: z.string().optional(),
  username: z.string().optional(),
  stats: z.unknown().optional(),
});

export type PlayerInfo = z.infer<typeof PlayerInfoSchema>;

export const ExternalGameInfoSchema = z.object({
  info: z
    .object({
      config: z
        .object({
          gameMap: z.string().optional(),
          gameMode: z.string().optional(),
          gameType: z.string().optional(),
          maxPlayers: z.number().optional(),
          playerTeams: z.union([z.number(), z.string()]).optional(),
        })
        .optional(),
      players: z.array(PlayerInfoSchema).optional(),
      winner: z.array(z.string()).optional(),
      duration: z.number().optional(),
      start: z.number().optional(),
      end: z.number().optional(),
      lobbyCreatedAt: z.number().optional(),
    })
    .optional(),
});

export type ExternalGameInfo = z.infer<typeof ExternalGameInfoSchema>;

export type PreviewMeta = {
  title: string;
  description: string;
  image: string;
  joinUrl: string;
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function formatDateTimeParts(timestamp: number): {
  date: string;
  time: string;
} {
  const date = new Date(normalizeTimestamp(timestamp));
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return { date: dateLabel, time: `${timeLabel} UTC` };
}

type WinnerInfo = { names: string; count: number };

function parseWinner(
  winnerArray: string[] | undefined,
  players: PlayerInfo[] | undefined,
): WinnerInfo | undefined {
  if (!winnerArray || winnerArray.length < 2) return undefined;

  const idToName = new Map(
    (players ?? []).map((p) => [p.clientID, p.username]),
  );

  if (winnerArray[0] === "team" && winnerArray.length >= 3) {
    const playerIds = winnerArray.slice(2);
    const names = playerIds.map((id) => idToName.get(id) ?? id).filter(Boolean);
    return names.length > 0
      ? { names: names.join(", "), count: names.length }
      : undefined;
  }

  if (winnerArray[0] === "player" && winnerArray.length >= 2) {
    const clientId = winnerArray[1];
    const name = idToName.get(clientId) ?? clientId;
    return { names: name, count: 1 };
  }

  // Unknown winner format - don't display confusing output
  return undefined;
}

function countActivePlayers(players: PlayerInfo[] | undefined): number {
  return (players ?? []).filter((p) => {
    if (!p || p.stats === null || p.stats === undefined) return false;
    // Count only when `stats` has at least one property.
    if (typeof p.stats === "object") {
      return Object.keys(p.stats as Record<string, unknown>).length > 0;
    }
    return false;
  }).length;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPreview(
  gameID: string,
  origin: string,
  workerPath: string,
  lobby: GameInfo | null,
  publicInfo: ExternalGameInfo | null,
): PreviewMeta {
  const isFinished = !!publicInfo?.info?.end;
  const isPrivate = lobby?.gameConfig?.gameType === "Private";

  // route directly to the correct worker.
  const joinUrl = `${origin}/${workerPath}/game/${gameID}`;

  const config = publicInfo?.info?.config ?? {};
  const players = publicInfo?.info?.players ?? [];

  let activePlayers: number;
  if (isFinished) {
    activePlayers = countActivePlayers(players);
  } else {
    activePlayers =
      countActivePlayers(players) || (lobby?.clients?.length ?? 0);
  }
  const map = lobby?.gameConfig?.gameMap ?? config.gameMap;
  let mode = lobby?.gameConfig?.gameMode ?? config.gameMode ?? GameMode.FFA;
  const playerTeams = lobby?.gameConfig?.playerTeams ?? config.playerTeams;
  const numericTeamCount =
    typeof playerTeams === "number" && playerTeams > 0
      ? playerTeams
      : undefined;

  // For finished games, show "x teams of y". For lobbies, just show "x teams"
  const teamBreakdownLabel = numericTeamCount
    ? isFinished
      ? `${numericTeamCount} teams of ${Math.max(
          1,
          Math.ceil(activePlayers / numericTeamCount),
        )}`
      : `${numericTeamCount} teams`
    : undefined;

  // Format team mode display
  if (mode === "Team" && playerTeams) {
    if (typeof playerTeams === "string") {
      mode = playerTeams; // e.g., "Quads"
    } else if (typeof playerTeams === "number") {
      mode = teamBreakdownLabel ?? `${playerTeams} Teams`;
    }
  }

  const winner = parseWinner(publicInfo?.info?.winner, players);
  const duration = publicInfo?.info?.duration;

  // Normalize map name to match filesystem (lowercase, no spaces or special chars)
  const normalizedMap = map ? map.toLowerCase().replace(/[\s.()]+/g, "") : null;

  const mapThumbnail = normalizedMap
    ? `${origin}/maps/${encodeURIComponent(normalizedMap)}/thumbnail.webp`
    : null;
  const image = mapThumbnail ?? `${origin}/images/GameplayScreenshot.png`;

  const gameType = lobby?.gameConfig?.gameType ?? config.gameType;
  const gameTypeLabel = gameType ? ` (${gameType})` : "";

  const title = isFinished
    ? `${mode ?? "Game"} on ${map ?? "Unknown Map"}${gameTypeLabel}`
    : mode && map
      ? `${mode} on ${map}${gameTypeLabel}`
      : "OpenFront Game";

  let description = "";
  if (isFinished) {
    const parts: string[] = [];
    if (winner) {
      parts.push(`${winner.count > 1 ? "Winners" : "Winner"}: ${winner.names}`);
      parts.push(""); // Extra line break after winner
    }
    const matchTimestamp =
      publicInfo?.info?.start ??
      publicInfo?.info?.end ??
      publicInfo?.info?.lobbyCreatedAt;
    const detailParts: string[] = [];
    const playerCountLabel = `${activePlayers} ${activePlayers === 1 ? "player" : "players"}`;
    detailParts.push(playerCountLabel);
    if (duration !== undefined) detailParts.push(`${formatDuration(duration)}`);
    if (matchTimestamp !== undefined) {
      const dateTime = formatDateTimeParts(matchTimestamp);
      detailParts.push(`${dateTime.date}`);
      detailParts.push(`${dateTime.time}`);
    }
    parts.push(detailParts.join(" • "));
    description = parts.join("\n");
  } else if (lobby) {
    const gc = lobby.gameConfig;

    if (isPrivate) {
      // Private lobby: show detailed game settings
      const sections: string[] = [];

      // Show host
      const hostClient = lobby.clients?.[0];
      if (hostClient?.username) {
        sections.push(`Host: ${hostClient.username}`);
      }

      const gameOptions: string[] = [];

      if (gc?.gameMapSize && gc.gameMapSize !== "Normal") {
        gameOptions.push(`${gc.gameMapSize} Map`);
      }
      if (gc?.infiniteGold) gameOptions.push("Infinite Gold");
      if (gc?.infiniteTroops) gameOptions.push("Infinite Troops");
      if (gc?.instantBuild) gameOptions.push("Instant Build");
      if (gc?.randomSpawn) gameOptions.push("Random Spawn");
      if (gc?.disableNations) gameOptions.push("Nations Disabled");
      if (gc?.donateTroops) gameOptions.push("Troop Donations Enabled");

      if (gameOptions.length > 0) {
        sections.push(`Game Options: ${gameOptions.join(" | ")}`);
      }

      if (Array.isArray(gc?.disabledUnits) && gc.disabledUnits.length > 0) {
        sections.push(
          `Disabled Units: ${gc.disabledUnits.map(String).join(" | ")}`,
        );
      }

      description = sections.join("\n\n");
    } else {
      // Public lobby: basic info
      description = "";
    }
  } else {
    description = `Game ${gameID}`;
  }

  return { title, description, image, joinUrl };
}
