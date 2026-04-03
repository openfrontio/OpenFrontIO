import { z } from "zod";
import {
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
  PlayerProfile,
  PlayerProfileSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { WalletCurrency } from "../core/CosmeticSchemas";
import { AnalyticsRecord, AnalyticsRecordSchema } from "../core/Schemas";
import { getAuthHeader, logOut, userAuth } from "./Auth";

const LOCAL_WALLET_DEBUG_KEY = "debug.walletBalances";
const STORE_PATTERN_PURCHASE_PATH = "/store/patterns/purchase";

const LocalWalletDebugSchema = z.object({
  premium: z.union([z.string(), z.number()]).optional(),
  standard: z.union([z.string(), z.number()]).optional(),
  email: z.string().optional(),
  publicId: z.string().optional(),
  flares: z.array(z.string()).optional(),
});
type LocalWalletDebugState = z.infer<typeof LocalWalletDebugSchema>;

export type WalletPurchaseFailureReason =
  | "insufficient_balance"
  | "unauthorized"
  | "unavailable"
  | "failed";

export interface WalletPatternPurchaseResult {
  ok: boolean;
  reason?: WalletPurchaseFailureReason;
}

function getLocalWalletDebugState(
  audience: string = getAudience(),
): LocalWalletDebugState | null {
  if (audience !== "localhost") {
    return null;
  }

  const raw = localStorage.getItem(LOCAL_WALLET_DEBUG_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = LocalWalletDebugSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn(
        "Invalid local wallet debug override",
        z.prettifyError(parsed.error),
      );
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.warn("Failed to parse local wallet debug override", error);
    return null;
  }
}

function setLocalWalletDebugState(state: LocalWalletDebugState): void {
  localStorage.setItem(LOCAL_WALLET_DEBUG_KEY, JSON.stringify(state));
}

function mergeLocalWalletDebugBalances(
  userMe: UserMeResponse,
  localDebugUserMe: UserMeResponse | null,
): UserMeResponse {
  if (localDebugUserMe === null) {
    return userMe;
  }

  return {
    ...userMe,
    player: {
      ...userMe.player,
      balances: {
        ...userMe.player.balances,
        ...localDebugUserMe.player.balances,
      },
    },
  };
}

export function getLocalWalletDebugUserMe(
  audience: string = getAudience(),
): UserMeResponse | null {
  const parsed = getLocalWalletDebugState(audience);
  if (!parsed) {
    return null;
  }

  const result = UserMeResponseSchema.safeParse({
    user: {
      email: parsed.email ?? "wallet-test@localhost",
    },
    player: {
      publicId: parsed.publicId ?? "wallet-test-player",
      flares: parsed.flares,
      balances: {
        premium: parsed.premium ?? 0,
        standard: parsed.standard ?? 0,
      },
    },
  });

  if (!result.success) {
    console.warn(
      "Invalid local wallet debug override",
      z.prettifyError(result.error),
    );
    return null;
  }

  console.info(
    `Using local wallet debug override from ${LOCAL_WALLET_DEBUG_KEY}`,
  );
  return result.data;
}

function tryLocalWalletDebugPatternPurchase(
  params: {
    patternName: string;
    colorPaletteName: string | null;
    currency: WalletCurrency;
    amount: bigint;
  },
  audience: string = getAudience(),
): WalletPatternPurchaseResult | null {
  const localDebugState = getLocalWalletDebugState(audience);
  const localDebugUserMe = getLocalWalletDebugUserMe(audience);
  if (!localDebugState || !localDebugUserMe) {
    return null;
  }

  const currentBalance =
    localDebugUserMe.player.balances?.[params.currency] ?? 0n;
  if (currentBalance < params.amount) {
    return { ok: false, reason: "insufficient_balance" };
  }

  const flare = params.colorPaletteName
    ? `pattern:${params.patternName}:${params.colorPaletteName}`
    : `pattern:${params.patternName}`;
  const nextFlares = Array.from(
    new Set([...(localDebugState.flares ?? []), flare]),
  );

  setLocalWalletDebugState({
    ...localDebugState,
    [params.currency]: (currentBalance - params.amount).toString(),
    flares: nextFlares,
  });
  invalidateUserMe();
  return { ok: true };
}

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return false;
    const { jwt } = userAuthResult;

    const url = `${getApiBase()}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}

let __userMe: Promise<UserMeResponse | false> | null = null;

async function fetchUserMe(): Promise<UserMeResponse | false> {
  const localDebugUserMe = getLocalWalletDebugUserMe();

  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return localDebugUserMe ?? false;
    const { jwt } = userAuthResult;

    // Get the user object
    const response = await fetch(getApiBase() + "/users/@me", {
      headers: {
        authorization: `Bearer ${jwt}`,
      },
    });
    if (response.status === 401) {
      if (localDebugUserMe !== null) {
        return localDebugUserMe;
      }
      await logOut();
      return false;
    }
    if (response.status !== 200) return localDebugUserMe ?? false;
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid response", error);
      return localDebugUserMe ?? false;
    }
    return mergeLocalWalletDebugBalances(result.data, localDebugUserMe);
  } catch (e) {
    return localDebugUserMe ?? false;
  }
}

function loadUserMe(forceRefresh = false): Promise<UserMeResponse | false> {
  if (forceRefresh || __userMe === null) {
    __userMe = fetchUserMe();
  }
  return __userMe;
}

export function invalidateUserMe(): void {
  __userMe = null;
}

export function getUserMe(): Promise<UserMeResponse | false> {
  return loadUserMe();
}

export function refreshUserMe(): Promise<UserMeResponse | false> {
  invalidateUserMe();
  return loadUserMe(true);
}

export function requestUserMeRefresh(forceRefresh = true): void {
  document.dispatchEvent(
    new CustomEvent("refresh-user-me", {
      detail: { forceRefresh },
      bubbles: true,
      cancelable: true,
    }),
  );
}

export async function purchasePatternWithWallet(
  params: {
    patternName: string;
    colorPaletteName: string | null;
    currency: WalletCurrency;
    amount: bigint;
  },
  audience: string = getAudience(),
): Promise<WalletPatternPurchaseResult> {
  const localResult = tryLocalWalletDebugPatternPurchase(params, audience);
  if (localResult !== null) {
    return localResult;
  }

  const authorization = await getAuthHeader();
  if (!authorization) {
    return { ok: false, reason: "unauthorized" };
  }

  try {
    const response = await fetch(
      `${getApiBase()}${STORE_PATTERN_PURCHASE_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify({
          patternName: params.patternName,
          colorPaletteName: params.colorPaletteName,
          currency: params.currency,
        }),
      },
    );

    if (response.ok) {
      invalidateUserMe();
      return { ok: true };
    }

    if (response.status === 401) {
      return { ok: false, reason: "unauthorized" };
    }

    if (response.status === 402 || response.status === 409) {
      return { ok: false, reason: "insufficient_balance" };
    }

    if (response.status === 404) {
      return { ok: false, reason: "unavailable" };
    }

    return { ok: false, reason: "failed" };
  } catch (error) {
    console.error("purchasePatternWithWallet: request failed", error);
    return { ok: false, reason: "failed" };
  }
}

export async function createCheckoutSession(
  priceId: string,
  colorPaletteName: string | null,
): Promise<string | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          priceId: priceId,
          hostname: window.location.origin,
          colorPaletteName: colorPaletteName,
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "createCheckoutSession: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("createCheckoutSession: request failed", e);
    return false;
  }
}

export function getApiBase() {
  const domainname = getAudience();

  if (domainname === "localhost") {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

export function getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

// Check if the user's account is linked to a Discord or email account.
export function hasLinkedAccount(
  userMeResponse: UserMeResponse | false,
): boolean {
  return (
    userMeResponse !== false &&
    (userMeResponse.user?.discord !== undefined ||
      userMeResponse.user?.email !== undefined)
  );
}

export async function fetchGameById(
  gameId: string,
): Promise<AnalyticsRecord | false> {
  try {
    const url = `${getApiBase()}/game/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchGameById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = AnalyticsRecordSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchGameById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchGameById: request failed", err);
    return false;
  }
}

export async function fetchClanLeaderboard(): Promise<
  ClanLeaderboardResponse | false
> {
  try {
    const res = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchClanLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = ClanLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchClanLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchClanLeaderboard: request failed", err);
    return false;
  }
}

export async function fetchPlayerLeaderboard(
  page: number,
): Promise<RankedLeaderboardResponse | "reached_limit" | false> {
  try {
    const url = new URL(`${getApiBase()}/leaderboard/ranked`);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = RankedLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Handle "Page must be between X and Y" error as end of list
      if (json?.message?.includes?.("Page must be between")) {
        return "reached_limit";
      }
      console.warn(
        "fetchPlayerLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchPlayerLeaderboard: request failed", err);
    return false;
  }
}
