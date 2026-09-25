/**
 * Fetching the record the viewer processes: only a record this build can
 * replay comes back as one.
 */

import { fetchReplayRecord } from "../../../src/client/replay/ReplayRecord";
import { config, human, playAndArchive } from "./util/ArchiveGame";

const API = "https://api.example";
// Records carry full commit hashes (GameRecordSchema).
const OWN = "abc1234".padEnd(40, "0");
const OTHER = "fff0000".padEnd(40, "0");

let archived: unknown;
beforeAll(async () => {
  const { record } = await playAndArchive({
    gameID: "recFETCH1",
    config: config({ bots: 0 }),
    players: [human(1)],
    ticks: 5,
    intents: () => [],
  });
  record.gitCommit = OWN;
  // As the API serves it.
  archived = JSON.parse(
    JSON.stringify(record, (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}, 60_000);

const answering = (res: Response | Error) =>
  vi.fn(async (url: string) => {
    expect(url).toBe(`${API}/game/recFETCH1`);
    if (res instanceof Error) throw res;
    return res;
  });

test("a record from this build", async () => {
  const got = await fetchReplayRecord("recFETCH1", {
    apiBase: API,
    ownCommit: OWN,
    fetchFn: answering(Response.json(archived)) as typeof fetch,
  });
  expect(got.kind).toBe("record");
  if (got.kind === "record") expect(got.record.info.gameID).toBe("recFETCH1");
});

test("a DEV build replays any record", async () => {
  const got = await fetchReplayRecord("recFETCH1", {
    apiBase: API,
    ownCommit: "DEV",
    fetchFn: answering(Response.json(archived)) as typeof fetch,
  });
  expect(got.kind).toBe("record");
});

test.each([
  ["another build's commit", () => Response.json(archived), "other_build"],
  [
    "a record this build's schema doesn't read",
    () => Response.json({ info: {}, turns: "?" }),
    "other_build",
  ],
  ["no such game", () => new Response("{}", { status: 404 }), "not_found"],
  ["a server error", () => new Response("", { status: 502 }), "unreachable"],
  ["not JSON", () => new Response("<html>"), "unreachable"],
  ["no network", () => new TypeError("Failed to fetch"), "unreachable"],
  [
    "timeout or abort",
    () => new DOMException("The operation was aborted.", "TimeoutError"),
    "unreachable",
  ],
])("%s → %s", async (_name, res, kind) => {
  const got = await fetchReplayRecord("recFETCH1", {
    apiBase: API,
    ownCommit: OTHER,
    fetchFn: answering(res()) as typeof fetch,
  });
  expect(got).toEqual({ kind });
});

test("passes signal with finite timeout in options", async () => {
  let capturedInit: RequestInit | undefined;
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    capturedInit = init;
    return Response.json(archived);
  });
  await fetchReplayRecord("recFETCH1", {
    apiBase: API,
    ownCommit: OWN,
    fetchFn: fetchFn as typeof fetch,
  });
  expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
});
