import { describe, expect, test } from "vitest";
import {
  GameConfigSchema,
  UpdateGameConfigIntentSchema,
} from "../src/core/Schemas";

describe("randomMap in GameConfig", () => {
  test("is carried by the update_game_config intent", () => {
    const parsed = UpdateGameConfigIntentSchema.parse({
      type: "update_game_config",
      config: { randomMap: true },
    });
    expect(parsed.config.randomMap).toBe(true);
  });

  test("is optional", () => {
    const parsed = GameConfigSchema.partial().parse({});
    expect(parsed.randomMap).toBeUndefined();
  });
});
