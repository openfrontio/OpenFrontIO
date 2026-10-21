import type { TokenPayload } from "@openfront/shared/ApiSchemas";
import { describe, expect, it } from "vitest";
import { GameManager } from "../../src/server/GameManager";
import {
  cid,
  makeClient,
  mockLogger,
  mockWsOf,
} from "../util/GameServerHarness";

function claims(provider?: string): TokenPayload {
  return {
    jti: "j",
    sub: "s",
    iat: 0,
    iss: "i",
    aud: "openfront.io",
    exp: 0,
    ...(provider ? { provider } : {}),
  } as TokenPayload;
}

describe("GameManager.activeClientsBySegment", () => {
  it("counts connected clients per platform, device and auth across games, zeros included", () => {
    const manager = new GameManager(mockLogger());
    const a = manager.createGame(cid("a"), undefined)!;
    const b = manager.createGame(cid("b"), undefined)!;
    a.joinClient(
      makeClient({
        platform: "steam",
        device: "desktop",
        claims: claims("steam"),
      }),
    );
    a.joinClient(
      makeClient({
        platform: "web",
        device: "mobile",
        claims: claims("discord"),
      }),
    );
    b.joinClient(
      makeClient({
        platform: "steam",
        device: "desktop",
        claims: claims("steam"),
      }),
    );
    // A guest session has a JWT but no persistent identity behind it.
    b.joinClient(makeClient({ platform: "web", claims: claims("guest") }));
    b.joinClient(makeClient({ platform: "web", device: "mobile" }));
    b.joinClient(makeClient());
    const gone = makeClient({ platform: "crazygames", device: "mobile" });
    b.joinClient(gone);
    mockWsOf(gone).trigger("close");

    const segments = manager.activeClientsBySegment();
    const nonZero = segments
      .filter((s) => s.count > 0)
      .map(({ platform, device, auth, count }) => ({
        platform,
        device,
        auth,
        count,
      }));
    expect(nonZero).toEqual([
      { platform: "web", device: "mobile", auth: "account", count: 1 },
      { platform: "web", device: "mobile", auth: "anonymous", count: 1 },
      { platform: "web", device: "unknown", auth: "anonymous", count: 1 },
      { platform: "steam", device: "desktop", auth: "account", count: 2 },
      { platform: "unknown", device: "unknown", auth: "anonymous", count: 1 },
    ]);
    // 5 platforms x 3 devices x 2 auth states, every one present.
    expect(segments).toHaveLength(30);
    expect(manager.activeClients()).toBe(6);
  });
});
