import { Colord } from "colord";
import { GameView } from "../core/game/GameView";
import { uploadFrameData } from "./render/frame/Upload";
import { PlayerStatic, GameView as WebGLGameView } from "./render/gl";

const PALETTE_SIZE = 4096;

/**
 * The renderer-side glue between GameView (which already builds the full
 * FrameData each tick) and the WebGL view. Two responsibilities:
 *
 *   1. Palette management — translate PlayerView colors into a Float32Array
 *      the renderer uploads to a 1D texture, and call view.addPlayers() when
 *      new players appear (this is a renderer-side lifecycle event, not part
 *      of FrameData).
 *   2. Per-tick upload — pass the FrameData to the renderer's uploadFrameData
 *      helper, which dispatches to all the view.update*() methods.
 */
export class WebGLFrameBuilder {
  private readonly palette: Float32Array;
  private readonly knownSmallIDs = new Set<number>();
  // The renderer needs to know which player is "me" so affiliation tint,
  // unit colors, and SAM-radius perspective work. Push it once the local
  // player's update arrives (may take several ticks during join).
  private localPlayerSmallID = 0;

  constructor(private readonly view: WebGLGameView) {
    this.palette = new Float32Array(PALETTE_SIZE * 2 * 4);
  }

  update(gameView: GameView): void {
    this.syncPlayers(gameView);
    this.syncLocalPlayer(gameView);
    uploadFrameData(this.view, gameView.frameData());
  }

  private syncLocalPlayer(gameView: GameView): void {
    const sid = gameView.myPlayer()?.smallID() ?? 0;
    if (sid === this.localPlayerSmallID) return;
    this.localPlayerSmallID = sid;
    this.view.setLocalPlayerID(sid);
  }

  private syncPlayers(gameView: GameView): void {
    const newPlayers: PlayerStatic[] = [];
    for (const p of gameView.players()) {
      const smallID = p.smallID();
      if (this.knownSmallIDs.has(smallID)) continue;
      this.knownSmallIDs.add(smallID);

      this.writePaletteEntry(smallID, p.territoryColor(), p.borderColor());

      newPlayers.push({
        ...p.static,
        flag: p.cosmetics.flag,
        color: p.territoryColor().toHex(),
      });
    }
    if (newPlayers.length > 0) {
      this.view.addPlayers(newPlayers, this.palette);
    }
  }

  private writePaletteEntry(
    smallID: number,
    fill: Colord,
    border: Colord,
  ): void {
    const fillRgba = fill.toRgb();
    const fillOff = smallID * 4;
    this.palette[fillOff] = fillRgba.r / 255;
    this.palette[fillOff + 1] = fillRgba.g / 255;
    this.palette[fillOff + 2] = fillRgba.b / 255;
    this.palette[fillOff + 3] = 150 / 255;

    const borderRgba = border.toRgb();
    const borderOff = PALETTE_SIZE * 4 + smallID * 4;
    this.palette[borderOff] = borderRgba.r / 255;
    this.palette[borderOff + 1] = borderRgba.g / 255;
    this.palette[borderOff + 2] = borderRgba.b / 255;
    this.palette[borderOff + 3] = 1.0;
  }
}
