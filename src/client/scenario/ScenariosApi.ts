/**
 * The API's scenario endpoints (docs/ScenarioEditor.md, "Storage and API"):
 * drafts are created, saved and loaded there, and published as bundles.
 * Creating and publishing need the scenario editor entitlement, which the
 * API checks.
 */

import { ID } from "@openfront/engine-api/Schemas";
import { z } from "zod";
import { getApiBase } from "../Api";
import { getAuthHeader } from "../Auth";
import { gunzipInBrowser, gzipInBrowser } from "../replay/BrowserGzip";
import {
  type ScenarioDocument,
  ScenarioDocumentSchema,
  serializeScenarioDocument,
} from "./ScenarioDocument";
import { type ScenarioDrafts, scenarioDrafts } from "./ScenarioDrafts";

export type ScenarioApiError =
  // No session, or the API refused it.
  | "unauthorized"
  // The account lacks the scenario editor entitlement.
  | "entitlement"
  // The account already has as many scenarios as the API keeps.
  | "limit"
  // Another version was published while this one uploaded.
  | "conflict"
  // The API refused the request as sent: a name, a document or a bundle.
  | "rejected"
  | "not_found"
  | "request_failed";

/** A scenario as its owner sees it. */
export const OwnScenarioSchema = z.object({
  id: ID,
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  documentSizeBytes: z.number().nullable(),
  documentUpdatedAt: z.string().nullable(),
});
export type OwnScenario = z.infer<typeof OwnScenarioSchema>;

const MyScenarioSchema = OwnScenarioSchema.extend({
  /** Null until the first publish. */
  latestVersion: z.int().positive().nullable(),
});
export type MyScenario = z.infer<typeof MyScenarioSchema>;

const MyScenariosResponseSchema = z.object({
  scenarios: z.array(MyScenarioSchema),
});

export const ScenarioVersionSchema = z.object({
  version: z.int().positive(),
  hash: z.string(),
  engineCommit: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});
export type ScenarioVersion = z.infer<typeof ScenarioVersionSchema>;

/** A published scenario, as anyone sees it in the list. */
const PublishedScenarioSchema = z.object({
  id: ID,
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  latestVersion: z.int().positive(),
  publishedAt: z.string().nullable(),
});
export type PublishedScenario = z.infer<typeof PublishedScenarioSchema>;

const PublishedScenariosResponseSchema = z.object({
  scenarios: z.array(PublishedScenarioSchema),
});

/** A published scenario and its versions, the oldest first. */
const ScenarioDetailSchema = z.object({
  id: ID,
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  versions: z.array(ScenarioVersionSchema).min(1),
});
export type ScenarioDetail = z.infer<typeof ScenarioDetailSchema>;

/**
 * The largest gzipped bundle a client downloads: what the API takes on
 * publish (SCENARIO_BUNDLE_MAX_BYTES there).
 */
export const MAX_BUNDLE_DOWNLOAD_BYTES = 90 * 1024 * 1024;

async function authedFetch(path: string, init?: RequestInit) {
  return fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: await getAuthHeader(),
    },
  });
}

/** A 409 means the scenario cap on create, a publish race on publish. */
async function errorFor(
  res: Response,
  conflict: "limit" | "conflict" = "conflict",
): Promise<ScenarioApiError> {
  const body = (await res.json().catch(() => null)) as {
    reason?: unknown;
  } | null;
  console.warn(`scenarios API: ${res.status}`, body?.reason);
  if (res.status === 401) return "unauthorized";
  if (res.status === 403 && body?.reason === "scenario_editor_required") {
    return "entitlement";
  }
  if (res.status === 409) return conflict;
  if (res.status === 400) return "rejected";
  if (res.status === 404) return "not_found";
  return "request_failed";
}

async function parse<T>(
  res: Response,
  schema: z.ZodType<T>,
  conflict?: "limit" | "conflict",
): Promise<T | ScenarioApiError> {
  if (!res.ok) return errorFor(res, conflict);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    console.warn("scenarios API: zod failed", parsed.error);
    return "request_failed";
  }
  return parsed.data;
}

const path = (id: string) => `/scenarios/${encodeURIComponent(id)}`;

/** The caller's scenarios, published or not, the newest first. */
export async function listMyScenarios(): Promise<
  MyScenario[] | ScenarioApiError
> {
  try {
    const res = await authedFetch("/users/@me/scenarios");
    const list = await parse(res, MyScenariosResponseSchema);
    return typeof list === "string" ? list : list.scenarios;
  } catch (err) {
    console.warn("listMyScenarios: request failed", err);
    return "request_failed";
  }
}

/**
 * Published scenarios, anyone's, the most recently published first. `page`
 * counts from 1, and the API takes a `limit` of at most 50; a page shorter
 * than `limit` is the last.
 */
export async function listPublishedScenarios(
  page: number,
  limit: number,
): Promise<PublishedScenario[] | ScenarioApiError> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  try {
    const res = await fetch(`${getApiBase()}/scenarios?${params}`);
    const list = await parse(res, PublishedScenariosResponseSchema);
    return typeof list === "string" ? list : list.scenarios;
  } catch (err) {
    console.warn("listPublishedScenarios: request failed", err);
    return "request_failed";
  }
}

/** A published scenario's versions. A draft is not_found, as is a deleted one. */
export async function getPublishedScenario(
  id: string,
): Promise<ScenarioDetail | ScenarioApiError> {
  try {
    return await parse(
      await fetch(`${getApiBase()}${path(id)}`),
      ScenarioDetailSchema,
    );
  } catch (err) {
    console.warn("getPublishedScenario: request failed", err);
    return "request_failed";
  }
}

/**
 * A published version's bundle, gzipped as it was uploaded: what
 * loadScenarioBundle reads. One over MAX_BUNDLE_DOWNLOAD_BYTES is not
 * downloaded in full.
 */
export async function downloadScenarioBundle(
  id: string,
  version: number,
): Promise<Uint8Array | ScenarioApiError | "too_large"> {
  try {
    const res = await fetch(
      `${getApiBase()}${path(id)}/versions/${version}/bundle`,
    );
    if (!res.ok) return await errorFor(res);
    const length = Number(res.headers.get("Content-Length"));
    if (length > MAX_BUNDLE_DOWNLOAD_BYTES) {
      void res.body?.cancel().catch(() => {});
      return "too_large";
    }
    if (res.body === null) return new Uint8Array(0);
    // Content-Length can be missing or wrong, so the cap holds while it
    // streams rather than after the whole body is in memory.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BUNDLE_DOWNLOAD_BYTES) {
        void reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch (err) {
    console.warn("downloadScenarioBundle: request failed", err);
    return "request_failed";
  }
}

/** A published version's thumbnail (webp), for an `<img>`; it may 404. */
export function scenarioThumbnailUrl(id: string, version: number): string {
  return `${getApiBase()}${path(id)}/versions/${version}/thumbnail`;
}

/** Creates an empty draft named as the document is. */
export async function createScenario(
  meta: ScenarioDocument["meta"],
): Promise<OwnScenario | ScenarioApiError> {
  try {
    const res = await authedFetch("/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: meta.name, description: meta.description }),
    });
    return await parse(res, OwnScenarioSchema, "limit");
  } catch (err) {
    console.warn("createScenario: request failed", err);
    return "request_failed";
  }
}

/**
 * Saves the document as the draft's, replacing the last one. It is
 * serialised before the first await, so later edits don't go into it.
 */
export async function saveScenarioDocument(
  id: string,
  doc: ScenarioDocument,
): Promise<OwnScenario | ScenarioApiError> {
  const json = JSON.stringify(serializeScenarioDocument(doc));
  const params = new URLSearchParams({
    name: doc.meta.name,
    description: doc.meta.description,
  });
  try {
    const res = await authedFetch(`${path(id)}/document?${params}`, {
      method: "PUT",
      headers: { "Content-Type": "application/gzip" },
      // A Uint8Array body, so fetch sends the Content-Length the API needs.
      body: (await gzipInBrowser(new TextEncoder().encode(json))) as BodyInit,
    });
    return await parse(res, OwnScenarioSchema);
  } catch (err) {
    console.warn("saveScenarioDocument: request failed", err);
    return "request_failed";
  }
}

/**
 * The draft's document, or null if it has none yet: its first save never
 * landed. A document that fails its schema throws.
 */
export async function loadScenarioDocument(
  id: string,
): Promise<ScenarioDocument | ScenarioApiError | null> {
  let raw: Uint8Array;
  try {
    const res = await authedFetch(`${path(id)}/document`);
    if (res.status === 404) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { reason?: unknown } | null;
      if (body?.reason === "No document saved") return null;
    }
    if (!res.ok) return await errorFor(res);
    // The owner's own upload, so it is not capped as a shared one is.
    raw = await gunzipInBrowser(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.warn("loadScenarioDocument: request failed", err);
    return "request_failed";
  }
  return ScenarioDocumentSchema.parse(
    JSON.parse(new TextDecoder().decode(raw)),
  );
}

/**
 * Creates a draft holding the document. If the document doesn't save, the
 * empty draft is deleted again so it doesn't count against the cap. That
 * can fail too; such a draft opens as a blank document.
 */
export async function createScenarioDraft(
  doc: ScenarioDocument,
): Promise<OwnScenario | ScenarioApiError> {
  const created = await createScenario(doc.meta);
  if (typeof created === "string") return created;
  const saved = await saveScenarioDocument(created.id, doc);
  if (typeof saved === "string") {
    try {
      const res = await authedFetch(path(created.id), { method: "DELETE" });
      if (!res.ok) await errorFor(res);
    } catch (err) {
      console.warn("deleting the empty draft failed", err);
    }
  }
  return saved;
}

/**
 * Publishes a gzipped bundle (exportScenario) as the scenario's next
 * version, which the bundle's header must name: the latest plus one.
 */
export async function publishScenarioVersion(
  id: string,
  bundle: Uint8Array,
): Promise<ScenarioVersion | ScenarioApiError> {
  try {
    const res = await authedFetch(`${path(id)}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/gzip" },
      body: bundle as BodyInit,
    });
    return await parse(res, ScenarioVersionSchema);
  } catch (err) {
    console.warn("publishScenarioVersion: request failed", err);
    return "request_failed";
  }
}

/**
 * Moves a draft kept in this browser to the account. The local copy is
 * removed only once the account has it.
 */
export async function moveDraftToAccount(
  id: string,
  drafts: ScenarioDrafts = scenarioDrafts,
): Promise<OwnScenario | ScenarioApiError> {
  const doc = await drafts.load(id);
  if (doc === undefined) return "not_found";
  const moved = await createScenarioDraft(doc);
  if (typeof moved !== "string") await drafts.remove(id);
  return moved;
}

/** How long after an edit the draft is saved: at most one save this often. */
const SAVE_DELAY_MS = 3000;

/**
 * Saves the open draft to the API a few seconds after it changes, one
 * request at a time; edits made during a save go into the next. A save that
 * fails leaves the draft unsaved, for the next edit or flush to retry.
 */
export class ScenarioSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<ScenarioApiError | null> | null = null;
  private dirty = false;
  /** Why the last save failed, until another starts. */
  error: ScenarioApiError | null = null;

  constructor(
    private readonly id: string,
    /** The document to save; null while there is none to. */
    private readonly doc: () => ScenarioDocument | null,
    private readonly onChange: () => void,
    private readonly save: typeof saveScenarioDocument = saveScenarioDocument,
    private readonly delayMs = SAVE_DELAY_MS,
  ) {}

  /** Changes not yet saved, or a save still running. */
  pending(): boolean {
    return this.dirty || this.running !== null;
  }

  /** The document changed: it is saved soon. */
  changed(): void {
    this.dirty = true;
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
    this.onChange();
  }

  /** Saves what isn't yet. Resolves with null once it is, else the error. */
  async flush(): Promise<ScenarioApiError | null> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // A save already running may have an older document.
    while (this.running !== null) await this.running;
    if (!this.dirty) return this.error;
    const doc = this.doc();
    if (doc === null) return null;
    this.dirty = false;
    this.error = null;
    const run = this.save(this.id, doc).then(
      (r) => (typeof r === "string" ? r : null),
      (err: unknown): ScenarioApiError => {
        console.error("scenario editor: saving the draft failed:", err);
        return "request_failed";
      },
    );
    this.running = run;
    this.onChange();
    const error = await run;
    this.running = null;
    this.error = error;
    if (error !== null) this.dirty = true;
    this.onChange();
    return error;
  }
}
