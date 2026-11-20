/**
 * Scenario drafts in browser storage. jsdom has no IndexedDB, so the store
 * runs on an in-memory backend that, like IndexedDB, keeps a structured
 * clone of what it is given.
 */

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

function memoryBackend(): DraftBackend & {
  docs: Map<string, StoredScenarioDocument>;
} {
  const docs = new Map<string, StoredScenarioDocument>();
  const infos = new Map<string, DraftInfo>();
  return {
    docs,
    get: async (id) => structuredClone(docs.get(id)),
    put: async (info, doc) => {
      docs.set(info.id, structuredClone(doc));
      infos.set(info.id, structuredClone(info));
    },
    remove: async (id) => {
      docs.delete(id);
      infos.delete(id);
    },
    list: async () => [...infos.values()],
  };
}

function drafts(backend: DraftBackend) {
  let now = 1000;
  return new ScenarioDrafts(
    async () => backend,
    () => now++,
  );
}

test("a saved draft loads back as it was", async () => {
  const store = drafts(memoryBackend());
  const doc = newScenarioDocument("Islands", 3000, 1000);
  for (let t = 0; t < doc.terrain.length; t += 7) doc.terrain[t] = land(t % 31);
  doc.nations.push({
    id: "NATION01",
    name: "Nation",
    flag: null,
    troops: 10,
    gold: 20,
    playable: true,
  });
  doc.owners[7] = 1;
  await store.save("draft-1", doc);
  const loaded = (await store.load("draft-1"))!;
  // Compared stored, as toEqual on 3M-element arrays takes seconds.
  expect(loaded.terrain).toBeInstanceOf(Uint8Array);
  expect(serializeScenarioDocument(loaded)).toEqual(
    serializeScenarioDocument(doc),
  );
  expect(await store.load("draft-2")).toBeUndefined();
});

test("drafts are listed the last saved first, and removed", async () => {
  const store = drafts(memoryBackend());
  await store.save("a", newScenarioDocument("First", 100, 100));
  await store.save("b", newScenarioDocument("Second", 100, 100));
  await store.save("a", newScenarioDocument("First again", 100, 100));
  expect(await store.list()).toEqual([
    { id: "a", name: "First again", savedAt: 1002 },
    { id: "b", name: "Second", savedAt: 1001 },
  ]);
  await store.remove("a");
  expect((await store.list()).map((d) => d.id)).toEqual(["b"]);
  expect(await store.load("a")).toBeUndefined();
});

test("a damaged draft fails to load", async () => {
  const backend = memoryBackend();
  const store = drafts(backend);
  await store.save("a", newScenarioDocument("Draft", 100, 100));
  backend.docs.get("a")!.ownership = [0, 1];
  await expect(store.load("a")).rejects.toThrow(/don't cover/);
});

test("a draft's listing and document come from the same moment", async () => {
  const backend = memoryBackend();
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const store = new ScenarioDrafts(async () => {
    await opened;
    return backend;
  });
  const doc = newScenarioDocument("First", 100, 100);
  const saved = store.save("a", doc);
  // Edited while the database is still opening.
  doc.meta.name = "Second";
  open();
  await saved;
  expect((await store.list())[0].name).toBe("First");
  expect((await store.load("a"))!.meta.name).toBe("First");
});
