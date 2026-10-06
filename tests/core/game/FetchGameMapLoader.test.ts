import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { FetchGameMapLoader } from "@openfront/shared/FetchGameMapLoader";
import { describe, expect, test, vi } from "vitest";

describe("FetchGameMapLoader", () => {
  test("resolves each map file through the provided path resolver", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ url }),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader(
      (path) => `/_assets/maps/${path}.hashed`,
    );
    const mapData = loader.getMapData(GameMapType.BritanniaClassic);

    expect(mapData.webpPath).toBe(
      "/_assets/maps/britanniaclassic/thumbnail.webp.hashed",
    );

    await mapData.manifest();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_assets/maps/britanniaclassic/manifest.json.hashed",
    );
  });
});
