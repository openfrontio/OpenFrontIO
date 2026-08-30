// Shared context handed to every PlaybookBot module: the game, the player, the params, this tick's
// situation, the PRNG, and the three primitives the loop owns (send, boat, log).

import { Game, Player } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { PlaybookParams } from "./Params";
import { Situation } from "./Situation";

export interface BotContext {
  mg: Game;
  me: Player;
  p: PlaybookParams;
  sit: Situation;
  random: PseudoRandom;
  send(targetID: string | null, n: number, why: string, min?: number, capFloor?: number): number;
  boat(tile: TileRef, n: number, why: string): number;
  log(line: string): void; // enforces the 2000 cap
  /** A flagged branch changed a decision vs the flag being off; counts land in the lab's FINAL `fired=` field. */
  fire(flag: string): void;
}
