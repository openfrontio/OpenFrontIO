// Loader for the YouTube IFrame Player API, which <featured-stream> embeds with.

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
export interface YouTubeGlobal {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YouTubeGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SDK_SRC = "https://www.youtube.com/iframe_api";
// That script only bootstraps: it fetches the real player script itself and gives no
// error event if that one fails, so the ready callback can simply never come.
export const SDK_READY_TIMEOUT_MS = 30_000;

let sdkPromise: Promise<YouTubeGlobal> | undefined;

// Resolves once YT.Player is usable. A failed or stalled load is not cached, so the
// caller's next feed tick starts a new attempt.
export function loadYouTubeSdk(): Promise<YouTubeGlobal> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    const s = document.createElement("script");
    const fail = (message: string) => {
      clearTimeout(timer);
      s.remove();
      window.onYouTubeIframeAPIReady = prev;
      // The bootstrap leaves a window.YT marking the load as in progress, and would skip
      // fetching the player script on the next attempt if it found it. Assigned, not
      // deleted: the bootstrap declares it with a global `var`, so a delete would throw.
      window.YT = undefined;
      sdkPromise = undefined;
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail("YouTube SDK timed out"),
      SDK_READY_TIMEOUT_MS,
    );
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) {
        clearTimeout(timer);
        resolve(window.YT);
      } else {
        fail("YouTube SDK missing");
      }
    };
    s.src = SDK_SRC;
    s.async = true;
    s.onerror = () => fail("YouTube SDK failed to load");
    document.head.appendChild(s);
  });
  return sdkPromise;
}
