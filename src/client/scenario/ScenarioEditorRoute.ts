/**
 * The scenario editor's URL hash, `#scenario-editor`. Kept out of the editor
 * so Main can check it without loading the editor.
 */

const HASH = "#scenario-editor";

export function isScenarioEditorHash(hash: string): boolean {
  return hash === HASH;
}
