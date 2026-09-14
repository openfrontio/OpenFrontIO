import {
  isReplayShellHost,
  versionedReplayUrl,
} from "../src/client/VersionedReplay";

describe("versionedReplayUrl", () => {
  test("builds the canonical replay URL from the audience and game id", () => {
    expect(versionedReplayUrl("openfront.io", "abcd1234")).toBe(
      "https://replay.openfront.io/abcd1234",
    );
    expect(versionedReplayUrl("openfront.dev", "abcd1234")).toBe(
      "https://replay.openfront.dev/abcd1234",
    );
  });

  test("returns null in dev (localhost or empty audience)", () => {
    expect(versionedReplayUrl("localhost", "abcd1234")).toBeNull();
    expect(versionedReplayUrl("", "abcd1234")).toBeNull();
  });
});

describe("isReplayShellHost", () => {
  test("matches the hostname of a generated replay URL (loop guard)", () => {
    const url = versionedReplayUrl("openfront.io", "abcd1234");
    expect(url).not.toBeNull();
    expect(isReplayShellHost(new URL(url!).hostname)).toBe(true);
  });

  test.each([
    "openfront.io",
    "main.openfront.dev",
    "localhost",
    "cdn.ofedge.dev",
  ])("does not match ordinary app hosts (%s)", (hostname) => {
    expect(isReplayShellHost(hostname)).toBe(false);
  });
});
