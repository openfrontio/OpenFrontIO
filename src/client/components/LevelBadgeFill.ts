// Staggered drawing for long lists of level badges.
//
// A badge is cheap to build but not to lay out: a full 150-player lobby puts
// 150 badges (300 in team mode, with the team cards) on screen at once, and
// the browser's style and layout of all those SVGs in one frame is what made
// the roster's first paint slow. Badges marked `stagger` that arrive many in
// one render are therefore drawn a few per frame instead: each first holds its
// square empty (so nothing moves when it is drawn) and this loop draws them,
// nearest the viewport first, sized so each frame stays inside a small
// budget. A few badges arriving at once (a player joining, a badge changing)
// are drawn straight away, as before.

/** What the loop needs from a badge waiting to be drawn. */
export interface StaggeredBadge {
  /** Draws the badge now in place of its empty square. */
  draw(): void;
  readonly updateComplete: Promise<boolean>;
  readonly isConnected: boolean;
  getBoundingClientRect(): DOMRect;
}

// Up to this many staggered badges arriving in one render are drawn
// straight away: about a millisecond or two of layout.
export const STAGGER_ABOVE = 8;
// Each frame's share of the drawing: its script plus the style and layout it
// causes, measured, steers how many badges the next frame draws.
const FRAME_BUDGET_MS = 5;
const FIRST_BATCH = 12;
const MIN_BATCH = 4;
const MAX_BATCH = 64;

// Waiting badges, in arrival (document) order until sorted.
const waiting = new Set<StaggeredBadge>();
let frame: number | null = null;
// New badges have arrived since the queue was last ordered.
let unsorted = false;
let batch = FIRST_BATCH;
// Staggered badges put on the page and not yet rendered: one render of a
// list. Counted afresh once that render's badges have all decided.
let arrivals = 0;
let countDone = false;
let idleWaiters: (() => void)[] = [];

export function badgeArrived(): void {
  arrivals++;
}

/**
 * At a staggered badge's first render: true when it arrived with too many
 * others to draw them all at once. A list's render puts all its badges on
 * the page before any of them renders (each renders in its own microtask,
 * queued as it is attached), so every badge of that render gets the same
 * answer; the count starts afresh in a microtask queued behind theirs.
 */
export function shouldStagger(): boolean {
  if (!countDone) {
    countDone = true;
    queueMicrotask(() => {
      arrivals = 0;
      countDone = false;
    });
  }
  return arrivals > STAGGER_ABOVE;
}

export function queueBadge(badge: StaggeredBadge): void {
  waiting.add(badge);
  unsorted = true;
  schedule();
}

export function dequeueBadge(badge: StaggeredBadge): void {
  if (!waiting.delete(badge) || waiting.size > 0) return;
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  settle();
}

export function pendingBadges(): number {
  return waiting.size;
}

export function badgeFrameScheduled(): boolean {
  return frame !== null;
}

/** Resolves once every waiting badge has been drawn (or removed). */
export function badgesDrawn(): Promise<void> {
  if (waiting.size === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function schedule(): void {
  frame ??= requestAnimationFrame(() => {
    frame = null;
    void tick();
  });
}

function settle(): void {
  batch = FIRST_BATCH;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) resolve();
}

// How far a badge is from the visible part of the page, in pixels.
function offscreenDistance(badge: StaggeredBadge): number {
  const r = badge.getBoundingClientRect();
  const h = window.innerHeight;
  if (r.bottom < 0) return -r.bottom;
  if (r.top > h) return r.top - h;
  return 0;
}

async function tick(): Promise<void> {
  if (unsorted) {
    // The frame the new rows arrive in: order them nearest the viewport
    // first and draw nothing yet, so that frame lays out only the rows. The
    // rects are read before anything changes here, from the layout this
    // frame needs anyway.
    unsorted = false;
    const order = [...waiting]
      .map((badge) => ({ badge, d: offscreenDistance(badge) }))
      .sort((a, b) => a.d - b.d);
    waiting.clear();
    for (const { badge } of order) waiting.add(badge);
    schedule();
    return;
  }
  const start = performance.now();
  const drawn: StaggeredBadge[] = [];
  for (const badge of waiting) {
    if (drawn.length >= batch) break;
    waiting.delete(badge);
    if (!badge.isConnected) continue;
    badge.draw();
    drawn.push(badge);
  }
  if (drawn.length > 0) {
    await Promise.all(drawn.map((b) => b.updateComplete));
    // Lay the new badges out now rather than after this callback, so their
    // real cost is measured; the browser would do the same work this frame.
    drawn[drawn.length - 1].getBoundingClientRect();
    const cost = performance.now() - start;
    const scale = FRAME_BUDGET_MS / Math.max(cost, 0.25);
    batch = Math.round(
      Math.min(
        MAX_BATCH,
        Math.max(MIN_BATCH, batch * Math.min(2, Math.max(0.5, scale))),
      ),
    );
  }
  if (waiting.size > 0) schedule();
  else if (frame === null) settle();
}
