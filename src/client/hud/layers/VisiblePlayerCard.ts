import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { ClientID } from "@openfront/engine-api/Schemas";
import type { PlayerCard } from "@openfront/shared/PlayerCardSchemas";
import type { GameView, PlayerView } from "../../view";

// The card a viewer may see for `player` in a running game, for the panel and
// the hover summary, or undefined: for bots and nations, for humans without
// the card, when the server withheld it (the viewer is anonymised from that
// player, NameVisibility), and for anyone but the viewer themself while the
// viewer anonymises names locally — their name is anonymised then
// (PlayerView.displayName) and the card belongs to the real one.
export function visiblePlayerCard(
  game: GameView,
  player: PlayerView,
  anonymousNames: boolean,
):
  | { clientID: ClientID; card: PlayerCard; flag: string | undefined }
  | undefined {
  if (player.type() !== PlayerType.Human) return undefined;
  const clientID = player.clientID();
  if (clientID === null) return undefined;
  if (anonymousNames && clientID !== game.myClientID()) return undefined;
  const { card, flag } = game.playerCardOf(clientID);
  return card === undefined ? undefined : { clientID, card, flag };
}
