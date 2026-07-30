import { UnsecuredJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthHeader, logOut } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { steamSDK } from "../../src/client/SteamSDK";

function setBootstrapConfig() {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.dev",
    instanceId: "d",
    gitCommit: "t",
  };
  ClientEnv.reset();
}

beforeEach(async () => {
  setBootstrapConfig();
  await logOut();
  vi.restoreAllMocks();
});

describe("Steam login", () => {
  it("exchanges a Steam ticket for a session JWT via POST /auth/steam", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue("ticket123");

    const jwt = new UnsecuredJWT({
      jti: "some-id",
      sub: "AAAAAAAAAAAAAAAAAAAAAA",
      iat: Math.floor(Date.now() / 1000),
      iss: "https://api.openfront.dev",
      aud: "openfront.dev",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }).encode();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
        status: 200,
      }),
    );

    const header = await getAuthHeader();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/steam");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ticket: "ticket123",
    });
    expect(header).toBe(`Bearer ${jwt}`);
  });

  it("falls through to the guest/refresh flow when no Steam ticket is available", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue(null);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));

    await getAuthHeader();

    expect(fetchMock).toHaveBeenCalled();
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/auth/steam");
    }
  });
});
