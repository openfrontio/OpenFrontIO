import { ClientID, GameConfig } from "../Schemas";

/** What a snapshot holds that a host needs before it can restore it. */
export interface SnapshotHeader {
  format: number;
  gitCommit: string;
  gameID: string | null;
  tick: number;
  gameConfig: GameConfig;
  /** The human players, by the clientID their intents must carry. */
  humans: { clientID: ClientID; name: string }[];
}
