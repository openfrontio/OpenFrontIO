import type { SoundEffect } from "./Sounds";

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
