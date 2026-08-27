import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  getClientIp,
  WebSocketAdmissionControl,
  WebSocketAdmissionLease,
} from "../../src/server/WebSocketAdmission";

describe("WebSocketAdmissionControl", () => {
  it("bounds pending handshakes globally and per IP", () => {
    const control = new WebSocketAdmissionControl({
      maxConnections: 3,
      maxConnectionsPerIp: 2,
      maxAttemptsPerIp: 10,
    });

    const first = control.acquire("192.0.2.1");
    const second = control.acquire("192.0.2.1");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(control.acquire("192.0.2.1")).toBeNull();

    const third = control.acquire("192.0.2.2");
    expect(third).not.toBeNull();
    expect(control.pendingConnections()).toBe(3);
    expect(control.acquire("192.0.2.3")).toBeNull();

    first?.release();
    second?.release();
    third?.release();
    expect(control.pendingConnections()).toBe(0);
  });

  it("releases a lease at most once", () => {
    const control = new WebSocketAdmissionControl({
      maxConnections: 1,
      maxAttemptsPerIp: 10,
    });
    const lease = control.acquire("192.0.2.1");

    lease?.release();
    lease?.complete();
    lease?.release();

    expect(control.pendingConnections()).toBe(0);
    expect(control.acquire("192.0.2.1")).not.toBeNull();
  });

  it("rate-limits repeated connection attempts after they close", () => {
    let now = 0;
    const control = new WebSocketAdmissionControl(
      {
        maxConnections: 10,
        maxConnectionsPerIp: 10,
        maxAttemptsPerIp: 3,
        attemptWindowMs: 1000,
      },
      () => now,
    );

    for (let i = 0; i < 3; i++) {
      const lease = control.acquire("192.0.2.1");
      expect(lease).not.toBeNull();
      lease?.release();
    }
    expect(control.acquire("192.0.2.1")).toBeNull();

    now = 1001;
    const afterWindow = control.acquire("192.0.2.1");
    expect(afterWindow).not.toBeNull();
    afterWindow?.release();
  });

  it("limits the size and count of pre-authentication frames", () => {
    const control = new WebSocketAdmissionControl({
      maxAttemptsPerIp: 10,
      maxMessagesPerConnection: 1,
      maxMessageBytes: 10,
    });
    const lease = control.acquire("192.0.2.1");
    expect(lease).toBeInstanceOf(WebSocketAdmissionLease);

    expect(lease?.acceptMessage(11)).toBe("message_too_large");
    expect(lease?.acceptMessage(10)).toBe("accepted");
    expect(lease?.acceptMessage(10)).toBe("too_many_messages");

    lease?.complete();
    expect(lease?.acceptMessage(1)).toBe("released");
  });

  it("groups invalid IP values instead of creating a bucket per value", () => {
    const control = new WebSocketAdmissionControl({
      maxAttemptsPerIp: 1,
    });
    const first = control.acquire("not-an-ip");
    first?.release();

    expect(control.acquire("another-invalid-value")).toBeNull();
  });

  it("only trusts a valid proxy IP and otherwise uses the socket address", () => {
    expect(
      getClientIp({
        headers: { "cf-connecting-ip": "198.51.100.7" },
        socket: { remoteAddress: "192.0.2.1" },
      } as unknown as IncomingMessage),
    ).toBe("198.51.100.7");
    expect(
      getClientIp({
        headers: { "cf-connecting-ip": "attacker-controlled" },
        socket: { remoteAddress: "192.0.2.1" },
      } as unknown as IncomingMessage),
    ).toBe("192.0.2.1");
    expect(
      getClientIp({
        headers: {},
        socket: { remoteAddress: undefined },
      } as unknown as IncomingMessage),
    ).toBe("unknown");
  });
});
