import type { AudioCategory } from "../../core/game/UserSettings";
import type { CueCategory, SoundEffect } from "./Sounds";

/**
 * A way to play a cue without importing the mixer, and through it howler.
 *
 * UI components are mounted in tests that have no audio stack and no reason
 * to pay for one; pulling howler into their import graph costs real time in
 * jsdom and can leave an AudioContext behind. AudioMixer registers itself
 * here at init, and until it does this is a no-op.
 */
let player: ((name: SoundEffect) => void) | null = null;

export function setCuePlayer(fn: ((name: SoundEffect) => void) | null): void {
  player = fn;
}

export function playCue(name: SoundEffect): void {
  player?.(name);
}

/**
 * The slice of the mixer the settings tab needs: preview a channel's cue, and
 * ask whether that channel would be heard at all. Registered here for the same
 * reason as the cue player — the Audio tab must not drag howler into the
 * import graph of every test that mounts a settings modal.
 */
export interface AudioControls {
  previewCue(category: CueCategory): Promise<void>;
  isAudible(category: AudioCategory): boolean;
}

let controls: AudioControls | null = null;

export function setAudioControls(next: AudioControls | null): void {
  controls = next;
}

/** Null until AudioMixer registers itself; the tab hides its test buttons. */
export function audioControls(): AudioControls | null {
  return controls;
}
