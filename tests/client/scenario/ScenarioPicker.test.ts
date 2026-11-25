import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioBundleHeader } from "../../../src/client/scenario/ScenarioBundle";

const api = vi.hoisted(() => ({
  getPublishedScenario: vi.fn(),
  downloadScenarioBundle: vi.fn(),
}));
vi.mock(
  "../../../src/client/scenario/ScenariosApi",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getPublishedScenario: api.getPublishedScenario,
    downloadScenarioBundle: api.downloadScenarioBundle,
  }),
);

const bundles = vi.hoisted(() => ({ loadScenarioBundle: vi.fn() }));
vi.mock(
  "../../../src/client/scenario/ScenarioBundle",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadScenarioBundle: bundles.loadScenarioBundle,
  }),
);

import { ScenarioBundleError } from "../../../src/client/scenario/ScenarioBundle";
import {
  downloadPlayableScenario,
  playableNations,
  scenarioPickerAllowed,
  scenarioPlayErrorKey,
  type ScenarioPlayError,
} from "../../../src/client/scenario/ScenarioPicker";
import { MAX_BUNDLE_DOWNLOAD_BYTES } from "../../../src/client/scenario/ScenariosApi";

const ID = "abcdefghijklmnopqrstuv";
const GZIPPED = new Uint8Array([1, 2, 3]);

function userMe(flares?: string[]): UserMeResponse {
  return { user: {}, player: { publicId: "p", flares } } as UserMeResponse;
}

function header(
  nations: ScenarioBundleHeader["nations"],
): ScenarioBundleHeader {
  return {
    format: 1,
    scenario: { id: ID, version: 2 },
    engineCommit: "abc",
    nations,
    hash: "a".repeat(64),
  };
}

const FRANCE = { id: "fr", name: "France", flag: "fr", playable: true };
const SPAIN = { id: "es", name: "Spain", flag: null, playable: false };
const ITALY = { id: "it", name: "Italy", flag: "it", playable: true };

function version(v: number, hash: string, sizeBytes = 1000) {
  return { version: v, hash, engineCommit: "abc", sizeBytes, createdAt: "" };
}

describe("scenarioPickerAllowed", () => {
  it("offers scenarios only to accounts with the scenario editor flare", () => {
    expect(scenarioPickerAllowed(false)).toBe(false);
    expect(scenarioPickerAllowed(userMe())).toBe(false);
    expect(scenarioPickerAllowed(userMe(["other"]))).toBe(false);
    expect(scenarioPickerAllowed(userMe(["other", "scenario_editor"]))).toBe(
      true,
    );
  });
});

describe("playableNations", () => {
  it("keeps the playable nations, in the scenario's order", () => {
    expect(playableNations(header([FRANCE, SPAIN, ITALY]))).toEqual([
      FRANCE,
      ITALY,
    ]);
    expect(playableNations(header([SPAIN]))).toEqual([]);
  });
});

describe("scenarioPlayErrorKey", () => {
  it("names a message en.json has for every error", () => {
    const en = JSON.parse(
      readFileSync(`${__dirname}/../../../resources/lang/en.json`, "utf8"),
    );
    const errors: ScenarioPlayError[] = [
      "unauthorized",
      "entitlement",
      "limit",
      "conflict",
      "rejected",
      "not_found",
      "request_failed",
      "too_large",
      "format",
      "hash",
      "malformed",
      "no_playable",
    ];
    for (const error of errors) {
      const key = scenarioPlayErrorKey(error);
      const text = key.split(".").reduce((o, k) => o?.[k], en);
      expect(typeof text, `${error} -> ${key}`).toBe("string");
    }
    expect(scenarioPlayErrorKey("format")).toBe(
      "scenario_picker.error.incompatible",
    );
  });
});

describe("downloadPlayableScenario", () => {
  const bundle = { header: header([FRANCE, SPAIN, ITALY]) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.getPublishedScenario.mockResolvedValue({
      id: ID,
      name: "Europe",
      description: "",
      createdAt: "",
      versions: [version(1, "1".repeat(64)), version(3, "3".repeat(64))],
    });
    api.downloadScenarioBundle.mockResolvedValue(GZIPPED);
    bundles.loadScenarioBundle.mockResolvedValue(bundle);
  });

  it("downloads the latest version and checks it against its hash", async () => {
    const result = await downloadPlayableScenario(ID);
    expect(api.getPublishedScenario).toHaveBeenCalledWith(ID);
    expect(api.downloadScenarioBundle).toHaveBeenCalledWith(ID, 3);
    expect(bundles.loadScenarioBundle).toHaveBeenCalledWith(
      GZIPPED,
      "3".repeat(64),
    );
    expect(result).toEqual({
      id: ID,
      version: 3,
      bundle,
      nations: [FRANCE, ITALY],
    });
  });

  it("passes on why the scenario or its bundle couldn't be fetched", async () => {
    api.getPublishedScenario.mockResolvedValueOnce("not_found");
    expect(await downloadPlayableScenario(ID)).toBe("not_found");
    expect(api.downloadScenarioBundle).not.toHaveBeenCalled();

    api.downloadScenarioBundle.mockResolvedValueOnce("request_failed");
    expect(await downloadPlayableScenario(ID)).toBe("request_failed");

    api.downloadScenarioBundle.mockResolvedValueOnce("too_large");
    expect(await downloadPlayableScenario(ID)).toBe("too_large");
    expect(bundles.loadScenarioBundle).not.toHaveBeenCalled();
  });

  it("doesn't download a version listed as too large", async () => {
    api.getPublishedScenario.mockResolvedValueOnce({
      id: ID,
      name: "Europe",
      description: "",
      createdAt: "",
      versions: [version(1, "1".repeat(64), MAX_BUNDLE_DOWNLOAD_BYTES + 1)],
    });
    expect(await downloadPlayableScenario(ID)).toBe("too_large");
    expect(api.downloadScenarioBundle).not.toHaveBeenCalled();
  });

  it("says why a bundle doesn't load", async () => {
    for (const problem of [
      "too_large",
      "format",
      "hash",
      "malformed",
    ] as const) {
      bundles.loadScenarioBundle.mockRejectedValueOnce(
        new ScenarioBundleError(problem, "no"),
      );
      expect(await downloadPlayableScenario(ID)).toBe(problem);
    }
    bundles.loadScenarioBundle.mockRejectedValueOnce(new Error("?"));
    expect(await downloadPlayableScenario(ID)).toBe("malformed");
  });

  it("refuses a scenario with no nation to play", async () => {
    bundles.loadScenarioBundle.mockResolvedValueOnce({
      header: header([SPAIN]),
    });
    expect(await downloadPlayableScenario(ID)).toBe("no_playable");
  });
});
