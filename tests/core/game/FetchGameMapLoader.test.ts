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

  test("loads the WebP layer, and the 4x variant for compact games", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      blob: async () => new Blob(),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const bitmap = {} as ImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );

    const loader = new FetchGameMapLoader("/maps");
    const mapData = loader.getMapData(GameMapType.China);

    await expect(mapData.layerImage("label", false)).resolves.toBe(bitmap);
    expect(fetchMock).toHaveBeenLastCalledWith("/maps/china/label.webp");

    await expect(mapData.layerImage("label", true)).resolves.toBe(bitmap);
    expect(fetchMock).toHaveBeenLastCalledWith("/maps/china/label.4x.webp");
  });
});
