import type { PortalUser } from "./GamePortal";
import { clampUsername } from "./PlayerName";
import { translateText } from "./Utils";

// VIVERSE only lets the frame it embeds sign in, so we upload a wrapper page
// to VIVERSE that loads their SDK and frames us. Its origin is
// <app id>.world.viverse.app, framed in turn by www.viverse.com.
const VIVERSE_HOST = /(^|\.)(viverse\.app|viverse\.com)$/;
// Only the wrapper answers us, so replies must come from a viverse.app origin.
const WRAPPER_HOST = /(^|\.)viverse\.app$/;

// The wrapper runs VIVERSE's checkAuth() per request, which can take a few
// seconds. A wrapper that never answers counts as signed out.
const TOKEN_TIMEOUT_MS = 15_000;

// VIVERSE's avatar head icon. Anything else (javascript:, http:) is dropped.
const AVATAR_URL = /^(https:\/\/|data:image\/)/;

// The wrapper's answer. The name and avatar are only for display: they come
// from the parent frame, unverified, and our identity is what the backend gets
// from the token.
type WrapperReply = {
  token: string;
  username: string | null;
  avatarUrl: string | null;
};

const GET_TOKEN = "openfront:viverse:get-token";
const TOKEN = "openfront:viverse:token";
const LOGIN = "openfront:viverse:login";

function hostMatches(url: string, host: RegExp): boolean {
  try {
    return host.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const VIVERSE_SESSION_KEY = "onViverse";

// Storage can throw in a sandboxed or private frame; detection then falls
// back to the live check.
function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // See readSession.
  }
}

// Mirrors the CrazyGames/Poki SDK surface so GamePortal can route to it. The
// game never loads VIVERSE's SDK: it asks the wrapper (window.parent) for a
// token over postMessage. VIVERSE has no ads, gameplay events or invite links
// we use, so those are no-ops (copied invites fall back to a plain game link).
export class ViverseSDK {
  private requestCount = 0;
  // The last token request's answer. Shared by every profile read so they
  // don't each make the wrapper run checkAuth().
  private lastReply: Promise<WrapperReply | null> | null = null;

  // Same approach as PokiSDK.isOnPoki: ancestorOrigins where the browser has
  // it, else (Firefox) the referrer, which is the wrapper's URL. A positive
  // answer is kept for the frame's session, since the referrer becomes our
  // own URL after an in-frame navigation. index.html repeats this check
  // (window.__onViverse) to keep the CrazyGames SDK out; keep the two in step.
  isOnViverse(): boolean {
    if (window.self === window.top) return false;
    if (readSession(VIVERSE_SESSION_KEY) === "true") return true;
    const ancestors = window.location.ancestorOrigins;
    const onViverse =
      ancestors !== undefined && ancestors.length > 0
        ? Array.from(ancestors).some((o) => hostMatches(o, VIVERSE_HOST))
        : hostMatches(document.referrer, VIVERSE_HOST);
    if (onViverse) writeSession(VIVERSE_SESSION_KEY, "true");
    return onViverse;
  }

  // Nothing to load: the wrapper owns VIVERSE's SDK.
  async maybeInit(): Promise<void> {}

  async getUsername(): Promise<string | null> {
    if (!this.isOnViverse()) return null;
    return (await this.reply())?.username ?? null;
  }

  // A fresh VIVERSE access token for our backend to verify, or null when the
  // player isn't signed in to VIVERSE (or the wrapper didn't answer).
  async getUserToken(): Promise<string | null> {
    if (!this.isOnViverse()) return null;
    this.lastReply = this.requestToken();
    return (await this.lastReply)?.token ?? null;
  }

  // Without a VIVERSE name (the wrapper couldn't fetch it), a signed-in player
  // shows as their VIVERSE account.
  async getUserProfile(): Promise<PortalUser | null> {
    if (!this.isOnViverse()) return null;
    const reply = await this.reply();
    if (reply === null) return null;
    return {
      username:
        reply.username ?? translateText("account_modal.viverse_account"),
      profilePictureUrl: reply.avatarUrl,
    };
  }

  private reply(): Promise<WrapperReply | null> {
    return (this.lastReply ??= this.requestToken());
  }

  // VIVERSE's login reloads the wrapper, and with it the game, so there is
  // nothing to wait for and no auth listener to notify. Only call this from
  // the menus: the reload would end a game in progress.
  async showAuthPrompt(): Promise<void> {
    if (!this.isOnViverse()) return;
    window.parent.postMessage({ type: LOGIN }, "*");
  }

  async addAuthListener(
    _listener: (user: PortalUser | null) => void,
  ): Promise<void> {}

  async isInstantMultiplayer(): Promise<boolean> {
    return false;
  }

  async gameplayStart(): Promise<void> {}

  async gameplayStop(): Promise<void> {}

  async happytime(): Promise<void> {}

  loadingStart(): void {}

  loadingStop(): void {}

  showInviteButton(_gameId: string): string | null {
    return null;
  }

  hideInviteButton(): void {}

  async createInviteLink(_gameId: string): Promise<string | null> {
    return null;
  }

  async getInviteGameId(): Promise<string | null> {
    return null;
  }

  async requestMidgameAd(): Promise<void> {}

  // The request carries no secret, so any target origin will do; the reply
  // carries the token, so only the wrapper's is accepted.
  private requestToken(): Promise<WrapperReply | null> {
    const id = `${Date.now()}-${++this.requestCount}`;
    return new Promise((resolve) => {
      const finish = (reply: WrapperReply | null) => {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(reply);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        if (!hostMatches(event.origin, WRAPPER_HOST)) return;
        const data = event.data as { type?: unknown; id?: unknown } | null;
        if (data?.type !== TOKEN || data.id !== id) return;
        const { token, username, avatarUrl } = event.data as {
          token?: unknown;
          username?: unknown;
          avatarUrl?: unknown;
        };
        if (typeof token !== "string" || token === "") return finish(null);
        finish({
          token,
          username:
            typeof username === "string" && username.trim() !== ""
              ? clampUsername(username.trim())
              : null,
          avatarUrl:
            typeof avatarUrl === "string" && AVATAR_URL.test(avatarUrl)
              ? avatarUrl
              : null,
        });
      };
      const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS);
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ type: GET_TOKEN, id }, "*");
    });
  }
}

export const viverseSDK = new ViverseSDK();
