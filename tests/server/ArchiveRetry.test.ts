import { GameRecord, GameRecordSchema } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// archive() is the only path a finished game takes to the API. A POST lost to
// a 5xx or a network blip loses the game's stats for every player, so it
// retries those but not a validation rejection.

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => log },
}));

import { archive, ARCHIVE_RETRY_DELAYS_MS } from "../../src/server/Archive";

const record = { info: { gameID: "abcd1234" } } as unknown as GameRecord;

function respond(status: number) {
  return new Response(null, { status });
}

// Runs archive() to completion, advancing fake time past every retry delay.
async function runArchive() {
  const done = archive(record);
  const maxWait = ARCHIVE_RETRY_DELAYS_MS.reduce((a, b) => a + b * 2, 0);
  await vi.advanceTimersByTimeAsync(maxWait);
  await done;
}

describe("archive retries", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.spyOn(GameRecordSchema, "safeParse").mockReturnValue({
      success: true,
      data: record,
    } as ReturnType<typeof GameRecordSchema.safeParse>);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    log.error.mockClear();
    log.warn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("a 5xx then success archives without an error", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(502))
      .mockResolvedValueOnce(respond(502))
      .mockResolvedValueOnce(respond(200));
    await runArchive();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(log.error).not.toHaveBeenCalled();
  });

  test("a thrown network error is retried", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(respond(200));
    await runArchive();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
  });

  test("a 429 is retried", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(429))
      .mockResolvedValueOnce(respond(200));
    await runArchive();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
  });

  test("a 400 is not retried and logs its status", async () => {
    fetchMock.mockResolvedValue(respond(400));
    await runArchive();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toContain("400");
  });

  test("persistent 5xx gives up after every retry with one error", async () => {
    fetchMock.mockResolvedValue(respond(500));
    await runArchive();
    const attempts = ARCHIVE_RETRY_DELAYS_MS.length + 1;
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toContain(`${attempts} attempt`);
  });

  test("resends the same body on every attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(200));
    await runArchive();
    const [first, second] = fetchMock.mock.calls;
    expect(second[0]).toBe(first[0]);
    expect(second[1].body).toBe(first[1].body);
  });

  test("each attempt gets its own timeout signal", async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(respond(200));
    await runArchive();
    const [first, second] = fetchMock.mock.calls;
    expect(first[1].signal).toBeInstanceOf(AbortSignal);
    expect(second[1].signal).toBeInstanceOf(AbortSignal);
    expect(second[1].signal).not.toBe(first[1].signal);
    expect(log.error).not.toHaveBeenCalled();
  });

  test("a 409 after a failed attempt counts as already archived", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(503))
      .mockResolvedValueOnce(respond(409));
    await runArchive();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[1][0]).toContain("already archived");
  });

  test("a 409 on the first attempt is an error", async () => {
    fetchMock.mockResolvedValue(respond(409));
    await runArchive();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toContain("409");
  });

  test("a missing API config logs instead of rejecting", async () => {
    vi.stubEnv("DOMAIN", "");
    await expect(archive(record)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  test("a record without info logs instead of rejecting", async () => {
    await expect(archive({} as unknown as GameRecord)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
