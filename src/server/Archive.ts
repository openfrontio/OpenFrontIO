import z from "zod";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import {
  GameID,
  GameRecord,
  GameRecordSchema,
  ID,
  PartialGameRecord,
} from "../core/Schemas";
import { replacer } from "../core/Util";
import { logger } from "./Logger";

const config = getServerConfigFromServer();

const log = logger.child({ component: "Archive" });

export async function archive(
  gameRecord: GameRecord,
  trustedCosmeticFlagUrls: Set<string> = new Set(),
) {
  try {
    if (gameRecord.info.config.gameType === GameType.Singleplayer) {
      stripUntrustedFlagUrls(gameRecord, trustedCosmeticFlagUrls);
    }

    const parsed = GameRecordSchema.safeParse(gameRecord);
    if (!parsed.success) {
      log.error(`invalid game record: ${z.prettifyError(parsed.error)}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
    const url = `${config.jwtIssuer()}/game/${gameRecord.info.gameID}`;
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(gameRecord, replacer),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey(),
      },
    });
    if (!response.ok) {
      log.error(`error archiving game record: ${response.statusText}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
  } catch (error) {
    log.error(`error archiving game record: ${error}`, {
      gameID: gameRecord.info.gameID,
    });
    return;
  }
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    if (!ID.safeParse(gameId).success) {
      log.error(`invalid game ID: ${gameId}`);
      return null;
    }
    const url = `${config.jwtIssuer()}/game/${gameId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey(),
      },
    });
    const record = await response.json();
    if (!response.ok) {
      log.error(`error reading game record: ${response.statusText}`, {
        gameID: gameId,
      });
      return null;
    }
    return GameRecordSchema.parse(record);
  } catch (error) {
    log.error(`error reading game record: ${error}`, {
      gameID: gameId,
    });
    return null;
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: config.gitCommit(),
    subdomain: config.subdomain(),
    domain: config.domain(),
  };
}

function stripUntrustedFlagUrls(
  gameRecord: GameRecord,
  trustedCosmeticFlagUrls: Set<string>,
): void {
  for (const player of gameRecord.info.players) {
    const flag = player.cosmetics?.flag;
    if (
      flag === undefined ||
      !/^https?:\/\//i.test(flag) ||
      trustedCosmeticFlagUrls.has(flag)
    ) {
      continue;
    }
    log.warn("dropping untrusted singleplayer replay flag", {
      gameID: gameRecord.info.gameID,
      clientID: player.clientID,
    });
    player.cosmetics!.flag = undefined;
  }
}
