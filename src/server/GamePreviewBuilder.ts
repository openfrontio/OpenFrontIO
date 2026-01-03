import { GameInfo } from "../core/Schemas";
import { GameMode } from "../core/game/Game";

type PlayerInfo = {
  clientID?: string;
  username?: string;
  stats?: unknown;
};

export type ExternalGameInfo = {
  info?: {
    config?: {
      gameMap?: string;
      gameMode?: string;
      gameType?: string;
      maxPlayers?: number;
      playerTeams?: number | string;
    };
    players?: PlayerInfo[];
    winner?: string[];
    duration?: number;
    start?: number;
    end?: number;
    lobbyCreatedAt?: number;
  };
};

export type PreviewMeta = {
  title: string;
  description: string;
  image: string;
  joinUrl: string;
  redirectUrl: string;
};

function formatDuration(seconds: number): string {
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
    return true;
  }).length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/</g, "\\x3c")
    .replace(/\//g, "\\/");
}

export function buildPreview(
  gameID: string,
  origin: string,
  lobby: GameInfo | null,
  publicInfo: ExternalGameInfo | null,
): PreviewMeta {
  const isFinished = !!publicInfo?.info?.end;
  const isPrivate = lobby?.gameConfig?.gameType === "Private";

  // Build URLs with state parameter
  let joinUrl = `${origin}/game/${gameID}`;
  let redirectUrl = joinUrl;

  if (!isFinished && isPrivate) {
    joinUrl = `${joinUrl}?lobby`;
  } else if (isFinished) {
    redirectUrl = `${redirectUrl}?replay`;
  }

  const config = publicInfo?.info?.config ?? {};
  const players = publicInfo?.info?.players ?? [];

  let activePlayers: number;
  if (isFinished) {
    activePlayers = countActivePlayers(players);
  } else {
    activePlayers =
      countActivePlayers(players) ||
      (lobby?.numClients ?? lobby?.clients?.length ?? 0);
  }
  const maxPlayers = lobby?.gameConfig?.maxPlayers ?? config.maxPlayers;
  const map = lobby?.gameConfig?.gameMap ?? config.gameMap;
  let mode = lobby?.gameConfig?.gameMode ?? config.gameMode ?? GameMode.FFA;
  const playerTeams = lobby?.gameConfig?.playerTeams ?? config.playerTeams;
  const numericTeamCount =
    typeof playerTeams === "number" && playerTeams > 0
      ? playerTeams
      : undefined;
  const teamBreakdownLabel = numericTeamCount
    ? `${numericTeamCount} teams of ${Math.max(
        1,
        Math.ceil(activePlayers / numericTeamCount),
      )}`
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

  const mapThumbnail = map
    ? `${origin}/maps/${encodeURIComponent(
        map
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/[^a-z0-9]/g, ""),
      )}/thumbnail.webp`
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
    const playerCountLabel =
      maxPlayers !== undefined
        ? `${activePlayers}/${maxPlayers}`
        : `${activePlayers}`;
    detailParts.push(`Players: ${playerCountLabel}`);
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

  return { title, description, image, joinUrl, redirectUrl };
}

export function renderPreview(
  meta: PreviewMeta,
  joinId: string,
  botRequest: boolean,
): string {
  const refreshTag = botRequest
    ? ""
    : `<meta http-equiv="refresh" content="0; url=${escapeHtml(meta.redirectUrl)}">`;

  const redirectScript = botRequest
    ? ""
    : `<script>window.location.replace("${escapeJsString(meta.redirectUrl)}");</script>`;

  const fullDescription = escapeHtml(meta.description || meta.title);

  // Parse description sections for structured rendering
  const descriptionLines = meta.description.split("\n");
  let descriptionHtml = "";

  if (descriptionLines.length > 1) {
    // Multi-line structured format (private lobby)
    descriptionHtml = descriptionLines
      .map((line) => {
        if (line.startsWith("Game Options:")) {
          const options = line
            .replace("Game Options: ", "")
            .split(" | ")
            .map(
              (opt) => `<span class="badge">${escapeHtml(opt.trim())}</span>`,
            )
            .join("");
          return `<div class="section"><div class="section-title">Game Options</div><div class="badges">${options}</div></div>`;
        } else if (line.startsWith("Disabled Units:")) {
          const units = line
            .replace("Disabled Units: ", "")
            .split(" | ")
            .map(
              (unit) =>
                `<span class="badge badge-disabled">${escapeHtml(unit.trim())}</span>`,
            )
            .join("");
          return `<div class="section"><div class="section-title">Disabled Units</div><div class="badges">${units}</div></div>`;
        }
        return `<p>${escapeHtml(line)}</p>`;
      })
      .join("");
  } else {
    descriptionHtml = `<p class="simple-desc">${escapeHtml(meta.description)}</p>`;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(meta.title)}</title>
    <link rel="canonical" href="${escapeHtml(meta.joinUrl)}" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${fullDescription}" />
    <meta property="og:image" content="${escapeHtml(meta.image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeHtml(meta.image)}" />
    <meta name="twitter:image:width" content="1200" />
    <meta name="twitter:image:height" content="630" />
    <meta name="twitter:description" content="${fullDescription}" />
    <meta name="description" content="${fullDescription}" />
    <meta property="og:site_name" content="OpenFront" />
    <meta property="og:url" content="${escapeHtml(meta.joinUrl)}" />
    <meta property="og:type" content="website" />
    ${refreshTag}
    <style>
      * { box-sizing: border-box; }
      body { 
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); 
        color: #e2e8f0; 
        margin: 0; 
        padding: 1.5rem; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        min-height: 100vh; 
      }
      .card { 
        background: linear-gradient(to bottom, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9));
        backdrop-filter: blur(10px);
        border: 1px solid rgba(148, 163, 184, 0.1);
        border-radius: 16px; 
        padding: 2rem; 
        max-width: 800px; 
        width: 100%;
        min-width: 420px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
      }
      h1 { 
        margin: 0 0 1.5rem; 
        font-size: 1.5rem; 
        font-weight: 700; 
        color: #f1f5f9;
        letter-spacing: -0.025em;
      }
      .simple-desc { 
        margin: 0 0 1.5rem; 
        line-height: 1.6; 
        color: #cbd5e1;
        font-size: 0.95rem;
      }
      .section { 
        margin-bottom: 1.25rem; 
        padding: 1rem;
        background: rgba(15, 23, 42, 0.5);
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.08);
      }
      .section-title { 
        font-size: 0.75rem; 
        font-weight: 600; 
        text-transform: uppercase; 
        letter-spacing: 0.05em; 
        color: #94a3b8; 
        margin-bottom: 0.75rem; 
      }
      .badges { 
        display: flex; 
        flex-wrap: wrap; 
        gap: 0.5rem; 
      }
      .badge { 
        display: inline-flex;
        align-items: center;
        padding: 0.4rem 0.75rem; 
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(37, 99, 235, 0.15));
        border: 1px solid rgba(59, 130, 246, 0.3);
        color: #93c5fd; 
        border-radius: 6px; 
        font-size: 0.85rem; 
        font-weight: 500;
        white-space: nowrap;
      }
      .badge-disabled { 
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.15));
        border-color: rgba(239, 68, 68, 0.3);
        color: #fca5a5; 
      }
      .cta { 
        margin-top: 1.5rem; 
        padding: 0.875rem 1.5rem; 
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white; 
        text-align: center; 
        border-radius: 8px; 
        font-weight: 600; 
        font-size: 0.95rem;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        letter-spacing: 0.025em;
      }
      .lobby-code { 
        display: inline-flex; 
        align-items: center; 
        padding: 0.5rem 1rem; 
        border-radius: 8px; 
        background: rgba(15, 23, 42, 0.6); 
        border: 1px solid rgba(148, 163, 184, 0.15);
        color: #cbd5e1; 
        font-size: 0.9rem; 
        font-family: "Monaco", "Courier New", monospace;
        letter-spacing: 0.05em;
        margin-top: 1rem;
      }
      .lobby-code-label {
        color: #94a3b8;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }
      a { 
        color: #60a5fa; 
        text-decoration: none; 
        font-weight: 600; 
        transition: color 0.2s;
      }
      a:hover { 
        color: #93c5fd; 
      }
      .footer {
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(148, 163, 184, 0.1);
      }
    </style>
  </head>
  <body>
    <main class="card" role="main">
      <h1>${escapeHtml(meta.title)}</h1>
      ${descriptionHtml}
      <div class="footer">
        <div class="lobby-code-label">Lobby Code</div>
        <div class="lobby-code">${escapeHtml(joinId)}</div>
      </div>
    </main>
    ${redirectScript}
  </body>
</html>`;
}
