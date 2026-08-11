import {
  isVersionedReplayPage,
  versionedReplayUrl,
} from "../src/client/VersionedReplay";

const COMMIT = "0847945e3b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";

describe("versionedReplayUrl", () => {
  test("builds the shell URL from the short commit and game id", () => {
    expect(
      versionedReplayUrl(
        "https://cdn.ofedge.io/game_assets",
        COMMIT,
        "abcd1234",
      ),
    ).toBe(
      "https://cdn.ofedge.io/game_assets/index-0847945.html#join=abcd1234",
    );
  });

  test("trims trailing slashes from the CDN base", () => {
    expect(
      versionedReplayUrl(
        "https://cdn.ofedge.io/game_assets/",
        COMMIT,
        "abcd1234",
      ),
    ).toBe(
      "https://cdn.ofedge.io/game_assets/index-0847945.html#join=abcd1234",
    );
  });

  test("returns null without a CDN base (dev)", () => {
    expect(versionedReplayUrl("", COMMIT, "abcd1234")).toBeNull();
  });

  test.each(["DEV", "unknown", "0847945", COMMIT.toUpperCase()])(
    "returns null when the record commit is not a full SHA (%s)",
    (commit) => {
      expect(
        versionedReplayUrl(
          "https://cdn.ofedge.io/game_assets",
          commit,
          "abcd1234",
        ),
      ).toBeNull();
    },
  );
});

describe("isVersionedReplayPage", () => {
  test("matches the pathname of a generated shell URL (loop guard)", () => {
    const url = versionedReplayUrl(
      "https://cdn.ofedge.io/game_assets",
      COMMIT,
      "abcd1234",
    );
    expect(url).not.toBeNull();
    expect(isVersionedReplayPage(new URL(url!).pathname)).toBe(true);
  });

  test.each(["/", "/index.html", "/game/abcd1234"])(
    "does not match ordinary app URLs (%s)",
    (pathname) => {
      expect(isVersionedReplayPage(pathname)).toBe(false);
    },
  );
});
