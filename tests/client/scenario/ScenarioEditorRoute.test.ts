import { isScenarioEditorHash } from "../../../src/client/scenario/ScenarioEditorRoute";

describe("scenario editor route", () => {
  it("matches only its own hash", () => {
    expect(isScenarioEditorHash("#scenario-editor")).toBe(true);
    expect(isScenarioEditorHash("")).toBe(false);
    expect(isScenarioEditorHash("#scenario-editor=abc")).toBe(false);
    expect(isScenarioEditorHash("#replay-viewer=abcd1234")).toBe(false);
  });

  // The submodule may be checked out next to this test; without
  // SCENARIO_EDITOR=1 the import must still be the stub.
  it("resolves to the stub by default", async () => {
    const { createScenarioEditor } = await import("virtual:scenario-editor");
    expect(createScenarioEditor()).toBeNull();
  });
});
