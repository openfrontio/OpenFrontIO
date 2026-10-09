import { describe, expect, it } from "vitest";
import { GameType } from "../../src/core/game/Game";
import {
  CreateGameInputSchema,
  isPrivateGameInput,
} from "../../src/core/WorkerSchemas";
import { testGameConfig } from "../util/Wire";

// The create_game endpoint (src/server/Worker.ts) parses the body with
// CreateGameInputSchema and then only accepts private games.
function accepts(body: unknown): boolean {
  const parsed = CreateGameInputSchema.safeParse(body);
  expect(parsed.success).toBe(true);
  return isPrivateGameInput(parsed.data);
}

describe("create_game game type", () => {
  it("accepts a private game", () => {
    expect(accepts(testGameConfig({ gameType: GameType.Private }))).toBe(true);
  });

  it("rejects a public game", () => {
    expect(accepts(testGameConfig({ gameType: GameType.Public }))).toBe(false);
  });

  it("rejects a singleplayer game", () => {
    expect(accepts(testGameConfig({ gameType: GameType.Singleplayer }))).toBe(
      false,
    );
  });

  it("accepts an empty body, which gets the private default", () => {
    const parsed = CreateGameInputSchema.parse({});
    expect(parsed).toBeUndefined();
    expect(isPrivateGameInput(parsed)).toBe(true);
  });
});
