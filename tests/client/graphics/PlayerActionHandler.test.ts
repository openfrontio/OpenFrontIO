/**
 * @jest-environment jsdom
 */
jest.mock("../../../src/client/Transport", () => {
  return {
    SendSurrenderIntentEvent: class SendSurrenderIntentEventMock {},
  };
});

import { PlayerActionHandler } from "../../../src/client/graphics/layers/PlayerActionHandler";
import { SendSurrenderIntentEvent } from "../../../src/client/Transport";

describe("PlayerActionHandler surrender confirmation", () => {
  const uiState = { attackRatio: 1 };

  const makePlayer = () =>
    ({
      config: () => ({ vassalsEnabled: () => true }),
    } as any);

  const setup = () => {
    const eventBus = { emit: jest.fn() } as any;
    const handler = new PlayerActionHandler(eventBus, uiState as any);
    const player = makePlayer();
    const recipient = makePlayer();
    return { handler, eventBus, player, recipient };
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows modal and emits surrender on confirm", () => {
    const { handler, eventBus, player, recipient } = setup();

    handler.handleSurrender(player, recipient);

    const confirmBtn = document.querySelector('[data-role="confirm"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    confirmBtn.click();

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const emitted = eventBus.emit.mock.calls[0][0];
    expect(emitted).toBeInstanceOf(SendSurrenderIntentEvent);
    expect(document.querySelector('[data-role="confirm"]')).toBeNull();
  });

  it("closes modal without emitting on cancel", () => {
    const { handler, eventBus, player, recipient } = setup();

    handler.handleSurrender(player, recipient);
    const cancelBtn = document.querySelector('[data-role="cancel"]') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();

    cancelBtn.click();

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(document.querySelector('[data-role="cancel"]')).toBeNull();
  });
});
