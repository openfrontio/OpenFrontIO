import {
  parseScenarioEditorHash,
  scenarioEditorHash,
} from "../../../src/client/scenario/ScenarioEditorRoute";

describe("the scenario editor's hash", () => {
  test("opens the start screen with no draft", () => {
    expect(parseScenarioEditorHash("#scenario-editor")).toEqual({
      draft: null,
    });
  });

  test("names a draft", () => {
    expect(parseScenarioEditorHash("#scenario-editor=AbCd1234")).toEqual({
      draft: "AbCd1234",
    });
  });

  test("isn't ours otherwise", () => {
    for (const hash of [
      "",
      "#",
      "#scenario-editor=",
      "#scenario-editor=no/good",
      "#scenario-editor=short",
      "#scenario-editorX",
      "#replay-viewer=AbCd1234",
    ]) {
      expect(parseScenarioEditorHash(hash)).toBeNull();
    }
  });

  test("round-trips", () => {
    for (const draft of [null, "AbCd1234"]) {
      expect(parseScenarioEditorHash(scenarioEditorHash(draft))).toEqual({
        draft,
      });
    }
  });
});
