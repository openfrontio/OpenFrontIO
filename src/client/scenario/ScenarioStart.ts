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
import type { PlayerCosmetics } from "@openfront/shared/WireSchemas";
import type { JoinLobbyEvent } from "../Main";
import { readSnapshotHeader, UnreadableSnapshotError } from "../WorkerClient";
import {
  loadScenarioBundle,
  type ScenarioBundle,
  ScenarioBundleError,
  useScenarioMap,
} from "./ScenarioBundle";

/** Who plays the scenario's nation. */
export interface ScenarioPlayer {
  username: string;
  clanTag: string | null;
  cosmetics?: PlayerCosmetics;
}

/**
 * The join-lobby event for playing `nationID` in the bundle. A download
 * passes the hash its listing names, so a bundle that isn't that version is
 * refused. The game's map loader answers for the bundle's map from here on.
 */
export async function scenarioGameStart(
  gzipped: Uint8Array,
  nationID: string,
  player: ScenarioPlayer,
  expectedHash?: string,
): Promise<JoinLobbyEvent> {
  const bundle = await loadScenarioBundle(gzipped, expectedHash);
  const detail = await scenarioBundleGameStart(bundle, nationID, player);
  useScenarioMap(bundle);
  return detail;
}

/**
 * As scenarioGameStart, for a bundle already loaded (and checked against its
 * listing), but it leaves the map loader alone: the caller installs the
 * bundle's map with useScenarioMap once it is sure to start. Throws a ScenarioBundleError if this build can't read the
 * snapshot, as when a newer build exported it, or it isn't a singleplayer
 * game.
 */
export async function scenarioBundleGameStart(
  bundle: ScenarioBundle,
  nationID: string,
  player: ScenarioPlayer,
): Promise<JoinLobbyEvent> {
  const { header, snapshot } = bundle;
  const { gameConfig } = await readSnapshotHeader(snapshot).catch(
    (e: unknown) => {
      // Only a snapshot the worker can't decode; a worker that fails to
      // load or times out is no sign the scenario is from a newer build.
      if (!(e instanceof UnreadableSnapshotError)) throw e;
      throw new ScenarioBundleError(
        "format",
        `this build can't read the scenario's snapshot: ${String(e)}`,
      );
    },
  );
  if (gameConfig.gameType !== GameType.Singleplayer) {
    throw new ScenarioBundleError(
      "malformed",
      "the scenario's snapshot is not a singleplayer game",
    );
  }
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
