import { z } from "zod";
import { Cell, Nation, PlayerInfo, PlayerType, UnitType } from "../game/Game";
import type { SnapshotReader } from "./SnapshotContext";

export const PlayerInfoSchema = z.object({
  name: z.string(),
  playerType: z.enum(PlayerType),
  clientID: z.string().nullable(),
  id: z.string(),
  isLobbyCreator: z.boolean(),
  clanTag: z.string().nullable(),
  friends: z.array(z.string()),
  teamIndex: z.number().int().nullable(),
  nationFlag: z.string().nullable(),
});
export type PlayerInfoData = z.infer<typeof PlayerInfoSchema>;

export function playerInfoData(info: PlayerInfo): PlayerInfoData {
  return {
    name: info.name,
    playerType: info.playerType,
    clientID: info.clientID,
    id: info.id,
    isLobbyCreator: info.isLobbyCreator,
    clanTag: info.clanTag,
    friends: [...info.friends],
    teamIndex: info.teamIndex,
    nationFlag: info.nationFlag,
  };
}

export function newPlayerInfo(d: PlayerInfoData): PlayerInfo {
  return new PlayerInfo(
    d.name,
    d.playerType,
    d.clientID,
    d.id,
    d.isLobbyCreator,
    d.clanTag,
    d.friends,
    d.teamIndex,
    d.nationFlag,
  );
}

/**
 * Resolves stored player info to the game's own PlayerInfo object when one
 * exists, so identity matches between executions and players, as it does in
 * a live game.
 */
export function readPlayerInfo(d: PlayerInfoData, r: SnapshotReader) {
  return r.game.findPlayerInfo(d.id) ?? newPlayerInfo(d);
}

export const CellSchema = z.object({ x: z.number(), y: z.number() });

export function cellData(c: Cell): { x: number; y: number } {
  return { x: c.x, y: c.y };
}

export function newCell(d: { x: number; y: number }): Cell {
  return new Cell(d.x, d.y);
}

export const NationSchema = z.object({
  spawnCell: CellSchema.nullable(),
  playerInfo: PlayerInfoSchema,
});

export function nationData(n: Nation): z.infer<typeof NationSchema> {
  return {
    spawnCell: n.spawnCell ? cellData(n.spawnCell) : null,
    playerInfo: playerInfoData(n.playerInfo),
  };
}

export const UnitTypeSchema = z.enum(UnitType);
