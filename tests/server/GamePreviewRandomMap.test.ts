import { describe, expect, test, vi } from "vitest";

// buildPreview reads the runtime asset manifest and CDN base; stub both so the
// pure title/image logic can be tested without filesystem/env.
vi.mock("../../src/server/RuntimeAssetManifest", () => ({
  getRuntimeAssetManifest: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../src/server/ServerEnv", () => ({
  ServerEnv: { cdnBase: () => "" },
}));

import { buildPreview } from "../../src/server/GamePreviewBuilder";

const origin = "https://example.com";

function lobby(gameConfig: any) {
  return { gameConfig, clients: [{ username: "host" }] } as any;
}

describe("GamePreview — random map", () => {
  test("hides the concrete map for an unstarted random lobby", async () => {
    const meta = await buildPreview(
      "game1",
      origin,
      "w0",
      lobby({
        gameMap: "Europe",
        randomMap: true,
        gameType: "Private",
        gameMode: "FFA",
      }),
      null,
    );

    expect(meta.image).toContain("RandomMap.webp");
    expect(meta.image.toLowerCase()).not.toContain("europe");
    expect(meta.title).toContain("Random Map");
    expect(meta.title).not.toContain("Europe");
  });

  test("shows the concrete map for a normal lobby", async () => {
    const meta = await buildPreview(
      "game2",
      origin,
      "w0",
      lobby({
        gameMap: "Europe",
        randomMap: false,
        gameType: "Private",
        gameMode: "FFA",
      }),
      null,
    );

    expect(meta.image.toLowerCase()).toContain("europe");
    expect(meta.title).toContain("Europe");
  });

  test("shows the concrete map when randomMap is omitted (the common case)", async () => {
    // randomMap is optional, so most normal lobbies never set it at all.
    const meta = await buildPreview(
      "game3",
      origin,
      "w0",
      lobby({ gameMap: "Europe", gameType: "Private", gameMode: "FFA" }),
      null,
    );

    expect(meta.image.toLowerCase()).toContain("europe");
    expect(meta.image).not.toContain("RandomMap.webp");
    expect(meta.title).toContain("Europe");
  });
});
