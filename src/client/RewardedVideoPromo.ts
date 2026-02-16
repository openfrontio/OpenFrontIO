let rewardedUnitRegistered = false;
let rewardedAdReady = false;

// Listen for when rewarded ad becomes available
if (typeof window !== "undefined") {
  window.addEventListener("rewardedAdVideoRewardReady", () => {
    console.log("[RewardedVideoPromo] Rewarded ad is ready");
    rewardedAdReady = true;
  });
}

const AD_READY_TIMEOUT_MS = 3000;

function ensureRewardedUnitRegistered(): Promise<void> {
  console.log("[ensureRewardedUnitRegistered] Called", {
    rewardedUnitRegistered,
    rewardedAdReady,
    hasSpaAddAds: !!window.ramp?.spaAddAds,
  });

  return new Promise((resolve, reject) => {
    // Check for real SDK (not just stub from index.html)
    if (!window.ramp?.spaAddAds) {
      console.log(
        "[ensureRewardedUnitRegistered] Rejecting: spaAddAds not available",
      );
      reject(new Error("Ramp SDK not available"));
      return;
    }

    // If already registered and ready, resolve immediately
    if (rewardedUnitRegistered && rewardedAdReady) {
      console.log(
        "[ensureRewardedUnitRegistered] Already registered and ready",
      );
      resolve();
      return;
    }

    // Register the unit if not already registered
    if (!rewardedUnitRegistered) {
      try {
        window.ramp.spaAddAds([{ type: "rewarded_ad_video", selectorId: "" }]);
        rewardedUnitRegistered = true;
        console.log("[RewardedVideoPromo] Rewarded unit registered");
      } catch (e) {
        reject(e);
        return;
      }
    }

    // If ad is already ready, resolve
    if (rewardedAdReady) {
      console.log("[ensureRewardedUnitRegistered] Ad already ready");
      resolve();
      return;
    }

    // Wait for the rewardedAdVideoRewardReady event or no-fill event
    console.log("[ensureRewardedUnitRegistered] Waiting for ad to be ready...");
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("rewardedAdVideoRewardReady", onReady);
      window.removeEventListener("rewardedVideoNoFill", onNoFill);
      window.removeEventListener("rewardedAdNoFill", onNoFill);
      window.removeEventListener("pwNoFillEvent", onNoFill);
    };

    const onReady = () => {
      console.log("[ensureRewardedUnitRegistered] Ad is now ready");
      cleanup();
      resolve();
    };

    const onNoFill = () => {
      console.log("[ensureRewardedUnitRegistered] No fill event received");
      cleanup();
      reject(new Error("No rewarded ad available"));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      console.log("[ensureRewardedUnitRegistered] Timeout waiting for ad");
      reject(new Error("Ad timeout"));
    }, AD_READY_TIMEOUT_MS);

    window.addEventListener("rewardedAdVideoRewardReady", onReady);
    window.addEventListener("rewardedVideoNoFill", onNoFill);
    window.addEventListener("rewardedAdNoFill", onNoFill);
    window.addEventListener("pwNoFillEvent", onNoFill);
  });
}

export function showRewardedAd(): Promise<void> {
  console.log("[showRewardedAd] Called", {
    rewardedUnitRegistered,
  });

  return new Promise((resolve, reject) => {
    console.log("[showRewardedAd] Calling ensureRewardedUnitRegistered...");
    ensureRewardedUnitRegistered()
      .then(() => {
        console.log("[showRewardedAd] ensureRewardedUnitRegistered resolved");
        if (!window.ramp?.manuallyCreateRewardUi) {
          reject(new Error("Ramp SDK manuallyCreateRewardUi not available"));
          return;
        }

        // Set up event listeners before triggering the ad
        const cleanup = () => {
          window.removeEventListener(
            "rewardedAdRewardGranted",
            onRewardGranted,
          );
          window.removeEventListener("rewardedAdCompleted", onCompleted);
          window.removeEventListener("rewardedCloseButtonTriggered", onClosed);
          window.removeEventListener("rejectAdCloseCta", onRejected);
          // Destroy old unit and reset state so next ad attempt will re-register
          try {
            window.ramp?.destroyUnits?.("rewarded_ad_video");
          } catch (e) {
            console.error("[showRewardedAd] Failed to destroy unit:", e);
          }
          rewardedUnitRegistered = false;
          rewardedAdReady = false;
        };

        const onRewardGranted = () => {
          console.log("[showRewardedAd] Reward granted");
          cleanup();
          resolve();
        };

        const onCompleted = () => {
          console.log("[showRewardedAd] Ad completed without reward");
          // Don't resolve here - wait for rewardedAdRewardGranted
        };

        const onClosed = () => {
          console.log("[showRewardedAd] User closed ad early");
          cleanup();
          reject(new Error("User closed ad early"));
        };

        const onRejected = () => {
          console.log("[showRewardedAd] User rejected ad");
          cleanup();
          reject(new Error("User rejected ad"));
        };

        window.addEventListener("rewardedAdRewardGranted", onRewardGranted);
        window.addEventListener("rewardedAdCompleted", onCompleted);
        window.addEventListener("rewardedCloseButtonTriggered", onClosed);
        window.addEventListener("rejectAdCloseCta", onRejected);

        // Trigger the ad
        const result = window.ramp.manuallyCreateRewardUi({
          skipConfirmation: true,
        });

        // If it returns a promise that rejects, handle that too
        if (result && typeof result.then === "function") {
          result.catch((error: unknown) => {
            cleanup();
            reject(error);
          });
        }
      })
      .catch((err) => {
        console.log(
          "[showRewardedAd] ensureRewardedUnitRegistered rejected:",
          err,
        );
        reject(err);
      });
  });
}
