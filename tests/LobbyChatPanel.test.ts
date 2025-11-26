import fs from "fs";
import path from "path";

// Temporary minimal tests for Lobby Chat while Lit component tests are deferred
// due to ESM transform issues. Ensures suite is non-empty and i18n keys exist.

describe("LobbyChat i18n keys", () => {
  const langPath = path.resolve(
    __dirname,
    "..",
    "resources",
    "lang",
    "en.json",
  );
  const raw = fs.readFileSync(langPath, "utf-8");
  const json = JSON.parse(raw);

  test("has lobby_chat.title", () => {
    expect(json.lobby_chat?.title).toBeTruthy();
  });

  test("has lobby_chat.placeholder", () => {
    expect(json.lobby_chat?.placeholder).toBeTruthy();
  });

  test("has lobby_chat.enable", () => {
    expect(json.lobby_chat?.enable).toBeTruthy();
  });

  test("has lobby_chat.send", () => {
    expect(json.lobby_chat?.send).toBeTruthy();
  });
});

// Replace with component behavioral tests (alignment, event emission) once ESM config fixed.
