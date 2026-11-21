// @vitest-environment node
// Node's Blob and streams: jsdom's don't pipe through CompressionStream.
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-jwt"),
}));

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "https://api.test"),
}));

import {
  land,
  newScenarioDocument,
  serializeScenarioDocument,
  type StoredScenarioDocument,
} from "../../../src/client/scenario/ScenarioDocument";
import {
  type DraftBackend,
  type DraftInfo,
  ScenarioDrafts,
} from "../../../src/client/scenario/ScenarioDrafts";
import {
  createScenario,
  createScenarioDraft,
  listMyScenarios,
  loadScenarioDocument,
  moveDraftToAccount,
  publishScenarioVersion,
  saveScenarioDocument,
  ScenarioSaver,
} from "../../../src/client/scenario/ScenariosApi";

const SCENARIO = {
  id: "Scen1234",
  name: "Islands",
  description: "",
  createdAt: "2026-11-20T10:00:00.000Z",
  documentSizeBytes: null,
  documentUpdatedAt: null,
};

const VERSION = {
  version: 3,
  hash: "abc",
  engineCommit: "deadbeef",
  sizeBytes: 42,
  createdAt: "2026-11-20T11:00:00.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function memoryDrafts() {
  const docs = new Map<string, StoredScenarioDocument>();
  const backend: DraftBackend = {
    get: async (id) => structuredClone(docs.get(id)),
    put: async (info: DraftInfo, doc) => {
      docs.set(info.id, structuredClone(doc));
    },
    remove: async (id) => {
      docs.delete(id);
    },
    list: async () => [],
  };
  return { docs, drafts: new ScenarioDrafts(async () => backend) };
}

describe("ScenariosApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("creates a scenario with a JSON POST named as the document", async () => {
    fetchMock.mockResolvedValue(json(SCENARIO, 201));

    await expect(
      createScenario({ name: "Islands", description: "Many" }),
    ).resolves.toEqual(SCENARIO);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/scenarios");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      name: "Islands",
      description: "Many",
    });
  });

  it.each([
    [{ reason: "scenario_editor_required" }, 403, "entitlement"],
    [{ reason: "something else" }, 403, "request_failed"],
    [{ reason: "Scenario limit reached" }, 409, "limit"],
    [{ reason: "Unauthorized" }, 401, "unauthorized"],
    [{ reason: "bad name" }, 400, "rejected"],
    [{}, 500, "request_failed"],
  ])("maps a create's %o %i to %s", async (body, status, error) => {
    fetchMock.mockResolvedValue(json(body, status));
    await expect(createScenario({ name: "a", description: "" })).resolves.toBe(
      error,
    );
  });

  it("reports a network failure as request_failed", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const doc = newScenarioDocument("Islands", 100, 100);
    await expect(createScenario(doc.meta)).resolves.toBe("request_failed");
    await expect(saveScenarioDocument(SCENARIO.id, doc)).resolves.toBe(
      "request_failed",
    );
    await expect(
      publishScenarioVersion(SCENARIO.id, new Uint8Array([1])),
    ).resolves.toBe("request_failed");
    await expect(listMyScenarios()).resolves.toBe("request_failed");
    await expect(loadScenarioDocument(SCENARIO.id)).resolves.toBe(
      "request_failed",
    );
  });

  it("saves the document gzipped, with its name in the query", async () => {
    fetchMock.mockResolvedValue(json(SCENARIO));
    const doc = newScenarioDocument("Islands & more", 100, 100);
    doc.meta.description = "A sea";

    await expect(saveScenarioDocument(SCENARIO.id, doc)).resolves.toEqual(
      SCENARIO,
    );
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      `https://api.test/scenarios/${SCENARIO.id}/document`,
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      name: "Islands & more",
      description: "A sea",
    });
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(init.headers["Content-Type"]).toBe("application/gzip");
    // A byte body, so the browser sends the Content-Length the API checks.
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(gunzipSync(init.body).toString())).toEqual(
      serializeScenarioDocument(doc),
    );
  });

  it("loads the document it saved", async () => {
    const doc = newScenarioDocument("Islands", 100, 100);
    doc.terrain[5] = land(4);
    fetchMock.mockResolvedValue(
      new Response(gzipSync(JSON.stringify(serializeScenarioDocument(doc)))),
    );

    const loaded = await loadScenarioDocument(SCENARIO.id);
    expect(loaded).toEqual(doc);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.test/scenarios/${SCENARIO.id}/document`);
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
  });

  it("reports a draft not on the account as not_found", async () => {
    fetchMock.mockResolvedValue(json({ reason: "Unknown scenario" }, 404));
    await expect(loadScenarioDocument(SCENARIO.id)).resolves.toBe("not_found");
  });

  it("reports a draft whose first save never landed as null", async () => {
    fetchMock.mockResolvedValue(json({ reason: "No document saved" }, 404));
    await expect(loadScenarioDocument(SCENARIO.id)).resolves.toBeNull();
  });

  it("lists the caller's scenarios, and fails closed on a bad answer", async () => {
    const mine = { ...SCENARIO, latestVersion: 2 };
    fetchMock.mockResolvedValueOnce(json({ scenarios: [mine] }));
    await expect(listMyScenarios()).resolves.toEqual([mine]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.test/users/@me/scenarios",
    );

    fetchMock.mockResolvedValueOnce(json({ scenarios: "nope" }));
    await expect(listMyScenarios()).resolves.toBe("request_failed");
  });

  it("creates a draft and saves its document", async () => {
    fetchMock
      .mockResolvedValueOnce(json(SCENARIO, 201))
      .mockResolvedValueOnce(json(SCENARIO));
    const doc = newScenarioDocument("Islands", 100, 100);

    await expect(createScenarioDraft(doc)).resolves.toEqual(SCENARIO);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  it("deletes the empty draft when its document doesn't save", async () => {
    fetchMock
      .mockResolvedValueOnce(json(SCENARIO, 201))
      .mockResolvedValueOnce(json({ reason: "too large" }, 400))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      createScenarioDraft(newScenarioDocument("Islands", 100, 100)),
    ).resolves.toBe("rejected");
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe(`https://api.test/scenarios/${SCENARIO.id}`);
    expect(init.method).toBe("DELETE");
  });

  it("still reports the save's error when the cleanup is refused", async () => {
    fetchMock
      .mockResolvedValueOnce(json(SCENARIO, 201))
      .mockResolvedValueOnce(json({ reason: "too large" }, 400))
      .mockResolvedValueOnce(json({ reason: "down" }, 503));

    await expect(
      createScenarioDraft(newScenarioDocument("Islands", 100, 100)),
    ).resolves.toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("doesn't save a document when the create fails", async () => {
    fetchMock.mockResolvedValue(json({ reason: "limit" }, 409));
    await expect(
      createScenarioDraft(newScenarioDocument("Islands", 100, 100)),
    ).resolves.toBe("limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("publishes the bundle as sent", async () => {
    fetchMock.mockResolvedValue(json(VERSION, 201));
    const bundle = new Uint8Array(gzipSync(Buffer.from("bundle bytes")));

    await expect(publishScenarioVersion(SCENARIO.id, bundle)).resolves.toEqual(
      VERSION,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.test/scenarios/${SCENARIO.id}/versions`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(init.headers["Content-Type"]).toBe("application/gzip");
    expect(init.body).toBe(bundle);
  });

  it.each([
    [{ reason: "scenario_editor_required" }, 403, "entitlement"],
    [{ reason: "version must be 3" }, 409, "conflict"],
    [{ reason: "bad bundle" }, 400, "rejected"],
  ])("maps a publish's %o %i to %s", async (body, status, error) => {
    fetchMock.mockResolvedValue(json(body, status));
    await expect(
      publishScenarioVersion(SCENARIO.id, new Uint8Array([1])),
    ).resolves.toBe(error);
  });

  describe("moving a local draft", () => {
    it("removes the local copy once the account has it", async () => {
      const { docs, drafts } = memoryDrafts();
      const doc = newScenarioDocument("Local", 100, 100);
      await drafts.save("local01", doc);
      fetchMock
        .mockResolvedValueOnce(json({ ...SCENARIO, name: "Local" }, 201))
        .mockResolvedValueOnce(json({ ...SCENARIO, name: "Local" }));

      await expect(moveDraftToAccount("local01", drafts)).resolves.toEqual({
        ...SCENARIO,
        name: "Local",
      });
      expect(
        JSON.parse(gunzipSync(fetchMock.mock.calls[1][1].body).toString()),
      ).toEqual(serializeScenarioDocument(doc));
      expect(docs.has("local01")).toBe(false);
    });

    it.each([
      ["the create is refused", [json({ reason: "limit" }, 409)], "limit"],
      [
        "the account lacks the editor",
        [json({ reason: "scenario_editor_required" }, 403)],
        "entitlement",
      ],
      [
        "the document doesn't save",
        [
          json(SCENARIO, 201),
          json({}, 500),
          new Response(null, { status: 204 }),
        ],
        "request_failed",
      ],
    ])("keeps the local copy when %s", async (_, responses, error) => {
      const { docs, drafts } = memoryDrafts();
      await drafts.save("local01", newScenarioDocument("Local", 100, 100));
      for (const r of responses) fetchMock.mockResolvedValueOnce(r);

      await expect(moveDraftToAccount("local01", drafts)).resolves.toBe(error);
      expect(docs.has("local01")).toBe(true);
    });

    it("keeps the local copy when the network fails", async () => {
      const { docs, drafts } = memoryDrafts();
      await drafts.save("local01", newScenarioDocument("Local", 100, 100));
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(moveDraftToAccount("local01", drafts)).resolves.toBe(
        "request_failed",
      );
      expect(docs.has("local01")).toBe(true);
    });
  });

  describe("ScenarioSaver", () => {
    const doc = newScenarioDocument("Islands", 100, 100);

    it("saves once a while after edits, not on each", async () => {
      vi.useFakeTimers();
      const save = vi.fn(async () => SCENARIO);
      const saver = new ScenarioSaver(
        SCENARIO.id,
        () => doc,
        () => {},
        save,
        1000,
      );

      saver.changed();
      saver.changed();
      expect(saver.pending()).toBe(true);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(SCENARIO.id, doc);
      expect(saver.pending()).toBe(false);
    });

    it("keeps a failed save pending, and saves it on flush", async () => {
      const save = vi
        .fn()
        .mockResolvedValueOnce("entitlement")
        .mockResolvedValueOnce(SCENARIO);
      const saver = new ScenarioSaver(
        SCENARIO.id,
        () => doc,
        () => {},
        save,
      );

      saver.changed();
      await expect(saver.flush()).resolves.toBe("entitlement");
      expect(saver.error).toBe("entitlement");
      expect(saver.pending()).toBe(true);

      await expect(saver.flush()).resolves.toBeNull();
      expect(saver.error).toBeNull();
      expect(saver.pending()).toBe(false);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("saves edits made during a save in another after it", async () => {
      let finish = (): void => {};
      const save = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = () => resolve(SCENARIO);
            }),
        )
        .mockResolvedValue(SCENARIO);
      const saver = new ScenarioSaver(
        SCENARIO.id,
        () => doc,
        () => {},
        save,
      );

      saver.changed();
      const first = saver.flush();
      saver.changed();
      const second = saver.flush();
      expect(save).toHaveBeenCalledTimes(1);
      finish();
      await first;
      await expect(second).resolves.toBeNull();
      expect(save).toHaveBeenCalledTimes(2);
      expect(saver.pending()).toBe(false);
    });

    it("treats a save that throws as a failed request", async () => {
      const save = vi.fn().mockRejectedValue(new Error("boom"));
      const saver = new ScenarioSaver(
        SCENARIO.id,
        () => doc,
        () => {},
        save,
      );

      saver.changed();
      await expect(saver.flush()).resolves.toBe("request_failed");
      expect(saver.pending()).toBe(true);
    });
  });
});
