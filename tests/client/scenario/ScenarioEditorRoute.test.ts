import { isScenarioEditorHash } from "../../../src/client/scenario/ScenarioEditorRoute";

describe("scenario editor route", () => {
  it("matches only its own hash", () => {
    expect(isScenarioEditorHash("#scenario-editor")).toBe(true);
    expect(isScenarioEditorHash("")).toBe(false);
    expect(isScenarioEditorHash("#scenario-editor=abc")).toBe(false);
    expect(isScenarioEditorHash("#replay-viewer=abcd1234")).toBe(false);
  });
});
