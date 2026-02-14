import { describe, expect, it } from "vitest";
import {
  parseUiRuntimeErrorMessage,
  parseUiRuntimePayload,
  parseUiRuntimeReason,
  parseUiRuntimeRequestId,
  parseUiRuntimeString,
} from "../../../src/client/runtime/UiRuntimeParsing";

describe("UiRuntimeParsing", () => {
  it("parses payload objects and rejects non-objects", () => {
    expect(parseUiRuntimePayload({ requestId: 1 })).toEqual({ requestId: 1 });
    expect(parseUiRuntimePayload(null)).toEqual({});
    expect(parseUiRuntimePayload([1, 2, 3])).toEqual({});
    expect(parseUiRuntimePayload("x")).toEqual({});
  });

  it("parses request ids with fallback", () => {
    expect(parseUiRuntimeRequestId(5, 99)).toBe(5);
    expect(parseUiRuntimeRequestId(0, 99)).toBe(0);
    expect(parseUiRuntimeRequestId(-1, 99)).toBe(99);
    expect(parseUiRuntimeRequestId(Number.NaN, 99)).toBe(99);
    expect(parseUiRuntimeRequestId("5", 99)).toBe(99);
  });

  it("parses reason with open fallback", () => {
    expect(parseUiRuntimeReason("retry")).toBe("retry");
    expect(parseUiRuntimeReason("open")).toBe("open");
    expect(parseUiRuntimeReason("invalid")).toBe("open");
    expect(parseUiRuntimeReason(null)).toBe("open");
  });

  it("parses error message with fallback", () => {
    expect(parseUiRuntimeErrorMessage({ message: "boom" })).toBe("boom");
    expect(parseUiRuntimeErrorMessage({})).toBe("request-failed");
    expect(parseUiRuntimeErrorMessage({}, "fallback")).toBe("fallback");
  });

  it("parses string values with fallback", () => {
    expect(parseUiRuntimeString("game-1")).toBe("game-1");
    expect(parseUiRuntimeString(1)).toBe("");
    expect(parseUiRuntimeString(undefined, "fallback")).toBe("fallback");
  });
});
