import { GameConfig } from "@openfront/engine-api/Schemas";
import { GameEvent } from "@openfront/shared/EventBus";

// Sent from the lobby screens, which load before the game client: here, not
// in Transport, so emitting them doesn't pull the connection into the
// homepage's bundle.

export class SendKickPlayerIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendUpdateGameConfigIntentEvent implements GameEvent {
  constructor(public readonly config: Partial<GameConfig>) {}
}

export class SendToggleGameStartTimer implements GameEvent {
  constructor() {}
}

// Switch between playing and watching from the lobby screen.
export class SendSpectateEvent implements GameEvent {
  constructor(public readonly spectator: boolean) {}
}
