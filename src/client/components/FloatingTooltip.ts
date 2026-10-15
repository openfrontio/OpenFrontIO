import { html, render, TemplateResult } from "lit";

/**
 * A hover tooltip rendered into <body>, so it floats above cards and modal
 * panels that clip their overflow. One shared element: showing a new one
 * replaces the last. Placed above the anchor (below if there's no room),
 * right-aligned to it and clamped to the viewport. While shown it follows the
 * anchor every frame, and hides itself if the anchor leaves the page (lobby
 * cards re-render under the pointer, so mouseleave isn't guaranteed).
 */
let host: HTMLDivElement | null = null;
let anchor: HTMLElement | null = null;
let frame: number | null = null;

const GAP = 6;
const MARGIN = 8;

export function showFloatingTooltip(
  target: HTMLElement,
  content: TemplateResult,
): void {
  host ??= document.body.appendChild(document.createElement("div"));
  anchor = target;
  render(
    html`<div
      role="tooltip"
      class="pointer-events-none fixed z-[10030] w-max max-w-64 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-left text-xs normal-case tracking-normal text-white shadow-xl"
    >
      ${content}
    </div>`,
    host,
  );
  follow();
}

export function hideFloatingTooltip(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  anchor = null;
  if (host) render(html``, host);
}

function follow(): void {
  const tip = host?.firstElementChild as HTMLElement | null;
  if (!anchor || !tip || !anchor.isConnected) {
    hideFloatingTooltip();
    return;
  }
  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const above = a.top - GAP - t.height;
  const top = above >= MARGIN ? above : a.bottom + GAP;
  const left = Math.min(
    Math.max(MARGIN, a.right - t.width),
    window.innerWidth - t.width - MARGIN,
  );
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  frame = requestAnimationFrame(follow);
}
