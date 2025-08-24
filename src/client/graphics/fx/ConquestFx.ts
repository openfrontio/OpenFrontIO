import { ConquestUpdate } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { renderNumber } from "../../Utils";
import { AnimatedSpriteLoader } from "../AnimatedSpriteLoader";
import { Fx, FxType } from "./Fx";
import { FadeFx, SpriteFx } from "./SpriteFx";
import { TextFx } from "./TextFx";

/**
 * Conquest FX:
 * - conquest sprite
 * - gold displayed
 */
export function conquestFxFactory(
  animatedSpriteLoader: AnimatedSpriteLoader,
  conquest: ConquestUpdate,
  game: GameView,
): Fx[] {
  const conquestFx: Fx[] = [];
  const conquered = game.player(conquest.conqueredId);
  const { x } = conquered.nameLocation();
  const { y } = conquered.nameLocation();

  const swordAnimation = new SpriteFx(
    animatedSpriteLoader,
    x,
    y,
    FxType.Conquest,
    2500,
  );
  const fadeAnimation = new FadeFx(swordAnimation, 0.1, 0.6);
  conquestFx.push(fadeAnimation);

  const shortenedGold = renderNumber(conquest.gold);
  const goldText = new TextFx(
    `+ ${shortenedGold}`,
    x,
    y + 8,
    2500,
    0,
    "11px sans-serif",
  );
  conquestFx.push(goldText);

  return conquestFx;
}
