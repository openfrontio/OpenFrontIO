/**
 * Scenario drafts kept in this browser before the API stored them. The
 * editor now saves drafts to the API (ScenariosApi) and only lists these, to
 * move them to the account. IndexedDB, not localStorage:
 * a 3M-tile document is about 4 MB of base64 (a 25M-tile one about 33 MB),
 * and localStorage holds about 5 MB for the whole site. A draft is kept in its stored form, the same
 * JSON the API will take, and is checked against the schema when loaded.
 */

import {
  type ScenarioDocument,
  ScenarioDocumentSchema,
  serializeScenarioDocument,
  type StoredScenarioDocument,
} from "./ScenarioDocument";

export interface DraftInfo {
  id: string;
  name: string;
  /** When it was last saved (ms since epoch). */
  savedAt: number;
}

/** Storage backend (IndexedDB in the browser). */
export interface DraftBackend {
  get(id: string): Promise<StoredScenarioDocument | undefined>;
  put(info: DraftInfo, doc: StoredScenarioDocument): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<DraftInfo[]>;
}

export class ScenarioDrafts {
  constructor(
    private readonly backend: () => Promise<DraftBackend>,
    private readonly now: () => number = Date.now,
  ) {}

  async save(id: string, doc: ScenarioDocument): Promise<void> {
    // Taken before the first await, so later edits can't split the two.
    const stored = serializeScenarioDocument(doc);
    const info = { id, name: stored.meta.name, savedAt: this.now() };
    await (await this.backend()).put(info, stored);
  }

  /** The draft, or undefined if there is none. Throws if it is invalid. */
  async load(id: string): Promise<ScenarioDocument | undefined> {
    const stored = await (await this.backend()).get(id);
    return stored === undefined
      ? undefined
      : ScenarioDocumentSchema.parse(stored);
  }

  async remove(id: string): Promise<void> {
    await (await this.backend()).remove(id);
  }

  /** The drafts, the last saved first. */
  async list(): Promise<DraftInfo[]> {
    const all = await (await this.backend()).list();
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }
}

const DB_NAME = "openfront-scenario-drafts";
const DOCUMENTS = "documents";
// Kept apart so listing drafts doesn't load them.
const INFO = "info";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openIndexedDbDrafts(
  idb: IDBFactory = globalThis.indexedDB,
): Promise<DraftBackend> {
  const open = idb.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(DOCUMENTS);
    open.result.createObjectStore(INFO, { keyPath: "id" });
  };
  const db = await request(open);
  return {
    async get(id) {
      const tx = db.transaction(DOCUMENTS, "readonly");
      return (await request(tx.objectStore(DOCUMENTS).get(id))) as
        | StoredScenarioDocument
        | undefined;
    },
    async put(info, doc) {
      const tx = db.transaction([DOCUMENTS, INFO], "readwrite");
      tx.objectStore(DOCUMENTS).put(doc, info.id);
      tx.objectStore(INFO).put(info);
      await done(tx);
    },
    async remove(id) {
      const tx = db.transaction([DOCUMENTS, INFO], "readwrite");
      tx.objectStore(DOCUMENTS).delete(id);
      tx.objectStore(INFO).delete(id);
      await done(tx);
    },
    async list() {
      const tx = db.transaction(INFO, "readonly");
      return (await request(tx.objectStore(INFO).getAll())) as DraftInfo[];
    },
  };
}

let shared: Promise<DraftBackend> | null = null;

/** This browser's drafts, the database opened on first use. */
export const scenarioDrafts = new ScenarioDrafts(() => {
  // A failed open is tried again next time.
  shared ??= openIndexedDbDrafts().catch((e: unknown) => {
    shared = null;
    throw e;
  });
  return shared;
});
