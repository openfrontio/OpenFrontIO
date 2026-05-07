import { vi } from "vitest";
import type { ClanInfo } from "../../../src/client/ClanApi";
import type { ClanModal } from "../../../src/client/ClanModal";

// ─── Mock factories ─────────────────────────────────────────────────────────
// Each factory returns a fresh object of vi.fn()s. Test files pass these to
// vi.mock() so Vitest invokes them when the mocked module is first imported.
// The factory pattern keeps the mock surface DRY across test files while
// preserving per-file module isolation.

export function clanApiMockFactory() {
  return {
    fetchClanDetail: vi.fn(async () => ({
      name: "Test Clan",
      tag: "TST",
      description: "A test clan",
      isOpen: true,
      createdAt: "2024-01-01T00:00:00Z",
      memberCount: 5,
    })),
    fetchClanMembers: vi.fn(async () => ({
      results: [
        {
          role: "leader",
          joinedAt: "2024-01-01T00:00:00Z",
          publicId: "test-player",
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      pendingRequests: 0,
    })),
    fetchClanStats: vi.fn(async () => ({
      clanTag: "TST",
      games: 10,
      wins: 7,
      losses: 3,
      stats: {
        total: { wins: 7, losses: 3 },
        ffa: { wins: 3, losses: 2 },
        team: { wins: 2, losses: 1 },
        hvn: { wins: 1, losses: 0 },
        duos: { wins: 1, losses: 0 },
        trios: { wins: 0, losses: 1 },
        quads: { wins: 1, losses: 0 },
        "2": { wins: 1, losses: 0 },
        "3": { wins: 0, losses: 1 },
        "4": { wins: 1, losses: 0 },
        "5": { wins: 0, losses: 0 },
        "6": { wins: 0, losses: 0 },
        "7": { wins: 0, losses: 0 },
        ranked: { wins: 1, losses: 0 },
        "1v1": { wins: 1, losses: 0 },
      },
      teamTypeWL: {},
      teamCountWL: {},
    })),
    fetchClans: vi.fn(async () => ({
      results: [],
      total: 0,
      page: 1,
      limit: 20,
    })),
    joinClan: vi.fn(),
    leaveClan: vi.fn(),
    updateClan: vi.fn(),
    disbandClan: vi.fn(),
    kickMember: vi.fn(),
    promoteMember: vi.fn(),
    demoteMember: vi.fn(),
    transferLeadership: vi.fn(),
    fetchClanRequests: vi.fn(async () => ({
      results: [],
      total: 0,
      page: 1,
      limit: 20,
    })),
    approveClanRequest: vi.fn(async () => true),
    denyClanRequest: vi.fn(),
    withdrawClanRequest: vi.fn(),
    fetchClanLeaderboard: vi.fn(),
    banClanMember: vi.fn(async () => true),
    unbanClanMember: vi.fn(async () => true),
    fetchClanBans: vi.fn(async () => ({
      results: [],
      total: 0,
      page: 1,
      limit: 20,
    })),
  };
}

export function apiMockFactory() {
  return {
    getUserMe: vi.fn(async () => ({
      player: {
        publicId: "test-player",
        clans: [
          {
            tag: "TST",
            name: "Test Clan",
            role: "leader",
            joinedAt: "2024-01-01T00:00:00Z",
            memberCount: 5,
          },
        ],
        clanRequests: [],
        achievements: { singleplayerMap: [] },
      },
      user: { email: "test@test.com" },
    })),
    invalidateUserMe: vi.fn(),
  };
}

export function utilsMockFactory() {
  return {
    translateText: vi.fn((key: string) => key),
    showToast: vi.fn(),
  };
}

export function authMockFactory() {
  return {
    getAuthHeader: vi.fn(async () => "Bearer test-token"),
    userAuth: vi.fn(async () => ({ jwt: "test-token", claims: {} })),
  };
}

export function configLoaderMockFactory() {
  return {
    getRuntimeClientServerConfig: vi.fn(() => ({})),
  };
}

export function crazyGamesSdkMockFactory() {
  return {
    crazyGamesSDK: { isAvailable: false },
  };
}

export async function virtualizerMockFactory() {
  const { html } = await import("lit");
  return {
    virtualize: vi.fn(() => html``),
  };
}

export function stubLocalStorage() {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
}

// ─── Test helpers ───────────────────────────────────────────────────────────

/**
 * Drain pending microtasks and Lit's update scheduler.
 * Replaces bare `await new Promise(r => setTimeout(r, 0))` which only drains
 * a single microtask tick and can miss batched Lit updates.
 */
export async function flushAsync(
  ...els: (Element | null | undefined)[]
): Promise<void> {
  // Two ticks to drain chained microtasks (e.g. async handler → state update → re-render).
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  for (const el of els) {
    if (el && "updateComplete" in el) {
      await (el as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;
    }
  }
}

/** Force-set a Lit @state property and trigger re-render. */
export function setState<K extends keyof ClanModal>(
  modal: ClanModal,
  key: K,
  value: ClanModal[K],
) {
  (modal as unknown as Record<string, unknown>)[key] = value;
}

/** Force-set a property on any element (sub-components etc.). */
export function setElState(el: Element, key: string, value: unknown) {
  (el as unknown as Record<string, unknown>)[key] = value;
}

/** Get a property from any element. */
export function getElState<T = unknown>(el: Element, key: string): T {
  return (el as unknown as Record<string, unknown>)[key] as T;
}

/**
 * Wait for a sub-component to mount and finish its initial async load.
 * Call after setting ClanModal state that causes the sub-component to render.
 */
export async function waitForSubComponent(
  modal: ClanModal,
  selector: string,
): Promise<Element> {
  await flushAsync(modal);
  const el = modal.querySelector(selector)!;
  if (el && "updateComplete" in el) {
    await (el as HTMLElement & { updateComplete: Promise<boolean> })
      .updateComplete;
  }
  return el;
}

export function makeClan(overrides: Partial<ClanInfo> = {}): ClanInfo {
  return {
    name: "Test Clan",
    tag: "TST",
    description: "A test clan",
    isOpen: true,
    createdAt: "2024-01-01T00:00:00Z",
    memberCount: 5,
    ...overrides,
  };
}
