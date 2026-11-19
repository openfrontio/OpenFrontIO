import { beforeEach, describe, expect, it, vi } from "vitest";

const persistentID = vi.hoisted(() => ({ value: "player-a" }));
vi.mock("../../src/client/Auth", () => ({
  getPersistentID: () => persistentID.value,
}));

import {
  rememberAdmitted,
  wasAdmitted,
} from "../../src/client/AdmittedLobbies";

describe("AdmittedLobbies", () => {
  beforeEach(() => {
    persistentID.value = "player-a";
  });

  it("remembers a game this tab was let into", () => {
    expect(wasAdmitted("game1")).toBe(false);
    rememberAdmitted("game1");
    expect(wasAdmitted("game1")).toBe(true);
    expect(wasAdmitted("game2")).toBe(false);
  });

  it("forgets it for another account, as the server does", () => {
    rememberAdmitted("game3");
    persistentID.value = "player-b";
    expect(wasAdmitted("game3")).toBe(false);
  });
});
