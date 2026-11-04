import { describe, expect, test } from "vitest";
import { parsePartyHash, PartyClient } from "../../src/client/PartyClient";

describe("parsePartyHash", () => {
  test("reads the invite code", () => {
    expect(parsePartyHash("#party=AbCdEfGhJk")).toBe("AbCdEfGhJk");
  });

  test("rejects anything that is not a code", () => {
    expect(parsePartyHash("#party=")).toBeNull();
    expect(parsePartyHash("#party=ab")).toBeNull();
    expect(parsePartyHash("#party=AbCd/../x")).toBeNull();
    expect(parsePartyHash("#affiliate=AbCdEfGhJk")).toBeNull();
  });
});

describe("PartyClient", () => {
  test("starts outside a party, and a bad code fails without connecting", () => {
    const client = new PartyClient();
    const views: string[] = [];
    client.subscribe((v) => views.push(v.status));
    expect(client.inParty()).toBe(false);
    expect(client.isLeader()).toBe(false);
    client.join("not a code");
    expect(client.view().error).toBe("not_found");
    expect(views.every((s) => s === "idle")).toBe(true);
  });

  test("announceGame is a no-op outside a party", () => {
    const client = new PartyClient();
    expect(() => client.announceGame("AbCdEfGhJk")).not.toThrow();
  });
});
