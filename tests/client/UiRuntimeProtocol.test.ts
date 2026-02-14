import {
  normalizeUiAction,
  normalizeUiSnapshot,
  parseUiEventsPayload,
  parseUiRuntimeStatsPayload,
  UI_RUNTIME_PROTOCOL_VERSION,
} from "../../src/client/UiRuntimeBridge";

describe("DioxusUI runtime protocol contract", () => {
  test("normalizeUiAction fills protocolVersion when omitted", () => {
    const action = normalizeUiAction({
      type: "ui.test.action",
      payload: { a: 1 },
    });

    expect(action.protocolVersion).toBe(UI_RUNTIME_PROTOCOL_VERSION);
    expect(action.type).toBe("ui.test.action");
    expect(action.payload).toEqual({ a: 1 });
  });

  test("normalizeUiAction rejects empty type", () => {
    expect(() => normalizeUiAction({ type: " " })).toThrow(
      /non-empty string/i,
    );
  });

  test("normalizeUiAction rejects unsupported protocolVersion", () => {
    expect(() =>
      normalizeUiAction({
        type: "ui.test.action",
        protocolVersion: UI_RUNTIME_PROTOCOL_VERSION + 1,
      }),
    ).toThrow(/protocolVersion/i);
  });

  test("normalizeUiSnapshot fills protocolVersion when omitted", () => {
    const snapshot = normalizeUiSnapshot({
      type: "ui.test.snapshot",
      tick: 12,
      payload: { hp: 99 },
    });

    expect(snapshot.protocolVersion).toBe(UI_RUNTIME_PROTOCOL_VERSION);
    expect(snapshot.type).toBe("ui.test.snapshot");
    expect(snapshot.tick).toBe(12);
  });

  test("normalizeUiSnapshot rejects empty type", () => {
    expect(() => normalizeUiSnapshot({ type: "" })).toThrow(
      /non-empty string/i,
    );
  });

  test("normalizeUiSnapshot accepts ingame layer snapshot payload with state", () => {
    const snapshot = normalizeUiSnapshot({
      type: "ui.snapshot.ingame.control-panel",
      scope: "ingame",
      tick: 42,
      payload: {
        state: {
          isVisible: true,
          troops: "123",
        },
      },
    });

    expect(snapshot.protocolVersion).toBe(UI_RUNTIME_PROTOCOL_VERSION);
    expect(snapshot.type).toBe("ui.snapshot.ingame.control-panel");
    expect(snapshot.tick).toBe(42);
  });

  test("normalizeUiSnapshot rejects ingame layer snapshot payload without state", () => {
    expect(() =>
      normalizeUiSnapshot({
        type: "ui.snapshot.ingame.control-panel",
        payload: {},
      }),
    ).toThrow(/missing required field/i);
  });

  test("parseUiEventsPayload accepts valid events", () => {
    const events = parseUiEventsPayload(
      JSON.stringify([
        {
          protocolVersion: UI_RUNTIME_PROTOCOL_VERSION,
          type: "ui.runtime.ready",
          payload: { ok: true },
        },
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("ui.runtime.ready");
    expect(events[0].protocolVersion).toBe(UI_RUNTIME_PROTOCOL_VERSION);
    expect(events[0].payload).toEqual({ ok: true });
  });

  test("parseUiEventsPayload rejects unsupported event protocolVersion", () => {
    expect(() =>
      parseUiEventsPayload(
        JSON.stringify([
          {
            protocolVersion: UI_RUNTIME_PROTOCOL_VERSION + 1,
            type: "ui.runtime.ready",
          },
        ]),
      ),
    ).toThrow(/protocolVersion/i);
  });

  test("parseUiEventsPayload rejects non-array payload", () => {
    expect(() => parseUiEventsPayload(JSON.stringify({}))).toThrow(/array/i);
  });

  test("parseUiRuntimeStatsPayload parses valid runtime stats", () => {
    const stats = parseUiRuntimeStatsPayload(
      JSON.stringify({
        protocolVersion: UI_RUNTIME_PROTOCOL_VERSION,
        pendingActions: 1,
        pendingSnapshots: 2,
        pendingEvents: 3,
        acceptedActions: 4,
        acceptedSnapshots: 5,
        rejectedActions: 6,
        rejectedSnapshots: 7,
        emittedEvents: 8,
        drainedActions: 9,
        drainedSnapshots: 10,
        drainedEvents: 11,
        lastError: null,
        lastErrorCode: null,
      }),
    );

    expect(stats.protocolVersion).toBe(UI_RUNTIME_PROTOCOL_VERSION);
    expect(stats.acceptedActions).toBe(4);
    expect(stats.rejectedSnapshots).toBe(7);
    expect(stats.drainedEvents).toBe(11);
  });

  test("parseUiRuntimeStatsPayload recognizes storage runtime errors", () => {
    const stats = parseUiRuntimeStatsPayload(
      JSON.stringify({
        protocolVersion: UI_RUNTIME_PROTOCOL_VERSION,
        pendingActions: 0,
        pendingSnapshots: 0,
        pendingEvents: 0,
        acceptedActions: 0,
        acceptedSnapshots: 0,
        rejectedActions: 1,
        rejectedSnapshots: 0,
        emittedEvents: 0,
        drainedActions: 0,
        drainedSnapshots: 0,
        drainedEvents: 0,
        lastError: "localStorage unavailable",
        lastErrorCode: "STORAGE_UNAVAILABLE",
      }),
    );

    expect(stats.lastErrorCode).toBe("STORAGE_UNAVAILABLE");
  });
});
