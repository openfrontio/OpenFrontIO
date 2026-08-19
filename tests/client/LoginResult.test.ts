import { beforeEach, describe, expect, it } from "vitest";
import { consumeLoginResult } from "../../src/client/LoginResult";

describe("consumeLoginResult", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  it("returns the login result the auth callback sent back", () => {
    expect(consumeLoginResult({ login: "email_exists" })).toBe("email_exists");
  });

  it("returns undefined when there is no login param", () => {
    expect(consumeLoginResult({ tab: "account" })).toBeUndefined();
    expect(consumeLoginResult(undefined)).toBeUndefined();
  });

  it("ignores a login value it doesn't recognise", () => {
    expect(consumeLoginResult({ login: "cancel" })).toBeUndefined();
    expect(consumeLoginResult({ login: "../../evil" })).toBeUndefined();
  });

  it("strips the one-shot param so a refresh doesn't replay it", () => {
    history.replaceState(null, "", "/#modal=account&login=email_exists");

    consumeLoginResult({ login: "email_exists" });

    expect(window.location.hash).toBe("#modal=account");
  });

  it("clears the hash entirely when login was the only param", () => {
    history.replaceState(null, "", "/#login=email_exists");

    consumeLoginResult({ login: "email_exists" });

    expect(window.location.hash).toBe("");
  });
});
