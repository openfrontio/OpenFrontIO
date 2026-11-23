/**
 * Starting a singleplayer game from a scenario bundle (docs/ScenarioEditor.md,
 * "Starting a game from a bundle"). It takes the bundle's bytes, whether
 * they come from the editor's export or a download, and checks them as any
 * untrusted bundle is checked. The engine checks the nation when it
 * restores the snapshot.
 */

import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  generateID,
  generateSingleplayerGameID,
} from "@openfront/shared/SharedUtil";
import type { JoinLobbyEvent } from "../Main";
import { readSnapshotHeader } from "../WorkerClient";
import { loadScenarioBundle, useScenarioMap } from "./ScenarioBundle";

/**
 * The join-lobby event for playing `nationID` in the bundle. A download
 * passes the hash its listing names, so a bundle that isn't that version is
 * refused. The game's map loader answers for the bundle's map from here on.
 */
export async function scenarioGameStart(
  gzipped: Uint8Array,
  nationID: string,
  player: { username: string; clanTag: string | null },
  expectedHash?: string,
): Promise<JoinLobbyEvent> {
  const bundle = await loadScenarioBundle(gzipped);
  const { header, snapshot } = bundle;
  if (expectedHash !== undefined && header.hash !== expectedHash) {
    throw new Error("the bundle is not the scenario version asked for");
  }
  const { gameConfig } = await readSnapshotHeader(snapshot);
  if (gameConfig.gameType !== GameType.Singleplayer) {
    throw new Error("the scenario's snapshot is not a singleplayer game");
  }
  useScenarioMap(bundle);
  const gameID = generateSingleplayerGameID();
  const clientID = generateID();
  return {
    gameID,
    gameStartInfo: {
      gameID,
      lobbyCreatedAt: Date.now(),
      config: gameConfig,
      players: [{ clientID, ...player }],
      scenario: {
        ...header.scenario,
        hash: header.hash,
        assignments: [{ clientID, nationID }],
      },
    },
    snapshot,
    source: "singleplayer",
  };
}
