import { ClientEnv, NoServerError } from "src/client/ClientEnv";
import { CloseCode } from "../core/CloseCodes";
import { PublicGames } from "../core/Schemas";
import { decodeLobbyMessage } from "../core/ZbinWire";
import { showInGameAlert } from "./InGameModal";
import {
  ensureServerList,
  refreshServerList,
  reloadWouldRescue,
} from "./ServerList";
import { describeSocketClose } from "./SocketClose";
import { translateText } from "./Utils";

interface LobbySocketOptions {
  reconnectDelay?: number;
  maxWsAttempts?: number;
  pollIntervalMs?: number;
  // Fired at most once, when the server advertises a different build commit
  // than this bundle — i.e. a new version deployed while this tab was open.
  onUpdateAvailable?: () => void;
  // Fired when reconnecting reaches maxWsAttempts, once per outage. The
  // socket keeps trying after that, at GAVE_UP_RETRY_MS instead of
  // reconnectDelay, so a caller showing "unavailable" recovers on its own.
  onGaveUp?: () => void;
}

// Jittered per attempt: every tab open through a deploy gives up within the
// same few seconds, and would otherwise re-dial the new server in lockstep.
const GAVE_UP_RETRY_MS = 30_000;

function getRandomWorkerPath(numWorkers: number): string {
  const workerIndex = Math.floor(Math.random() * numWorkers);
  return `/w${workerIndex}`;
}

export class PublicLobbySocket {
  private ws: WebSocket | null = null;
  private wsReconnectTimeout: number | null = null;
  private wsConnectionAttempts = 0;
  private wsAttemptCounted = false;
  // Past maxWsAttempts and not yet recovered; cleared by the first frame
  // that decodes, like the attempt counter, and by start().
  private gaveUp = false;
  private workerPath: string = "";
  private stopped = true;
  // Bumped by start() and stop(). A continuation that awaited the server
  // list under an older value belongs to a run that has been replaced,
  // and must neither dial nor prompt on its behalf.
  private generation = 0;
  // Latest full snapshot, used as the base for applying counts-only deltas.
  private lastFull: PublicGames | null = null;

  private readonly reconnectDelay: number;
  private readonly maxWsAttempts: number;
  private readonly onUpdateAvailable?: () => void;
  private readonly onGaveUp?: () => void;
  private updateAvailableFired = false;

  constructor(
    private onLobbiesUpdate: (data: PublicGames) => void,
    options?: LobbySocketOptions,
  ) {
    this.reconnectDelay = options?.reconnectDelay ?? 3000;
    this.maxWsAttempts = options?.maxWsAttempts ?? 3;
    this.onUpdateAvailable = options?.onUpdateAvailable;
    this.onGaveUp = options?.onGaveUp;
  }

  // `refreshList` is for a start the player asked for after a failure: the
  // cached list answers discovery at once, and may still name the server that
  // just died, so the dial waits for ServerList.refreshServerList instead.
  async start(options?: { refreshList?: boolean }) {
    this.stopped = false;
    this.generation++;
    this.wsConnectionAttempts = 0;
    this.gaveUp = false;
    // A start() over a pending slow retry must dial now, not join its wait.
    this.disconnectWebSocket();
    await this.discoverAndConnect(options?.refreshList);
  }

  /**
   * Find a server, pick one of its workers, and connect.
   *
   * The lobby list needs a server: ask the API (multi-server v2), falling
   * back to the page's own values. It answers "outdated" when no server
   * takes new games from this build any more, a newer version exists, and
   * this page names no server of its own — the rollover has moved on
   * without a tab whose reload really does fetch `latest`. The lobby list
   * is the first thing every homepage starts, so this is where that player
   * finds out: the same one-shot "update available" prompt a newer commit
   * in the feed raises.
   *
   * A page a game server rendered is never told that (OPE-430: its own
   * server is serving it, so a reload would come back identical and prompt
   * forever). It learns from the feed this socket is about to open —
   * checkServerCommit and checkDeploymentActive below — and, if the socket
   * never opens at all, from promptIfOutdated.
   *
   * The connection goes ahead either way, so a shell that never prompts
   * (desktop, whose updater owns updates) still gets its lobby list from
   * the fallback values.
   *
   * Retried through here rather than through connectWebSocket when no
   * server was known: the list may arrive between attempts, and until it
   * does there is no worker path to build a URL with, so a plain reconnect
   * would burn every remaining attempt on the same empty path. The attempt
   * counter is deliberately NOT reset (start() owns that), so the retries
   * still give up after maxWsAttempts.
   */
  private async discoverAndConnect(refreshList = false): Promise<void> {
    // Each discovery attempt counts, the way each socket attempt does.
    // connectWebSocket clears this after it builds a socket; the discovery
    // path never gets that far, so without clearing it here the counter
    // would freeze at one and the retry would run every reconnectDelay
    // forever, never reaching maxWsAttempts and never telling the player.
    this.wsAttemptCounted = false;
    const generation = this.generation;
    const listStatus = await (refreshList
      ? refreshServerList()
      : ensureServerList());
    if (generation !== this.generation) return;
    if (listStatus === "outdated") this.fireUpdateAvailable();
    // Get config to determine number of workers, then pick a random one.
    // With no list and nothing injected there is no server to ask (a static
    // page while the API is unreachable), which is a connection failure like
    // any other: take the same path a refused socket does rather than
    // rejecting a promise most callers never await.
    try {
      this.workerPath = getRandomWorkerPath(ClientEnv.numWorkers());
    } catch (e) {
      if (!(e instanceof NoServerError)) throw e;
      this.handleConnectError(e, true);
      return;
    }
    this.connectWebSocket();
  }

  stop() {
    this.stopped = true;
    this.generation++;
    this.lastFull = null;
    this.disconnectWebSocket();
  }

  private connectWebSocket() {
    try {
      // Clean up existing WebSocket before creating a new one
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      // Drop any cached snapshot — the server primes new connections with a
      // fresh full message, and a stale base could mis-merge incoming deltas.
      this.lastFull = null;

      // WS origin comes from ClientEnv (same-origin on web, audience-derived on
      // the desktop app://openfront origin), not window.location.host.
      const wsUrl = `${ClientEnv.serverWsBase()}${this.workerPath}/lobbies`;

      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      // Frames are zbin payloads; without this they would arrive as Blobs.
      ws.binaryType = "arraybuffer";
      this.wsAttemptCounted = false;

      // A replaced socket's close arrives after its successor is dialing, and
      // would count an attempt against it and schedule a reconnect over it.
      const current = (handler: () => void) => () => {
        if (this.ws === ws) handler();
      };
      let openedAt: number | null = null;
      ws.addEventListener(
        "open",
        current(() => {
          openedAt = Date.now();
          this.handleOpen();
        }),
      );
      ws.addEventListener("message", (event) => {
        if (this.ws === ws) this.handleMessage(event);
      });
      ws.addEventListener("close", (event) => {
        if (this.ws === ws) this.handleClose(ws.url, event, openedAt);
      });
    } catch (error) {
      this.handleConnectError(error);
    }
  }

  private handleOpen() {
    console.log("WebSocket connected: lobby updating");
    // The attempt counter is NOT reset here but on the first frame that
    // decodes (handleMessage). A client whose wire format the server has
    // moved past opens fine and then fails every frame; resetting on open
    // made that an endless open/fail/reconnect loop that never reached
    // maxWsAttempts, and so never reached promptIfOutdated either.
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message = decodeLobbyMessage(
        new Uint8Array(event.data as ArrayBuffer),
      );
      this.wsConnectionAttempts = 0;
      this.gaveUp = false;
      if (message.type === "full") {
        this.checkServerCommit(message.gitCommit);
        this.checkDeploymentActive(message.active);
        this.lastFull = {
          serverTime: message.serverTime,
          games: message.games,
        };
        this.onLobbiesUpdate(this.lastFull);
        return;
      }
      // counts: patch numClients onto the last full snapshot. If we have no
      // base yet (shouldn't happen — server primes on connect), ignore it
      // and wait for the next full.
      if (this.lastFull === null) {
        return;
      }
      const patchedGames = { ...this.lastFull.games };
      for (const type of Object.keys(patchedGames) as Array<
        keyof typeof patchedGames
      >) {
        const list = patchedGames[type];
        if (!list) continue;
        patchedGames[type] = list.map((lobby) => {
          const next = message.counts[lobby.gameID];
          return next === undefined || next === lobby.numClients
            ? lobby
            : { ...lobby, numClients: next };
        });
      }
      this.lastFull = {
        serverTime: message.serverTime,
        games: patchedGames,
      };
      this.onLobbiesUpdate(this.lastFull);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.close();
        } catch (closeError) {
          console.error(
            "Error closing WebSocket after parse failure:",
            closeError,
          );
        }
      }
    }
  }

  // The one gate for the "update available" prompt: however this tab found
  // out (the server list at start, a newer commit in the feed, a drained
  // deployment), the player is asked at most once.
  private fireUpdateAvailable() {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    this.updateAvailableFired = true;
    this.onUpdateAvailable();
  }

  private checkServerCommit(serverCommit: string | undefined) {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    if (serverCommit === undefined) return;
    const ownCommit = ClientEnv.gitCommit();
    if (ownCommit === "DEV" || serverCommit === ownCommit) return;
    this.fireUpdateAvailable();
  }

  // The deployment serving this feed says the load balancer routes elsewhere.
  // It has stopped queueing public lobbies, so without a reload this tab
  // would watch the list drain empty: the commit compare above can't catch
  // it, since this (pinned) server reports its own commit — equal to this
  // bundle's on a same-commit flip. A reload re-fetches the shell from the
  // site host, which repins to the active deployment.
  private checkDeploymentActive(active: boolean | undefined) {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    if (active !== false) return;
    this.fireUpdateAvailable();
  }

  private handleClose(url: string, event: CloseEvent, openedAt: number | null) {
    if (this.stopped) return;
    if (!this.wsAttemptCounted) {
      this.wsAttemptCounted = true;
      this.wsConnectionAttempts++;
    }
    const detail =
      `Lobby socket ${describeSocketClose(url, event, openedAt)}; ` +
      `attempt ${this.wsConnectionAttempts}/${this.maxWsAttempts}, reconnecting`;
    if (event.code === CloseCode.Normal) {
      console.log(detail);
    } else {
      console.warn(detail);
    }
    if (this.wsConnectionAttempts >= this.maxWsAttempts) {
      if (!this.gaveUp) console.error("Max WebSocket attempts reached");
      this.giveUp();
    }
    this.scheduleReconnect();
  }

  // Returns whether this call is the one that crossed the cap, so a caller
  // with its own one-off announcement makes it once per outage too.
  private giveUp(): boolean {
    const first = !this.gaveUp;
    this.gaveUp = true;
    if (first) this.onGaveUp?.();
    void this.promptIfOutdated();
    return first;
  }

  // Reconnecting has given up. A tab that was already sitting on the
  // homepage when its server left the list (drained, then fenced or
  // removed) never gets a feed to learn from — it just watches the socket
  // fail — so ask the list again here, and prompt when reloading would
  // genuinely rescue this tab: nothing serves this build, a newer build
  // exists, and a reload can land somewhere other than the server that has
  // stopped answering. ServerList.reloadWouldRescue holds that whole rule,
  // including why the page-load path above must never ask it (OPE-430).
  //
  // ensureServerList never throws and answers from the cached list, so this
  // costs nothing when the failure was only the network.
  private async promptIfOutdated(): Promise<void> {
    if (this.updateAvailableFired || this.onUpdateAvailable === undefined) {
      return;
    }
    const generation = this.generation;
    const listStatus = await ensureServerList();
    if (generation !== this.generation) return;
    if (reloadWouldRescue(listStatus)) this.fireUpdateAvailable();
  }

  // `rediscover` is for a failure a plain reconnect cannot fix: with no server
  // known the next attempt has to re-run discovery, not re-dial an empty
  // worker path.
  private handleConnectError(error: unknown, rediscover = false) {
    console.error("Error connecting WebSocket:", error);
    if (!this.wsAttemptCounted) {
      this.wsAttemptCounted = true;
      this.wsConnectionAttempts++;
    }
    if (this.wsConnectionAttempts >= this.maxWsAttempts && this.giveUp()) {
      void showInGameAlert(translateText("error_modal.connection_error"));
    }
    this.scheduleReconnect(rediscover);
  }

  private scheduleReconnect(rediscover = false) {
    if (this.wsReconnectTimeout !== null) return;
    this.wsReconnectTimeout = window.setTimeout(() => {
      this.wsReconnectTimeout = null;
      // A slow re-dial rediscovers too: by now the list may name another
      // server, and the worker path was drawn from the old one's count.
      if (rediscover || this.gaveUp) {
        void this.discoverAndConnect();
        return;
      }
      this.connectWebSocket();
    }, this.nextReconnectDelay());
  }

  private nextReconnectDelay(): number {
    if (!this.gaveUp) return this.reconnectDelay;
    return GAVE_UP_RETRY_MS * (0.5 + Math.random());
  }

  private disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wsReconnectTimeout !== null) {
      clearTimeout(this.wsReconnectTimeout);
      this.wsReconnectTimeout = null;
    }
  }
}
