import { GameMapType } from "../../../core/game/Game";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import {
  buildPreviewMap,
  PREVIEW_MAP_H,
  PREVIEW_MAP_W,
  type PreviewMapData,
} from "./PreviewMap";

let pending: Promise<PreviewMapData> | undefined;

/** Fetch the preview map's terrain (once per page) from the map assets. */
export function loadPreviewMap(): Promise<PreviewMapData> {
  pending ??= (async () => {
    const data = terrainMapFileLoader.getMapData(GameMapType.Australia);
    const [manifest, bin] = await Promise.all([
      data.manifest(),
      data.map4xBin(),
    ]);
    const { width, height } = manifest.map4x;
    if (width !== PREVIEW_MAP_W || height !== PREVIEW_MAP_H) {
      throw new Error(
        `Preview map: expected ${PREVIEW_MAP_W}x${PREVIEW_MAP_H}, manifest says ${width}x${height}`,
      );
    }
    return buildPreviewMap(bin, width, height);
  })();
  pending.catch(() => {
    pending = undefined; // let a later open retry
  });
  return pending;
}
