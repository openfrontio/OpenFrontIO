import WebSocket from "ws";

const BASE_URL = process.env.TARGET_BASE_URL ?? "https://openfront.io";
const ARCHIVE_API_BASE =
  process.env.ARCHIVE_API_BASE ?? "https://api.openfront.io";
const NUM_WORKERS = Number(process.env.NUM_WORKERS ?? "20");
const WS_WAIT_MS = Number(process.env.WS_WAIT_MS ?? "6000");
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS ?? "5000");

const trim = (v) => v.replace(/\/+$/, "");
const base = trim(BASE_URL);
const archiveBase = trim(ARCHIVE_API_BASE);

const workerIndexForGame = (gameID, workers) => {
  let hash = 0;
  for (let i = 0; i < gameID.length; i++) {
    const char = gameID.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash) % Math.max(1, workers);
};

const fetchJson = async (url, timeoutMs = 6000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let json = null;
    if (contentType.includes("application/json")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      json,
      textSample: text.slice(0, 240),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      json: null,
      textSample: "",
      error: String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const wsProbe = async (url, waitMs = WS_WAIT_MS) => {
  return new Promise((resolve) => {
    const result = {
      url,
      opened: false,
      openAt: null,
      closeAt: null,
      closeCode: null,
      closeReason: "",
      error: null,
      messageCount: 0,
      firstMessageSample: "",
      firstMessageRaw: "",
      firstMessageType: "",
      firstMessageGames: null,
      firstMessageLobbyCount: null,
      parseError: null,
    };

    let settled = false;
    let ws = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const connectTimeout = setTimeout(() => {
      result.error = "connect-timeout";
      try {
        ws?.terminate();
      } catch (error) {
        result.error = result.error ?? String(error);
      }
      finish();
    }, CONNECT_TIMEOUT_MS);

    try {
      ws = new WebSocket(url);
    } catch (error) {
      clearTimeout(connectTimeout);
      result.error = String(error);
      finish();
      return;
    }

    ws.on("open", () => {
      clearTimeout(connectTimeout);
      result.opened = true;
      result.openAt = Date.now();
      setTimeout(() => {
        try {
          ws.close(1000, "probe-done");
        } catch (error) {
          result.error = result.error ?? String(error);
        }
      }, waitMs);
    });

    ws.on("message", (raw) => {
      result.messageCount += 1;
      if (!result.firstMessageSample) {
        const text = typeof raw === "string" ? raw : raw.toString("utf-8");
        result.firstMessageRaw = text;
        result.firstMessageSample = text.slice(0, 280);
        try {
          const parsed = JSON.parse(text);
          result.firstMessageType = typeof parsed?.type === "string" ? parsed.type : "json";
          if (Array.isArray(parsed?.games)) {
            result.firstMessageGames = parsed.games.length;
          }
          if (Array.isArray(parsed?.data?.lobbies)) {
            result.firstMessageLobbyCount = parsed.data.lobbies.length;
          }
        } catch (error) {
          result.parseError = String(error);
        }
      }
    });

    ws.on("close", (code, reason) => {
      result.closeAt = Date.now();
      result.closeCode = code;
      result.closeReason = reason ? reason.toString("utf-8") : "";
      finish();
    });

    ws.on("error", (error) => {
      result.error = String(error);
    });
  });
};

const printHeader = (title) => {
  console.log(`\n=== ${title} ===`);
};

const wsUrlForPath = (pathPart) =>
  `${base.replace(/^http/i, "ws")}${pathPart.startsWith("/") ? "" : "/"}${pathPart}`;

async function main() {
  console.log("Probe config:", {
    BASE_URL: base,
    ARCHIVE_API_BASE: archiveBase,
    NUM_WORKERS,
    WS_WAIT_MS,
  });

  printHeader("HTTP env check");
  const envRes = await fetchJson(`${base}/api/env`);
  console.log(envRes);

  printHeader("HTTP lobbies path check");
  const rootLobbiesHttp = await fetchJson(`${base}/lobbies`);
  const workerLobbiesHttp = await fetchJson(`${base}/w0/lobbies`);
  console.log({ rootLobbiesHttp, workerLobbiesHttp });

  printHeader("WS probes");
  const wsTargets = ["/lobbies", ...Array.from({ length: NUM_WORKERS }, (_, i) => `/w${i}/lobbies`)];
  const wsResults = [];
  for (const target of wsTargets) {
    const url = wsUrlForPath(target);
    const result = await wsProbe(url);
    wsResults.push(result);
    console.log({
      target,
      opened: result.opened,
      messageCount: result.messageCount,
      closeCode: result.closeCode,
      error: result.error,
      firstMessageGames: result.firstMessageGames,
      firstMessageLobbyCount: result.firstMessageLobbyCount,
      firstMessageSample: result.firstMessageSample,
    });
  }

  const withLobbies = wsResults.find(
    (result) =>
      result.firstMessageGames !== null || result.firstMessageLobbyCount !== null,
  );
  if (!withLobbies) {
    printHeader("No games payload found on WS");
    console.log(
      "No websocket endpoint returned a payload with lobby arrays during probe window.",
    );
    return;
  }

  printHeader("Sample game follow-up");
  const firstPayload =
    withLobbies.firstMessageRaw === ""
      ? withLobbies.firstMessageSample
      : withLobbies.firstMessageRaw;
  const parsed = JSON.parse(firstPayload);
  const game = parsed.games?.[0] ?? parsed.data?.lobbies?.[0];
  if (!game?.gameID) {
    console.log("No sample game in first games payload.");
    return;
  }

  const gameID = game.gameID;
  const workerIndex = workerIndexForGame(gameID, NUM_WORKERS);
  const workerPath = `w${workerIndex}`;
  const paths = [
    `${base}/${workerPath}/api/game/${gameID}`,
    `${base}/${workerPath}/api/game/${gameID}/exists`,
    `${base}/api/game/${gameID}`,
    `${base}/api/game/${gameID}/exists`,
    `${archiveBase}/game/${gameID}`,
  ];

  for (const url of paths) {
    const result = await fetchJson(url);
    console.log(url, {
      status: result.status,
      ok: result.ok,
      contentType: result.contentType,
      hasJson: result.json !== null,
      textSample: result.textSample,
    });
  }

  printHeader("Probe complete");
}

main().catch((error) => {
  console.error("Probe failed", error);
  process.exit(1);
});
