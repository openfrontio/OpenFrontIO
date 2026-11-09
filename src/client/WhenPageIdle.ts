/**
 * Runs `task` once the page has loaded and the browser is idle, for background
 * work that shouldn't compete with the page's own load. Safari has no
 * requestIdleCallback, so there it waits a second instead.
 */
export function whenPageIdle(task: () => void): void {
  const whenIdle = () => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(task, { timeout: 5000 });
    } else {
      setTimeout(task, 1000);
    }
  };
  if (document.readyState === "complete") {
    whenIdle();
  } else {
    window.addEventListener("load", whenIdle, { once: true });
  }
}
