import { describe, expect, it } from "vitest";
import { resolveGameHost } from "../../src/client/ClientEnv";
import { ClusterConfig } from "../../src/core/ClusterConfig";

// The per-game routing decision (docs/MultiServer.md, PR 5): a 10-char id's
// leading letter names its deployment in the cluster map; everything older
// or unmapped stays on the server the page already talks to.
const CLUSTER: ClusterConfig = {
  c: { host: "blue.openfront.io", color: "blue", numWorkers: 20 },
  d: { host: "green.openfront.io", color: "green", numWorkers: 20 },
};

describe("resolveGameHost", () => {
  it("routes a foreign letter to its deployment with its worker count", () => {
    expect(resolveGameHost("dAbCd12345", CLUSTER, "c")).toEqual({
      kind: "cross",
      host: "green.openfront.io",
      numWorkers: 20,
    });
  });

  it("keeps the own letter on the own server", () => {
    expect(resolveGameHost("cAbCd12345", CLUSTER, "c")).toEqual({
      kind: "own",
    });
  });

  it.each(["AbCd1234", "AbCd12345"])(
    "keeps legacy short id %s on the own server",
    (id) => {
      expect(resolveGameHost(id, CLUSTER, "c")).toEqual({ kind: "own" });
    },
  );

  it("keeps everything on the own server without a map (old desktop shell)", () => {
    expect(resolveGameHost("dAbCd12345", undefined, undefined)).toEqual({
      kind: "own",
    });
  });

  it("flags a letter the map does not know", () => {
    expect(resolveGameHost("zAbCd12345", CLUSTER, "c")).toEqual({
      kind: "unknown-letter",
    });
  });
});
