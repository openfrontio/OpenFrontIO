/**
 * What `virtual:scenario-editor` resolves to in a build without the scenario
 * editor, and the interface the real one implements.
 *
 * The editor is closed source and lives in the src/client/scenario-editor
 * submodule, which forks and public CI don't have. A build that sets
 * SCENARIO_EDITOR=1 (see vite.config.ts) resolves the import to that
 * submodule's index.ts instead, which must export the same names with the
 * same types.
 */

/** The editor's root element, or null when this build has no editor. */
export function createScenarioEditor(): HTMLElement | null {
  return null;
}
