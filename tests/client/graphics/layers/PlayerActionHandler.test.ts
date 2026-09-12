import { describe, expect, it } from "vitest";

import { PlayerActionHandler } from "../../../../src/client/hud/layers/PlayerActionHandler";
import { SendSpawnIntentEvent } from "../../../../src/client/Transport";
import type { UIState } from "../../../../src/client/UIState";
import { EventBus } from "../../../../src/core/EventBus";
import type { TileRef } from "../../../../src/core/game/GameMap";

describe("PlayerActionHandler.handleSpawn", () => {
  it("emits a SendSpawnIntentEvent for the clicked tile", () => {
    const eventBus = new EventBus();
    const events: SendSpawnIntentEvent[] = [];
    eventBus.on(SendSpawnIntentEvent, (e) => events.push(e));

    const handler = new PlayerActionHandler(eventBus, {
      attackRatio: 0.5,
    } as UIState);
    const tile = 1234 as TileRef;

    handler.handleSpawn(tile);

    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(SendSpawnIntentEvent);
    expect(events[0].tile).toBe(tile);
  });
});
