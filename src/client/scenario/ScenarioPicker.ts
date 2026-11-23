/**
 * Picking a published scenario to play alone (docs/ScenarioEditor.md,
 * "Playing > Singleplayer"): who is offered it, downloading and checking a
 * scenario's latest version, and which of its nations a player may take.
 */

import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import {
  loadScenarioBundle,
  type ScenarioBundle,
  ScenarioBundleError,
  type ScenarioBundleHeader,
  type ScenarioBundleProblem,
} from "./ScenarioBundle";
import { SCENARIO_EDITOR_FLARE } from "./ScenarioEditorRoute";
import {
  downloadScenarioBundle,
  getPublishedScenario,
  MAX_BUNDLE_DOWNLOAD_BYTES,
  type ScenarioApiError,
} from "./ScenariosApi";

/**
 * Whether the Solo modal offers scenarios at all. For now, only to accounts
 * with the scenario editor flare: the shared list is other players' uploads,
 * and until there is a way to report one and take it down (OPE-884) they
 * must not be shown to everyone. Lift this once there is.
 */
export function scenarioPickerAllowed(userMe: UserMeResponse | false): boolean {
  return (
    userMe !== false &&
    (userMe.player.flares ?? []).includes(SCENARIO_EDITOR_FLARE)
  );
}

export type ScenarioPlayError =
  | ScenarioApiError
  | ScenarioBundleProblem
  // The bundle loaded, but none of its nations is playable.
  | "no_playable";

const ERROR_KEYS: Record<ScenarioPlayError, string> = {
  unauthorized: "scenario_picker.error.unauthorized",
  // The read endpoints refuse with none of these.
  entitlement: "scenario_picker.error.request_failed",
  limit: "scenario_picker.error.request_failed",
  conflict: "scenario_picker.error.request_failed",
  rejected: "scenario_picker.error.request_failed",
  not_found: "scenario_picker.error.not_found",
  request_failed: "scenario_picker.error.request_failed",
  too_large: "scenario_picker.error.too_large",
  format: "scenario_picker.error.incompatible",
  hash: "scenario_picker.error.hash",
  malformed: "scenario_picker.error.malformed",
  no_playable: "scenario_picker.error.no_playable",
};

/** The translation key for why a scenario can't be listed or played. */
export function scenarioPlayErrorKey(error: ScenarioPlayError): string {
  return ERROR_KEYS[error];
}

export type PlayableNation = ScenarioBundleHeader["nations"][number];

/**
 * The nations a player may take, in the scenario's order. The header's list
 * is for showing; the engine checks the pick against the snapshot's own
 * nations when it restores it.
 */
export function playableNations(
  header: ScenarioBundleHeader,
): PlayableNation[] {
  return header.nations.filter((n) => n.playable);
}

export interface DownloadedScenario {
  id: string;
  version: number;
  bundle: ScenarioBundle;
  nations: PlayableNation[];
}

/**
 * Downloads the scenario's latest version and checks it: the bundle must be
 * the one the listing names (its hash), one this build reads, and have a
 * nation to play.
 */
export async function downloadPlayableScenario(
  id: string,
): Promise<DownloadedScenario | ScenarioPlayError> {
  const detail = await getPublishedScenario(id);
  if (typeof detail === "string") return detail;
  const latest = detail.versions.reduce((a, b) =>
    b.version > a.version ? b : a,
  );
  if (latest.sizeBytes > MAX_BUNDLE_DOWNLOAD_BYTES) return "too_large";
  const gzipped = await downloadScenarioBundle(id, latest.version);
  if (typeof gzipped === "string") return gzipped;
  let bundle: ScenarioBundle;
  try {
    bundle = await loadScenarioBundle(gzipped, latest.hash);
  } catch (e) {
    console.warn(`scenario ${id} v${latest.version} doesn't load`, e);
    return e instanceof ScenarioBundleError ? e.problem : "malformed";
  }
  const nations = playableNations(bundle.header);
  if (nations.length === 0) return "no_playable";
  return { id, version: latest.version, bundle, nations };
}
