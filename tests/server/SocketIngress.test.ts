import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchTelemetryRecorder } from "../../src/server/MatchTelemetryRecorder";
import {
  KICK_REASON_INVALID_MESSAGE,
  KICK_REASON_TOO_MUCH_DATA,
  SocketIngress,
  SocketIngressView,
} from "../../src/server/SocketIngress";
import type {
  MatchTelemetryCounters,
  MatchTelemetryEmitter,
  MatchTelemetryEvent,
} from "../../src/server/telemetry/MatchTelemetry";
import {
  cid,
  makeClient,
  mockLogger,
  mockWsOf,
} from "../util/GameServerHarness";
import { clientFrame } from "../util/Wire";

// The ingress pipeline on its own, with a stubbed rate limiter: what reaches
// the game, what is dropped, who gets kicked, and how a rejected intent is
// attributed in telemetry. What a delivered message then does is GameServer's
// handleClientMessage, covered by the frame-level tests (GameServerWire,
// GameServerJoin, MatchTelemetryIntegration).

class RecordingEmitter implements MatchTelemetryEmitter {
  events: MatchTelemetryEvent[] = [];
  emit(event: MatchTelemetryEvent) {
    this.events.push(event);
    return "enqueued" as const;
  }
  counters(): MatchTelemetryCounters {
    throw new Error("not used");
  }
  stop() {}
}

type Rate = "ok" | "limit" | "kick";

function setup(rate: Rate = "ok") {
  const emitter = new RecordingEmitter();
  const view: SocketIngressView = {
    zbinCtx: () => undefined,
    serverTick: () => 7,
    onMessage: vi.fn(),
    onClose: vi.fn(),
    kick: vi.fn(),
  };
  const check = vi.fn((): Rate => rate);
  const ingress = new SocketIngress(
    mockLogger(),
    new MatchTelemetryRecorder(emitter, cid("match"), "build-1"),
    view,
    { check },
  );
  const observed = () =>
    emitter.events
      .filter((e) => e.type === "intent_observed")
      .map((e) => e.payload);
  return { ingress, view, check, observed };
}

const P1 = cid("p1");
const spawn = () =>
  clientFrame({ type: "intent", intent: { type: "spawn", tile: 1 } });

describe("SocketIngress.receive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands a valid message to the game after charging it to the rate limiter", () => {
    const { ingress, view, check, observed } = setup();
    const client = makeClient({ clientID: P1 });
    const frame = clientFrame({ type: "ping" });

    ingress.receive(client, frame);

    expect(check).toHaveBeenCalledWith(P1, "ping", frame.length);
    expect(view.onMessage).toHaveBeenCalledWith(client, { type: "ping" });
    expect(view.kick).not.toHaveBeenCalled();
    expect(observed()).toEqual([]);
  });

  it("kicks corrupt bytes as invalid_message, with nothing to attribute", () => {
    const { ingress, view, check, observed } = setup();
    const client = makeClient({ clientID: P1 });

    ingress.receive(client, Buffer.from([0xff, 0xff, 0xff, 0xff]));

    expect(view.kick).toHaveBeenCalledWith(P1, KICK_REASON_INVALID_MESSAGE);
    expect(view.onMessage).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(observed()).toEqual([]);
  });

  it("kicks a schema-invalid intent and attributes its raw payload first", () => {
    const { ingress, view, observed } = setup();
    const client = makeClient({ clientID: P1, publicId: "p1-pub" });

    // Decodes (the target is a plain string on the wire) but fails zod.
    ingress.receive(
      client,
      clientFrame({
        type: "intent",
        intent: { type: "targetPlayer", target: "not a client id" },
      }),
    );

    expect(observed()).toMatchObject([
      {
        identity: { clientId: P1, publicId: "p1-pub" },
        intentType: "targetPlayer",
        outcome: "rejected",
        reasonCode: KICK_REASON_INVALID_MESSAGE,
        reasonDetail: expect.stringContaining("target"),
        intent: { type: "targetPlayer", target: "not a client id" },
      },
    ]);
    expect(view.kick).toHaveBeenCalledWith(P1, KICK_REASON_INVALID_MESSAGE);
    expect(view.onMessage).not.toHaveBeenCalled();
  });

  it("kicks a schema-invalid non-intent without attributing anything", () => {
    const { ingress, view, observed } = setup();
    const client = makeClient({ clientID: P1 });

    ingress.receive(
      client,
      clientFrame({
        type: "rejoin",
        gameID: "not a game id",
        lastTurn: 0,
        token: "secret",
      }),
    );

    expect(view.kick).toHaveBeenCalledWith(P1, KICK_REASON_INVALID_MESSAGE);
    expect(observed()).toEqual([]);
  });

  it.each([
    ["limit", "limit", false],
    ["kick", KICK_REASON_TOO_MUCH_DATA, true],
  ] as const)(
    "on a rate-limiter %s, attributes the intent as rejected and keeps it from the game",
    (rate, reasonCode, kicked) => {
      const { ingress, view, observed } = setup(rate);
      const client = makeClient({ clientID: P1, publicId: "p1-pub" });

      ingress.receive(client, spawn());

      expect(observed()).toMatchObject([
        {
          identity: { clientId: P1, publicId: "p1-pub" },
          intentType: "spawn",
          outcome: "rejected",
          reasonCode,
          intent: { type: "spawn", tile: 1, clientID: P1 },
        },
      ]);
      expect(view.onMessage).not.toHaveBeenCalled();
      if (kicked) {
        expect(view.kick).toHaveBeenCalledWith(P1, KICK_REASON_TOO_MUCH_DATA);
      } else {
        expect(view.kick).not.toHaveBeenCalled();
      }
    },
  );

  it("drops a rate-limited non-intent quietly", () => {
    const { ingress, view, observed } = setup("limit");
    ingress.receive(
      makeClient({ clientID: P1 }),
      clientFrame({ type: "ping" }),
    );
    expect(view.onMessage).not.toHaveBeenCalled();
    expect(view.kick).not.toHaveBeenCalled();
    expect(observed()).toEqual([]);
  });

  it("drops what a spectator sends for the simulation, but not housekeeping", () => {
    const { ingress, view, observed } = setup();
    const spectator = makeClient({ clientID: P1, spectator: true });

    ingress.receive(spectator, spawn());
    ingress.receive(
      spectator,
      clientFrame({ type: "hash", turnNumber: 0, hash: 1 }),
    );
    expect(view.onMessage).not.toHaveBeenCalled();
    // Not a rejection of the intent, just a drop: nothing to attribute.
    expect(observed()).toEqual([]);

    ingress.receive(spectator, clientFrame({ type: "ping" }));
    expect(view.onMessage).toHaveBeenCalledWith(spectator, { type: "ping" });
  });
});

describe("SocketIngress.attach", () => {
  it("routes the socket's frames through receive and its close to the game", async () => {
    const { ingress, view } = setup();
    const client = makeClient({ clientID: P1 });
    ingress.attach(client);

    await mockWsOf(client).trigger("message", clientFrame({ type: "ping" }));
    expect(view.onMessage).toHaveBeenCalledWith(client, { type: "ping" });

    await mockWsOf(client).trigger("close");
    expect(view.onClose).toHaveBeenCalledWith(client);
  });

  it("reports a socket that closed before it was attached", () => {
    const { ingress, view } = setup();
    const client = makeClient({ clientID: P1 });
    mockWsOf(client).readyState = 3;
    ingress.attach(client);
    expect(view.onClose).toHaveBeenCalledWith(client);
  });

  it("keeps an error thrown by the game from escaping the socket handler", async () => {
    const { ingress, view } = setup();
    (view.onMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("boom");
    });
    const client = makeClient({ clientID: P1 });
    ingress.attach(client);
    await expect(
      mockWsOf(client).trigger("message", clientFrame({ type: "ping" })),
    ).resolves.toBeUndefined();
    expect(view.kick).not.toHaveBeenCalled();
  });
});
