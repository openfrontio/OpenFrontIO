import {
  type SavedGame,
  SavedGameSchema,
  SavedGamesListResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";

// Saved singleplayer games. The API stores the gzipped bytes of a game
// snapshot (WorkerClient.snapshot()) as they are; it never decodes them.

// A late-game World snapshot is about 2.7 MB raw. A shared save is anyone's
// upload, so a download that inflates past this is a gzip bomb, not a game.
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export type SavedGameError =
  // No session, or the API refused it.
  | "unauthorized"
  // The player already has as many saves as the API keeps.
  | "limit"
  // The API refused the request as sent: a name it won't show on a shared
  // save, or a snapshot it won't store.
  | "rejected"
  | "not_found"
  | "request_failed";

async function authedFetch(path: string, init?: RequestInit) {
  return fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: await getAuthHeader(),
    },
  });
}

function errorFor(res: Response): SavedGameError {
  if (res.status === 401 || res.status === 403) return "unauthorized";
  if (res.status === 409) return "limit";
  if (res.status === 400) return "rejected";
  if (res.status === 404) return "not_found";
  return "request_failed";
}

async function parseSavedGame(
  res: Response,
): Promise<SavedGame | SavedGameError> {
  if (!res.ok) return errorFor(res);
  const parsed = SavedGameSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.warn("saved game: zod failed", parsed.error);
    return "request_failed";
  }
  return parsed.data;
}

export async function listSavedGames(): Promise<SavedGame[] | false> {
  try {
    const res = await authedFetch("/users/@me/saved_games");
    if (!res.ok) return false;
    const parsed = SavedGamesListResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("listSavedGames: zod failed", parsed.error);
      return false;
    }
    return parsed.data.savedGames;
  } catch (err) {
    console.warn("listSavedGames: request failed", err);
    return false;
  }
}

/** Uploads an (uncompressed) snapshot as a new, private save. */
export async function uploadSavedGame(
  snapshot: Uint8Array,
  meta: { name: string; map: string; tick: number },
): Promise<SavedGame | SavedGameError> {
  try {
    const params = new URLSearchParams({
      name: meta.name,
      map: meta.map,
      tick: String(meta.tick),
    });
    const res = await authedFetch(`/users/@me/saved_games?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/gzip" },
      // A Uint8Array body, so fetch sends the Content-Length the API needs.
      body: await gzip(snapshot),
    });
    return await parseSavedGame(res);
  } catch (err) {
    console.warn("uploadSavedGame: request failed", err);
    return "request_failed";
  }
}

/** Renames a save, or shares or unshares it. */
export async function updateSavedGame(
  id: string,
  update: { name?: string; public?: boolean },
): Promise<SavedGame | SavedGameError> {
  try {
    const res = await authedFetch(
      `/users/@me/saved_games/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      },
    );
    return await parseSavedGame(res);
  } catch (err) {
    console.warn("updateSavedGame: request failed", err);
    return "request_failed";
  }
}

export async function deleteSavedGame(
  id: string,
): Promise<true | SavedGameError> {
  try {
    const res = await authedFetch(
      `/users/@me/saved_games/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return res.ok ? true : errorFor(res);
  } catch (err) {
    console.warn("deleteSavedGame: request failed", err);
    return "request_failed";
  }
}

/** A shared save's details. Needs no session. */
export async function fetchSharedSavedGame(
  id: string,
): Promise<SavedGame | SavedGameError> {
  try {
    const res = await fetch(
      `${getApiBase()}/public/saved_games/${encodeURIComponent(id)}`,
    );
    return await parseSavedGame(res);
  } catch (err) {
    console.warn("fetchSharedSavedGame: request failed", err);
    return "request_failed";
  }
}

/**
 * A save's snapshot, uncompressed and ready to restore: one of the player's
 * own, or (`shared`) anyone's shared one.
 */
export async function downloadSavedGame(
  id: string,
  shared: boolean,
): Promise<Uint8Array | SavedGameError> {
  try {
    const path = shared
      ? `/public/saved_games/${encodeURIComponent(id)}/data`
      : `/users/@me/saved_games/${encodeURIComponent(id)}/data`;
    const res = shared
      ? await fetch(`${getApiBase()}${path}`)
      : await authedFetch(path);
    if (!res.ok) return errorFor(res);
    return await gunzip(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.warn("downloadSavedGame: failed", err);
    return "request_failed";
  }
}

export async function gzip(
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  return readAll(
    streamOf(bytes).pipeThrough(new CompressionStream("gzip")),
    Infinity,
  );
}

/** Inflates gzip, refusing to go past `max` bytes. */
export async function gunzip(
  bytes: Uint8Array,
  max = MAX_SNAPSHOT_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  return readAll(
    streamOf(bytes).pipeThrough(new DecompressionStream("gzip")),
    max,
  );
}

function streamOf(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as BufferSource);
      controller.close();
    },
  });
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new Error("Snapshot is too large");
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
